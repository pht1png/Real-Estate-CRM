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
		await s.salesA.caller.lead.logActivity({
			interestId: ids[0] ?? "",
			type: "no_answer",
			nextFollowUpAt,
		});
		expect(await codeOf(s.salesA.caller.lead.claim(sixth))).toBe(
			"PRECONDITION_FAILED",
		);
		await s.salesA.caller.lead.logActivity({
			interestId: ids[0] ?? "",
			type: "call",
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

		const today = await s.salesB.caller.today.get();
		expect(today.pool.map((l) => l.interestId)).toContain(expired);
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

describe("activities and follow-ups", () => {
	test("owned open leads must end up with a future follow-up", async () => {
		const s = await setup();
		const id = await poolLead(s);
		await s.salesA.caller.lead.claim({ interestId: id });
		expect(
			await codeOf(
				s.salesA.caller.lead.logActivity({ interestId: id, type: "call" }),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.lead.logActivity({
					interestId: id,
					type: "line",
					nextFollowUpAt: inDays(-1).toISOString(),
				}),
			),
		).toBe("BAD_REQUEST");

		const nextFollowUpAt = inDays(2);
		await s.salesA.caller.lead.logActivity({
			interestId: id,
			type: "line",
			note: "Sent brochure",
			nextFollowUpAt: nextFollowUpAt.toISOString(),
		});
		expect(await row(id)).toMatchObject({
			nextFollowUpAt,
			contactDeadlineAt: null,
		});
		// The existing future follow-up carries over.
		await s.salesA.caller.lead.logActivity({ interestId: id, type: "call" });

		const later = inDays(5);
		await s.salesA.caller.lead.setFollowUp({
			interestId: id,
			nextFollowUpAt: later.toISOString(),
		});
		expect((await row(id)).nextFollowUpAt).toEqual(later);
		expect(
			await codeOf(
				s.salesA.caller.lead.setFollowUp({
					interestId: id,
					nextFollowUpAt: inDays(-1).toISOString(),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("other salespeople can't log on my lead; pool leads must be claimed first", async () => {
		const s = await setup();
		const mine = await poolLead(s);
		await s.salesA.caller.lead.claim({ interestId: mine });
		const call = (interestId: string) => ({
			interestId,
			type: "call" as const,
			nextFollowUpAt: inDays(1).toISOString(),
		});
		expect(await codeOf(s.salesB.caller.lead.logActivity(call(mine)))).toBe(
			"NOT_FOUND",
		);
		const pooled = await poolLead(s);
		expect(await codeOf(s.salesB.caller.lead.logActivity(call(pooled)))).toBe(
			"FORBIDDEN",
		);
		// Managers covering the project may act on any lead.
		expect(await codeOf(s.manager.caller.lead.logActivity(call(mine)))).toBe(
			"OK",
		);
	});

	test("company B can't log on or reschedule company A's lead", async () => {
		const a = await setup();
		const b = await setup();
		const id = await poolLead(a);
		const nextFollowUpAt = inDays(1).toISOString();
		expect(
			await codeOf(
				b.manager.caller.lead.logActivity({
					interestId: id,
					type: "call",
					nextFollowUpAt,
				}),
			),
		).toBe("NOT_FOUND");
		expect(
			await codeOf(
				b.manager.caller.lead.setFollowUp({ interestId: id, nextFollowUpAt }),
			),
		).toBe("NOT_FOUND");
	});
});

describe("Today", () => {
	test("pool → my claims → follow-ups due, overdue and missing first", async () => {
		const s = await setup();
		const id = await poolLead(s);
		const ids = (l: { interestId: string }[]) => l.map((x) => x.interestId);

		let today = await s.salesA.caller.today.get();
		expect(ids(today.pool)).toContain(id);
		expect(today.pool.find((l) => l.interestId === id)).toMatchObject({
			phoneE164: expect.stringMatching(/^\+66/),
			projectName: "Riverside",
		});

		await s.salesA.caller.lead.claim({ interestId: id });
		today = await s.salesA.caller.today.get();
		expect(ids(today.pool)).not.toContain(id);
		expect(ids(today.claims)).toEqual([id]);
		expect(ids(today.followUps)).toEqual([]);

		await s.salesA.caller.lead.logActivity({
			interestId: id,
			type: "call",
			nextFollowUpAt: inDays(3).toISOString(),
		});
		today = await s.salesA.caller.today.get();
		expect(ids(today.claims)).toEqual([]);
		expect(ids(today.followUps)).toEqual([]);

		// Overdue, plus a self-logged lead missing a follow-up, both show up.
		await db
			.update(interest)
			.set({ nextFollowUpAt: new Date(Date.now() - 3_600_000) })
			.where(eq(interest.id, id));
		const missing = await poolLead(s);
		await db
			.update(interest)
			.set({ ownerMemberId: s.salesA.member.id })
			.where(eq(interest.id, missing));
		today = await s.salesA.caller.today.get();
		expect(ids(today.followUps)).toEqual([missing, id]);

		// Other people's work isn't on my Today.
		const other = await s.salesB.caller.today.get();
		expect(ids(other.claims)).toEqual([]);
		expect(ids(other.followUps)).toEqual([]);
	});

	test("company B's Today never shows company A's leads", async () => {
		const a = await setup();
		const b = await setup();
		await poolLead(a);
		const today = await b.salesA.caller.today.get();
		expect(today.pool).toEqual([]);
	});
});
