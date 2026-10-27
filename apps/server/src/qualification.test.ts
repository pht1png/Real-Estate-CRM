import { activity, lead } from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

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

const inMinutes = (n: number) => new Date(Date.now() + n * 60_000);
const UNITS_CSV = [
	"section,unit_number,unit_type,list_price",
	"Tower,T-1,1 Bed,3000000",
	"Tower,T-2,2 Bed,5000000",
].join("\n");

/** A project with units (฿3M–฿5M) and two types; a salesperson and a manager in it. */
async function setup() {
	const org = await createOrg();
	const admin = await callerAs(org.id, "admin");
	const { id: projectId } = await admin.caller.project.create({
		name: "Riverside",
	});
	await admin.caller.unit.importCommit({ projectId, csv: UNITS_CSV });
	const types = await admin.caller.unitType.list({ projectId });
	const sales = await callerAs(org.id, "salesperson", [projectId]);
	const manager = await callerAs(org.id, "sales_manager", [projectId]);
	const sources = await admin.caller.leadSource.list();
	const offline = sources.channels.find((c) => c.name === "Offline");
	const online = sources.channels.find((c) => c.name === "Online");
	const walkInId = offline?.sources.find((s) => s.name === "Walk-in")?.id;
	const facebookId = online?.sources.find((s) => s.name === "Facebook")?.id;
	if (!offline || !walkInId || !facebookId) throw new Error("no sources");
	return {
		org,
		admin,
		sales,
		manager,
		projectId,
		typeIds: types.map((t) => t.id),
		offline,
		walkInId,
		facebookId,
	};
}
type Setup = Awaited<ReturnType<typeof setup>>;

let phone = 0;
const walkIn = (s: Setup, extra: Record<string, unknown> = {}) => ({
	projectId: s.projectId,
	name: "Khun Somchai",
	phone: `08900${String(phone++ % 100_000).padStart(5, "0")}`,
	sourceId: s.walkInId,
	marketingConsent: true,
	nextFollowUpAt: inMinutes(120).toISOString(),
	budgetMinSatang: 350_000_000,
	budgetMaxSatang: 450_000_000,
	buyingTimeline: "1_3_months" as const,
	unitTypeIds: s.typeIds.slice(0, 1),
	buyerIntent: "own_stay" as const,
	...extra,
});

const row = async (id: string) =>
	(await db.select().from(lead).where(eq(lead.id, id)))[0];

describe("in-person sources need full details at capture", () => {
	test("walk-ins without budget, timeline, unit types or intent are refused", async () => {
		const s = await setup();
		expect(s.offline.inPerson).toBe(true);
		for (const missing of [
			{ budgetMinSatang: undefined },
			{ buyingTimeline: undefined },
			{ unitTypeIds: [] },
			{ buyerIntent: undefined },
		]) {
			expect(
				await codeOf(s.sales.caller.lead.capture(walkIn(s, missing))),
			).toBe("BAD_REQUEST");
		}
		const ok = await s.sales.caller.lead.capture(walkIn(s));
		expect(await row(ok.leadId)).toMatchObject({
			unitTypeIds: s.typeIds.slice(0, 1),
			buyerIntent: "own_stay",
			status: "new",
		});
		expect(ok.fit).toBe("fits");
	});

	test("online sources keep the details optional", async () => {
		const s = await setup();
		const res = await s.sales.caller.lead.capture({
			projectId: s.projectId,
			name: "Khun Nida",
			phone: "0891112222",
			sourceId: s.facebookId,
			marketingConsent: false,
			nextFollowUpAt: inMinutes(60).toISOString(),
		});
		expect(res.fit).toBe("unknown");
	});

	test("admins choose which channels are in person; others can't", async () => {
		const s = await setup();
		expect(
			await codeOf(
				s.sales.caller.leadSource.setChannelFlags({
					channelId: s.offline.id,
					inPerson: false,
				}),
			),
		).toBe("FORBIDDEN");
		await s.admin.caller.leadSource.setChannelFlags({
			channelId: s.offline.id,
			inPerson: false,
		});
		// No longer in person: a walk-in without details is accepted.
		expect(
			await codeOf(
				s.sales.caller.lead.capture(
					walkIn(s, { budgetMinSatang: undefined, budgetMaxSatang: undefined }),
				),
			),
		).toBe("OK");
		const b = await setup();
		expect(
			await codeOf(
				b.admin.caller.leadSource.setChannelFlags({
					channelId: s.offline.id,
					inPerson: true,
				}),
			),
		).toBe("NOT_FOUND");
	});
});

