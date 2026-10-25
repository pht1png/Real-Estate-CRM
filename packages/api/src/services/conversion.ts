import type { Database } from "@Real-Estate-CRM/db";
import { activity, lead, opportunity } from "@Real-Estate-CRM/db/schema/index";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
	futureDateTime,
	logStatusChange,
	requireActor,
	requireFutureFollowUp,
	requireOpenLead,
} from "./activity";
import { writeAudit } from "./audit";
import { badRequest, conflict } from "./errors";
import { requireVisibleLead } from "./lead-access";
import type { Tenant } from "./tenancy";

export const convertLeadInput = z.strictObject({
	leadId: z.uuid(),
	/** When the customer was at the showroom; defaults to now, never in the future. */
	visitedAt: z.iso.datetime({ offset: true }).optional(),
	note: z.string().trim().max(1000).optional(),
	nextFollowUpAt: futureDateTime,
});

/**
 * Conversion trigger (brief §2): the salesperson confirms the customer
 * actually came to the showroom. The lead becomes converted and a deal
 * (opportunity) starts at Visited. This is the only way to create one; a
 * booked tour doesn't convert until it happens.
 */
export async function convertLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof convertLeadInput>,
) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const visible = await requireVisibleLead(tx, tenant, input.leadId);
		// Lock so two confirmations at once create one deal.
		const [row] = await tx
			.select()
			.from(lead)
			.where(eq(lead.id, visible.id))
			.for("update");
		if (!row) badRequest("Lead not found");
		requireActor(tenant, row);
		requireOpenLead(row);
		if (!row.ownerMemberId) badRequest("Claim or assign the lead first");
		const visitedAt = input.visitedAt ? new Date(input.visitedAt) : now;
		if (visitedAt > now) badRequest("The visit can't be in the future");
		const nextFollowUpAt = requireFutureFollowUp(input.nextFollowUpAt, now);

		const [live] = await tx
			.select({ id: opportunity.id })
			.from(opportunity)
			.where(
				and(eq(opportunity.leadId, row.id), ne(opportunity.stage, "lost")),
			);
		if (live) conflict("This lead already has an open deal");

		const [created] = await tx
			.insert(opportunity)
			.values({
				organizationId: tenant.organizationId,
				leadId: row.id,
				customerId: row.customerId,
				projectId: row.projectId,
				ownerMemberId: row.ownerMemberId,
				firstVisitAt: visitedAt,
				lastVisitAt: visitedAt,
				nextFollowUpAt,
			})
			.returning({ id: opportunity.id });
		if (!created) throw new Error("insert returned no row");
		await tx
			.update(lead)
			.set({
				status: "converted",
				convertedAt: now,
				contactDeadlineAt: null,
				nextFollowUpAt: null,
			})
			.where(eq(lead.id, row.id));
		await logStatusChange(
			tx,
			tenant,
			row.id,
			row.status,
			"converted",
			"visit",
			now,
		);
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			opportunityId: created.id,
			type: "conversion",
			at: visitedAt,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { from: row.status, visitedAt: visitedAt.toISOString() },
		});
		await writeAudit(tx, tenant, {
			action: "lead.convert",
			entityType: "lead",
			entityId: row.id,
			after: { opportunityId: created.id },
		});
		return { opportunityId: created.id };
	});
}
