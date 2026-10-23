import type { Database } from "@Real-Estate-CRM/db";
import * as schema from "@Real-Estate-CRM/db/schema/auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";

import { ac, roles } from "./permissions";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
	/** Parent domain shared by web and API in production, e.g. `example.com`. */
	COOKIE_DOMAIN?: string | undefined;
};

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	// Web and API are same-site (localhost ports, or app./api. subdomains), so
	// SameSite=Lax is enough; Secure follows the API's scheme so http dev works.
	const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";

	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		emailAndPassword: { enabled: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			// Better Auth skips origin/CSRF checks when NODE_ENV=test; keep them on so
			// tests exercise the same protection as production.
			disableOriginCheck: false,
			useSecureCookies: secure,
			defaultCookieAttributes: {
				sameSite: "lax",
				secure,
				httpOnly: true,
			},
			...(env.COOKIE_DOMAIN && {
				crossSubDomainCookies: { enabled: true, domain: env.COOKIE_DOMAIN },
			}),
		},
		plugins: [
			organization({
				ac,
				roles,
				creatorRole: "owner",
				allowUserToCreateOrganization: false,
				disableOrganizationDeletion: true,
			}),
			twoFactor({ issuer: "Real Estate CRM" }),
		],
	});
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
