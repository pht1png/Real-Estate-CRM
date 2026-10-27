import { activity, lead } from "@Real-Estate-CRM/db/schema/index";
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

const later = () => new Date(Date.now() + 86_400_000).toISOString();

/** Company with one project, two salespeople and a manager covering it. */
async function setup() {
	const org = await createOrg();
	const admin = await callerAs(org.id, "admin");
	const { id: projectId } = await admin.caller.project.create({
		name: "Riverside",
	});
	const salesA = await callerAs(org.id, "salesperson", [projectId]);
	const salesB = await callerAs(org.id, "salesperson", [projectId]);
	const sources = await admin.caller.leadSource.list();
	const source = (name: string) => {
		const s = sources.channels
			.flatMap((c) => c.sources)
			.find((x) => x.name === name);
		if (!s) throw new Error(`no source ${name}`);
		return s.id;
	};
	return { org, admin, salesA, salesB, projectId, source, sources };
}
type Setup = Awaited<ReturnType<typeof setup>>;

let counter = 0;
/** Salesperson A logs an enquiry (theirs at once). */
async function capture(
	s: Setup,
	extra: { sourceName?: string; referrerPhone?: string; phone?: string } = {},
) {
	const n = String(counter++ % 10_000).padStart(4, "0");
	const phone = extra.phone ?? `08126${n}0`;
	const result = await s.salesA.caller.lead.capture({
		projectId: s.projectId,
		name: `Contact ${n}`,
		phone,
		sourceId: s.source(extra.sourceName ?? "Facebook"),
		marketingConsent: false,
		nextFollowUpAt: later(),
		...(extra.referrerPhone && { referrerPhone: extra.referrerPhone }),
	});
	return { ...result, phone };
}

async function leadRow(id: string) {
	const [r] = await db.select().from(lead).where(eq(lead.id, id));
	if (!r) throw new Error("no lead");
	return r;
}

describe("referrer on the lead", () => {
	test("the Referral channel asks who referred them; capture stores the referrer by phone", async () => {
		const s = await setup();
		const referral = s.sources.channels.find((c) => c.name === "Referral");
		expect(referral?.referral).toBe(true);
		const referrer = await capture(s);
		const referred = await capture(s, {
			sourceName: "Existing owner",
			referrerPhone: referrer.phone,
		});
		expect((await leadRow(referred.leadId)).referredByContactId).toBe(
			referrer.contactId,
		);
		const page = await s.salesA.caller.contact.get({
			contactId: referred.contactId,
		});
		const own = page.leads.find((l) => l.id === referred.leadId);
		expect(own?.visible && own.referredBy).toEqual({
			id: referrer.contactId,
			name: expect.stringMatching(/^Contact /),
		});
		// Unknown phone: nothing saved.
		expect(
			await codeOf(
				capture(s, {
					sourceName: "Existing owner",
					referrerPhone: "0800000009",
				}),
			),
		).toBe("NOT_FOUND");
	});

	test("set, change and clear on the lead; never the contact themselves", async () => {
		const s = await setup();
		const one = await capture(s);
		const two = await capture(s);
		const target = await capture(s);
		const set = (phone: string | null) =>
			s.salesA.caller.lead.setReferrer({
				leadId: target.leadId,
				referrerPhone: phone,
			});
		await set(one.phone);
		expect((await leadRow(target.leadId)).referredByContactId).toBe(
			one.contactId,
		);
		await set(two.phone);
		expect((await leadRow(target.leadId)).referredByContactId).toBe(
			two.contactId,
		);
		expect(await codeOf(set(target.phone))).toBe("BAD_REQUEST");
		await set(null);
		expect((await leadRow(target.leadId)).referredByContactId).toBeNull();
		const notes = await db
			.select()
			.from(activity)
			.where(
				and(eq(activity.leadId, target.leadId), eq(activity.type, "note")),
			);
		expect(notes).toHaveLength(3);
		// Not the owner: salesperson B can't see the lead.
		expect(
			await codeOf(
				s.salesB.caller.lead.setReferrer({
					leadId: target.leadId,
					referrerPhone: one.phone,
				}),
			),
		).toBe("NOT_FOUND");
	});

	test("company B can't set a referrer on company A's lead or refer A's contacts", async () => {
		const a = await setup();
		const b = await setup();
		const aLead = await capture(a);
		const aReferrer = await capture(a);
		const bLead = await capture(b);
		expect(
			await codeOf(
				b.salesA.caller.lead.setReferrer({
					leadId: aLead.leadId,
					referrerPhone: null,
				}),
			),
		).toBe("NOT_FOUND");
		expect(
			await codeOf(
				b.salesA.caller.lead.setReferrer({
					leadId: bLead.leadId,
					referrerPhone: aReferrer.phone,
				}),
			),
		).toBe("NOT_FOUND");
	});
});

describe("income range on the lead", () => {
	test("captured, kept by Mark qualified, and private to the owner", async () => {
		const s = await setup();
		const n = String(counter++ % 10_000).padStart(4, "0");
		const phone = `08127${n}0`;
		const { leadId, contactId } = await s.salesA.caller.lead.capture({
			projectId: s.projectId,
			name: "Khun Income",
			phone,
			sourceId: s.source("Facebook"),
			marketingConsent: false,
			nextFollowUpAt: later(),
			incomeRange: "50k_100k",
		});
		expect((await leadRow(leadId)).incomeRange).toBe("50k_100k");
		// Qualify without the field keeps it; giving one changes it.
		await qualifyLead(s.salesA.caller, leadId, s.projectId);
		expect((await leadRow(leadId)).incomeRange).toBe("50k_100k");
		const types = await s.salesA.caller.unitType.list({
			projectId: s.projectId,
		});
		await s.salesA.caller.lead.qualify({
			leadId,
			budgetMinSatang: 300_000_000,
			budgetMaxSatang: 450_000_000,
			buyingTimeline: "1_3_months",
			unitTypeIds: types.slice(0, 1).map((t) => t.id),
			buyerIntent: "own_stay",
			incomeRange: "100k_200k",
			nextFollowUpAt: later(),
		});
		expect((await leadRow(leadId)).incomeRange).toBe("100k_200k");
		const [snapshot] = await db
			.select()
			.from(activity)
			.where(and(eq(activity.leadId, leadId), eq(activity.type, "qualified")))
			.orderBy(activity.at)
			.limit(1);
		expect(snapshot?.data).toMatchObject({ incomeRange: "50k_100k" });

		// Another salesperson sees only the summary line, without income.
		const theirs = await s.salesB.caller.lead.lookupPhone({ phone });
		expect(theirs.contact?.id).toBe(contactId);
		expect(Object.keys(theirs.contact?.leads[0] ?? {})).not.toContain(
			"incomeRange",
		);
	});

	test("only known ranges", async () => {
		const s = await setup();
		const { leadId } = await capture(s);
		expect(
			await codeOf(
				s.salesA.caller.lead.qualify({
					leadId,
					budgetMinSatang: 1,
					budgetMaxSatang: 2,
					buyingTimeline: "1_3_months",
					unitTypeIds: [],
					buyerIntent: "own_stay",
					// @ts-expect-error not a range
					incomeRange: "75000",
					nextFollowUpAt: later(),
				}),
			),
		).toBe("BAD_REQUEST");
	});
});
