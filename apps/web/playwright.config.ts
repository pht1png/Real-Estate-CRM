import { defineConfig, devices } from "@playwright/test";

// Separate ports so e2e never collides with `bun run dev` (3000/3001).
const serverUrl = "http://localhost:3100";
const webUrl = "http://localhost:3101";

export default defineConfig({
	testDir: "./e2e",
	// Whole journeys (sign-up, invitations, imports) across several pages.
	timeout: 60_000,
	// Assertions wait for server-rendered pages (session checks) under parallel load.
	expect: { timeout: 15_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: webUrl,
		// The projects' time zone, so test times mean the same on CI (UTC) and locally.
		timezoneId: "Asia/Bangkok",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		// WebKit behaves like Safari on iPhone, where cookie rules are strictest.
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	webServer: [
		{
			command: "bun run src/e2e-server.ts",
			cwd: "../server",
			url: serverUrl,
			env: {
				NODE_ENV: "test",
				PORT: "3100",
				BETTER_AUTH_URL: serverUrl,
				CORS_ORIGIN: webUrl,
				WEB_URL: webUrl,
			},
			reuseExistingServer: false,
		},
		{
			command: "bun run build && bun run start --port 3101",
			url: webUrl,
			env: { NEXT_PUBLIC_SERVER_URL: serverUrl },
			reuseExistingServer: false,
			timeout: 240_000,
		},
	],
});
