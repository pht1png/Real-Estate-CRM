import { auditLog, member } from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { ENV } from "./env.server";
import { createOrganizationWithOwner } from "./operator";
import { auth, db } from "./services";
import {
	addMember,
	callerFor,
	cookiesFrom,
	createOrg,
	lastEmailTo,
	PASSWORD,
	post,
	signIn,
	totpFromUri,
} from "./test-support";

async function inviteAs(cookie: string, email: string, role: string) {
	return post("/api/auth/organization/invite-member", { email, role }, cookie);
}

function invitationIdFromEmail(to: string) {
	const match = lastEmailTo(to).text.match(/accept-invitation\/([^\s]+)/);
	if (!match?.[1]) throw new Error("no invitation link");
	return match[1];
}

describe("invite-only sign-up", () => {
	test("sign-up without an invitation is refused", async () => {
		const res = await post("/api/auth/sign-up/email", {
			name: "Stranger",
			email: "stranger@example.com",
			password: PASSWORD,
		});
		expect(res.status).toBe(403);
	});

	test("an invited salesperson signs up, accepts and joins with that role", async () => {
		const org = await createOrg();
		const { user: admin } = await addMember(org.id, "admin");
		const adminCookie = await signIn(admin.email);

		const invited = await inviteAs(
			adminCookie,
			"new.sales@example.com",
			"salesperson",
		);
		expect(invited.status).toBe(200);
		const invitationId = invitationIdFromEmail("new.sales@example.com");

		// Someone else's email with this invitation id is still refused.
		const wrongEmail = await post(
			`/api/auth/sign-up/email?invitationId=${invitationId}`,
			{ name: "Other", email: "other@example.com", password: PASSWORD },
		);
		expect(wrongEmail.status).toBe(403);

		const signUp = await post(
			`/api/auth/sign-up/email?invitationId=${invitationId}`,
			{ name: "New Sales", email: "new.sales@example.com", password: PASSWORD },
		);
		expect(signUp.status).toBe(200);
		const accepted = await post(
			"/api/auth/organization/accept-invitation",
			{ invitationId },
			cookiesFrom(signUp),
		);
		expect(accepted.status).toBe(200);

		// A fresh session lands in the organization with the invited role.
		const me = await (
			await callerFor(await signIn("new.sales@example.com"))
		).me();
		expect(me.organization?.id).toBe(org.id);
		expect(me.role).toBe("salesperson");
		expect(me.projectIds).toEqual([]);

		const audit = await db
			.select({ action: auditLog.action, actor: auditLog.actorUserId })
			.from(auditLog)
			.where(eq(auditLog.organizationId, org.id));
		expect(audit).toContainEqual({
			action: "invitation.create",
			actor: admin.id,
		});
		expect(audit.map((a) => a.action)).toContain("member.join");
	});

	test("invitations with an unknown or combined role are rejected", async () => {
		const org = await createOrg();
		const { user: admin } = await addMember(org.id, "admin");
		const cookie = await signIn(admin.email);
		expect((await inviteAs(cookie, "a@example.com", "member")).status).toBe(
			400,
		);
		expect(
			(await inviteAs(cookie, "b@example.com", "salesperson,executive")).status,
		).toBe(400);
		// Admins cannot hand out the owner role at all.
		expect((await inviteAs(cookie, "c@example.com", "owner")).status).toBe(403);
	});

	test("a salesperson cannot invite anyone", async () => {
		const org = await createOrg();
		const { user: sales } = await addMember(org.id, "salesperson");
		const res = await inviteAs(
			await signIn(sales.email),
			"x@example.com",
			"salesperson",
		);
		expect(res.status).toBe(403);
	});

	test("an admin cannot change the owner's role; role changes are audited", async () => {
		const org = await createOrg();
		const { member: owner } = await addMember(org.id, "owner");
		const { user: admin } = await addMember(org.id, "admin");
		const { member: sales } = await addMember(org.id, "salesperson");
		const cookie = await signIn(admin.email);

		const demoteOwner = await post(
			"/api/auth/organization/update-member-role",
			{ memberId: owner.id, role: "salesperson" },
			cookie,
		);
		expect(demoteOwner.status).toBe(403);

		const promote = await post(
			"/api/auth/organization/update-member-role",
			{ memberId: sales.id, role: "sales_manager" },
			cookie,
		);
		expect(promote.status).toBe(200);
		const [entry] = await db
			.select()
			.from(auditLog)
			.where(
				and(
					eq(auditLog.organizationId, org.id),
					eq(auditLog.action, "member.role_change"),
				),
			);
		expect(entry?.before).toEqual({ role: "salesperson" });
		expect(entry?.after).toEqual({ role: "sales_manager" });
	});
});

