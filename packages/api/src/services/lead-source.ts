import type { Database } from "@Real-Estate-CRM/db";
import { leadChannel, leadSource } from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { badRequest, conflict, isUniqueViolation, notFound } from "./errors";
import type { Tenant } from "./tenancy";

/** Starting list for every company (brief §5); admins rename, add or archive. */
const DEFAULTS: { channel: string; inPerson: boolean; sources: string[] }[] = [
	{
		channel: "Online",
		inPerson: false,
		sources: ["Facebook", "Google", "Website", "LINE"],
	},
	{
		channel: "Offline",
		inPerson: true,
		sources: ["Walk-in", "Billboard", "Event"],
	},
	{
		channel: "Referral",
		inPerson: false,
		sources: ["Existing owner", "Friends & family"],
	},
];
export const UNKNOWN_SOURCE_NAME = "Don't know";

type Tx = Pick<Database, "select" | "insert">;

/** Creates the default channels/sources and "Don't know" once per company (idempotent). */
export async function ensureDefaultSources(tx: Tx, organizationId: string) {
	const [existing] = await tx
		.select({ id: leadSource.id })
		.from(leadSource)
		.where(
			and(
				eq(leadSource.organizationId, organizationId),
				eq(leadSource.isUnknown, true),
			),
		);
	if (existing) return;

	for (const [i, d] of DEFAULTS.entries()) {
		const [channel] = await tx
			.insert(leadChannel)
			.values({
				organizationId,
				name: d.channel,
				inPerson: d.inPerson,
				sortOrder: i,
			})
			.onConflictDoNothing()
			.returning({ id: leadChannel.id });
		if (!channel) continue;
		await tx.insert(leadSource).values(
			d.sources.map((name, j) => ({
				organizationId,
				channelId: channel.id,
				name,
				sortOrder: j,
			})),
		);
	}
	await tx
		.insert(leadSource)
		.values({
			organizationId,
			name: UNKNOWN_SOURCE_NAME,
			isUnknown: true,
			sortOrder: 999,
		})
		.onConflictDoNothing();
}

const name = z.string().trim().min(1).max(60);
export const createChannelInput = z.strictObject({ name });
export const renameChannelInput = z.strictObject({ channelId: z.uuid(), name });
export const createSourceInput = z.strictObject({ channelId: z.uuid(), name });
export const renameSourceInput = z.strictObject({ sourceId: z.uuid(), name });
export const archiveSourceInput = z.strictObject({
	sourceId: z.uuid(),
	archived: z.boolean(),
});
export const channelInPersonInput = z.strictObject({
	channelId: z.uuid(),
	inPerson: z.boolean(),
});

/** Channels with their sources (archived included, flagged) and the "Don't know" source. */
export async function listLeadSources(db: Database, tenant: Tenant) {
	await db.transaction((tx) => ensureDefaultSources(tx, tenant.organizationId));
	const [channels, sources] = await Promise.all([
		db
			.select({
				id: leadChannel.id,
				name: leadChannel.name,
				inPerson: leadChannel.inPerson,
			})
			.from(leadChannel)
			.where(eq(leadChannel.organizationId, tenant.organizationId))
			.orderBy(asc(leadChannel.sortOrder), asc(leadChannel.name)),
		db
			.select({
				id: leadSource.id,
				channelId: leadSource.channelId,
				name: leadSource.name,
				isUnknown: leadSource.isUnknown,
				archived: leadSource.archivedAt,
			})
			.from(leadSource)
			.where(eq(leadSource.organizationId, tenant.organizationId))
			.orderBy(asc(leadSource.sortOrder), asc(leadSource.name)),
	]);
	return {
		channels: channels.map((c) => ({
			...c,
			sources: sources
				.filter((s) => s.channelId === c.id)
				.map(({ archived, ...s }) => ({ ...s, archived: archived !== null })),
		})),
		unknownSourceId: sources.find((s) => s.isUnknown)?.id ?? null,
	};
}

/** A source the company can assign to a new lead (not archived), with its channel. */
export async function requireActiveSource(
	db: Pick<Database, "select">,
	tenant: Tenant,
	sourceId: string,
) {
	const [row] = await db
		.select({
			id: leadSource.id,
			channelId: leadSource.channelId,
			inPerson: sql<boolean>`coalesce(${leadChannel.inPerson}, false)`,
		})
		.from(leadSource)
		.leftJoin(leadChannel, eq(leadChannel.id, leadSource.channelId))
		.where(
			and(
				eq(leadSource.id, sourceId),
				eq(leadSource.organizationId, tenant.organizationId),
				isNull(leadSource.archivedAt),
			),
		);
	if (!row) notFound("Source");
	return row;
}

