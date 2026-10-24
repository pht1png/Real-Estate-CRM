import type { Database } from "@Real-Estate-CRM/db";
import {
	campaign,
	leadChannel,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import { requireProject } from "./scope";
import type { Tenant } from "./tenancy";
import { isoDate } from "./validation";

const fields = {
	name: z.string().trim().min(1).max(120),
	code: z
		.string()
		.trim()
		.min(2)
		.max(60)
		.regex(
			/^[A-Za-z0-9][A-Za-z0-9._-]*$/,
			"Letters, digits, dot, dash or underscore",
		),
	startsOn: isoDate,
	endsOn: isoDate.nullable(),
};

export const listCampaignsInput = z.strictObject({
	projectId: z.uuid().optional(),
	includeArchived: z.boolean().optional(),
});
export const createCampaignInput = z.strictObject({
	projectId: z.uuid(),
	channelId: z.uuid(),
	...fields,
	endsOn: fields.endsOn.optional(),
});
export const updateCampaignInput = z.strictObject({
	campaignId: z.uuid(),
	channelId: z.uuid().optional(),
	name: fields.name.optional(),
	code: fields.code.optional(),
	startsOn: fields.startsOn.optional(),
	endsOn: fields.endsOn.optional(),
	archived: z.boolean().optional(),
});

/** Campaigns in projects the tenant can see. */
export async function listCampaigns(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listCampaignsInput>,
) {
	if (input.projectId) await requireProject(db, tenant, input.projectId);
	if (tenant.projectIds?.length === 0) return [];
	const rows = await db
		.select({
			id: campaign.id,
			projectId: campaign.projectId,
			projectName: project.name,
			channelId: campaign.channelId,
			channelName: leadChannel.name,
			name: campaign.name,
			code: campaign.code,
			startsOn: campaign.startsOn,
			endsOn: campaign.endsOn,
			archivedAt: campaign.archivedAt,
		})
		.from(campaign)
		.innerJoin(project, eq(project.id, campaign.projectId))
		.innerJoin(leadChannel, eq(leadChannel.id, campaign.channelId))
		.where(
			and(
				eq(campaign.organizationId, tenant.organizationId),
				input.projectId ? eq(campaign.projectId, input.projectId) : undefined,
				tenant.projectIds
					? inArray(campaign.projectId, tenant.projectIds)
					: undefined,
				input.includeArchived ? undefined : isNull(campaign.archivedAt),
			),
		)
		.orderBy(desc(campaign.startsOn), asc(campaign.name));
	return rows.map(({ archivedAt, ...r }) => ({
		...r,
		archived: archivedAt !== null,
	}));
}

async function requireChannel(
	db: Pick<Database, "select">,
	tenant: Tenant,
	channelId: string,
) {
	const [row] = await db
		.select({ id: leadChannel.id })
		.from(leadChannel)
		.where(
			and(
				eq(leadChannel.id, channelId),
				eq(leadChannel.organizationId, tenant.organizationId),
			),
		);
	if (!row) notFound("Channel");
}

function assertDates(
	startsOn: string | undefined,
	endsOn: string | null | undefined,
) {
	if (startsOn && endsOn && endsOn < startsOn)
		badRequest("End date is before start date");
}

export async function createCampaign(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createCampaignInput>,
) {
	assertDates(input.startsOn, input.endsOn);
	try {
		return await db.transaction(async (tx) => {
			await requireProject(tx, tenant, input.projectId);
			await requireChannel(tx, tenant, input.channelId);
			const [created] = await tx
				.insert(campaign)
				.values({ organizationId: tenant.organizationId, ...input })
				.returning({ id: campaign.id });
			if (!created) throw new Error("insert returned no row");
			await writeAudit(tx, tenant, {
				action: "campaign.create",
				entityType: "campaign",
				entityId: created.id,
				after: { projectId: input.projectId, code: input.code },
			});
			return created;
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A campaign with this code exists");
		throw error;
	}
}

export async function updateCampaign(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateCampaignInput>,
) {
	const { campaignId, archived, ...changes } = input;
	try {
		await db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(campaign)
				.where(
					and(
						eq(campaign.id, campaignId),
						eq(campaign.organizationId, tenant.organizationId),
					),
				);
			if (!row) notFound("Campaign");
			await requireProject(tx, tenant, row.projectId);
			if (changes.channelId)
				await requireChannel(tx, tenant, changes.channelId);
			assertDates(
				changes.startsOn ?? row.startsOn,
				changes.endsOn === undefined ? row.endsOn : changes.endsOn,
			);
			await tx
				.update(campaign)
				.set({
					...changes,
					...(archived !== undefined && {
						archivedAt: archived ? new Date() : null,
					}),
				})
				.where(eq(campaign.id, campaignId));
			await writeAudit(tx, tenant, {
				action: "campaign.update",
				entityType: "campaign",
				entityId: campaignId,
				after: { fields: Object.keys(input).filter((k) => k !== "campaignId") },
			});
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A campaign with this code exists");
		throw error;
	}
}

/** A campaign that may be put on a new lead: same project, not archived. */
export async function requireActiveCampaign(
	db: Pick<Database, "select">,
	tenant: Tenant,
	campaignId: string,
	projectId: string,
) {
	const [row] = await db
		.select({ id: campaign.id, channelId: campaign.channelId })
		.from(campaign)
		.where(
			and(
				eq(campaign.id, campaignId),
				eq(campaign.organizationId, tenant.organizationId),
				eq(campaign.projectId, projectId),
				isNull(campaign.archivedAt),
			),
		);
	if (!row) notFound("Campaign");
	return row;
}
