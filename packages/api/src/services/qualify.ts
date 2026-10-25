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
import { requireVisibleLead } from "./lead-access";
import type { Tenant } from "./tenancy";
import { satang } from "./validation";

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
 * Mark qualified (brief §6): the salesperson confirms the person, a budget
 * that fits, when they plan to buy, what they want and why. Allowed from any
 * open vetting status; a walk-in may also convert without it.
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

		// Unit types wanted come from this project's list (required when it has types).
		const types = await tx
			.select({ id: unitType.id })
			.from(unitType)
			.where(eq(unitType.projectId, row.projectId));
		const unitTypeIds = [...new Set(input.unitTypeIds)];
		if (types.length > 0 && unitTypeIds.length === 0) {
			badRequest("Choose the unit types they want");
		}
		if (unitTypeIds.length > 0) {
			const [found] = await tx
				.select({ n: sql<number>`count(*)::int` })
				.from(unitType)
				.where(
					and(
						eq(unitType.projectId, row.projectId),
						inArray(unitType.id, unitTypeIds),
					),
				);
			if ((found?.n ?? 0) !== unitTypeIds.length) {
				badRequest("A unit type isn't in this project");
			}
		}

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