export async function createChannel(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createChannelInput>,
) {
	try {
		return await db.transaction(async (tx) => {
			const [last] = await tx
				.select({ max: max(leadChannel.sortOrder) })
				.from(leadChannel)
				.where(eq(leadChannel.organizationId, tenant.organizationId));
			const [created] = await tx
				.insert(leadChannel)
				.values({
					organizationId: tenant.organizationId,
					name: input.name,
					sortOrder: (last?.max ?? -1) + 1,
				})
				.returning({ id: leadChannel.id });
			if (!created) throw new Error("insert returned no row");
			await writeAudit(tx, tenant, {
				action: "lead_channel.create",
				entityType: "lead_channel",
				entityId: created.id,
			});
			return created;
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A channel with this name exists");
		throw error;
	}
}

/** Admins mark channels where the customer meets us in person (capture needs details). */
export async function setChannelInPerson(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof channelInPersonInput>,
) {
	await db.transaction(async (tx) => {
		const updated = await tx
			.update(leadChannel)
			.set({ inPerson: input.inPerson })
			.where(
				and(
					eq(leadChannel.id, input.channelId),
					eq(leadChannel.organizationId, tenant.organizationId),
				),
			)
			.returning({ id: leadChannel.id });
		if (updated.length === 0) notFound("Channel");
		await writeAudit(tx, tenant, {
			action: "lead_channel.in_person",
			entityType: "lead_channel",
			entityId: input.channelId,
			after: { inPerson: input.inPerson },
		});
	});
}

export async function renameChannel(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof renameChannelInput>,
) {
	try {
		await db.transaction(async (tx) => {
			const updated = await tx
				.update(leadChannel)
				.set({ name: input.name })
				.where(
					and(
						eq(leadChannel.id, input.channelId),
						eq(leadChannel.organizationId, tenant.organizationId),
					),
				)
				.returning({ id: leadChannel.id });
			if (updated.length === 0) notFound("Channel");
			await writeAudit(tx, tenant, {
				action: "lead_channel.rename",
				entityType: "lead_channel",
				entityId: input.channelId,
			});
		});
	} catch (error) {
		if (isUniqueViolation(error)) conflict("A channel with this name exists");
		throw error;
	}
}

export async function createSource(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof createSourceInput>,
) {
	return db.transaction(async (tx) => {
		const [channel] = await tx
			.select({ id: leadChannel.id })
			.from(leadChannel)
			.where(
				and(
					eq(leadChannel.id, input.channelId),
					eq(leadChannel.organizationId, tenant.organizationId),
				),
			);
		if (!channel) notFound("Channel");
		const [last] = await tx
			.select({ max: max(leadSource.sortOrder) })
			.from(leadSource)
			.where(eq(leadSource.channelId, channel.id));
		const [created] = await tx
			.insert(leadSource)
			.values({
				organizationId: tenant.organizationId,
				channelId: channel.id,
				name: input.name,
				sortOrder: (last?.max ?? -1) + 1,
			})
			.returning({ id: leadSource.id });
		if (!created) throw new Error("insert returned no row");
		await writeAudit(tx, tenant, {
			action: "lead_source.create",
			entityType: "lead_source",
			entityId: created.id,
			after: { channelId: channel.id },
		});
		return created;
	});
}

async function updateSource(
	db: Database,
	tenant: Tenant,
	sourceId: string,
	set: Partial<typeof leadSource.$inferInsert>,
	action: string,
) {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select({ isUnknown: leadSource.isUnknown })
			.from(leadSource)
			.where(
				and(
					eq(leadSource.id, sourceId),
					eq(leadSource.organizationId, tenant.organizationId),
				),
			);
		if (!row) notFound("Source");
		if (row.isUnknown) badRequest(`"${UNKNOWN_SOURCE_NAME}" is fixed`);
		await tx.update(leadSource).set(set).where(eq(leadSource.id, sourceId));
		await writeAudit(tx, tenant, {
			action,
			entityType: "lead_source",
			entityId: sourceId,
		});
	});
}

export const renameSource = (
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof renameSourceInput>,
) =>
	updateSource(
		db,
		tenant,
		input.sourceId,
		{ name: input.name },
		"lead_source.rename",
	);

/** Archived sources stay on existing leads but can't be chosen for new ones. */
export const archiveSource = (
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof archiveSourceInput>,
) =>
	updateSource(
		db,
		tenant,
		input.sourceId,
		{ archivedAt: input.archived ? new Date() : null },
		input.archived ? "lead_source.archive" : "lead_source.unarchive",
	);
