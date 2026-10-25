import { returnExpiredClaims } from "@Real-Estate-CRM/api/services/pool";
import { contactDeadline } from "@Real-Estate-CRM/api/services/working-time";
import {
	auditLog,
	defaultOfficeHours,
	interest,
	interestActivity,
	type OfficeHours,
} from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { runScheduledJobs } from "./scheduler";
import { db } from "./services";
import { callerAs, createOrg } from "./test-support";

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
	const { interestId } = await s.manager.caller.lead.capture({
		projectId: s.projectId,
		name: `Customer ${n}`,
		phone: `08123${n}0`,
		sourceId: s.sourceId,
		marketingConsent: false,
		ownerMemberId,
	});
	return interestId;
}

async function row(interestId: string) {
	const [r] = await db
		.select()
		.from(interest)
		.where(eq(interest.id, interestId));
	if (!r) throw new Error("no interest");
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
			interestId: id,
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

		const [activity] = await db
			.select()
			.from(interestActivity)
			.where(
				and(
					eq(interestActivity.interestId, id),
					eq(interestActivity.type, "assignment"),
				),
			);
		expect(activity?.data).toEqual({
			from: null,
			to: s.salesA.member.id,
			via: "claim",
		});
		const [audit] = await db
			.select()
			.from(auditLog)
			.where(
				and(eq(auditLog.entityId, id), eq(auditLog.action, "interest.claim")),
			);
		expect(audit?.actorUserId).toBe(s.salesA.user.id);

		const second = s.salesB.caller.lead.claim({ interestId: id });
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
				codeOf(p.caller.lead.claim({ interestId: id })),
			),
		);
		expect(results.filter((r) => r === "OK")).toHaveLength(1);
		expect(results.filter((r) => r === "CONFLICT")).toHaveLength(4);
	});

	test("cap: 5 uncontacted claims; a real contact frees a slot, no answer doesn't", async () => {
		const s = await setup();
		const ids = await Promise.all([0, 1, 2, 3, 4, 5].map(() => poolLead(s)));
		for (const id of ids.slice(0, 5)) {
			await s.salesA.caller.lead.claim({ interestId: id });
		}
		const sixth = { interestId: ids[5] ?? "" };
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe(
			"PRECONDITION_FAILED",
		);

		const nextFollowUpAt = inDays(1).toISOString();
		await s.salesA.caller.lead.logOutcome({
			interestId: ids[0] ?? "",
			outcome: "no_answer",
			nextFollowUpAt,
		});
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe(
			"PRECONDITION_FAILED",
		);
		await s.salesA.caller.lead.logOutcome({
			interestId: ids[0] ?? "",
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
		expect(await codeOf(s.manager.caller.lead.claim({ interestId: id }))).toBe(
			"FORBIDDEN",
		);
		const { id: hillside } = await s.admin.caller.project.create({
			name: "Hillside",
		});
		const outsider = await callerAs(s.org.id, "salesperson", [hillside]);
		expect(await codeOf(outsider.caller.lead.claim({ interestId: id }))).toBe(
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
			expect(await codeOf(s.salesA.caller.lead.claim({ interestId: id }))).toBe(
				"OK",
			);
		}
	});

	test("company B can't claim company A's lead", async () => {
		const a = await setup();
		const b = await setup();
		const id = await poolLead(a);
		expect(await codeOf(b.salesA.caller.lead.claim({ interestId: id }))).toBe(
			"NOT_FOUND",
		);
		expect((await row(id)).ownerMemberId).toBeNull();
	});
});

describe("expired claims", () => {
	test("the scheduled job returns them to the pool, logged by the system", async () => {
		const s = await setup();
		const id = await poolLead(s);
		await s.salesA.caller.lead.claim({ interestId: id });
		await db
			.update(interest)
			.set({ contactDeadlineAt: new Date(Date.now() - 60_000) })
			.where(eq(interest.id, id));

		const result = await runScheduledJobs(db);
		expect(result?.expiredClaims).toBeGreaterThanOrEqual(1);
		expect(await row(id)).toMatchObject({
			ownerMemberId: null,
			claimedAt: null,
			contactDeadlineAt: null,
		});
		const activities = await db
			.select()
			.from(interestActivity)
			.where(eq(interestActivity.interestId, id));
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
				and(eq(auditLog.entityId, id), eq(auditLog.action, "interest.assign")),
			);
		expect(audit?.actorUserId).toBeNull();
	});

	test("a lead not yet due stays; reading Today returns overdue ones lazily", async () => {
		const s = await setup();
		const kept = await poolLead(s);
		const expired = await poolLead(s);
		await s.salesA.caller.lead.claim({ interestId: kept });
		await s.salesA.caller.lead.claim({ interestId: expired });
		await db
			.update(interest)
			.set({ contactDeadlineAt: new Date(Date.now() - 1000) })
			.where(eq(interest.id, expired));

		const pool = await s.salesB.caller.pool.list({});
		expect(pool.map((l) => l.interestId)).toContain(expired);
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
		await a.salesA.caller.lead.claim({ interestId: id });
		await db
			.update(interest)
			.set({ contactDeadlineAt: new Date(Date.now() - 1000) })
			.where(eq(interest.id, id));
		await returnExpiredClaims(db, { organizationId: b.org.id });
		expect((await row(id)).ownerMemberId).toBe(a.salesA.member.id);
	});
});

