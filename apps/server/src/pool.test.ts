import { returnExpiredClaims } from "@Real-Estate-CRM/api/services/pool";
import { contactDeadline } from "@Real-Estate-CRM/api/services/working-time";
import {
	activity,
	auditLog,
	defaultOfficeHours,
	lead,
	type OfficeHours,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { runScheduledJobs } from "./scheduler";
import { db } from "./services";
import { callerAs, createOrg, qualifyLead } from "./test-support";

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "OK";
	} catch (error) {
		return error instanceof TRPCError ? error.code : String(error);
	}
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);
// Open all day, every day: deadlines are predictable whenever the tests run.
const allDay = Object.fromEntries(
	Object.keys(defaultOfficeHours).map((d) => [
		d,
		{ open: "00:00", close: "23:59" },
	]),
) as OfficeHours;

/** Company with one all-day project, two salespeople and a manager covering it. */
async function setup() {
	const org = await createOrg();
	const admin = await callerAs(org.id, "admin");
	const { id: projectId } = await admin.caller.project.create({
		name: "Riverside",
	});
	await admin.caller.project.update({ projectId, officeHours: allDay });
	const salesA = await callerAs(org.id, "salesperson", [projectId]);
	const salesB = await callerAs(org.id, "salesperson", [projectId]);
	const manager = await callerAs(org.id, "sales_manager", [projectId]);
	const sources = await admin.caller.leadSource.list();
	return {
		org,
		admin,
		salesA,
		salesB,
		manager,
		projectId,
		sourceId: sources.unknownSourceId ?? "",
	};
}
type Setup = Awaited<ReturnType<typeof setup>>;

let phoneCounter = 0;
/** A manager-logged enquiry sent to the pool (or to `ownerMemberId`). */
async function poolLead(s: Setup, ownerMemberId: string | null = null) {
	const n = String(phoneCounter++ % 10_000).padStart(4, "0");
	const { leadId } = await s.manager.caller.lead.capture({
		projectId: s.projectId,
		name: `Customer ${n}`,
		phone: `08123${n}0`,
		sourceId: s.sourceId,
		marketingConsent: false,
		ownerMemberId,
	});
	return leadId;
}

async function row(leadId: string) {
	const [r] = await db.select().from(lead).where(eq(lead.id, leadId));
	if (!r) throw new Error("no lead");
	return r;
}

const expectedDeadline = (now: Date) =>
	contactDeadline(
		{ timeZone: "Asia/Bangkok", officeHours: allDay, closedDates: new Set() },
		now,
		2,
	);

