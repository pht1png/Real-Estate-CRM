import { expect, test } from "@playwright/test";

import {
	createOrganization,
	linkFromOutbox,
	PASSWORD,
	setUpOwner,
	signIn,
	totp,
	uniqueEmail,
} from "./support";

test("owner sets up a project and invites a salesperson, who joins with limited access", async ({
	page,
	browser,
}) => {
	const ownerEmail = uniqueEmail("owner");
	const salesEmail = uniqueEmail("sales");

	// Operator creates the company; the owner chooses a password (Thai by default).
	await setUpOwner(
		page,
		createOrganization("Baan Suan Co", ownerEmail),
		ownerEmail,
	);
	await expect(page).toHaveURL(/\/dashboard$/);
	await expect(page.getByRole("heading", { name: /สวัสดี/ })).toBeVisible();

	// Owner adds a project.
	await page.getByRole("link", { name: "โครงการ" }).click();
	await page.getByLabel("ชื่อโครงการ").fill("Baan Suan Phase 1");
	await page.getByRole("button", { name: "เพิ่มโครงการ" }).click();
	await expect(
		page.getByRole("cell", { name: "Baan Suan Phase 1" }),
	).toBeVisible();

	// Owner invites a salesperson (the default role).
	await page.getByRole("link", { name: "สมาชิก" }).click();
	await page.getByLabel("อีเมล").fill(salesEmail);
	await page.getByRole("button", { name: "ส่งคำเชิญ" }).click();
	await expect(page.getByRole("cell", { name: salesEmail })).toBeVisible();
	const invitationLink = await linkFromOutbox(
		page,
		salesEmail,
		/http\S+\/accept-invitation\/\S+/,
	);

	// The salesperson creates their account from the invitation, in their own browser.
	const salesContext = await browser.newContext();
	const sales = await salesContext.newPage();
	await sales.goto(invitationLink);
	await sales.waitForLoadState("networkidle");
	await sales.getByLabel("ชื่อของคุณ").fill("Malee Sales");
	await sales.getByLabel("อีเมล").fill(salesEmail);
	await sales.getByLabel("รหัสผ่าน").fill(PASSWORD);
	await sales.getByRole("button", { name: "สร้างบัญชีและเข้าร่วม" }).click();
	await expect(sales).toHaveURL(/\/dashboard$/);
	await expect(sales.getByText("พนักงานขาย ที่ Baan Suan Co")).toBeVisible();
	// No settings for a salesperson.
	await expect(sales.getByRole("link", { name: "สมาชิก" })).toHaveCount(0);

	// Owner puts the salesperson on the project.
	await page.getByRole("link", { name: "โครงการ" }).click();
	await page.getByRole("button", { name: "ทีม" }).click();
	await page.getByRole("checkbox", { name: /Malee Sales/ }).click();
	await expect(
		page.getByRole("checkbox", { name: /Malee Sales/ }),
	).toBeChecked();

	// Switching to English persists across pages.
	await sales.getByRole("button", { name: /Malee Sales/ }).click();
	await sales.getByRole("menuitem", { name: "English" }).click();
	await expect(sales.getByText("Salesperson at Baan Suan Co")).toBeVisible();
	await sales.reload();
	await expect(sales.getByRole("link", { name: "Today" })).toBeVisible();

	await salesContext.close();
});

test("two-step login: turn it on, then sign in with an authenticator code", async ({
	page,
}) => {
	const email = uniqueEmail("owner2fa");
	await setUpOwner(page, createOrganization("Two Step Co", email), email);
	await expect(page).toHaveURL(/\/dashboard$/);

	await page.goto("/settings/security");
	await page.getByRole("button", { name: "เปิดใช้งาน" }).click();
	await page.getByLabel("รหัสผ่านปัจจุบัน").fill(PASSWORD);
	await page.getByRole("button", { name: "เปิดใช้งาน" }).click();
	const keyText = await page.getByText(/กรอกคีย์นี้แทน/).textContent();
	const secret = keyText?.split(":").pop()?.trim() ?? "";
	await page.getByLabel("รหัส", { exact: true }).fill(totp(secret));
	await page.getByRole("button", { name: "ยืนยันและเปิดใช้งาน" }).click();
	await expect(page.getByText("เปิด", { exact: true })).toBeVisible();

	// Sign out, then sign in again: the code step is required.
	await page.getByRole("button", { name: new RegExp(email) }).click();
	await page.getByRole("menuitem", { name: "ออกจากระบบ" }).click();
	await expect(page).toHaveURL(/\/login$/);
	await signIn(page, email);
	await expect(page).toHaveURL(/\/two-factor$/);
	// Full page load: let the form hydrate before typing.
	await page.waitForLoadState("networkidle");
	await page.getByLabel("รหัส", { exact: true }).fill(totp(secret));
	await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
});
