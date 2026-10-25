import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	contactActivityTypes,
	type LeadStatus,
	lead,
	openLeadStatuses,
	openOpportunityStages,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { eq, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import { badRequest, forbidden, notFound } from "./errors";
import { requireVisibleLead, requireVisibleOpportunity } from "./lead-access";
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

export const futureDateTime = z.iso.datetime({ offset: true });

const outcomeFields = {
	outcome: z.enum(callOutcomes),
	note: z.string().trim().max(1000).optional(),
	nextFollowUpAt: futureDateTime,
};
export const leadOutcomeInput = z.strictObject({
	leadId: z.uuid(),
	...outcomeFields,
});
export const opportunityOutcomeInput = z.strictObject({
	opportunityId: z.uuid(),
	...outcomeFields,
});

export const leadIdInput = z.strictObject({ leadId: z.uuid() });
export const opportunityIdInput = z.strictObject({ opportunityId: z.uuid() });

export const leadFollowUpInput = z.strictObject({
	leadId: z.uuid(),
	nextFollowUpAt: futureDateTime,
});
export const opportunityFollowUpInput = z.strictObject({
	opportunityId: z.uuid(),
	nextFollowUpAt: futureDateTime,
});

/** The owner works their lead or deal; managers covering the project may act on any. */
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

/** The next follow-up must be in the future (brief §6: nothing sits without a next step). */
export function requireFutureFollowUp(value: string, now = new Date()) {
	const next = new Date(value);
	if (next <= now) badRequest("The next follow-up must be in the future");
	return next;
}

/** Leads still being vetted (open statuses). */
export function requireOpenLead(row: { status: LeadStatus }) {
	if (!openLeadStatuses.includes(row.status)) {
		badRequest("This lead is no longer open");
	}
}

/** Deals before a deposit (visited, negotiating). */
export function requireOpenOpportunity(row: { stage: string }) {
	if (!(openOpportunityStages as readonly string[]).includes(row.stage)) {
		badRequest("This deal is no longer open");
	}
}

/**
 * `lead.id` with its table name: Drizzle drops the qualifier in single-table
 * selects, and a bare "id" inside a subquery means the inner row.
 */
export const outerLeadId = sql.raw(`"lead"."id"`);

const contactTypes = sql.join(
	contactActivityTypes.map((t) => sql`${t}`),
	sql`, `,
);

/**
 * No-answers in a row on the lead: since `since` and after its last real
 * contact (call, LINE, meeting, visit). Correlated to the outer `lead` row.
 */
export function noAnswerStreak(since: Date): SQL<number> {
	return sql<number>`(select count(*)::int from activity na
		where na.lead_id = ${outerLeadId} and na.type = 'no_answer' and na.at >= ${since}
		and na.at > coalesce((select max(c.at) from activity c
			where c.lead_id = ${outerLeadId} and c.type in (${contactTypes})), '-infinity'::timestamptz))`;
}

/** Start of the Unreachable window (brief §6: 3 no-answers over 7 days). */
export const streakSince = (windowDays: number, now = new Date()) =>
	new Date(now.getTime() - windowDays * 86_400_000);

/** Records a lead status move as an activity (history is append-only). */
export function logStatusChange(
	tx: Pick<Database, "insert">,
	tenant: Tenant,
	leadId: string,
	from: string,
	to: string,
	reason: string,
	at = new Date(),
) {
	return tx.insert(activity).values({
		organizationId: tenant.organizationId,
		leadId,
		type: "stage_change",
		at,
		byUserId: tenant.userId,
		data: { from, to, reason },
	});
}

/** Lead status after a call result: the vetting queue moves on by itself. */
function statusAfter(
	status: LeadStatus,
	outcome: (typeof callOutcomes)[number],
): LeadStatus {
	if (outcome === "no_answer") return status === "new" ? "attempting" : status;
	return status === "new" || status === "attempting" ? "connected" : status;
}

/**
 * Call result or LINE contact on a lead, with the next follow-up (brief §6–7).
 * No answer: New → Attempting, and returns the try count and whether the lead
 * now looks unreachable. Answered / LINE: → Connected and the contact deadline
 * is cleared.
 */
export async function logLeadOutcome(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof leadOutcomeInput>,
) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		const nextFollowUpAt = requireFutureFollowUp(input.nextFollowUpAt, now);
		const type = outcomeActivity[input.outcome];
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type,
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { nextFollowUpAt: input.nextFollowUpAt },
		});
		const status = statusAfter(row.status, input.outcome);
		if (status !== row.status) {
			await logStatusChange(
				tx,
				tenant,
				row.id,
				row.status,
				status,
				"call_result",
				now,
			);
		}
		await tx
			.update(lead)
			.set({
				status,
				nextFollowUpAt,
				...(contactActivityTypes.includes(type) && {
					contactDeadlineAt: null,
				}),
			})
			.where(eq(lead.id, row.id));

		if (input.outcome !== "no_answer") {
			return { status, attempt: 0, unreachable: false };
		}
		const rules = await getRules(tx, tenant.organizationId);
		const [streak] = await tx
			.select({
				n: noAnswerStreak(streakSince(rules.unreachableWindowDays, now)),
			})
			.from(lead)
			.where(eq(lead.id, row.id));
		const attempt = streak?.n ?? 1;
		return {
			status,
			attempt,
			unreachable: attempt >= rules.unreachableAttempts,
		};
	});
}

