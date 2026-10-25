import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	disqualifyReasons,
	lead,
	lostReasons,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
	requireActor,
	requireOpenLead,
	requireOpenOpportunity,
} from "./activity";
import { requireVisibleLead, requireVisibleOpportunity } from "./lead-access";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";

const note = z.string().trim().max(1000).optional();
const otherNeedsNote = (v: { reason: string; note?: string }) =>
	v.reason !== "other" || !!v.note;
const otherNote = { message: "Add a note for “Other”", path: ["note"] };

export const disqualifyLeadInput = z
	.strictObject({
		leadId: z.uuid(),
		reason: z.enum(disqualifyReasons),
		note,
	})
	.refine(otherNeedsNote, otherNote);

export const nurtureLeadInput = z.strictObject({ leadId: z.uuid(), note });

export const markLostInput = z
	.strictObject({
		opportunityId: z.uuid(),
		reason: z.enum(lostReasons),
		note,
	})
	.refine(otherNeedsNote, otherNote);

export const setOpportunityStageInput = z.strictObject({
	opportunityId: z.uuid(),
	/** Deposited and later come from deposits (M6). */
	stage: z.enum(["visited", "negotiating"]),
	note,
});

/**
 * Lead exits (brief §6): Disqualify with a reason, or Nurture for wrong
 * timing. The owner keeps the lead for history; deadline and follow-up are
 * cleared (freeing a claim slot). A new enquiry reopens it.
 */
export async function disqualifyLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof disqualifyLeadInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		await tx
			.update(lead)
			.set({
				status: "disqualified",
				disqualifyReason: input.reason,
				nextFollowUpAt: null,
				contactDeadlineAt: null,
			})
			.where(eq(lead.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type: "stage_change",
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, to: "disqualified", reason: input.reason },
		});
	});
}

export async function nurtureLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof nurtureLeadInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		const rules = await getRules(tx, tenant.organizationId);
		const now = new Date();
		await tx
			.update(lead)
			.set({
				status: "nurturing",
				nurtureNextCheckAt: new Date(
					now.getTime() + rules.nurtureCheckDays * 86_400_000,
				),
				ignoredNurtureCount: 0,
				nextFollowUpAt: null,
				contactDeadlineAt: null,
			})
			.where(eq(lead.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type: "stage_change",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, to: "nurturing" },
		});
	});
}

/** Deal exit after a visit (brief §6): Lost with a reason. */
export async function markLost(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof markLostInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		requireOpenOpportunity(row);
		const now = new Date();
		await tx
			.update(opportunity)
			.set({
				stage: "lost",
				lostReason: input.reason,
				lostAt: now,
				nextFollowUpAt: null,
			})
			.where(eq(opportunity.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: "stage_change",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.stage, to: "lost", reason: input.reason },
		});
	});
}

/** Visited ⇄ Negotiating (unit selection); later stages come from deposits. */
export async function setOpportunityStage(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof setOpportunityStageInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		requireOpenOpportunity(row);
		if (row.stage === input.stage) return;
		await tx
			.update(opportunity)
			.set({ stage: input.stage })
			.where(eq(opportunity.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: "stage_change",
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.stage, to: input.stage },
		});
	});
}
