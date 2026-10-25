import type { Database } from "@Real-Estate-CRM/db";
import {
	interest,
	interestActivity,
	invalidReasons,
	lostReasons,
	openStages,
} from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireActor } from "./activity";
import { badRequest } from "./errors";
import { requireVisibleInterest } from "./lead-access";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";

const note = z.string().trim().max(1000).optional();

export const closeLeadInput = z
	.discriminatedUnion("exit", [
		z.strictObject({
			interestId: z.uuid(),
			exit: z.literal("lost"),
			reason: z.enum(lostReasons),
			note,
		}),
		z.strictObject({
			interestId: z.uuid(),
			exit: z.literal("invalid"),
			reason: z.enum(invalidReasons),
			note,
		}),
		z.strictObject({
			interestId: z.uuid(),
			exit: z.literal("nurture"),
			note,
		}),
	])
	.refine((v) => v.exit !== "lost" || v.reason !== "other" || !!v.note, {
		message: "Add a note for “Other”",
		path: ["note"],
	});

/**
 * Lost / Nurture / Invalid exits (brief §6). The owner keeps the lead for
 * history; the deadline and follow-up are cleared (freeing a claim slot).
 * A new enquiry reopens it through the re-enquiry rule.
 */
export async function closeLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof closeLeadInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleInterest(tx, tenant, input.interestId);
		requireActor(tenant, row);
		if (!(openStages as readonly string[]).includes(row.stage)) {
			badRequest("Only open leads can be closed");
		}
		const now = new Date();
		const nurtureNextCheckAt =
			input.exit === "nurture"
				? new Date(
						now.getTime() +
							(await getRules(tx, tenant.organizationId)).nurtureCheckDays *
								86_400_000,
					)
				: null;
		await tx
			.update(interest)
			.set({
				stage: input.exit,
				lostReason: input.exit === "lost" ? input.reason : null,
				invalidReason: input.exit === "invalid" ? input.reason : null,
				nextFollowUpAt: null,
				contactDeadlineAt: null,
				nurtureNextCheckAt,
				...(input.exit === "nurture" && { ignoredNurtureCount: 0 }),
			})
			.where(eq(interest.id, row.id));
		await tx.insert(interestActivity).values({
			organizationId: tenant.organizationId,
			interestId: row.id,
			type: "stage_change",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: {
				from: row.stage,
				to: input.exit,
				...(input.exit !== "nurture" && { reason: input.reason }),
			},
		});
	});
}
