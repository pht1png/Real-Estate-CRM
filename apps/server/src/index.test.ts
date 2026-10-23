import { describe, expect, test } from "bun:test";

import { ENV } from "./env.server";
import app from "./index";
import { createUser, PASSWORD } from "./test-support";

const webOrigin = ENV.CORS_ORIGIN;
const foreignOrigin = "https://evil.example";
const credentials = { email: "somchai@example.com", password: PASSWORD };

function authRequest(path: string, body: unknown, origin = webOrigin) {
	return app.request(path, {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: origin },
		body: JSON.stringify(body),
	});
}

function sessionCookie(res: Response) {
	const cookie = res.headers
		.getSetCookie()
		.find((c) => c.includes("better-auth.session_token="));
	if (!cookie) throw new Error("no session cookie set");
	return cookie;
}

describe("CORS", () => {
	test("preflight from the web origin allows credentials", async () => {
		const res = await app.request("/trpc/privateData", {
			method: "OPTIONS",
			headers: {
				Origin: webOrigin,
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(webOrigin);
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
	});

	test("a foreign origin is not allowed", async () => {
		const res = await app.request("/trpc/privateData", {
			method: "OPTIONS",
			headers: {
				Origin: foreignOrigin,
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
			foreignOrigin,
		);
	});
});

describe("auth across origins", () => {
	test("sign-in sets an HttpOnly, SameSite=Lax session cookie", async () => {
		await createUser(credentials.email);
		const res = await authRequest("/api/auth/sign-in/email", credentials);
		expect(res.status).toBe(200);

		const cookie = sessionCookie(res);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		// Local dev runs over http, so the cookie must not require https.
		expect(cookie).not.toContain("Secure");
	});

	test("the session cookie authorises tRPC; no cookie is rejected", async () => {
		await createUser(credentials.email);
		const signIn = await authRequest("/api/auth/sign-in/email", {
			email: credentials.email,
			password: credentials.password,
		});
		expect(signIn.status).toBe(200);
		const cookie = sessionCookie(signIn).split(";")[0] ?? "";

		const authed = await app.request("/trpc/privateData", {
			headers: { Origin: webOrigin, Cookie: cookie },
		});
		expect(authed.status).toBe(200);
		const body = (await authed.json()) as {
			result: { data: { user: { email: string } } };
		};
		expect(body.result.data.user.email).toBe(credentials.email);

		const anonymous = await app.request("/trpc/privateData", {
			headers: { Origin: webOrigin },
		});
		expect(anonymous.status).toBe(401);
	});

	// Better Auth validates Origin when cookies are present (the CSRF case).
	test("a cookie-bearing request from an untrusted origin is refused", async () => {
		await createUser(credentials.email);
		const signIn = await authRequest("/api/auth/sign-in/email", credentials);
		const cookie = sessionCookie(signIn).split(";")[0] ?? "";

		const forged = await app.request("/api/auth/sign-out", {
			method: "POST",
			headers: { Origin: foreignOrigin, Cookie: cookie },
		});
		expect(forged.status).toBe(403);

		const legit = await app.request("/api/auth/sign-out", {
			method: "POST",
			headers: { Origin: webOrigin, Cookie: cookie },
		});
		expect(legit.status).toBe(200);
	});
});
