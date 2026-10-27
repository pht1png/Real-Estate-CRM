import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	fundingTypes,
	lead,
	liveOpportunityStatuses,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
	futureDateTime,
	requireActor,
	requireFutureFollowUp,
	requireOpenLead,
	requireOpenOpportunity,
} from "./activity";
import { openOpportunity } from "./conversion";
import { badRequest } from "./errors";
import { requireVisibleLead, requireVisibleOpportunity } from "./lead-access";
import type { Tenant } from "./tenancy";

type Tx = Pick<Database, "select" | "insert" | "update">;

const visitFields = {
	/** When the customer was at the showroom; defaults to now, never in the future. */
	visitedAt: z.iso.datetime({ offset: true }).optional(),
	note: z.string().trim().max(1000).optional(),
	nextFollowUpAt: futureDateTime,
};

/** Confirm visit on a lead (brief §2): the first visit converts it. */
export const confirmVisitInput = z.strictObject({
	leadId: z.uuid(),
	...visitFields,
});

/** A repeat walk-in on an opportunity, without an appointment. */
export const recordVisitInput = z.strictObject({
	opportunityId: z.uuid(),
	...visitFields,
});

export const setFundingInput = z.strictObject({
	opportunityId: z.uuid(),
	fundingType: z.enum(fundingTypes),
});

/** The visit time: given or now, never in the future. */
export function visitTime(value: string | undefined, now = new Date()) {
	const visitedAt = value ? new Date(value) : now;
	if (visitedAt > now) badRequest("The visit can't be in the future");
	return visitedAt;
}

/**
 * The only writer of showroom visits (brief §6), walk-in or by appointment.
 * No live opportunity yet: the lead (qualified) converts and the opportunity
 * starts with this visit. Otherwise the opportunity's visit summary moves on;
 * its status stays. Either way one `visit` activity is logged. Takes the
 * lead locked by the caller.
 */
export async function recordVisit(
	tx: Tx,
	tenant: Tenant,
	input: {
		lead: typeof lead.$inferSelect;
		visitedAt: Date;
		nextFollowUpAt: Date;
		appointmentId?: string;
		note?: string;
	},
	now = new Date(),
) {
	const row = input.lead;
	const [live] = await tx
		.select()
		.from(opportunity)
		.where(
			and(
				eq(opportunity.leadId, row.id),
				inArray(opportunity.status, [...liveOpportunityStatuses]),
			),
		)
		.for("update");

	let opportunityId: string;
	if (!live) {
		opportunityId = await openOpportunity(
			tx,
			tenant,
			row,
			input.visitedAt,
			input.nextFollowUpAt,
			now,
		);
	} else {
		requireActor(tenant, live);
		requireOpenOpportunity(live);
		opportunityId = live.id;
		await tx
			.update(opportunity)
			.set({
				visitCount: sql`${opportunity.visitCount} + 1`,
				lastVisitAt: sql`greatest(${opportunity.lastVisitAt}, ${input.visitedAt})`,
				nextFollowUpAt: input.nextFollowUpAt,
			})
			.where(eq(opportunity.id, live.id));
	}
	await tx.insert(activity).values({
		organizationId: tenant.organizationId,
		leadId: row.id,
		opportunityId,
		type: "visit",
		at: input.visitedAt,
		byUserId: tenant.userId,
		note: input.note || null,
		data: {
			nextFollowUpAt: input.nextFollowUpAt.toISOString(),
			...(input.appointmentId && { appointmentId: input.appointmentId }),
		},
	});
	return { opportunityId, converted: !live };
}

/** The lead, visible to the tenant, locked so two confirmations make one opportunity. */
export async function lockVisibleLead(tx: Tx, tenant: Tenant, leadId: string) {
	const visible = await requireVisibleLead(tx, tenant, leadId);
	const [row] = await tx
		.select()
		.from(lead)
		.where(eq(lead.id, visible.id))
		.for("update");
	if (!row) badRequest("Lead not found");
	return row;
}

/**
 * Confirm visit (brief §2): the salesperson confirms the customer actually
 * came to the showroom, and the qualified lead converts.
 */
export async function confirmVisit(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof confirmVisitInput>,
) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const row = await lockVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		// Repeat visits go through the opportunity (or its appointment).
		requireOpenLead(row);
		const { opportunityId } = await recordVisit(
			tx,
			tenant,
			{
				lead: row,
				visitedAt: visitTime(input.visitedAt, now),
				nextFollowUpAt: requireFutureFollowUp(input.nextFollowUpAt, now),
				note: input.note,
			},
			now,
		);
		return { opportunityId };
	});
}

/** Record visit on an opportunity: a repeat walk-in. */
export async function recordOpportunityVisit(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof recordVisitInput>,
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		const opp = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, opp);
		requireOpenOpportunity(opp);
		const row = await lockVisibleLead(tx, tenant, opp.leadId);
		await recordVisit(
			tx,
			tenant,
			{
				lead: row,
				visitedAt: visitTime(input.visitedAt, now),
				nextFollowUpAt: requireFutureFollowUp(input.nextFollowUpAt, now),
				note: input.note,
			},
			now,
		);
	});
}

/**
 * How the buyer pays (cash / mortgage / both). Loan details wait for the
 * mortgage milestone (M6b). The change is kept on the timeline.
 */
export async function setFunding(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof setFundingInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		if (row.status === "lost" || row.status === "transferred") {
			badRequest("This opportunity is closed");
		}
		if (row.fundingType === input.fundingType) return;
		await tx
			.update(opportunity)
			.set({ fundingType: input.fundingType })
			.where(eq(opportunity.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: "note",
			byUserId: tenant.userId,
			data: { funding: { from: row.fundingType, to: input.fundingType } },
		});
	});
}