describe("claiming", () => {
	test("first salesperson wins; the claim sets owner, deadline, activity and audit", async () => {
		const s = await setup();
		const id = await poolLead(s);
		const before = new Date();
		const { contactDeadlineAt } = await s.salesA.caller.lead.claim({
			leadId: id,
		});
		expect([
			expectedDeadline(before)?.getTime(),
			expectedDeadline(new Date())?.getTime(),
		]).toContain(contactDeadlineAt.getTime());
		expect(await row(id)).toMatchObject({
			ownerMemberId: s.salesA.member.id,
			contactDeadlineAt,
		});
		expect((await row(id)).claimedAt).not.toBeNull();

		const [assignment] = await db
			.select()
			.from(activity)
			.where(and(eq(activity.leadId, id), eq(activity.type, "assignment")));
		expect(assignment?.data).toEqual({
			from: null,
			to: s.salesA.member.id,
			via: "claim",
		});
		const [audit] = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.entityId, id), eq(auditLog.action, "lead.claim")));
		expect(audit?.actorUserId).toBe(s.salesA.user.id);

		const second = s.salesB.caller.lead.claim({ leadId: id });
		expect(await codeOf(second)).toBe("CONFLICT");
	});

	test("parallel claims on one lead: exactly one succeeds", async () => {
		const s = await setup();
		const id = await poolLead(s);
		const others = await Promise.all(
			[1, 2, 3].map(() => callerAs(s.org.id, "salesperson", [s.projectId])),
		);
		const results = await Promise.all(
			[s.salesA, s.salesB, ...others].map((p) =>
				codeOf(p.caller.lead.claim({ leadId: id })),
			),
		);
		expect(results.filter((r) => r === "OK")).toHaveLength(1);
		expect(results.filter((r) => r === "CONFLICT")).toHaveLength(4);
	});

	test("cap: 5 uncontacted claims; a real contact frees a slot, no answer doesn't", async () => {
		const s = await setup();
		const ids = await Promise.all([0, 1, 2, 3, 4, 5].map(() => poolLead(s)));
		for (const id of ids.slice(0, 5)) {
			await s.salesA.caller.lead.claim({ leadId: id });
		}
		const sixth = { leadId: ids[5] ?? "" };
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe(
			"PRECONDITION_FAILED",
		);

		const nextFollowUpAt = inDays(1).toISOString();
		await s.salesA.caller.lead.logOutcome({
			leadId: ids[0] ?? "",
			outcome: "no_answer",
			nextFollowUpAt,
		});
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe(
			"PRECONDITION_FAILED",
		);
		await s.salesA.caller.lead.logOutcome({
			leadId: ids[0] ?? "",
			outcome: "answered",
			note: "Wants a 2-bed",
			nextFollowUpAt,
		});
		expect((await row(ids[0] ?? "")).contactDeadlineAt).toBeNull();
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe("OK");
	});

	test("salespeople only, in their projects, and only from the pool", async () => {
		const s = await setup();
		const id = await poolLead(s);
		expect(await codeOf(s.manager.caller.lead.claim({ leadId: id }))).toBe(
			"FORBIDDEN",
		);
		const { id: hillside } = await s.admin.caller.project.create({
			name: "Hillside",
		});
		const outsider = await callerAs(s.org.id, "salesperson", [hillside]);
		expect(await codeOf(outsider.caller.lead.claim({ leadId: id }))).toBe(
			"NOT_FOUND",
		);
	});

	test("manager-assigned leads get a deadline but don't count toward the cap", async () => {
		const s = await setup();
		const assigned = await poolLead(s, s.salesA.member.id);
		const r = await row(assigned);
		expect(r.ownerMemberId).toBe(s.salesA.member.id);
		expect(r.claimedAt).toBeNull();
		expect(r.contactDeadlineAt).not.toBeNull();

		const ids = await Promise.all([0, 1, 2, 3, 4].map(() => poolLead(s)));
		for (const id of ids) {
			expect(await codeOf(s.salesA.caller.lead.claim({ leadId: id }))).toBe(
				"OK",
			);
		}
	});

	test("company B can't claim company A's lead", async () => {
		const a = await setup();
		const b = await setup();
		const id = await poolLead(a);
		expect(await codeOf(b.salesA.caller.lead.claim({ leadId: id }))).toBe(
			"NOT_FOUND",
		);
		expect((await row(id)).ownerMemberId).toBeNull();
	});
});