describe("organizations", () => {
	test("users cannot create organizations themselves", async () => {
		const org = await createOrg();
		const { user: owner } = await addMember(org.id, "owner");
		const res = await post(
			"/api/auth/organization/create",
			{ name: "Side business", slug: "side-business" },
			await signIn(owner.email),
		);
		expect(res.status).toBe(403);
	});

	test("a member of two organizations starts in the one they joined first", async () => {
		const first = await createOrg();
		const second = await createOrg();
		const { user: u } = await addMember(first.id, "salesperson");
		await db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: second.id,
			userId: u.id,
			role: "admin",
		});
		const me = await (await callerFor(await signIn(u.email))).me();
		expect(me.organization?.id).toBe(first.id);
	});

	test("org:create makes a company and owner who sets a password and signs in", async () => {
		const result = await createOrganizationWithOwner(db, auth, ENV.WEB_URL, {
			name: "Baan Suan Developments",
			ownerEmail: "Owner@BaanSuan.example",
		});
		expect(result.hasPassword).toBe(false);

		const setup = lastEmailTo("owner@baansuan.example");
		expect(setup.subject).toContain("Set up your account");
		const resetLink = setup.text.match(/(http\S+reset-password\S+)/)?.[1] ?? "";
		const token = new URL(resetLink).pathname.split("/").pop() ?? "";

		const reset = await post("/api/auth/reset-password", {
			token,
			newPassword: PASSWORD,
		});
		expect(reset.status).toBe(200);

		const me = await (
			await callerFor(await signIn("owner@baansuan.example"))
		).me();
		expect(me.organization?.id).toBe(result.organizationId);
		expect(me.role).toBe("owner");
	});
});

describe("two-step login", () => {
	test("once enabled, sign-in needs an authenticator code", async () => {
		const org = await createOrg();
		const { user: u } = await addMember(org.id, "sales_manager");
		const cookie = await signIn(u.email);

		const enable = await post(
			"/api/auth/two-factor/enable",
			{ password: PASSWORD },
			cookie,
		);
		expect(enable.status).toBe(200);
		const { totpURI } = (await enable.json()) as { totpURI: string };
		const confirm = await post(
			"/api/auth/two-factor/verify-totp",
			{ code: await totpFromUri(totpURI) },
			cookie,
		);
		expect(confirm.status).toBe(200);

		const firstStep = await post("/api/auth/sign-in/email", {
			email: u.email,
			password: PASSWORD,
		});
		expect(firstStep.status).toBe(200);
		expect(await firstStep.json()).toMatchObject({ twoFactorRedirect: true });
		const pending = cookiesFrom(firstStep);
		// The session cookie is only cleared (empty) until the code is verified.
		expect(pending).not.toMatch(/session_token=[^;]/);

		const wrong = await post(
			"/api/auth/two-factor/verify-totp",
			{ code: "000000" },
			pending,
		);
		expect(wrong.status).toBe(401);

		const second = await post(
			"/api/auth/two-factor/verify-totp",
			{ code: await totpFromUri(totpURI) },
			pending,
		);
		expect(second.status).toBe(200);
		expect(cookiesFrom(second)).toMatch(/session_token=[^;]/);
	});
});