/** Call result or LINE contact on a deal; no automatic stage moves. */
export async function logOpportunityOutcome(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof opportunityOutcomeInput>,
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		requireOpenOpportunity(row);
		const nextFollowUpAt = requireFutureFollowUp(input.nextFollowUpAt, now);
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.id,
			type: outcomeActivity[input.outcome],
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: { nextFollowUpAt: input.nextFollowUpAt },
		});
		await tx
			.update(opportunity)
			.set({ nextFollowUpAt })
			.where(eq(opportunity.id, row.id));
	});
}

export async function setLeadFollowUp(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof leadFollowUpInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		requireOpenLead(row);
		await tx
			.update(lead)
			.set({ nextFollowUpAt: requireFutureFollowUp(input.nextFollowUpAt) })
			.where(eq(lead.id, row.id));
	});
}

export async function setOpportunityFollowUp(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof opportunityFollowUpInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, row);
		requireOpenOpportunity(row);
		await tx
			.update(opportunity)
			.set({ nextFollowUpAt: requireFutureFollowUp(input.nextFollowUpAt) })
			.where(eq(opportunity.id, row.id));
	});
}

/** Note on a lead or deal timeline. */
export const addNoteInput = z
	.strictObject({
		leadId: z.uuid().optional(),
		opportunityId: z.uuid().optional(),
		note: z.string().trim().min(1).max(2000),
	})
	.refine((v) => !!v.leadId !== !!v.opportunityId, {
		message: "Give a lead or an opportunity",
	});

export async function addNote(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof addNoteInput>,
) {
	await db.transaction(async (tx) => {
		const target = input.opportunityId
			? await requireVisibleOpportunity(tx, tenant, input.opportunityId).then(
					(o) => ({ leadId: o.leadId, opportunityId: o.id }),
				)
			: await requireVisibleLead(tx, tenant, input.leadId ?? "").then((l) => ({
					leadId: l.id,
					opportunityId: null,
				}));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			...target,
			type: "note",
			byUserId: tenant.userId,
			note: input.note,
		});
	});
}

/** Quick-pick follow-up times inside the project's office hours. */
export async function getFollowUpPicks(
	db: Database,
	tenant: Tenant,
	input: { leadId?: string; opportunityId?: string },
) {
	const row = input.opportunityId
		? await requireVisibleOpportunity(db, tenant, input.opportunityId)
		: await requireVisibleLead(db, tenant, input.leadId ?? "");
	const [proj] = await db
		.select()
		.from(project)
		.where(eq(project.id, row.projectId));
	if (!proj) notFound("Project");
	const now = new Date();
	return followUpPicks(await loadCalendar(db, proj, now), now);
}