describe("expired claims", () => {
	test("the scheduled job returns them to the pool, logged by the system", async () => {
		const s = await setup();
		const id = await poolLead(s);
		await s.salesA.caller.lead.claim({ leadId: id });
		await db
			.update(lead)
			.set({ contactDeadlineAt: new Date(Date.now() - 60_000) })
			.where(eq(lead.id, id));

		const result = await runScheduledJobs(db);
		expect(result?.expiredClaims).toBeGreaterThanOrEqual(1);
		expect(await row(id)).toMatchObject({
			ownerMemberId: null,
			claimedAt: null,
			contactDeadlineAt: null,
		});
		const activities = await db
			.select()
			.from(activity)
			.where(eq(activity.leadId, id));
		expect(activities.at(-1)).toMatchObject({
			type: "assignment",
			byUserId: null,
			data: {
				from: s.salesA.member.id,
				to: null,
				reason: "contact_deadline_missed",
			},
		});
		const [audit] = await db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.entityId, id), eq(auditLog.action, "lead.assign")),
			);
		expect(audit?.actorUserId).toBeNull();
	});

	test("a lead not yet due stays; reading Today returns overdue ones lazily", async () => {
		const s = await setup();
		const kept = await poolLead(s);
		const expired = await poolLead(s);
		await s.salesA.caller.lead.claim({ leadId: kept });
		await s.salesA.caller.lead.claim({ leadId: expired });
		await db
			.update(lead)
			.set({ contactDeadlineAt: new Date(Date.now() - 1000) })
			.where(eq(lead.id, expired));

		const pool = await s.salesB.caller.pool.list({});
		expect(pool.map((l) => l.leadId)).toContain(expired);
		expect((await row(kept)).ownerMemberId).toBe(s.salesA.member.id);
	});

	test("only one instance runs the jobs at a time", async () => {
		const results = await Promise.all([
			runScheduledJobs(db),
			runScheduledJobs(db),
		]);
		expect(results.filter((r) => r === null).length).toBeLessThanOrEqual(1);
		expect(results.some((r) => r !== null)).toBe(true);
	});

	test("one company's lazy check leaves other companies alone", async () => {
		const a = await setup();
		const b = await setup();
		const id = await poolLead(a);
		await a.salesA.caller.lead.claim({ leadId: id });
		await db
			.update(lead)
			.set({ contactDeadlineAt: new Date(Date.now() - 1000) })
			.where(eq(lead.id, id));
		await returnExpiredClaims(db, { organizationId: b.org.id });
		expect((await row(id)).ownerMemberId).toBe(a.salesA.member.id);
	});
});

const later = (days = 1) => inDays(days).toISOString();

/** A pool lead claimed by salesperson A. */
async function claimed(s: Setup) {
	const id = await poolLead(s);
	await s.salesA.caller.lead.claim({ leadId: id });
	return id;
}

/** A claimed lead that salesperson A has qualified (converting requires it). */
async function qualified(s: Setup) {
	const id = await claimed(s);
	await qualifyLead(s.salesA.caller, id, s.projectId);
	return id;
}

describe("call results and follow-ups", () => {
	test("every result needs a future follow-up; the chosen time is stored", async () => {
		const s = await setup();
		const id = await claimed(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.logOutcome({
					leadId: id,
					outcome: "answered",
					nextFollowUpAt: inDays(-1).toISOString(),
				}),
			),
		).toBe("BAD_REQUEST");

		// A time later today is fine: the salesperson chooses freely.
		const inTwoHours = new Date(Date.now() + 2 * 3_600_000);
		await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "no_answer",
			nextFollowUpAt: inTwoHours.toISOString(),
		});
		expect((await row(id)).nextFollowUpAt).toEqual(inTwoHours);
		// No answer isn't contact: the deadline stays.
		expect((await row(id)).contactDeadlineAt).not.toBeNull();

		const nextWeek = inDays(7);
		await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "line",
			note: "Sent brochure",
			nextFollowUpAt: nextWeek.toISOString(),
		});
		expect(await row(id)).toMatchObject({
			nextFollowUpAt: nextWeek,
			contactDeadlineAt: null,
		});

		const in5 = inDays(5);
		await s.salesA.caller.lead.setFollowUp({
			leadId: id,
			nextFollowUpAt: in5.toISOString(),
		});
		expect((await row(id)).nextFollowUpAt).toEqual(in5);
	});

	test("3 no-answers in 7 days is unreachable; a real contact resets the count", async () => {
		const s = await setup();
		const id = await claimed(s);
		const noAnswer = () =>
			s.salesA.caller.lead.logOutcome({
				leadId: id,
				outcome: "no_answer",
				nextFollowUpAt: later(),
			});
		expect(await noAnswer()).toMatchObject({ attempt: 1, unreachable: false });
		expect(await noAnswer()).toMatchObject({ attempt: 2, unreachable: false });
		expect(await noAnswer()).toMatchObject({ attempt: 3, unreachable: true });

		await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "answered",
			nextFollowUpAt: later(),
		});
		expect(await noAnswer()).toMatchObject({ attempt: 1, unreachable: false });
	});

	test("no-answers older than the window don't count", async () => {
		const s = await setup();
		const id = await claimed(s);
		// History is append-only, so seed an old try directly.
		await db.insert(activity).values({
			organizationId: s.org.id,
			leadId: id,
			type: "no_answer",
			at: inDays(-8),
		});
		const result = await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "no_answer",
			nextFollowUpAt: later(),
		});
		expect(result.attempt).toBe(1);
	});

	test("other salespeople can't log on my lead; pool leads must be claimed first", async () => {
		const s = await setup();
		const mine = await claimed(s);
		const answered = (leadId: string) => ({
			leadId,
			outcome: "answered" as const,
			nextFollowUpAt: later(),
		});
		expect(await codeOf(s.salesB.caller.lead.logOutcome(answered(mine)))).toBe(
			"NOT_FOUND",
		);
		const pooled = await poolLead(s);
		expect(
			await codeOf(s.salesB.caller.lead.logOutcome(answered(pooled))),
		).toBe("FORBIDDEN");
		// Managers covering the project may act on any lead.
		expect(await codeOf(s.manager.caller.lead.logOutcome(answered(mine)))).toBe(
			"OK",
		);
	});

	test("follow-up picks land in the future and are private like the lead", async () => {
		const s = await setup();
		const id = await claimed(s);
		const picks = await s.salesA.caller.lead.followUpPicks({ leadId: id });
		for (const at of Object.values(picks)) {
			expect(at?.getTime()).toBeGreaterThan(Date.now());
		}
		expect(
			await codeOf(s.salesB.caller.lead.followUpPicks({ leadId: id })),
		).toBe("NOT_FOUND");
		const b = await setup();
		expect(
			await codeOf(b.manager.caller.lead.followUpPicks({ leadId: id })),
		).toBe("NOT_FOUND");
	});
});

