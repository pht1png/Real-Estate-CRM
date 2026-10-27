import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	disqualifyReasons,
	lead,
	lostReasons,
	type OpportunityStatus,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
	requireActor,
	requireOpenLead,
	requireOpenOpportunity,
} from "./activity";
import { writeAudit } from "./audit";
import { badRequest, forbidden } from "./errors";
import { requireVisibleLead, requireVisibleOpportunity } from "./lead-access";
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

/**
 * Manual status moves: Visited ⇄ Negotiating (unit selection), and
 * Contracted → Waiting for mortgage result → Transferred for mortgage buyers.
 * Deposited and Contracted come from deposits (M6).
 */
const manualMoves: Partial<Record<OpportunityStatus, OpportunityStatus[]>> = {
	visited: ["negotiating"],
	negotiating: ["visited"],
	contracted: ["waiting_mortgage_result"],
	waiting_mortgage_result: ["transferred"],
};

export const setOpportunityStatusInput = z.strictObject({
	opportunityId: z.uuid(),
	status: z.enum([
		"visited",
		"negotiating",
		"waiting_mortgage_result",
		"transferred",
	]),
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
			type: "status_change",
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, to: "disqualified", reason: input.reason },
		});
	});
}

/**
 * Nurture (brief §6): wrong timing. The lead goes to the nurturing pool,
 * unowned and claimable by anyone; the previous owner stays in the history.
 * A claim or a new enquiry brings it back.
 */
export async function nurtureLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof nurtureLeadInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		const now = new Date();
		await tx
			.update(lead)
			.set({
				status: "nurturing",
				ownerMemberId: null,
				claimedAt: null,
				nextFollowUpAt: null,
				contactDeadlineAt: null,
			})
			.where(eq(lead.id, row.id));
		await tx.insert(activity).values([
			{
				organizationId: tenant.organizationId,
				leadId: row.id,
				type: "status_change",
				at: now,
				byUserId: tenant.userId,
				note: input.note || null,
				data: { from: row.status, to: "nurturing" },
			},
			{
				organizationId: tenant.organizationId,
				leadId: row.id,
				type: "assignment",
				at: now,
				byUserId: tenant.userId,
				data: { from: row.ownerMemberId, to: null, reason: "nurtured" },
			},
		]);
		await writeAudit(tx, tenant, {
			action: "lead.assign",
			entityType: "lead",
			entityId: row.id,
			before: { ownerMemberId: row.ownerMemberId },
			after: { ownerMemberId: null, reason: "nurtured" },
		});
	});
}

/** Opportunity exit after a visit (brief §6): Lost with a reason. */
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
		// A rejected mortgage can still lose a contracted sale; cancelling a
		// deposit or contract otherwise comes with deposits (M6).
		if (row.status !== "waiting_mortgage_result") requireOpenOpportunity(row);
		const now = new Date();
		await tx
			.update(opportunity)
			.set({
				status: "lost",
				lostReason: input.reason,
				lostAt: now,
				nextFollowUpAt: null,
			})
			.where(eq(opportunity.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: "status_change",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, to: "lost", reason: input.reason },
		});
	});
}

export async function setOpportunityStatus(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof setOpportunityStatusInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		if (row.status === input.status) return;
		if (!manualMoves[row.status]?.includes(input.status)) {
			badRequest("This status change isn't allowed");
		}
		// Brief §4/§6: a sales manager marks an opportunity Transferred.
		if (
			input.status === "transferred" &&
			!roleCan(tenant.role, { lead: ["assign"] })
		) {
			forbidden("A sales manager marks the transfer");
		}
		if (
			input.status === "waiting_mortgage_result" &&
			row.fundingType !== "mortgage" &&
			row.fundingType !== "cash_mortgage"
		) {
			badRequest("Set the funding to a mortgage first");
		}
		await tx
			.update(opportunity)
			.set({
				status: input.status,
				// Nothing left to follow up once the unit is transferred.
				...(input.status === "transferred" && { nextFollowUpAt: null }),
			})
			.where(eq(opportunity.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: "status_change",
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, to: input.status },
		});
	});
}
