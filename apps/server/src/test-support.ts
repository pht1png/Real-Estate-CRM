// Test-only helpers: seed organizations/members directly and act as them over HTTP or tRPC.
import { createCallerFactory } from "@Real-Estate-CRM/api";
import { appRouter } from "@Real-Estate-CRM/api/routers/index";
import type { RoleName } from "@Real-Estate-CRM/auth/permissions";
import {
	account,
	member,
	organization,
	project,
	projectMember,
	user,
} from "@Real-Estate-CRM/db/schema/index";

import { ENV } from "./env.server";
import app from "./index";
import { auth, db, logEmailSender, storage } from "./services";

export const PASSWORD = "correct-horse-battery";
export const webOrigin = ENV.CORS_ORIGIN;

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function createOrg(name = `Org ${uid()}`) {
	const [org] = await db
		.insert(organization)
		.values({ id: crypto.randomUUID(), name, slug: `org-${uid()}` })
		.returning();
	if (!org) throw new Error("no org");
	return org;
}

export async function createUser(email = `user-${uid()}@example.com`) {
	const ctx = await auth.$context;
	const [created] = await db
		.insert(user)
		.values({
			id: crypto.randomUUID(),
			name: email.split("@")[0] ?? email,
			email,
			emailVerified: true,
		})
		.returning();
	if (!created) throw new Error("no user");
	await db.insert(account).values({
		id: crypto.randomUUID(),
		userId: created.id,
		accountId: created.id,
		providerId: "credential",
		password: await ctx.password.hash(PASSWORD),
	});
	return created;
}

export async function addMember(
	organizationId: string,
	role: RoleName,
	options: { projectIds?: string[]; email?: string } = {},
) {
	const u = await createUser(options.email);
	const [m] = await db
		.insert(member)
		.values({ id: crypto.randomUUID(), organizationId, userId: u.id, role })
		.returning();
	if (!m) throw new Error("no member");
	for (const projectId of options.projectIds ?? []) {
		await db
			.insert(projectMember)
			.values({ organizationId, projectId, memberId: m.id });
	}
	return { user: u, member: m };
}

export async function createProjectRow(
	organizationId: string,
	name = `Project ${uid()}`,
) {
	const [p] = await db
		.insert(project)
		.values({ organizationId, name })
		.returning();
	if (!p) throw new Error("no project");
	return p;
}

export function post(path: string, body: unknown, cookie?: string) {
	return app.request(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: webOrigin,
			...(cookie && { Cookie: cookie }),
		},
		body: JSON.stringify(body),
	});
}

/** `name=value` pairs from Set-Cookie, ready to send back as a Cookie header. */
export function cookiesFrom(res: Response) {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

export async function signIn(email: string, password = PASSWORD) {
	const res = await post("/api/auth/sign-in/email", { email, password });
	if (res.status !== 200) throw new Error(`sign-in failed: ${res.status}`);
	return cookiesFrom(res);
}

/** tRPC caller acting as the signed-in user (same session resolution as HTTP). */
export async function callerFor(cookie: string) {
	const session = await auth.api.getSession({
		headers: new Headers({ Cookie: cookie }),
	});
	return createCallerFactory(appRouter)({ db, session, files: storage });
}

export async function callerAs(
	organizationId: string,
	role: RoleName,
	projectIds?: string[],
) {
	const { user: u, member: m } = await addMember(organizationId, role, {
		projectIds,
	});
	return { caller: await callerFor(await signIn(u.email)), user: u, member: m };
}

export function lastEmailTo(to: string) {
	const found = logEmailSender.outbox.findLast((e) => e.to === to);
	if (!found) throw new Error(`no email to ${to}`);
	return found;
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from an otpauth:// URI, like an authenticator app. */
export async function totpFromUri(uri: string, at = Date.now()) {
	const secret = new URL(uri).searchParams.get("secret") ?? "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
		bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
	}
	const key = new Uint8Array(Math.floor(bits.length / 8));
	for (let i = 0; i < key.length; i++) {
		key[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
	}
	const counter = new DataView(new ArrayBuffer(8));
	counter.setBigUint64(0, BigInt(Math.floor(at / 1000 / 30)));
	const hmacKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign("HMAC", hmacKey, counter.buffer),
	);
	const offset = (mac[mac.length - 1] ?? 0) & 0xf;
	const code =
		(((mac[offset] ?? 0) & 0x7f) << 24) |
		((mac[offset + 1] ?? 0) << 16) |
		((mac[offset + 2] ?? 0) << 8) |
		(mac[offset + 3] ?? 0);
	return (code % 1_000_000).toString().padStart(6, "0");
}

type Caller = Awaited<ReturnType<typeof callerFor>>;

/** Mark a lead qualified with typical details (converting requires it). */
export async function qualifyLead(
	caller: Caller,
	leadId: string,
	projectId: string,
) {
	const types = await caller.unitType.list({ projectId });
	await caller.lead.qualify({
		leadId,
		budgetMinSatang: 300_000_000,
		budgetMaxSatang: 450_000_000,
		buyingTimeline: "1_3_months",
		unitTypeIds: types.slice(0, 1).map((t) => t.id),
		buyerIntent: "own_stay",
		nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString(),
	});
}
