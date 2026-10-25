import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	contactActivityTypes,
	interest,
	interestActivity,
	openStages,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { badRequest, forbidden, notFound } from "./errors";
import { requireVisibleInterest } from "./lead-access";
import { loadCalendar } from "./pool";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";
import { followUpPicks } from "./working-time";

/** Call results (brief §7): each one ends with the next follow-up. */
export const callOutcomes = ["answered", "no_answer", "line"] as const;
const outcomeActivity = {
	answered: "call",
	no_answer: "no_answer",
	line: "line",
} as const;

const futureDateTime = z.iso.datetime({ offset: true });

export const logOutcomeInput = z.strictObject({
	interestId: z.uuid(),
	outcome: z.enum(callOutcomes),
	note: z.string().trim().max(1000).optional(),
	nextFollowUpAt: futureDateTime,
});

export const interestIdInput = z.strictObject({ interestId: z.uuid() });

export const setFollowUpInput = z.strictObject({
	interestId: z.uuid(),
	nextFollowUpAt: futureDateTime,
});

/** The owner works their lead; managers covering the project may act on any of them. */
export function requireActor(
	tenant: Tenant,
	row: { ownerMemberId: string | null },
) {
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
 * `interest.id` with its table name: Drizzle drops the qualifier in
 * single-table selects, and a bare "id" inside a subquery means the inner row.
 */
export const outerInterestId = sql.raw(`"interest"."id"`);

const contactTypes = sql.join(
	contactActivityTypes.map((t) => sql`${t}`),
	sql`, `,
);

/**
 * No-answers in a row on the interest: since `since` and after its last real
 * contact (call, LINE, meeting, visit). Correlated to the outer `interest` row.
 */
export function noAnswerStreak(since: Date): SQL<number> {
	return sql<number>`(select count(*)::int from interest_activity na
		where na.interest_id = ${outerInterestId} and na.type = 'no_answer' and na.at >= ${since}
		and na.at > coalesce((select max(c.at) from interest_activity c
			where c.interest_id = ${outerInterestId} and c.type in (${contactTypes})), '-infinity'::timestamptz))`;
}

/** Start of the Unreachable window (brief §6: 3 no-answers over 7 days). */
export const streakSince = (windowDays: number, now = new Date()) =>
	new Date(now.getTime() - windowDays * 86_400_000);

/**
 * Log a call result or a LINE contact with the next follow-up (brief §6–7).
 * Answered and LINE count as contact and clear the contact deadline. A No
 * answer returns the try count and whether the lead is now unreachable.
 */
export async function logOutcome(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof logOutcomeInput>,
) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const row = await requireVisibleInterest(tx, tenant, input.interestId);
		requireActor(tenant, row);
		if (!(openStages as readonly string[]).includes(row.stage)) {
			badRequest("Only open leads take call results");
		}
		const nextFollowUpAt = resolveFollowUp(row, input.nextFollowUpAt, now);
		const type = outcomeActivity[input.outcome];
		await tx.insert(interestActivity).values({
			organizationId: tenant.organizationId,
			interestId: row.id,
			type,
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { nextFollowUpAt: input.nextFollowUpAt },
		});
		await tx
			.update(interest)
			.set({
				nextFollowUpAt,
				...(contactActivityTypes.includes(type) && {
					contactDeadlineAt: null,
				}),
			})
			.where(eq(interest.id, row.id));

		if (input.outcome !== "no_answer")
			return { attempt: 0, unreachable: false };
		const rules = await getRules(tx, tenant.organizationId);
		const [streak] = await tx
			.select({
				n: noAnswerStreak(streakSince(rules.unreachableWindowDays, now)),
			})
			.from(interest)
			.where(eq(interest.id, row.id));
		const attempt = streak?.n ?? 1;
		return { attempt, unreachable: attempt >= rules.unreachableAttempts };
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

/** Quick-pick follow-up times inside the project's office hours. */
export async function getFollowUpPicks(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof interestIdInput>,
) {
	const row = await requireVisibleInterest(db, tenant, input.interestId);
	const [proj] = await db
		.select()
		.from(project)
		.where(eq(project.id, row.projectId));
	if (!proj) notFound("Project");
	const now = new Date();
	return followUpPicks(await loadCalendar(db, proj, now), now);
}
