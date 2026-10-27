import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	buyerIntents,
	buyingTimelines,
	lead,
	unitType,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
	futureDateTime,
	logStatusChange,
	requireActor,
	requireFutureFollowUp,
	requireOpenLead,
} from "./activity";
import { badRequest } from "./errors";
import {
	assessFit,
	FIT_VERSION,
	projectPriceRange,
	qualificationRulesOf,
} from "./fit";
import { requireVisibleLead } from "./lead-access";
import type { Tenant } from "./tenancy";
import { satang } from "./validation";

type Executor = Pick<Database, "select">;

export const qualifyLeadInput = z
	.strictObject({
		leadId: z.uuid(),
		budgetMinSatang: satang,
		budgetMaxSatang: satang,
		buyingTimeline: z.enum(buyingTimelines),
		unitTypeIds: z.array(z.uuid()).max(50),
		buyerIntent: z.enum(buyerIntents),
		note: z.string().trim().max(1000).optional(),
		nextFollowUpAt: futureDateTime,
	})
	.refine((v) => v.budgetMinSatang <= v.budgetMaxSatang, {
		message: "Minimum budget is above maximum",
		path: ["budgetMaxSatang"],
	});

/**
 * Unit types wanted, from this project's list: deduped, all in the project,
 * and at least one when the project has types and `required` is set.
 */
export async function checkUnitTypes(
	db: Executor,
	projectId: string,
	ids: readonly string[],
	required: boolean,
) {
	const unitTypeIds = [...new Set(ids)];
	const [counts] = await db
		.select({
			all: sql<number>`count(*)::int`,
			chosen:
				unitTypeIds.length > 0
					? sql<number>`count(*) filter (where ${inArray(unitType.id, unitTypeIds)})::int`
					: sql<number>`0`,
		})
		.from(unitType)
		.where(eq(unitType.projectId, projectId));
	if (required && (counts?.all ?? 0) > 0 && unitTypeIds.length === 0) {
		badRequest("Choose the unit types they want");
	}
	if ((counts?.chosen ?? 0) !== unitTypeIds.length) {
		badRequest("A unit type isn't in this project");
	}
	return unitTypeIds;
}

/**
 * Mark qualified (brief §6): the salesperson confirms the person, a budget
 * that fits, when they plan to buy, what they want and why. Allowed from any
 * open vetting status; converting a lead requires it.
 */
export async function qualifyLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof qualifyLeadInput>,
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		const nextFollowUpAt = requireFutureFollowUp(input.nextFollowUpAt, now);
		const unitTypeIds = await checkUnitTypes(
			tx,
			row.projectId,
			input.unitTypeIds,
			true,
		);
		await tx
			.update(lead)
			.set({
				status: "qualified",
				budgetMinSatang: input.budgetMinSatang,
				budgetMaxSatang: input.budgetMaxSatang,
				buyingTimeline: input.buyingTimeline,
				unitTypeIds,
				buyerIntent: input.buyerIntent,
				qualifiedAt: now,
				contactDeadlineAt: null,
				nextFollowUpAt,
			})
			.where(eq(lead.id, row.id));
		if (row.status !== "qualified") {
			await logStatusChange(
				tx,
				tenant,
				row.id,
				row.status,
				"qualified",
				"qualified",
				now,
			);
		}
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type: "qualified",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			// Snapshot for the Phase 2 scoring model (brief §11).
			data: {
				budgetMinSatang: input.budgetMinSatang,
				budgetMaxSatang: input.budgetMaxSatang,
				buyingTimeline: input.buyingTimeline,
				unitTypeIds,
				buyerIntent: input.buyerIntent,
			},
		});
	});
}

/**
 * Project opt-in (brief §6): a lead that fits, with unit types (when the
 * project has them) and buyer intent, becomes Qualified by the system.
 * Too early / budget-doesn't-fit are only ever suggestions.
 */
export async function autoQualifyIfFits(
	tx: Pick<Database, "select" | "insert" | "update">,
	organizationId: string,
	proj: {
		id: string;
		qualificationRules: Parameters<
			typeof qualificationRulesOf
		>[0]["qualificationRules"];
	},
	row: {
		id: string;
		status: string;
		budgetMinSatang: number | null;
		budgetMaxSatang: number | null;
		buyingTimeline: (typeof buyingTimelines)[number] | null;
		unitTypeIds: string[];
		buyerIntent: (typeof buyerIntents)[number] | null;
	},
	now = new Date(),
) {
	const rules = qualificationRulesOf(proj);
	const fit = assessFit(
		{ ...row, priceRange: await projectPriceRange(tx, proj.id) },
		rules,
	);
	const suggestion = { fit, qualified: false };
	if (!rules.autoQualify || fit !== "fits" || !row.buyerIntent) {
		return suggestion;
	}
	if (!["new", "attempting", "connected"].includes(row.status)) {
		return suggestion;
	}
	const [types] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(unitType)
		.where(eq(unitType.projectId, proj.id));
	if ((types?.n ?? 0) > 0 && row.unitTypeIds.length === 0) return suggestion;

	await tx
		.update(lead)
		.set({ status: "qualified", qualifiedAt: now, contactDeadlineAt: null })
		.where(and(eq(lead.id, row.id), eq(lead.organizationId, organizationId)));
	await tx.insert(activity).values([
		{
			organizationId,
			leadId: row.id,
			type: "status_change",
			at: now,
			data: { from: row.status, to: "qualified", reason: FIT_VERSION },
		},
		{
			organizationId,
			leadId: row.id,
			type: "qualified",
			at: now,
			data: {
				rule: FIT_VERSION,
				budgetMinSatang: row.budgetMinSatang,
				budgetMaxSatang: row.budgetMaxSatang,
				buyingTimeline: row.buyingTimeline,
				unitTypeIds: row.unitTypeIds,
				buyerIntent: row.buyerIntent,
			},
		},
	]);
	return { fit, qualified: true };
}
