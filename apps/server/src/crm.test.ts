import {
	activity,
	auditLog,
	customer,
	customerPhone,
	lead,
	opportunity,
} from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import { db } from "./services";
import { addMember, callerAs, createOrg, post, signIn } from "./test-support";

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "OK";
	} catch (error) {
		return error instanceof TRPCError ? error.code : String(error);
	}
}

const UNITS_CSV = [
	"section,unit_number,unit_type,list_price",
	"Tower,T-1,1 Bed,3000000",
	"Tower,T-2,2 Bed,5000000",
].join("\n");
const followUp = () => new Date(Date.now() + 86_400_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Company with one project (units ฿3M–฿5M), two salespeople, a manager and an admin. */
async function setup() {
	const org = await createOrg();
	const admin = await callerAs(org.id, "admin");
	const { id: projectId } = await admin.caller.project.create({
		name: "Riverside",
	});
	await admin.caller.unit.importCommit({ projectId, csv: UNITS_CSV });
	const { id: otherProjectId } = await admin.caller.project.create({
		name: "Hillside",
	});
	const salesA = await callerAs(org.id, "salesperson", [
		projectId,
		otherProjectId,
	]);
	const salesB = await callerAs(org.id, "salesperson", [
		projectId,
		otherProjectId,
	]);
	const manager = await callerAs(org.id, "sales_manager", [projectId]);
	const sources = await admin.caller.leadSource.list();
	const online = sources.channels.find((c) => c.name === "Online");
	const facebook = online?.sources.find((s) => s.name === "Facebook");
	const walkIn = sources.channels
		.find((c) => c.name === "Offline")
		?.sources.find((s) => s.name === "Walk-in");
	if (!online || !facebook || !walkIn)
		throw new Error("default sources missing");
	return {
		org,
		admin,
		salesA,
		salesB,
		manager,
		projectId,
		otherProjectId,
		online,
		facebookId: facebook.id,
		walkInId: walkIn.id,
		unknownSourceId: sources.unknownSourceId ?? "",
	};
}

type Setup = Awaited<ReturnType<typeof setup>>;
const walkIn = (s: Setup, extra: Record<string, unknown> = {}) => ({
	projectId: s.projectId,
	name: "Khun Somchai",
	phone: "081-234-5678",
	sourceId: s.walkInId,
	marketingConsent: true,
	nextFollowUpAt: followUp(),
	...extra,
});

describe("sources and campaigns", () => {
	test('every company starts with default channels, sources and a fixed "Don\'t know"', async () => {
		const s = await setup();
		const list = await s.salesA.caller.leadSource.list();
		expect(list.channels.map((c) => c.name)).toEqual([
			"Online",
			"Offline",
			"Referral",
		]);
		expect(list.unknownSourceId).toBe(s.unknownSourceId);
		expect(
			await codeOf(
				s.admin.caller.leadSource.renameSource({
					sourceId: s.unknownSourceId,
					name: "X",
				}),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.leadSource.createSource({
					channelId: s.online.id,
					name: "TikTok",
				}),
			),
		).toBe("FORBIDDEN");
	});

	test("archived sources can't be used for new leads", async () => {
		const s = await setup();
		await s.admin.caller.leadSource.archiveSource({
			sourceId: s.walkInId,
			archived: true,
		});
		expect(await codeOf(s.salesA.caller.lead.capture(walkIn(s)))).toBe(
			"NOT_FOUND",
		);
	});

	test("campaign codes are unique per company (ignoring case) and must match the source's channel", async () => {
		const s = await setup();
		const { id: campaignId } = await s.admin.caller.campaign.create({
			projectId: s.projectId,
			channelId: s.online.id,
			name: "FB lead form Nov",
			code: "RSD-FB-2026-11",
			startsOn: "2026-11-01",
		});
		expect(
			await codeOf(
				s.admin.caller.campaign.create({
					projectId: s.otherProjectId,
					channelId: s.online.id,
					name: "Dup",
					code: "rsd-fb-2026-11",
					startsOn: "2026-11-01",
				}),
			),
		).toBe("CONFLICT");
		expect(
			await codeOf(s.salesA.caller.lead.capture(walkIn(s, { campaignId }))),
		).toBe("BAD_REQUEST");
		const ok = await s.salesA.caller.lead.capture(
			walkIn(s, { sourceId: s.facebookId, campaignId }),
		);
		expect(ok.outcome).toBe("new_customer");
		// A campaign of another project can't be used.
		expect(
			await codeOf(
				s.salesA.caller.lead.capture(
					walkIn(s, {
						projectId: s.otherProjectId,
						sourceId: s.facebookId,
						campaignId,
						phone: "0899999999",
					}),
				),
			),
		).toBe("NOT_FOUND");
	});
});

describe("quick capture", () => {
	test("a salesperson's enquiry is theirs at once, needs a follow-up, and records consent and a snapshot", async () => {
		const s = await setup();
		expect(
			await codeOf(
				s.salesA.caller.lead.capture(walkIn(s, { nextFollowUpAt: undefined })),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.salesA.caller.lead.capture(
					walkIn(s, { ownerMemberId: s.salesB.member.id }),
				),
			),
		).toBe("FORBIDDEN");

		const result = await s.salesA.caller.lead.capture(
			walkIn(s, { budgetMaxSatang: 400_000_000, buyingTimeline: "1_3_months" }),
		);
		expect(result.outcome).toBe("new_customer");
		const [row] = await db
			.select()
			.from(lead)
			.where(eq(lead.id, result.leadId));
		expect(row).toMatchObject({
			ownerMemberId: s.salesA.member.id,
			status: "new",
			priority: true,
			prioritySignals: ["budget_in_range", "timeline_soon"],
			scoringVersion: "rules-v1",
			// Self-logged: theirs at once, no contact deadline (brief §6).
			contactDeadlineAt: null,
		});
		const [phone] = await db
			.select()
			.from(customerPhone)
			.where(eq(customerPhone.customerId, result.customerId));
		expect(phone?.phoneE164).toBe("+66812345678");
		const [cust] = await db
			.select()
			.from(customer)
			.where(eq(customer.id, result.customerId));
		expect(cust).toMatchObject({
			marketingConsent: true,
			consentRecordedByUserId: s.salesA.user.id,
		});
		const [enquiry] = await db
			.select()
			.from(activity)
			.where(eq(activity.leadId, result.leadId));
		expect(enquiry).toMatchObject({
			type: "enquiry",
			byUserId: s.salesA.user.id,
		});
		expect(enquiry?.data).toMatchObject({
			via: "quick_capture",
			budgetMaxSatang: 400_000_000,
			buyingTimeline: "1_3_months",
			priority: true,
			scoringVersion: "rules-v1",
		});
	});

	test("managers assign to someone covering the project, or the pool; assignments are audited", async () => {
		const s = await setup();
		expect(await codeOf(s.manager.caller.lead.capture(walkIn(s)))).toBe(
			"BAD_REQUEST",
		);
		const outsider = await addMember(s.org.id, "salesperson");
		expect(
			await codeOf(
				s.manager.caller.lead.capture(
					walkIn(s, { ownerMemberId: outsider.member.id }),
				),
			),
		).toBe("BAD_REQUEST");

		const assigned = await s.manager.caller.lead.capture(
			walkIn(s, {
				ownerMemberId: s.salesB.member.id,
				nextFollowUpAt: undefined,
			}),
		);
		const [row] = await db
			.select()
			.from(lead)
			.where(eq(lead.id, assigned.leadId));
		expect(row?.ownerMemberId).toBe(s.salesB.member.id);
		const [audit] = await db
			.select()
			.from(auditLog)
			.where(
				and(
					eq(auditLog.action, "lead.assign"),
					eq(auditLog.entityId, assigned.leadId),
				),
			);
		expect(audit?.actorUserId).toBe(s.manager.user.id);

		const pooled = await s.admin.caller.lead.capture(
			walkIn(s, {
				phone: "0811111111",
				ownerMemberId: null,
				nextFollowUpAt: undefined,
			}),
		);
		const [pool] = await db
			.select()
			.from(lead)
			.where(eq(lead.id, pooled.leadId));
		expect(pool?.ownerMemberId).toBeNull();
	});

	test("executives can't capture", async () => {
		const s = await setup();
		const exec = await callerAs(s.org.id, "executive");
		expect(
			await codeOf(
				exec.caller.lead.capture(walkIn(s, { ownerMemberId: null })),
			),
		).toBe("FORBIDDEN");
	});

	test("invalid phones are refused", async () => {
		const s = await setup();
		expect(
			await codeOf(s.salesA.caller.lead.capture(walkIn(s, { phone: "12345" }))),
		).toBe("BAD_REQUEST");
	});
});

describe("duplicates and re-enquiry", () => {
	test("the same phone in another format and project adds a lead to the same customer", async () => {
		const s = await setup();
		const first = await s.salesA.caller.lead.capture(walkIn(s));
		const second = await s.salesB.caller.lead.capture(
			walkIn(s, {
				projectId: s.otherProjectId,
				phone: "+66 81 234 5678",
				name: "Somchai J.",
			}),
		);
		expect(second).toMatchObject({
			customerId: first.customerId,
			outcome: "new_lead",
		});

		const lookup = await s.salesB.caller.lead.lookupPhone({
			phone: "0812345678",
		});
		expect(lookup.customer?.name).toBe("Khun Somchai");
		expect(lookup.customer?.leads.map((i) => i.projectName).sort()).toEqual([
			"Hillside",
			"Riverside",
		]);
		expect(Object.keys(lookup.customer?.leads[0] ?? {}).sort()).toEqual([
			"ownerName",
			"projectId",
			"projectName",
			"stage",
			"status",
		]);
	});

	async function captureOwnedByA(s: Setup) {
		const first = await s.salesA.caller.lead.capture(walkIn(s));
		return first.leadId;
	}
	const contactAt = (s: Setup, leadId: string, at: Date) =>
		db.insert(activity).values({
			organizationId: s.org.id,
			leadId,
			type: "call",
			byUserId: s.salesA.user.id,
			at,
		});

	test("re-enquiry stays with an owner who made contact within 90 days", async () => {
		const s = await setup();
		const leadId = await captureOwnedByA(s);
		await contactAt(s, leadId, daysAgo(10));
		const again = await s.salesB.caller.lead.capture(
			walkIn(s, { nextFollowUpAt: followUp() }),
		);
		expect(again).toMatchObject({ leadId, outcome: "re_enquiry_kept" });
		const [row] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(row?.ownerMemberId).toBe(s.salesA.member.id);
	});

	test("re-enquiry goes to the pool after 90 days without contact, logged as re_engagement", async () => {
		const s = await setup();
		const leadId = await captureOwnedByA(s);
		await contactAt(s, leadId, daysAgo(95));
		const again = await s.manager.caller.lead.capture(
			walkIn(s, { ownerMemberId: null }),
		);
		expect(again.outcome).toBe("re_enquiry_pooled");
		const [row] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(row?.ownerMemberId).toBeNull();
		const types = (
			await db
				.select({ type: activity.type })
				.from(activity)
				.where(eq(activity.leadId, leadId))
		).map((a) => a.type);
		expect(types).toContain("re_engagement");
		expect(types.filter((t) => t === "enquiry").length).toBe(2);
	});

	test("the window follows the company rule", async () => {
		const s = await setup();
		await s.admin.caller.rules.update({ reEnquiryWindowDays: 120 });
		const leadId = await captureOwnedByA(s);
		await contactAt(s, leadId, daysAgo(95));
		expect((await s.salesB.caller.lead.capture(walkIn(s))).outcome).toBe(
			"re_enquiry_kept",
		);
	});

	test("disqualified leads and lost deals reopen as new; a live deal only gets the activity", async () => {
		const s = await setup();
		const leadId = await captureOwnedByA(s);
		await db
			.update(lead)
			.set({ status: "disqualified", disqualifyReason: "spam" })
			.where(eq(lead.id, leadId));
		expect((await s.salesB.caller.lead.capture(walkIn(s))).outcome).toBe(
			"re_enquiry_pooled",
		);
		const [reopened] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(reopened).toMatchObject({ status: "new", disqualifyReason: null });

		// A confirmed visit made it a deal: a re-enquiry is only logged on it.
		await db
			.update(lead)
			.set({ ownerMemberId: s.salesA.member.id })
			.where(eq(lead.id, leadId));
		const { opportunityId } = await s.salesA.caller.lead.convert({
			leadId,
			nextFollowUpAt: followUp(),
		});
		expect((await s.salesB.caller.lead.capture(walkIn(s))).outcome).toBe(
			"re_enquiry_logged",
		);
		const [still] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(still).toMatchObject({
			status: "converted",
			ownerMemberId: s.salesA.member.id,
		});
		const [enquiry] = await db
			.select()
			.from(activity)
			.where(
				and(
					eq(activity.opportunityId, opportunityId),
					eq(activity.type, "enquiry"),
				),
			);
		expect(enquiry).toBeDefined();

		// Once the deal is lost, the lead starts over and can convert again.
		await s.salesA.caller.opportunity.markLost({
			opportunityId,
			reason: "bought_competitor",
		});
		await contactAt(s, leadId, daysAgo(1));
		expect((await s.salesB.caller.lead.capture(walkIn(s))).outcome).toBe(
			"re_enquiry_kept",
		);
		const [again] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(again?.status).toBe("new");
		const second = await s.salesA.caller.lead.convert({
			leadId,
			nextFollowUpAt: followUp(),
		});
		expect(second.opportunityId).not.toBe(opportunityId);
		const deals = await db
			.select()
			.from(opportunity)
			.where(eq(opportunity.leadId, leadId));
		expect(deals.map((d) => d.stage).sort()).toEqual(["lost", "visited"]);
	});

	test("five simultaneous captures of a new phone create one customer and one lead", async () => {
		const s = await setup();
		const results = await Promise.all(
			[s.salesA, s.salesB, s.salesA, s.salesB, s.salesA].map((who) =>
				who.caller.lead.capture(walkIn(s, { phone: "0855555555" })),
			),
		);
		expect(new Set(results.map((r) => r.customerId)).size).toBe(1);
		expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
		expect(results.filter((r) => r.outcome === "new_customer").length).toBe(1);
	});

	test("re-enquiry with a new budget re-scores the lead", async () => {
		const s = await setup();
		const leadId = await captureOwnedByA(s);
		await s.salesA.caller.lead.capture(
			walkIn(s, {
				budgetMinSatang: 350_000_000,
				buyingTimeline: "under_1_month",
			}),
		);
		const [row] = await db.select().from(lead).where(eq(lead.id, leadId));
		expect(row?.priority).toBe(true);
	});
});

describe("visibility (brief §4)", () => {
	test("another salesperson sees only summary lines of a colleague's lead", async () => {
		const s = await setup();
		const a = await s.salesA.caller.lead.capture(
			walkIn(s, { budgetMaxSatang: 400_000_000 }),
		);
		expect(
			await codeOf(s.salesB.caller.customer.get({ customerId: a.customerId })),
		).toBe("NOT_FOUND");
		expect(
			await codeOf(
				s.salesB.caller.lead.addNote({ leadId: a.leadId, note: "hi" }),
			),
		).toBe("NOT_FOUND");

		await s.salesB.caller.lead.capture(
			walkIn(s, { projectId: s.otherProjectId }),
		);
		const page = await s.salesB.caller.customer.get({
			customerId: a.customerId,
		});
		const theirs = page.leads.find((i) => i.projectName === "Riverside");
		expect(theirs).toEqual({
			visible: false,
			id: a.leadId,
			projectName: "Riverside",
			status: "new",
			stage: null,
			ownerName: s.salesA.user.name,
		});
		expect(page.leads.find((i) => i.projectName === "Hillside")?.visible).toBe(
			true,
		);
	});

	test("lists: salespeople see their own and the pool; managers see their projects; others are hidden", async () => {
		const s = await setup();
		await s.salesA.caller.lead.capture(walkIn(s));
		await s.manager.caller.lead.capture(
			walkIn(s, { phone: "0822222222", ownerMemberId: null }),
		);
		await s.salesB.caller.lead.capture(
			walkIn(s, { phone: "0833333333", projectId: s.otherProjectId }),
		);
		const names = async (who: Setup["salesA"]) =>
			(await who.caller.lead.list({})).map((l) => l.primaryPhone).sort();
		expect(await names(s.salesA)).toEqual(["081 234 5678", "082 222 2222"]);
		expect(await names(s.salesB)).toEqual(["082 222 2222", "083 333 3333"]);
		expect(await names(s.manager)).toEqual(["081 234 5678", "082 222 2222"]);
		expect(
			(await s.salesA.caller.lead.list({ ownership: "pool" })).length,
		).toBe(1);
		expect(
			(await s.salesA.caller.lead.list({ query: "+66812345678" })).length,
		).toBe(1);
	});
});

describe("customer profile", () => {
	test("consent changes record who and when and are audited; capture never withdraws consent", async () => {
		const s = await setup();
		const a = await s.salesA.caller.lead.capture(
			walkIn(s, { marketingConsent: true }),
		);
		await s.salesA.caller.lead.capture(walkIn(s, { marketingConsent: false }));
		let page = await s.salesA.caller.customer.get({ customerId: a.customerId });
		expect(page.marketingConsent).toBe(true);

		await s.salesA.caller.customer.setConsent({
			customerId: a.customerId,
			marketingConsent: false,
		});
		page = await s.salesA.caller.customer.get({ customerId: a.customerId });
		expect(page).toMatchObject({
			marketingConsent: false,
			consentRecordedBy: s.salesA.user.name,
		});
		const [audit] = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, "customer.consent_change"));
		expect(audit?.after).toEqual({ marketingConsent: false });
	});

	test("phones are unique per company and a customer keeps at least one", async () => {
		const s = await setup();
		const a = await s.salesA.caller.lead.capture(walkIn(s));
		await s.salesA.caller.lead.capture(walkIn(s, { phone: "0866666666" }));
		expect(
			await codeOf(
				s.salesA.caller.customer.addPhone({
					customerId: a.customerId,
					phone: "0866666666",
				}),
			),
		).toBe("CONFLICT");
		await s.salesA.caller.customer.addPhone({
			customerId: a.customerId,
			phone: "+86 138 0013 8000",
		});
		await s.salesA.caller.customer.removePhone({
			customerId: a.customerId,
			phone: "081-234-5678",
		});
		const page = await s.salesA.caller.customer.get({
			customerId: a.customerId,
		});
		expect(page.phones).toMatchObject([
			{ phoneE164: "+8613800138000", isPrimary: true },
		]);
		expect(
			await codeOf(
				s.salesA.caller.customer.removePhone({
					customerId: a.customerId,
					phone: "+8613800138000",
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("activities are append-only", async () => {
		const s = await setup();
		await s.salesA.caller.lead.capture(walkIn(s));
		let message = "no error";
		try {
			await db.execute(sql`update activity set note = 'edited'`);
		} catch (error) {
			message = String((error as { cause?: Error }).cause?.message ?? error);
		}
		expect(message).toContain("append-only");
	});

	test("a member who still owns open leads can't be removed", async () => {
		const s = await setup();
		await s.salesA.caller.lead.capture(walkIn(s));
		const { user: owner } = await addMember(s.org.id, "owner");
		const res = await post(
			"/api/auth/organization/remove-member",
			{ memberIdOrEmail: s.salesA.member.id },
			await signIn(owner.email),
		);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ code: "MEMBER_OWNS_LEADS" });
	});
});

describe("cross-tenant isolation (org B cannot read or change org A)", () => {
	test("every M3 procedure is NOT_FOUND or empty for another company", async () => {
		const a = await setup();
		const captured = await a.salesA.caller.lead.capture(walkIn(a));
		const b = await setup();
		const adminB = b.admin.caller;

		const attempts: Record<string, () => Promise<unknown>> = {
			"customer.get": () =>
				adminB.customer.get({ customerId: captured.customerId }),
			"customer.update": () =>
				adminB.customer.update({ customerId: captured.customerId, name: "X" }),
			"customer.addPhone": () =>
				adminB.customer.addPhone({
					customerId: captured.customerId,
					phone: "0877777777",
				}),
			"customer.setConsent": () =>
				adminB.customer.setConsent({
					customerId: captured.customerId,
					marketingConsent: false,
				}),
			"lead.addNote": () =>
				adminB.lead.addNote({ leadId: captured.leadId, note: "x" }),
			"lead.capture (A's project)": () =>
				adminB.lead.capture({ ...walkIn(a), ownerMemberId: null }),
			"leadSource.renameSource": () =>
				adminB.leadSource.renameSource({ sourceId: a.walkInId, name: "X" }),
		};
		const results: Record<string, string> = {};
		for (const [name, attempt] of Object.entries(attempts))
			results[name] = await codeOf(attempt());
		expect(results).toEqual(
			Object.fromEntries(Object.keys(results).map((k) => [k, "NOT_FOUND"])),
		);

		// Same phone in company B is a different customer; A's data stays invisible.
		expect(
			(await adminB.lead.lookupPhone({ phone: "0812345678" })).customer,
		).toBeNull();
		expect(await adminB.lead.list({})).toEqual([]);
		const bLead = await b.salesA.caller.lead.capture(walkIn(b));
		expect(bLead.customerId).not.toBe(captured.customerId);
	});
});

describe("rules", () => {
	test("defaults apply until a company changes them; only admins change them", async () => {
		const s = await setup();
		expect((await s.salesA.caller.rules.get()).rules).toEqual({
			reEnquiryWindowDays: 90,
			preScoreTimelineMonths: 3,
			claimCap: 5,
			deadlineRollHours: 2,
			unreachableAttempts: 3,
			unreachableWindowDays: 7,
			nurtureCheckDays: 30,
		});
		expect(
			await codeOf(s.salesA.caller.rules.update({ reEnquiryWindowDays: 30 })),
		).toBe("FORBIDDEN");
		await s.admin.caller.rules.update({ preScoreTimelineMonths: 6 });
		expect(
			(await s.salesA.caller.rules.get()).rules.preScoreTimelineMonths,
		).toBe(6);
	});
});
