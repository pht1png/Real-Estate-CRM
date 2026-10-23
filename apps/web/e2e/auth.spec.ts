import { expect, test } from "@playwright/test";

test("sign up, use the dashboard, sign out and sign in again", async ({
	page,
}, testInfo) => {
	const user = {
		name: "Somchai E2E",
		email: `somchai-${testInfo.project.name}-${Date.now()}@example.com`,
		password: "correct-horse-battery",
	};
	const form = page.locator("form");

	// Sign up from the web origin against the separate API origin.
	await page.goto("/login");
	await form.getByLabel("Name").fill(user.name);
	await form.getByLabel("Email").fill(user.email);
	await form.getByLabel("Password").fill(user.password);
	await form.getByRole("button", { name: "Sign Up", exact: true }).click();

	// tRPC call with the cross-origin session cookie succeeds.
	await expect(page).toHaveURL(/\/dashboard$/);
	await expect(page.getByText("API: This is private")).toBeVisible();
	await expect(page.getByText(user.email).first()).toBeVisible();

	// Server-rendered layout reads the session on a full reload.
	await page.reload();
	await expect(page.getByText("API: This is private")).toBeVisible();

	// Sign out from the sidebar user menu.
	await page.getByText(user.email).first().click();
	await page.getByRole("menuitem", { name: "Log out" }).click();
	await expect(page).toHaveURL(/\/$/);

	await page.goto("/dashboard");
	await expect(page).toHaveURL(/\/login$/);

	// Sign in again.
	await page
		.getByRole("button", { name: "Already have an account? Sign In" })
		.click();
	await form.getByLabel("Email").fill(user.email);
	await form.getByLabel("Password").fill(user.password);
	await form.getByRole("button", { name: "Sign In", exact: true }).click();
	await expect(page).toHaveURL(/\/dashboard$/);
	await expect(page.getByText("API: This is private")).toBeVisible();
});