const later = (days = 1) => inDays(days).toISOString();

/** A pool lead claimed by salesperson A. */
async function claimed(s: Setup) {
	const id = await poolLead(s);
	await s.salesA.caller.lead.claim({ interestId: id });
	return id;
}

describe("call results and follow-ups", () => {
	test("every result needs a future follow-up; the chosen time is stored", async () => {
		const s = await setup();
		const id = await claimed(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.logOutcome({
					interestId: id,
					outcome: "answered",
					nextFollowUpAt: inDays(-1).toISOString(),
				}),
			),
		).toBe("BAD_REQUEST");

		// A time later today is fine: the salesperson chooses freely.
		const inTwoHours = new Date(Date.now() + 2 * 3_600_000);
		await s.salesA.caller.lead.logOutcome({
			interestId: id,
			outcome: "no_answer",
			nextFollowUpAt: inTwoHours.toISOString(),
		});
		expect((await row(id)).nextFollowUpAt).toEqual(inTwoHours);
		// No answer isn't contact: the deadline stays.
		expect((await row(id)).contactDeadlineAt).not.toBeNull();

		const nextWeek = inDays(7);
		await s.salesA.caller.lead.logOutcome({
			interestId: id,
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
			interestId: id,
			nextFollowUpAt: in5.toISOString(),
		});
		expect((await row(id)).nextFollowUpAt).toEqual(in5);
	});

	test("3 no-answers in 7 days is unreachable; a real contact resets the count", async () => {
		const s = await setup();
		const id = await claimed(s);
		const noAnswer = () =>
			s.salesA.caller.lead.logOutcome({
				interestId: id,
				outcome: "no_answer",
				nextFollowUpAt: later(),
			});
		expect(await noAnswer()).toEqual({ attempt: 1, unreachable: false });
		expect(await noAnswer()).toEqual({ attempt: 2, unreachable: false });
		expect(await noAnswer()).toEqual({ attempt: 3, unreachable: true });

		await s.salesA.caller.lead.logOutcome({
			interestId: id,
			outcome: "answered",
			nextFollowUpAt: later(),
		});
		expect(await noAnswer()).toEqual({ attempt: 1, unreachable: false });
	});

	test("no-answers older than the window don't count", async () => {
		const s = await setup();
		const id = await claimed(s);
		// History is append-only, so seed an old try directly.
		await db.insert(interestActivity).values({
			organizationId: s.org.id,
			interestId: id,
			type: "no_answer",
			at: inDays(-8),
		});
		const result = await s.salesA.caller.lead.logOutcome({
			interestId: id,
			outcome: "no_answer",
			nextFollowUpAt: later(),
		});
		expect(result.attempt).toBe(1);
	});

	test("other salespeople can't log on my lead; pool leads must be claimed first", async () => {
		const s = await setup();
		const mine = await claimed(s);
		const answered = (interestId: string) => ({
			interestId,
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
		const picks = await s.salesA.caller.lead.followUpPicks({ interestId: id });
		for (const at of Object.values(picks)) {
			expect(at?.getTime()).toBeGreaterThan(Date.now());
		}
		expect(
			await codeOf(s.salesB.caller.lead.followUpPicks({ interestId: id })),
		).toBe("NOT_FOUND");
		const b = await setup();
		expect(
			await codeOf(b.manager.caller.lead.followUpPicks({ interestId: id })),
		).toBe("NOT_FOUND");
	});
});

describe("Lost / Nurture / Invalid", () => {
	test("Lost needs a reason, Other needs a note; closing frees the claim slot", async () => {
		const s = await setup();
		const id = await claimed(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.close({
					interestId: id,
					exit: "lost",
					reason: "other",
				}),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.lead.close({
			interestId: id,
			exit: "lost",
			reason: "other",
			note: "Moved abroad",
		});
		expect(await row(id)).toMatchObject({
			stage: "lost",
			lostReason: "other",
			ownerMemberId: s.salesA.member.id,
			contactDeadlineAt: null,
			nextFollowUpAt: null,
		});
		const [change] = await db
			.select()
			.from(interestActivity)
			.where(
				and(
					eq(interestActivity.interestId, id),
					eq(interestActivity.type, "stage_change"),
				),
			);
		expect(change).toMatchObject({
			note: "Moved abroad",
			data: { from: "new", to: "lost", reason: "other" },
		});
		// Closed leads can't be closed again or take call results.
		expect(
			await codeOf(
				s.salesA.caller.lead.close({ interestId: id, exit: "nurture" }),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.lead.logOutcome({
					interestId: id,
					outcome: "answered",
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("Invalid and Nurture: reasons, check-in date, off To do", async () => {
		const s = await setup();
		const wrong = await claimed(s);
		const nurture = await claimed(s);
		await s.salesA.caller.lead.close({
			interestId: wrong,
			exit: "invalid",
			reason: "wrong_number",
		});
		await s.salesA.caller.lead.close({ interestId: nurture, exit: "nurture" });
		expect((await row(wrong)).invalidReason).toBe("wrong_number");
		const nurtured = await row(nurture);
		expect(nurtured.stage).toBe("nurture");
		const days =
			((nurtured.nurtureNextCheckAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThan(30.1);

		const today = await s.salesA.caller.today.get();
		expect(today.todo).toEqual([]);
		expect(today.stats.active).toBe(0);
	});

	test("only the owner or a covering manager can close; company B can't", async () => {
		const s = await setup();
		const id = await claimed(s);
		const lost = {
			interestId: id,
			exit: "lost" as const,
			reason: "budget" as const,
		};
		expect(await codeOf(s.salesB.caller.lead.close(lost))).toBe("NOT_FOUND");
		const b = await setup();
		expect(await codeOf(b.manager.caller.lead.close(lost))).toBe("NOT_FOUND");
		expect(
			await codeOf(
				b.manager.caller.lead.logOutcome({
					interestId: id,
					outcome: "answered",
					nextFollowUpAt: later(),
				}),
			),
		).toBe("NOT_FOUND");
		expect(await codeOf(s.manager.caller.lead.close(lost))).toBe("OK");
	});
});

describe("pool page", () => {
	test("my projects only, priority first, project filter, claimed leads leave", async () => {
		const s = await setup();
		const plain = await poolLead(s);
		const urgent = await poolLead(s);
		await db
			.update(interest)
			.set({ priority: true })
			.where(eq(interest.id, urgent));
		const { id: hillside } = await s.admin.caller.project.create({
			name: "Hillside",
		});
		const outsider = await callerAs(s.org.id, "salesperson", [hillside]);

		let pool = await s.salesA.caller.pool.list({});
		expect(pool.map((l) => l.interestId)).toEqual([urgent, plain]);
		expect(pool[0]).toMatchObject({ projectName: "Riverside", priority: true });
		expect((await s.salesA.caller.pool.count()).count).toBe(2);
		expect(await outsider.caller.pool.list({})).toEqual([]);
		expect(await s.salesA.caller.pool.list({ projectId: hillside })).toEqual(
			[],
		);

		await s.salesB.caller.lead.claim({ interestId: urgent });
		pool = await s.salesA.caller.pool.list({});
		expect(pool.map((l) => l.interestId)).toEqual([plain]);
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

describe("Overview", () => {
	test("To do: first contact by deadline, then due follow-ups; cards count my leads", async () => {
		const s = await setup();
		const fresh = await claimed(s);
		const due = await claimed(s);
		const notYet = await claimed(s);
		const answered = (interestId: string, at: Date) =>
			s.salesA.caller.lead.logOutcome({
				interestId,
				outcome: "answered",
				nextFollowUpAt: at.toISOString(),
			});
		await answered(due, inDays(1));
		await answered(notYet, inDays(2));
		await db
			.update(interest)
			.set({ nextFollowUpAt: new Date(Date.now() - 3_600_000) })
			.where(eq(interest.id, due));

		const today = await s.salesA.caller.today.get();
		expect(today.todo.map((l) => [l.interestId, l.reason])).toEqual([
			[fresh, "first_contact"],
			[due, "follow_up_due"],
		]);
		expect(today.todo[0]?.phoneE164).toMatch(/^\+66/);
		expect(today.stats).toMatchObject({
			active: 3,
			overdue: { count: 1 },
			qualified: 2,
			unreachable: 0,
		});
		expect(today.stats.overdue.oldest).not.toBeNull();
		// Other people's work isn't on my Overview.
		expect((await s.salesB.caller.today.get()).todo).toEqual([]);
	});

	test("cards follow the pipeline; unreachable leads show up to decide on", async () => {
		const s = await setup();
		const visited = await claimed(s);
		const deposited = await claimed(s);
		const won = await claimed(s);
		const quiet = await claimed(s);
		const setStage = (
			id: string,
			stage: "visited" | "deposited" | "transferred",
		) =>
			db
				.update(interest)
				.set({ stage, contactDeadlineAt: null, nextFollowUpAt: inDays(3) })
				.where(eq(interest.id, id));
		await setStage(visited, "visited");
		await setStage(deposited, "deposited");
		await setStage(won, "transferred");
		for (let i = 0; i < 3; i++) {
			await s.salesA.caller.lead.logOutcome({
				interestId: quiet,
				outcome: "no_answer",
				nextFollowUpAt: later(3),
			});
		}

		const today = await s.salesA.caller.today.get();
		expect(today.stats).toMatchObject({
			active: 3,
			opportunities: 1,
			deposited: 1,
			unreachable: 1,
			qualified: 0,
		});
		expect(today.todo.find((l) => l.interestId === quiet)).toMatchObject({
			attempts: 3,
			unreachable: true,
		});
	});

	test("company B's Overview never counts company A's leads", async () => {
		const a = await setup();
		const b = await setup();
		await claimed(a);
		const today = await b.salesA.caller.today.get();
		expect(today.todo).toEqual([]);
		expect(today.stats.active).toBe(0);
	});
});