describe("lead status moves with call results", () => {
	test("no answer: new → attempting; answered: → connected; each move is logged", async () => {
		const s = await setup();
		const id = await claimed(s);
		const first = await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "no_answer",
			nextFollowUpAt: later(),
		});
		expect(first).toMatchObject({ status: "attempting", attempt: 1 });
		const second = await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "answered",
			nextFollowUpAt: later(),
		});
		expect(second.status).toBe("connected");
		const moves = await db
			.select({ data: activity.data })
			.from(activity)
			.where(and(eq(activity.leadId, id), eq(activity.type, "stage_change")));
		expect(moves.map((m) => m.data)).toEqual([
			{ from: "new", to: "attempting", reason: "call_result" },
			{ from: "attempting", to: "connected", reason: "call_result" },
		]);
	});
});

describe("Mark qualified", () => {
	/** A project with two unit types, and a claimed lead in it. */
	async function withTypes(s: Setup) {
		const twoBed = await s.admin.caller.unitType.create({
			projectId: s.projectId,
			name: "2 Bed",
		});
		const other = await s.admin.caller.project.create({ name: "Elsewhere" });
		const foreign = await s.admin.caller.unitType.create({
			projectId: other.id,
			name: "Villa",
		});
		return { id: await claimed(s), twoBedId: twoBed.id, foreignId: foreign.id };
	}
	const form = (leadId: string, unitTypeIds: string[]) => ({
		leadId,
		budgetMinSatang: 300_000_000,
		budgetMaxSatang: 450_000_000,
		buyingTimeline: "1_3_months" as const,
		unitTypeIds,
		buyerIntent: "own_stay" as const,
		nextFollowUpAt: later(2),
	});

	test("needs budget, timeline, intent and this project's unit types", async () => {
		const s = await setup();
		const { id, twoBedId, foreignId } = await withTypes(s);
		expect(await codeOf(s.salesA.caller.lead.qualify(form(id, [])))).toBe(
			"BAD_REQUEST",
		);
		expect(
			await codeOf(s.salesA.caller.lead.qualify(form(id, [foreignId]))),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.lead.qualify({
					...form(id, [twoBedId]),
					budgetMinSatang: 500_000_000,
				}),
			),
		).toBe("BAD_REQUEST");

		await s.salesA.caller.lead.qualify(form(id, [twoBedId]));
		const r = await row(id);
		expect(r).toMatchObject({
			status: "qualified",
			unitTypeIds: [twoBedId],
			buyerIntent: "own_stay",
			buyingTimeline: "1_3_months",
			contactDeadlineAt: null,
		});
		expect(r.qualifiedAt).not.toBeNull();
		const overview = await s.salesA.caller.overview.get();
		expect(overview.leads.byStatus.qualified).toBe(1);
	});

	test("being reached is not qualified; only the salesperson marks it", async () => {
		const s = await setup();
		const id = await claimed(s);
		await s.salesA.caller.lead.logOutcome({
			leadId: id,
			outcome: "answered",
			nextFollowUpAt: later(),
		});
		expect(
			(await s.salesA.caller.overview.get()).leads.byStatus.qualified,
		).toBe(0);
		expect(await codeOf(s.salesB.caller.lead.qualify(form(id, [])))).toBe(
			"NOT_FOUND",
		);
		const b = await setup();
		expect(await codeOf(b.manager.caller.lead.qualify(form(id, [])))).toBe(
			"NOT_FOUND",
		);
	});
});

