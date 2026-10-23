import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const serverUrl = "http://localhost:3100";
export const webUrl = "http://localhost:3101";
export const PASSWORD = "correct-horse-battery";

export const uniqueEmail = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

/** Runs the operator script against the e2e test DB; returns the owner's setup link. */
export function createOrganization(name: string, ownerEmail: string) {
	const output = execFileSync(
		"bun",
		[
			"run",
			"src/scripts/org-create.ts",
			"--name",
			name,
			"--owner-email",
			ownerEmail,
		],
		{
			cwd: path.resolve(__dirname, "../../server"),
			env: {
				...process.env,
				NODE_ENV: "test",
				BETTER_AUTH_URL: serverUrl,
				CORS_ORIGIN: webUrl,
				WEB_URL: webUrl,
			},
			encoding: "utf8",
		},
	);
	const link = output.match(/(http\S+\/reset-password\/\S+)/)?.[1];
	if (!link) throw new Error(`no setup link in:\n${output}`);
	return link;
}

/** Latest link in an email the e2e API sent (log sender outbox). */
export async function linkFromOutbox(page: Page, to: string, pattern: RegExp) {
	const res = await page.request.get(`${serverUrl}/__test/outbox`);
	const emails = (await res.json()) as { to: string; text: string }[];
	const email = emails.findLast((e) => e.to === to);
	const link = email?.text.match(pattern)?.[0];
	if (!link) throw new Error(`no link for ${to}`);
	return link;
}

/** Owner follows the setup link, chooses a password and signs in (Thai UI). */
export async function setUpOwner(page: Page, setupLink: string, email: string) {
	await page.goto(setupLink);
	await expect(page).toHaveURL(/\/reset-password\?token=/);
	// Full page load: let the form hydrate before typing.
	await page.waitForLoadState("networkidle");
	await page.getByLabel("รหัสผ่านใหม่").fill(PASSWORD);
	await page.getByRole("button", { name: "บันทึกรหัสผ่าน" }).click();
	await expect(page).toHaveURL(/\/login$/);
	await signIn(page, email);
}

export async function signIn(page: Page, email: string) {
	await page.getByLabel("อีเมล").fill(email);
	await page.getByLabel("รหัสผ่าน").fill(PASSWORD);
	await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
}

/** RFC 6238 TOTP from a base32 secret, as an authenticator app computes it. */
export function totp(secret: string, at = Date.now()) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
		bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
	}
	const key = Buffer.alloc(Math.floor(bits.length / 8));
	for (let i = 0; i < key.length; i++) {
		key[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
	}
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
	const mac = createHmac("sha1", key).update(counter).digest();
	const offset = (mac.at(-1) ?? 0) & 0xf;
	return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)
		.toString()
		.padStart(6, "0");
}
