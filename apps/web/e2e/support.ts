import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import path from "node:path";

import {
	type Browser,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

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
	await fillAndSubmit(
		page,
		[[page.getByLabel("รหัสผ่านใหม่"), PASSWORD]],
		page.getByRole("button", { name: "บันทึกรหัสผ่าน" }),
		/\/login$/,
	);
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

/** Owner invites a salesperson from Settings → Members; they join in their own browser. */
export async function inviteSalesperson(
	owner: Page,
	browser: Browser,
	name: string,
	options: { mobile?: boolean } = {},
) {
	const email = uniqueEmail(name.toLowerCase().replace(/\W+/g, "-"));
	await owner.getByRole("link", { name: "สมาชิก" }).click();
	await owner.getByLabel("อีเมล").fill(email);
	await owner.getByRole("button", { name: "ส่งคำเชิญ" }).click();
	await expect(owner.getByRole("cell", { name: email })).toBeVisible();
	const link = await linkFromOutbox(
		owner,
		email,
		/http\S+\/accept-invitation\/\S+/,
	);

	const context = await browser.newContext(
		options.mobile
			? {
					viewport: { width: 390, height: 844 },
					isMobile: true,
					hasTouch: true,
				}
			: {},
	);
	const page = await context.newPage();
	await joinFromInvitation(page, link, name, email);
	return { page, context, email };
}

/** Opens an invitation link, creates the account and lands on the dashboard. */
export async function joinFromInvitation(
	page: Page,
	link: string,
	name: string,
	email: string,
) {
	await page.goto(link);
	await fillAndSubmit(
		page,
		[
			[page.getByLabel("ชื่อของคุณ"), name],
			[page.getByLabel("อีเมล"), email],
			[page.getByLabel("รหัสผ่าน"), PASSWORD],
		],
		page.getByRole("button", { name: "สร้างบัญชีและเข้าร่วม" }),
		/\/dashboard$/,
	);
}

/** Picks an option in a (Base UI) select by its label. */
export async function choose(page: Page, label: string, option: string) {
	await page.getByLabel(label, { exact: true }).click();
	await page.getByRole("option", { name: option, exact: true }).click();
}

export async function addProject(owner: Page, name: string) {
	await owner.getByRole("link", { name: "โครงการ" }).click();
	await owner.getByLabel("ชื่อโครงการ").fill(name);
	await owner.getByRole("button", { name: "เพิ่มโครงการ" }).click();
	await expect(owner.getByRole("link", { name })).toBeVisible();
}

export async function assignTeam(
	owner: Page,
	project: string,
	people: string[],
) {
	await owner.getByRole("link", { name: "โครงการ" }).click();
	await owner
		.getByRole("row", { name: new RegExp(project) })
		.getByRole("button", { name: "ทีม" })
		.click();
	for (const person of people) {
		await owner.getByRole("checkbox", { name: new RegExp(person) }).click();
		await expect(
			owner.getByRole("checkbox", { name: new RegExp(person) }),
		).toBeChecked();
	}
	await owner.keyboard.press("Escape");
}

export async function openCapture(page: Page) {
	await page.getByRole("button", { name: "บันทึกลูกค้าใหม่" }).click();
	await expect(
		page.getByRole("heading", { name: "บันทึกลูกค้าใหม่" }),
	).toBeVisible();
}

/**
 * For forms reached by a full page load: under load the browser can type before
 * React hydrates, and the keystrokes never reach the form state. Fill and submit,
 * and if the page didn't move on, fill again (values may be computed, e.g. TOTP).
 */
export async function fillAndSubmit(
	page: Page,
	fields: [Locator, string | (() => string)][],
	submit: Locator,
	until: RegExp,
) {
	await expect(async () => {
		for (const [field, value] of fields) {
			await field.fill(typeof value === "function" ? value() : value);
		}
		await submit.click();
		await expect(page).toHaveURL(until, { timeout: 10_000 });
	}).toPass({ timeout: 45_000 });
}

/** The owner (acting as manager) sends a Facebook lead to the Riverside pool. */
export async function poolLead(owner: Page, name: string, phone: string) {
	await openCapture(owner);
	await choose(owner, "โครงการ", "Riverside");
	// exact: the customer page behind the sheet has "เพิ่มเบอร์โทร".
	await owner.getByLabel("เบอร์โทร", { exact: true }).fill(phone);
	await owner.getByLabel("ชื่อลูกค้า").fill(name);
	await choose(owner, "แหล่งที่มา", "Facebook");
	await owner.getByRole("button", { name: "บันทึกลูกค้า", exact: true }).click();
	await expect(owner.getByText("บันทึกลูกค้าใหม่แล้ว").first()).toBeVisible();
}

/** Tap Call without leaving the page: the test browser has no dialler. */
export async function tapCall(scope: Locator) {
	const call = scope.getByRole("link", { name: "โทร", exact: true });
	await expect(call).toHaveAttribute("href", /^tel:\+66/);
	// Click with href removed (no navigation), then put it back.
	await call.evaluate((a: HTMLAnchorElement) => {
		const href = a.getAttribute("href") ?? "";
		a.removeAttribute("href");
		a.click();
		a.setAttribute("href", href);
	});
}

/** Call → No answer → save with the suggested follow-up (in 2 hours). */
export async function logNoAnswer(page: Page, scope: Locator) {
	await tapCall(scope);
	await page.getByRole("button", { name: "ไม่รับสาย", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "ไม่รับสาย" });
	await expect(
		dialog.getByRole("button", { name: /อีก 2 ชั่วโมง/ }),
	).toHaveAttribute("aria-pressed", "true");
	await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(dialog).toBeHidden();
}
