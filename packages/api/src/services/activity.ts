import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	contactActivityTypes,
	interest,
	interestActivity,
	openStages,
} from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { badRequest, forbidden } from "./errors";
import { requireVisibleInterest } from "./lead-access";
import type { Tenant } from "./tenancy";

/** One-tap actions available in M4; visits, stages and deposits come later. */
export const oneTapActivityTypes = ["call", "no_answer", "line"] as const;

const futureDateTime = z.iso.datetime({ offset: true });

export const logActivityInput = z.strictObject({
	interestId: z.uuid(),
	type: z.enum(oneTapActivityTypes),
	note: z.string().trim().max(1000).optional(),
	nextFollowUpAt: futureDateTime.optional(),
});

export const setFollowUpInput = z.strictObject({
	interestId: z.uuid(),
	nextFollowUpAt: futureDateTime,
});

/** The owner works their lead; managers covering the project may act on any of them. */
function requireActor(tenant: Tenant, row: { ownerMemberId: string | null }) {
	if (row.ownerMemberId === tenant.memberId) return;
	if (roleCan(tenant.role, { lead: ["assign"] })) return;
	forbidden(
		row.ownerMemberId === null
			? "Claim this lead first"
			: "Only the owner can log activities",
	);
}

/** The follow-up an owned open lead ends up with must be in the future. */
function resolveFollowUp(
	row: {
		ownerMemberId: string | null;
		stage: string;
		nextFollowUpAt: Date | null;
	},
	requested: string | undefined,
	now: Date,
) {
	const next = requested ? new Date(requested) : row.nextFollowUpAt;
	if (requested && next && next <= now) {
		badRequest("The next follow-up must be in the future");
	}
	const needsFollowUp =
		row.ownerMemberId !== null &&
		(openStages as readonly string[]).includes(row.stage);
	if (needsFollowUp && (!next || next <= now)) {
		badRequest("Set the next follow-up");
	}
	return next;
}

/**
 * Call / No answer / LINE (brief §7). A real contact (call, LINE) clears the
 * contact deadline; every owned open lead keeps a next follow-up (brief §6).
 */
export async function logActivity(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof logActivityInput>,
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		const row = await requireVisibleInterest(tx, tenant, input.interestId);
		requireActor(tenant, row);
		const nextFollowUpAt = resolveFollowUp(row, input.nextFollowUpAt, now);
		const contacted = contactActivityTypes.includes(input.type);
		await tx.insert(interestActivity).values({
			organizationId: tenant.organizationId,
			interestId: row.id,
			type: input.type,
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: input.nextFollowUpAt
				? { nextFollowUpAt: input.nextFollowUpAt }
				: null,
		});
		await tx
			.update(interest)
			.set({
				nextFollowUpAt,
				...(contacted && { contactDeadlineAt: null }),
			})
			.where(eq(interest.id, row.id));
	});
}

/** Reschedule the next follow-up. */
export async function setFollowUp(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof setFollowUpInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleInterest(tx, tenant, input.interestId);
		requireActor(tenant, row);
		const nextFollowUpAt = resolveFollowUp(
			row,
			input.nextFollowUpAt,
			new Date(),
		);
		await tx
			.update(interest)
			.set({ nextFollowUpAt })
			.where(eq(interest.id, row.id));
	});
}
