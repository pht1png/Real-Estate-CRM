import type { Database } from "@Real-Estate-CRM/db";
import { activity, lead, opportunity } from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";

import { logStatusChange, requireOpenLead } from "./activity";
import { writeAudit } from "./audit";
import { badRequest } from "./errors";
import type { Tenant } from "./tenancy";

type Tx = Pick<Database, "insert" | "update">;

/**
 * Conversion (brief §2): the first confirmed showroom visit turns a qualified
 * lead into an opportunity at Visited. Called only by `recordVisit`, which
 * locks the lead and checks there is no live opportunity; a booked tour
 * doesn't convert until it happens.
 */
export async function openOpportunity(
	tx: Tx,
	tenant: Tenant,
	row: typeof lead.$inferSelect,
	visitedAt: Date,
	nextFollowUpAt: Date,
	now = new Date(),
) {
	requireOpenLead(row);
	// Brief §6: every opportunity starts from a qualified lead (walk-ins qualify on the tour).
	if (row.status !== "qualified") badRequest("Qualify the lead first");
	if (!row.ownerMemberId) badRequest("Claim or assign the lead first");

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
		data: { from: row.status, visitedAt: visitedAt.toISOString() },
	});
	await writeAudit(tx, tenant, {
		action: "lead.convert",
		entityType: "lead",
		entityId: row.id,
		after: { opportunityId: created.id },
	});
	return created.id;
}