describe("conversion: confirmed visit → opportunity", () => {
	test("creates one deal at Visited; the lead becomes converted", async () => {
		const s = await setup();
		const id = await qualified(s);
		const visitedAt = new Date(Date.now() - 600_000);
		const { opportunityId } = await s.salesA.caller.lead.convert({
			leadId: id,
			visitedAt: visitedAt.toISOString(),
			nextFollowUpAt: later(),
		});
		expect(await row(id)).toMatchObject({
			status: "converted",
			contactDeadlineAt: null,
			nextFollowUpAt: null,
		});
		const [deal] = await db
			.select()
			.from(opportunity)
			.where(eq(opportunity.id, opportunityId));
		expect(deal).toMatchObject({
			stage: "visited",
			leadId: id,
			ownerMemberId: s.salesA.member.id,
			firstVisitAt: visitedAt,
			visitCount: 1,
		});
		const [conversion] = await db
			.select()
			.from(activity)
			.where(and(eq(activity.leadId, id), eq(activity.type, "conversion")));
		expect(conversion?.opportunityId).toBe(opportunityId);
		const overview = await s.salesA.caller.overview.get();
		expect(overview.deals.byStage.visited).toBe(1);
	});

	test("a booked (future) visit can't convert; pool leads must be claimed first", async () => {
		const s = await setup();
		const id = await qualified(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.convert({
					leadId: id,
					visitedAt: inDays(1).toISOString(),
					nextFollowUpAt: later(2),
				}),
			),
		).toBe("BAD_REQUEST");
		const pooled = await poolLead(s);
		expect(
			await codeOf(
				s.manager.caller.lead.convert({
					leadId: pooled,
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("parallel confirmations create exactly one deal", async () => {
		const s = await setup();
		const id = await qualified(s);
		const results = await Promise.all(
			[1, 2, 3].map(() =>
				codeOf(
					s.salesA.caller.lead.convert({ leadId: id, nextFollowUpAt: later() }),
				),
			),
		);
		expect(results.filter((r) => r === "OK")).toHaveLength(1);
		const deals = await db
			.select()
			.from(opportunity)
			.where(eq(opportunity.leadId, id));
		expect(deals).toHaveLength(1);
	});

	test("company B can't convert company A's lead", async () => {
		const a = await setup();
		const b = await setup();
		const id = await qualified(a);
		expect(
			await codeOf(
				b.manager.caller.lead.convert({ leadId: id, nextFollowUpAt: later() }),
			),
		).toBe("NOT_FOUND");
	});
});

describe("exits per pipeline", () => {
	test("Disqualify: reason (Other needs a note); frees the claim slot", async () => {
		const s = await setup();
		const id = await claimed(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.disqualify({ leadId: id, reason: "other" }),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.lead.disqualify({
			leadId: id,
			reason: "other",
			note: "Moved abroad",
		});
		expect(await row(id)).toMatchObject({
			status: "disqualified",
			disqualifyReason: "other",
			ownerMemberId: s.salesA.member.id,
			contactDeadlineAt: null,
			nextFollowUpAt: null,
		});
		const [change] = await db
			.select()
			.from(activity)
			.where(and(eq(activity.leadId, id), eq(activity.type, "stage_change")));
		expect(change).toMatchObject({
			note: "Moved abroad",
			data: { from: "new", to: "disqualified", reason: "other" },
		});
		// Closed leads take no more actions.
		expect(await codeOf(s.salesA.caller.lead.nurture({ leadId: id }))).toBe(
			"BAD_REQUEST",
		);
		expect(
			await codeOf(
				s.salesA.caller.lead.logOutcome({
					leadId: id,
					outcome: "answered",
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("Nurture sets the check-in; disqualified and nurtured leads leave the Overview", async () => {
		const s = await setup();
		const wrong = await claimed(s);
		const later30 = await claimed(s);
		await s.salesA.caller.lead.disqualify({
			leadId: wrong,
			reason: "invalid_data",
		});
		await s.salesA.caller.lead.nurture({ leadId: later30 });
		const nurtured = await row(later30);
		expect(nurtured.status).toBe("nurturing");
		const days =
			((nurtured.nurtureNextCheckAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThan(30.1);
		const todo = await s.salesA.caller.todo.list();
		expect([...todo.dueToday, ...todo.stale]).toEqual([]);
		const overview = await s.salesA.caller.overview.get();
		expect(Object.values(overview.leads.byStatus)).toEqual([0, 0, 0, 0]);
	});

	test("Lost is for deals only, with a reason; Negotiating moves the deal on", async () => {
		const s = await setup();
		const id = await qualified(s);
		const { opportunityId } = await s.salesA.caller.lead.convert({
			leadId: id,
			nextFollowUpAt: later(),
		});
		// The lead is converted: lead-phase exits no longer apply.
		expect(
			await codeOf(
				s.salesA.caller.lead.disqualify({ leadId: id, reason: "spam" }),
			),
		).toBe("BAD_REQUEST");

		await s.salesA.caller.opportunity.setStage({
			opportunityId,
			stage: "negotiating",
		});
		expect(
			await codeOf(
				s.salesA.caller.opportunity.markLost({
					opportunityId,
					reason: "other",
				}),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.opportunity.markLost({
			opportunityId,
			reason: "loan_rejected",
		});
		const [deal] = await db
			.select()
			.from(opportunity)
			.where(eq(opportunity.id, opportunityId));
		expect(deal).toMatchObject({ stage: "lost", lostReason: "loan_rejected" });
		expect(deal?.lostAt).not.toBeNull();
	});

	test("only the owner or a covering manager can close; company B can't", async () => {
		const s = await setup();
		const id = await qualified(s);
		const disqualify = { leadId: id, reason: "spam" as const };
		expect(await codeOf(s.salesB.caller.lead.disqualify(disqualify))).toBe(
			"NOT_FOUND",
		);
		const b = await setup();
		expect(await codeOf(b.manager.caller.lead.disqualify(disqualify))).toBe(
			"NOT_FOUND",
		);
		expect(
			await codeOf(
				b.manager.caller.lead.logOutcome({
					leadId: id,
					outcome: "answered",
					nextFollowUpAt: later(),
				}),
			),
		).toBe("NOT_FOUND");
		const { opportunityId } = await s.salesA.caller.lead.convert({
			leadId: id,
			nextFollowUpAt: later(),
		});
		const lost = { opportunityId, reason: "cold_feet" as const };
		expect(await codeOf(s.salesB.caller.opportunity.markLost(lost))).toBe(
			"NOT_FOUND",
		);
		expect(await codeOf(b.manager.caller.opportunity.markLost(lost))).toBe(
			"NOT_FOUND",
		);
		expect(
			await codeOf(
				b.manager.caller.opportunity.setFollowUp({
					opportunityId,
					nextFollowUpAt: later(),
				}),
			),
		).toBe("NOT_FOUND");
		expect(await codeOf(b.manager.caller.opportunity.list({}))).toBe("OK");
		expect(await b.manager.caller.opportunity.list({})).toEqual([]);
		expect(await codeOf(s.manager.caller.opportunity.markLost(lost))).toBe(
			"OK",
		);
	});
});

describe("pool page", () => {
	test("my projects only, priority first, project filter, claimed leads leave", async () => {
		const s = await setup();
		const plain = await poolLead(s);
		const urgent = await poolLead(s);
		await db.update(lead).set({ priority: true }).where(eq(lead.id, urgent));
		const { id: hillside } = await s.admin.caller.project.create({
			name: "Hillside",
		});
		const outsider = await callerAs(s.org.id, "salesperson", [hillside]);

		let pool = await s.salesA.caller.pool.list({});
		expect(pool.map((l) => l.leadId)).toEqual([urgent, plain]);
		expect(pool[0]).toMatchObject({ projectName: "Riverside", priority: true });
		expect((await s.salesA.caller.pool.count()).count).toBe(2);
		expect(await outsider.caller.pool.list({})).toEqual([]);
		expect(await s.salesA.caller.pool.list({ projectId: hillside })).toEqual(
			[],
		);

		await s.salesB.caller.lead.claim({ leadId: urgent });
		pool = await s.salesA.caller.pool.list({});
		expect(pool.map((l) => l.leadId)).toEqual([plain]);
		expect((await s.salesA.caller.pool.count()).count).toBe(1);
	});

	test("company B's pool never shows company A's leads", async () => {
		const a = await setup();
		const b = await setup();
		await poolLead(a);
		expect(await b.salesA.caller.pool.list({})).toEqual([]);
		expect((await b.salesA.caller.pool.count()).count).toBe(0);
	});
});

describe("To do", () => {
	test("due today vs stale; leads and deals together, earliest first", async () => {
		const s = await setup();
		const fresh = await claimed(s);
		const overdue = await claimed(s);
		const missing = await claimed(s);
		const notYet = await claimed(s);
		const dealLead = await qualified(s);
		const answered = (leadId: string, at: Date) =>
			s.salesA.caller.lead.logOutcome({
				leadId,
				outcome: "answered",
				nextFollowUpAt: at.toISOString(),
			});
		await answered(overdue, inDays(1));
		await answered(missing, inDays(1));
		await answered(notYet, inDays(3));
		await db
			.update(lead)
			.set({ nextFollowUpAt: new Date(Date.now() - 3_600_000) })
			.where(eq(lead.id, overdue));
		await db
			.update(lead)
			.set({ nextFollowUpAt: null })
			.where(eq(lead.id, missing));
		const { opportunityId } = await s.salesA.caller.lead.convert({
			leadId: dealLead,
			nextFollowUpAt: later(),
		});
		await db
			.update(opportunity)
			.set({ nextFollowUpAt: new Date(Date.now() - 7_200_000) })
			.where(eq(opportunity.id, opportunityId));

		const todo = await s.salesA.caller.todo.list();
		expect(todo.dueToday.map((r) => [r.kind, r.id, r.reason])).toEqual([
			["lead", fresh, "first_contact"],
		]);
		expect(todo.stale.map((r) => [r.kind, r.id, r.reason])).toEqual([
			["lead", missing, "no_follow_up"],
			["opportunity", opportunityId, "overdue"],
			["lead", overdue, "overdue"],
		]);
		expect(todo.arrivals).toEqual({ qualified: 0, unvetted: 0, items: [] });
		expect(todo.dueToday[0]).toMatchObject({
			status: "new",
			stage: null,
			phoneE164: expect.stringMatching(/^\+66/),
		});
		expect((await s.salesA.caller.todo.count()).count).toBe(4);
		// Other people's work isn't on my To do.
		const other = await s.salesB.caller.todo.list();
		expect([...other.dueToday, ...other.stale]).toEqual([]);
	});

	test("unreachable leads are stale with the try count", async () => {
		const s = await setup();
		const quiet = await claimed(s);
		for (let i = 0; i < 3; i++) {
			await s.salesA.caller.lead.logOutcome({
				leadId: quiet,
				outcome: "no_answer",
				nextFollowUpAt: inDays(3).toISOString(),
			});
		}
		const todo = await s.salesA.caller.todo.list();
		expect(todo.stale.find((r) => r.id === quiet)).toMatchObject({
			reason: "unreachable",
			attempts: 3,
			unreachable: true,
		});
	});

	test("lead rows carry the fit check; deals don't", async () => {
		const s = await setup();
		const id = await claimed(s);
		await db
			.update(lead)
			.set({
				budgetMinSatang: 300_000_000,
				budgetMaxSatang: 400_000_000,
				buyingTimeline: "1_3_months",
			})
			.where(eq(lead.id, id));
		await s.admin.caller.unit.importCommit({
			projectId: s.projectId,
			csv: [
				"section,unit_number,unit_type,list_price",
				"Tower,T-1,1 Bed,3500000",
			].join("\n"),
		});
		const todo = await s.salesA.caller.todo.list();
		expect(todo.dueToday.find((r) => r.id === id)?.fit).toBe("fits");
	});

	test("company B's To do never shows company A's leads", async () => {
		const a = await setup();
		const b = await setup();
		await claimed(a);
		const todo = await b.salesA.caller.todo.list();
		expect([...todo.dueToday, ...todo.stale]).toEqual([]);
		expect((await b.salesA.caller.todo.count()).count).toBe(0);
	});
});

describe("Overview", () => {
	test("lead statuses, deal stages, this month and rates", async () => {
		const s = await setup();
		await claimed(s); // new
		const attempting = await claimed(s);
		await s.salesA.caller.lead.logOutcome({
			leadId: attempting,
			outcome: "no_answer",
			nextFollowUpAt: later(),
		});
		const dropped = await claimed(s);
		await s.salesA.caller.lead.disqualify({ leadId: dropped, reason: "spam" });
		const won = await qualified(s);
		const lostLead = await qualified(s);
		const deal = await s.salesA.caller.lead.convert({
			leadId: won,
			nextFollowUpAt: later(),
		});
		const lost = await s.salesA.caller.lead.convert({
			leadId: lostLead,
			nextFollowUpAt: later(),
		});
		await s.salesA.caller.opportunity.setStage({
			opportunityId: deal.opportunityId,
			stage: "negotiating",
		});
		await s.salesA.caller.opportunity.markLost({
			opportunityId: lost.opportunityId,
			reason: "cold_feet",
		});

		const o = await s.salesA.caller.overview.get();
		expect(o.leads.byStatus).toEqual({
			new: 1,
			attempting: 1,
			connected: 0,
			qualified: 0,
		});
		expect(o.leads.thisMonth).toEqual({
			received: 5,
			converted: 2,
			disqualified: 1,
		});
		// 2 of 5 were reached by a call (qualify helper doesn't call), 2 qualified, 2 converted.
		expect(o.leads.rates).toEqual({
			contact: 0,
			qualify: 2 / 5,
			conversion: 2 / 5,
		});
		expect(o.deals.byStage).toEqual({
			visited: 0,
			negotiating: 1,
			deposited: 0,
			contracted: 0,
		});
		expect(o.deals.thisMonth).toEqual({
			visits: 2,
			deposits: 0,
			won: 0,
			lost: 1,
		});
		expect(o.deals.rates).toEqual({ visitToDeposit: 0, win: 0 });
		expect(o.deals.closedWon).toEqual({
			count: 0,
			volumeSatang: null,
			commissionSatang: null,
		});
	});

	test("rates are null when there's nothing to divide; company B sees nothing of A", async () => {
		const a = await setup();
		await claimed(a);
		const b = await setup();
		const o = await b.salesA.caller.overview.get();
		expect(o.leads.thisMonth.received).toBe(0);
		expect(o.leads.rates).toEqual({
			contact: null,
			qualify: null,
			conversion: null,
		});
		expect(o.deals.rates).toEqual({ visitToDeposit: null, win: null });
	});
});