describe("received time", () => {
	test("a late-logged walk-in keeps its real time; future or >30 days back is refused", async () => {
		const s = await setup();
		const receivedAt = inMinutes(-20);
		const res = await s.sales.caller.lead.capture(
			walkIn(s, { receivedAt: receivedAt.toISOString() }),
		);
		expect((await row(res.leadId))?.createdAt).toEqual(receivedAt);
		const [enquiry] = await db
			.select()
			.from(activity)
			.where(
				and(eq(activity.leadId, res.leadId), eq(activity.type, "enquiry")),
			);
		expect(enquiry?.at).toEqual(receivedAt);

		expect(
			await codeOf(
				s.sales.caller.lead.capture(
					walkIn(s, { receivedAt: inMinutes(10).toISOString() }),
				),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				s.sales.caller.lead.capture(
					walkIn(s, { receivedAt: inMinutes(-31 * 24 * 60).toISOString() }),
				),
			),
		).toBe("BAD_REQUEST");
	});

	test("a manager-assigned lead's contact deadline still counts from now", async () => {
		const s = await setup();
		const res = await s.manager.caller.lead.capture({
			...walkIn(s),
			ownerMemberId: s.sales.member.id,
			nextFollowUpAt: undefined,
			receivedAt: inMinutes(-3 * 24 * 60).toISOString(),
		});
		const r = await row(res.leadId);
		expect(r?.contactDeadlineAt?.getTime()).toBeGreaterThan(Date.now());
	});
});

describe("qualification check and qualify before converting", () => {
	test("converting needs a qualified lead", async () => {
		const s = await setup();
		const res = await s.sales.caller.lead.capture(walkIn(s));
		expect(
			await codeOf(
				s.sales.caller.lead.convert({
					leadId: res.leadId,
					nextFollowUpAt: inMinutes(60).toISOString(),
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("auto-qualify (project opt-in) qualifies fitting leads; too early never changes", async () => {
		const s = await setup();
		expect(
			await codeOf(
				s.sales.caller.project.update({
					projectId: s.projectId,
					qualificationRules: { autoQualify: true },
				}),
			),
		).toBe("FORBIDDEN");
		await s.admin.caller.project.update({
			projectId: s.projectId,
			qualificationRules: { autoQualify: true },
		});
		const settings = await s.admin.caller.project.get({
			projectId: s.projectId,
		});
		expect(settings.qualificationRules).toEqual({
			budgetTolerancePct: 10,
			qualifyWithinMonths: 6,
			autoQualify: true,
		});

		const fits = await s.sales.caller.lead.capture(walkIn(s));
		const r = await row(fits.leadId);
		expect(r?.status).toBe("qualified");
		expect(r?.qualifiedAt).not.toBeNull();
		const [byRule] = await db
			.select()
			.from(activity)
			.where(
				and(eq(activity.leadId, fits.leadId), eq(activity.type, "qualified")),
			);
		expect(byRule).toMatchObject({ byUserId: null, data: { rule: "fit-v1" } });
		// A qualified walk-in converts straight away.
		expect(
			await codeOf(
				s.sales.caller.lead.convert({
					leadId: fits.leadId,
					nextFollowUpAt: inMinutes(60).toISOString(),
				}),
			),
		).toBe("OK");

		const tooEarly = await s.sales.caller.lead.capture(
			walkIn(s, { buyingTimeline: "6_12_months" }),
		);
		expect(tooEarly.fit).toBe("too_early");
		expect((await row(tooEarly.leadId))?.status).toBe("new");
		const noFit = await s.sales.caller.lead.capture(
			walkIn(s, { budgetMinSatang: 100_000_000, budgetMaxSatang: 150_000_000 }),
		);
		expect(noFit.fit).toBe("budget_no_fit");
		expect((await row(noFit.leadId))?.status).toBe("new");
	});

	test("auto-qualify is off by default; the contact page shows the fit", async () => {
		const s = await setup();
		const res = await s.sales.caller.lead.capture(walkIn(s));
		expect(res.fit).toBe("fits");
		expect((await row(res.leadId))?.status).toBe("new");
		const page = await s.sales.caller.contact.get({
			contactId: res.contactId,
		});
		const l = page.leads.find((x) => x.id === res.leadId);
		expect(l?.visible && l.fit).toBe("fits");
	});

	test("company B can't change company A's qualification rules", async () => {
		const a = await setup();
		const b = await setup();
		expect(
			await codeOf(
				b.admin.caller.project.update({
					projectId: a.projectId,
					qualificationRules: { autoQualify: true },
				}),
			),
		).toBe("NOT_FOUND");
	});
});
