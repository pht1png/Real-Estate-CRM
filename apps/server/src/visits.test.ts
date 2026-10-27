import {
	activity,
	appointment,
	defaultOfficeHours,
	lead,
	type OfficeHours,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

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

const HOUR = 3_600_000;
const inHours = (n: number) => new Date(Date.now() + n * HOUR);
const at = (hours: number) => inHours(hours).toISOString();
const later = (days = 1) => at(days * 24);
// Open all day, every day: appointment times are predictable whenever the tests run.
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
type Person = Setup["salesA"];

let phoneCounter = 0;
/** A manager-logged enquiry sent to the pool. */
async function poolLead(s: Setup) {
	const n = String(phoneCounter++ % 10_000).padStart(4, "0");
	const { leadId } = await s.manager.caller.lead.capture({
		projectId: s.projectId,
		name: `Visitor ${n}`,
		phone: `08124${n}0`,
		sourceId: s.sourceId,
		marketingConsent: false,
		ownerMemberId: null,
	});
	return leadId;
}

/** A lead `who` claimed and spoke to (Connected). */
async function connected(s: Setup, who: Person = s.salesA) {
	const id = await poolLead(s);
	await who.caller.lead.claim({ leadId: id });
	await who.caller.lead.logOutcome({
		leadId: id,
		outcome: "answered",
		nextFollowUpAt: later(),
	});
	return id;
}

async function qualified(s: Setup, who: Person = s.salesA) {
	const id = await connected(s, who);
	await qualifyLead(who.caller, id, s.projectId);
	return id;
}

/** An opportunity from a walk-in visit `daysAgo` days back. */
async function converted(s: Setup, daysAgo = 0) {
	const leadId = await qualified(s);
	const { opportunityId } = await s.salesA.caller.lead.convert({
		leadId,
		visitedAt: inHours(-daysAgo * 24 - 0.1).toISOString(),
		nextFollowUpAt: later(),
	});
	return { leadId, opportunityId };
}

async function appointmentRow(id: string) {
	const [r] = await db.select().from(appointment).where(eq(appointment.id, id));
	if (!r) throw new Error("no appointment");
	return r;
}

async function opportunityRow(id: string) {
	const [r] = await db.select().from(opportunity).where(eq(opportunity.id, id));
	if (!r) throw new Error("no opportunity");
	return r;
}

async function activitiesOf(leadId: string, type: string) {
	return db
		.select()
		.from(activity)
		.where(
			and(
				eq(activity.leadId, leadId),
				eq(activity.type, type as typeof activity.$inferSelect.type),
			),
		);
}

/** Moves a scheduled appointment to start `hours` from now (setup only). */
async function moveTo(id: string, hours: number) {
	await db
		.update(appointment)
		.set({ startsAt: inHours(hours), endsAt: inHours(hours + 1) })
		.where(eq(appointment.id, id));
}

describe("booking appointments", () => {
	test("first tour for a connected lead: 60 minutes, hosted by the owner, logged", async () => {
		const s = await setup();
		const id = await connected(s);
		const startsAt = at(26);
		const booked = await s.salesA.caller.appointment.book({
			leadId: id,
			startsAt,
		});
		expect(booked.endsAt.getTime() - booked.startsAt.getTime()).toBe(HOUR);
		expect(await appointmentRow(booked.appointmentId)).toMatchObject({
			leadId: id,
			opportunityId: null,
			memberId: s.salesA.member.id,
			status: "scheduled",
			cancelReason: null,
		});
		const [logged] = await activitiesOf(id, "appointment_booked");
		expect(logged?.data).toMatchObject({
			appointmentId: booked.appointmentId,
			startsAt,
			memberId: s.salesA.member.id,
		});
		// A manager may book for the salesperson; the host is still the owner.
		const byManager = await s.manager.caller.appointment.book({
			leadId: id,
			startsAt: at(30),
		});
		expect((await appointmentRow(byManager.appointmentId)).memberId).toBe(
			s.salesA.member.id,
		);
	});

	test("only connected or qualified leads, in the future", async () => {
		const s = await setup();
		const fresh = await poolLead(s);
		await s.salesA.caller.lead.claim({ leadId: fresh });
		expect(
			await codeOf(
				s.salesA.caller.appointment.book({ leadId: fresh, startsAt: at(5) }),
			),
		).toBe("BAD_REQUEST");
		const id = await qualified(s);
		expect(
			await codeOf(
				s.salesA.caller.appointment.book({ leadId: id, startsAt: at(-1) }),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.appointment.book({ leadId: id, startsAt: at(5) }),
			),
		).toBe("OK");
		// Someone else's lead: not visible to salesperson B.
		expect(
			await codeOf(
				s.salesB.caller.appointment.book({ leadId: id, startsAt: at(9) }),
			),
		).toBe("NOT_FOUND");
	});

	test("no overlaps for one salesperson; back to back and other salespeople are fine", async () => {
		const s = await setup();
		const one = await connected(s);
		const two = await connected(s);
		const first = await s.salesA.caller.appointment.book({
			leadId: one,
			startsAt: at(48),
		});
		expect(
			await codeOf(
				s.salesA.caller.appointment.book({ leadId: two, startsAt: at(48.5) }),
			),
		).toBe("CONFLICT");
		// Back to back: starts when the first ends.
		await s.salesA.caller.appointment.book({
			leadId: two,
			startsAt: first.endsAt.toISOString(),
		});
		// Salesperson B at the same time as A.
		const theirs = await connected(s, s.salesB);
		await s.salesB.caller.appointment.book({
			leadId: theirs,
			startsAt: at(48),
		});
		// A cancelled appointment frees its slot.
		await s.salesA.caller.appointment.cancel({
			appointmentId: first.appointmentId,
			reason: "contact_cancelled",
		});
		const three = await connected(s);
		expect(
			await codeOf(
				s.salesA.caller.appointment.book({
					leadId: three,
					startsAt: first.startsAt.toISOString(),
				}),
			),
		).toBe("OK");
	});

	test("parallel bookings of one slot: exactly one succeeds", async () => {
		const s = await setup();
		const leads = await Promise.all([1, 2, 3].map(() => connected(s)));
		const startsAt = at(72);
		const results = await Promise.all(
			leads.map((leadId) =>
				codeOf(s.salesA.caller.appointment.book({ leadId, startsAt })),
			),
		);
		expect(results.filter((r) => r === "OK")).toHaveLength(1);
		expect(results.filter((r) => r === "CONFLICT")).toHaveLength(2);
	});

	test("free slots leave out the salesperson's booked time", async () => {
		const s = await setup();
		const id = await connected(s);
		const date = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString(
			"en-CA",
			{ timeZone: "Asia/Bangkok" },
		);
		const before = await s.salesA.caller.appointment.slots({
			leadId: id,
			date,
		});
		expect(before.minutes).toBe(60);
		const slot = before.free[4];
		if (!slot) throw new Error("no free slot");
		const { appointmentId } = await s.salesA.caller.appointment.book({
			leadId: id,
			startsAt: slot.toISOString(),
		});
		const after = await s.salesA.caller.appointment.slots({ leadId: id, date });
		expect(after.booked.map((b) => b.id)).toEqual([appointmentId]);
		expect(after.free.map((f) => f.getTime())).not.toContain(slot.getTime());
		// Rescheduling the same appointment keeps its own time on offer.
		const own = await s.salesA.caller.appointment.slots({
			leadId: id,
			date,
			appointmentId,
		});
		expect(own.free.map((f) => f.getTime())).toContain(slot.getTime());
	});
});

describe("changing appointments", () => {
	test("reschedule keeps it scheduled, logs from → to, is clash-checked and isn't a cancel", async () => {
		const s = await setup();
		const one = await connected(s);
		const two = await connected(s);
		const a = await s.salesA.caller.appointment.book({
			leadId: one,
			startsAt: at(30),
		});
		const b = await s.salesA.caller.appointment.book({
			leadId: two,
			startsAt: at(40),
		});
		expect(
			await codeOf(
				s.salesA.caller.appointment.reschedule({
					appointmentId: a.appointmentId,
					startsAt: at(40.5),
				}),
			),
		).toBe("CONFLICT");
		await s.salesA.caller.appointment.reschedule({
			appointmentId: a.appointmentId,
			startsAt: at(50),
		});
		const moved = await appointmentRow(a.appointmentId);
		expect(moved.status).toBe("scheduled");
		expect(moved.endsAt.getTime() - moved.startsAt.getTime()).toBe(HOUR);
		const [log] = await activitiesOf(one, "appointment_rescheduled");
		expect(log?.data).toMatchObject({
			appointmentId: a.appointmentId,
			from: a.startsAt.toISOString(),
		});
		expect(await activitiesOf(one, "appointment_cancelled")).toEqual([]);
		expect((await appointmentRow(b.appointmentId)).status).toBe("scheduled");
	});

	test("cancel needs a reason; Other needs a note", async () => {
		const s = await setup();
		const id = await connected(s);
		const { appointmentId } = await s.salesA.caller.appointment.book({
			leadId: id,
			startsAt: at(30),
		});
		expect(
			await codeOf(
				s.salesA.caller.appointment.cancel({ appointmentId, reason: "other" }),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.appointment.cancel({
			appointmentId,
			reason: "other",
			note: "Family emergency",
		});
		expect(await appointmentRow(appointmentId)).toMatchObject({
			status: "cancelled",
			cancelReason: "other",
		});
		const [log] = await activitiesOf(id, "appointment_cancelled");
		expect(log).toMatchObject({
			note: "Family emergency",
			data: { appointmentId, reason: "other" },
		});
		// A cancelled appointment takes no more changes.
		expect(
			await codeOf(
				s.salesA.caller.appointment.reschedule({
					appointmentId,
					startsAt: at(40),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("no-show needs a future follow-up and sets it on the lead", async () => {
		const s = await setup();
		const id = await connected(s);
		const { appointmentId } = await s.salesA.caller.appointment.book({
			leadId: id,
			startsAt: at(1),
		});
		await moveTo(appointmentId, -1);
		expect(
			await codeOf(
				s.salesA.caller.appointment.noShow({
					appointmentId,
					nextFollowUpAt: at(-2),
				}),
			),
		).toBe("BAD_REQUEST");
		const next = later(2);
		await s.salesA.caller.appointment.noShow({
			appointmentId,
			nextFollowUpAt: next,
		});
		expect((await appointmentRow(appointmentId)).status).toBe("no_show");
		const [r] = await db.select().from(lead).where(eq(lead.id, id));
		expect(r?.nextFollowUpAt?.toISOString()).toBe(next);
		expect(await activitiesOf(id, "appointment_no_show")).toHaveLength(1);
	});

	test("company B can't see, change or book on company A's appointments", async () => {
		const a = await setup();
		const b = await setup();
		const id = await connected(a);
		const { appointmentId } = await a.salesA.caller.appointment.book({
			leadId: id,
			startsAt: at(30),
		});
		const calls = [
			() => b.manager.caller.appointment.book({ leadId: id, startsAt: at(40) }),
			() =>
				b.manager.caller.appointment.reschedule({
					appointmentId,
					startsAt: at(40),
				}),
			() =>
				b.manager.caller.appointment.cancel({
					appointmentId,
					reason: "contact_cancelled",
				}),
			() =>
				b.manager.caller.appointment.noShow({
					appointmentId,
					nextFollowUpAt: later(),
				}),
			() =>
				b.manager.caller.appointment.arrived({
					appointmentId,
					nextFollowUpAt: later(),
				}),
			() =>
				b.manager.caller.appointment.slots({ leadId: id, date: "2030-01-01" }),
		];
		for (const call of calls) {
			expect(await codeOf(call())).toBe("NOT_FOUND");
		}
		// Salesperson B in the same company doesn't see A's lead either.
		expect(
			await codeOf(
				a.salesB.caller.appointment.cancel({
					appointmentId,
					reason: "contact_cancelled",
				}),
			),
		).toBe("NOT_FOUND");
		expect((await appointmentRow(appointmentId)).status).toBe("scheduled");
	});
});

describe("visits: one way to record them", () => {
	test("arrived on a first tour: unvetted must qualify first, then it converts", async () => {
		const s = await setup();
		const id = await connected(s);
		const { appointmentId } = await s.salesA.caller.appointment.book({
			leadId: id,
			startsAt: at(1),
		});
		await moveTo(appointmentId, -0.5);
		expect(
			await codeOf(
				s.salesA.caller.appointment.arrived({
					appointmentId,
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
		await qualifyLead(s.salesA.caller, id, s.projectId);
		const { opportunityId, converted: first } =
			await s.salesA.caller.appointment.arrived({
				appointmentId,
				nextFollowUpAt: later(),
			});
		expect(first).toBe(true);
		// Still no opportunity on it: that's how it reads as the first tour.
		expect(await appointmentRow(appointmentId)).toMatchObject({
			status: "arrived",
			opportunityId: null,
		});
		const [visit] = await activitiesOf(id, "visit");
		expect(visit).toMatchObject({ opportunityId, data: { appointmentId } });
		expect(await activitiesOf(id, "conversion")).toHaveLength(1);
		expect(await opportunityRow(opportunityId)).toMatchObject({
			status: "visited",
			visitCount: 1,
		});
	});

	test("follow-up visit on an opportunity: booked, arrived, counted", async () => {
		const s = await setup();
		const { leadId, opportunityId } = await converted(s, 2);
		const { appointmentId } = await s.salesA.caller.appointment.book({
			opportunityId,
			startsAt: at(1),
		});
		expect((await appointmentRow(appointmentId)).opportunityId).toBe(
			opportunityId,
		);
		await moveTo(appointmentId, -0.5);
		const result = await s.salesA.caller.appointment.arrived({
			appointmentId,
			nextFollowUpAt: later(),
		});
		expect(result).toEqual({ opportunityId, converted: false });
		const updated = await opportunityRow(opportunityId);
		expect(updated.visitCount).toBe(2);
		expect(updated.lastVisitAt.getTime()).toBeGreaterThan(
			updated.firstVisitAt.getTime(),
		);
		const visits = await activitiesOf(leadId, "visit");
		expect(visits).toHaveLength(2);
		expect(await activitiesOf(leadId, "conversion")).toHaveLength(1);
	});

	test("a repeat walk-in without an appointment; a past time only", async () => {
		const s = await setup();
		const { leadId, opportunityId } = await converted(s, 1);
		expect(
			await codeOf(
				s.salesA.caller.opportunity.recordVisit({
					opportunityId,
					visitedAt: at(1),
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.opportunity.recordVisit({
			opportunityId,
			note: "Brought parents",
			nextFollowUpAt: later(),
		});
		expect((await opportunityRow(opportunityId)).visitCount).toBe(2);
		const visits = await activitiesOf(leadId, "visit");
		expect(
			visits.find((v) => v.note === "Brought parents")?.data,
		).not.toHaveProperty("appointmentId");
		// Confirm visit is for leads only: a converted lead doesn't convert again.
		expect(
			await codeOf(
				s.salesA.caller.lead.convert({ leadId, nextFollowUpAt: later() }),
			),
		).toBe("BAD_REQUEST");
		const b = await setup();
		expect(
			await codeOf(
				b.manager.caller.opportunity.recordVisit({
					opportunityId,
					nextFollowUpAt: later(),
				}),
			),
		).toBe("NOT_FOUND");
	});
});

describe("To do: arrivals and appointments nobody closed", () => {
	test("today's arrivals split qualified / unvetted / follow-ups; after 2 hours they ask 'did they come?'", async () => {
		const s = await setup();
		const unvetted = await connected(s);
		const ready = await qualified(s);
		const { opportunityId } = await converted(s, 1);
		const book = async (input: { leadId?: string; opportunityId?: string }) =>
			(await s.salesA.caller.appointment.book({ ...input, startsAt: at(1) }))
				.appointmentId;
		const u = await book({ leadId: unvetted });
		await moveTo(u, 3);
		const r = await book({ leadId: ready });
		await moveTo(r, 5);
		const f = await book({ opportunityId });
		await moveTo(f, -3);

		const todo = await s.salesA.caller.todo.list();
		const dayLeft = (h: number) =>
			new Date(Date.now() + h * HOUR).toLocaleDateString("en-CA", {
				timeZone: "Asia/Bangkok",
			}) ===
			new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
		// Late at night (Bangkok), +3h / +5h fall on tomorrow: skip the today counts.
		if (dayLeft(5)) {
			expect(todo.arrivals).toMatchObject({
				qualified: 1,
				unvetted: 1,
				followUps: 0,
			});
			expect(todo.arrivals.items.map((a) => a.appointmentId)).toEqual([u, r]);
		}
		expect(todo.unansweredAppointments).toEqual([
			expect.objectContaining({
				appointmentId: f,
				firstTour: false,
				opportunityId,
			}),
		]);
		const other = await s.salesB.caller.todo.list();
		expect(other.arrivals.items).toEqual([]);
		expect(other.unansweredAppointments).toEqual([]);
	});
});

describe("nurturing pool", () => {
	test("a nurtured lead is listed under Nurturing (not New, not the badge) and anyone can claim it", async () => {
		const s = await setup();
		const id = await connected(s);
		await s.salesA.caller.lead.nurture({ leadId: id, note: "Back in Q3" });

		const nurturing = await s.salesB.caller.pool.list({ tab: "nurturing" });
		expect(nurturing).toEqual([
			expect.objectContaining({
				leadId: id,
				previousOwnerName: s.salesA.user.name,
				nurtureNote: "Back in Q3",
			}),
		]);
		expect(nurturing[0]?.nurturedAt).toBeInstanceOf(Date);
		expect(await s.salesB.caller.pool.list({})).toEqual([]);
		expect((await s.salesB.caller.pool.count()).count).toBe(0);

		await s.salesB.caller.lead.claim({ leadId: id });
		const [r] = await db.select().from(lead).where(eq(lead.id, id));
		expect(r).toMatchObject({
			status: "attempting",
			ownerMemberId: s.salesB.member.id,
		});
		expect(r?.contactDeadlineAt).not.toBeNull();
		const changes = await activitiesOf(id, "status_change");
		expect(changes.map((c) => c.data)).toContainEqual({
			from: "nurturing",
			to: "attempting",
			reason: "claim",
		});
		expect(await s.salesA.caller.pool.list({ tab: "nurturing" })).toEqual([]);
	});

	test("a new enquiry reopens it as new in the New tab", async () => {
		const s = await setup();
		const n = String(phoneCounter++ % 10_000).padStart(4, "0");
		const phone = `08125${n}0`;
		const { leadId } = await s.manager.caller.lead.capture({
			projectId: s.projectId,
			name: "Returning",
			phone,
			sourceId: s.sourceId,
			marketingConsent: false,
			ownerMemberId: null,
		});
		await s.salesA.caller.lead.claim({ leadId });
		await s.salesA.caller.lead.nurture({ leadId });
		await s.manager.caller.lead.capture({
			projectId: s.projectId,
			name: "Returning",
			phone,
			sourceId: s.sourceId,
			marketingConsent: false,
			ownerMemberId: null,
		});
		const [r] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(r?.status).toBe("new");
		expect(
			(await s.salesB.caller.pool.list({})).map((p) => p.leadId),
		).toContain(leadId);
		expect(await s.salesB.caller.pool.list({ tab: "nurturing" })).toEqual([]);
	});

	test("company B never sees or claims company A's nurturing leads", async () => {
		const a = await setup();
		const b = await setup();
		const id = await connected(a);
		await a.salesA.caller.lead.nurture({ leadId: id });
		expect(await b.salesA.caller.pool.list({ tab: "nurturing" })).toEqual([]);
		expect(await codeOf(b.salesA.caller.lead.claim({ leadId: id }))).toBe(
			"NOT_FOUND",
		);
	});
});

describe("funding, status and hot / warm", () => {
	test("funding: owner or manager, logged; others and other companies can't", async () => {
		const s = await setup();
		const { leadId, opportunityId } = await converted(s);
		await s.salesA.caller.opportunity.setFunding({
			opportunityId,
			fundingType: "mortgage",
		});
		await s.manager.caller.opportunity.setFunding({
			opportunityId,
			fundingType: "cash_mortgage",
		});
		expect((await opportunityRow(opportunityId)).fundingType).toBe(
			"cash_mortgage",
		);
		const notes = await activitiesOf(leadId, "note");
		expect(notes.map((n) => n.data)).toEqual(
			expect.arrayContaining([
				{ funding: { from: null, to: "mortgage" } },
				{ funding: { from: "mortgage", to: "cash_mortgage" } },
			]),
		);
		expect(
			await codeOf(
				s.salesB.caller.opportunity.setFunding({
					opportunityId,
					fundingType: "cash",
				}),
			),
		).toBe("NOT_FOUND");
		const b = await setup();
		expect(
			await codeOf(
				b.manager.caller.opportunity.setFunding({
					opportunityId,
					fundingType: "cash",
				}),
			),
		).toBe("NOT_FOUND");
	});

	test("contracted → waiting for mortgage result needs mortgage funding; it stays live", async () => {
		const s = await setup();
		const { leadId, opportunityId } = await converted(s);
		expect(
			await codeOf(
				s.salesA.caller.opportunity.setStatus({
					opportunityId,
					status: "waiting_mortgage_result",
				}),
			),
		).toBe("BAD_REQUEST");
		// Contracted comes from deposits (M6); seeded here.
		await db
			.update(opportunity)
			.set({ status: "contracted" })
			.where(eq(opportunity.id, opportunityId));
		expect(
			await codeOf(
				s.salesA.caller.opportunity.setStatus({
					opportunityId,
					status: "waiting_mortgage_result",
				}),
			),
		).toBe("BAD_REQUEST");
		await s.salesA.caller.opportunity.setFunding({
			opportunityId,
			fundingType: "mortgage",
		});
		await s.salesA.caller.opportunity.setStatus({
			opportunityId,
			status: "waiting_mortgage_result",
		});
		const changes = await activitiesOf(leadId, "status_change");
		expect(changes.map((c) => c.data)).toContainEqual({
			from: "contracted",
			to: "waiting_mortgage_result",
		});
		// Live: a second opportunity for the lead is refused by the database.
		expect(
			await codeOf(
				db.insert(opportunity).values({
					organizationId: s.org.id,
					leadId,
					contactId: (await opportunityRow(opportunityId)).contactId,
					projectId: s.projectId,
					ownerMemberId: s.salesA.member.id,
					firstVisitAt: new Date(),
					lastVisitAt: new Date(),
				}),
			),
		).not.toBe("OK");
		// Only a sales manager marks the transfer.
		expect(
			await codeOf(
				s.salesA.caller.opportunity.setStatus({
					opportunityId,
					status: "transferred",
				}),
			),
		).toBe("FORBIDDEN");
		// A rejected loan can still lose it.
		await s.salesA.caller.opportunity.markLost({
			opportunityId,
			reason: "loan_rejected",
		});
		expect((await opportunityRow(opportunityId)).status).toBe("lost");
	});

	test("hot / warm is computed: timeline, budget fit, cash, a second visit", async () => {
		const s = await setup();
		const { opportunityId, leadId } = await converted(s);
		const contactId = (await opportunityRow(opportunityId)).contactId;
		const temperature = async () =>
			(await s.salesA.caller.contact.get({ contactId })).leads.find(
				(l) => l.id === leadId && l.visible,
			);
		// Visited + buying within 3 months; no priced units yet → warm.
		let page = await temperature();
		expect(page?.visible && page.opportunity?.temperature).toBe("warm");
		expect(
			(await s.salesA.caller.overview.get()).opportunities.temperature,
		).toEqual({ hot: 0, warm: 1 });
		// The budget fits the available units, and they pay cash → hot.
		await s.admin.caller.unit.importCommit({
			projectId: s.projectId,
			csv: [
				"section,unit_number,unit_type,list_price",
				"Tower,T-1,1 Bed,3500000",
			].join("\n"),
		});
		await s.salesA.caller.opportunity.setFunding({
			opportunityId,
			fundingType: "cash",
		});
		page = await temperature();
		expect(page?.visible && page.opportunity?.temperature).toBe("hot");
		// Mortgage instead: warm again, until a second visit makes it hot.
		await s.salesA.caller.opportunity.setFunding({
			opportunityId,
			fundingType: "mortgage",
		});
		page = await temperature();
		expect(page?.visible && page.opportunity?.temperature).toBe("warm");
		await s.salesA.caller.opportunity.recordVisit({
			opportunityId,
			nextFollowUpAt: later(),
		});
		page = await temperature();
		expect(page?.visible && page.opportunity?.temperature).toBe("hot");
	});

	test("a hot or warm opportunity quiet for 3 days goes to Stale", async () => {
		const s = await setup();
		const { opportunityId } = await converted(s, 4);
		const todo = await s.salesA.caller.todo.list();
		expect(todo.stale.find((r) => r.id === opportunityId)).toMatchObject({
			kind: "opportunity",
			reason: "quiet",
			temperature: "warm",
		});
		// Something logged today: no longer quiet, and not due yet.
		await s.salesA.caller.opportunity.recordVisit({
			opportunityId,
			nextFollowUpAt: later(),
		});
		const after = await s.salesA.caller.todo.list();
		expect(
			[...after.stale, ...after.dueToday].find((r) => r.id === opportunityId),
		).toBeUndefined();
	});
});
