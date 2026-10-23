import type { Database } from "@Real-Estate-CRM/db";
import { type AuditEntry, insertAudit } from "@Real-Estate-CRM/db/audit";
import * as schema from "@Real-Estate-CRM/db/schema/auth";
import { tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { and, asc, eq, gt } from "drizzle-orm";

import {
	accountSetupEmail,
	type EmailSender,
	invitationEmail,
	resetPasswordEmail,
} from "./email";
import { ac, isRoleName, roles } from "./permissions";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
	/** Public URL of the web app, used for links in emails. */
	WEB_URL: string;
	/** Parent domain shared by web and API in production, e.g. `example.com`. */
	COOKIE_DOMAIN?: string | undefined;
};

export function createAuth(
	env: AuthConfig,
	database: Database,
	email: EmailSender,
	desktopOrigins: readonly string[] = [],
) {
	// Web and API are same-site (localhost ports, or app./api. subdomains), so
	// SameSite=Lax is enough; Secure follows the API's scheme so http dev works.
	const secure = new URL(env.BETTER_AUTH_URL).protocol === "https:";
	const webUrl = env.WEB_URL.replace(/\/$/, "");

	/** Audit entry for an organization change, attributed to the signed-in actor. */
	const audit = (entry: Omit<AuditEntry, "actorUserId">) =>
		insertAudit(database, {
			...entry,
			actorUserId:
				tryGetCurrentAuthEndpointContext()?.context.session?.user.id ?? null,
		});

	const assertSingleKnownRole = (
		role: string | string[] | null | undefined,
	) => {
		if (typeof role !== "string" || !isRoleName(role)) {
			throw new APIError("BAD_REQUEST", { message: "Unknown role" });
		}
	};

	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		emailAndPassword: {
			enabled: true,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				// Owners created by `org:create` have no password yet: same flow, setup wording.
				const [credential] = await database
					.select({ id: schema.account.id })
					.from(schema.account)
					.where(
						and(
							eq(schema.account.userId, user.id),
							eq(schema.account.providerId, "credential"),
						),
					);
				await email.send(
					credential
						? resetPasswordEmail(user.email, url)
						: accountSetupEmail(user.email, url),
				);
			},
		},
		hooks: {
			// No self-serve sign-up (brief §11): an account can only be created
			// for a pending invitation, identified by the id from the emailed link.
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-up/email") return;
				const invitationId = ctx.query?.invitationId;
				const signUpEmail = String(ctx.body?.email ?? "").toLowerCase();
				const [pending] =
					typeof invitationId === "string"
						? await database
								.select({ email: schema.invitation.email })
								.from(schema.invitation)
								.where(
									and(
										eq(schema.invitation.id, invitationId),
										eq(schema.invitation.status, "pending"),
										gt(schema.invitation.expiresAt, new Date()),
									),
								)
						: [];
				if (!pending || pending.email.toLowerCase() !== signUpEmail) {
					throw new APIError("FORBIDDEN", {
						code: "INVITATION_REQUIRED",
						message: "Sign-up requires a valid invitation",
					});
				}
			}),
		},
		databaseHooks: {
			session: {
				create: {
					// Every session starts in the user's organization (their first, if several).
					before: async (session) => {
						const [membership] = await database
							.select({ organizationId: schema.member.organizationId })
							.from(schema.member)
							.where(eq(schema.member.userId, session.userId))
							.orderBy(asc(schema.member.createdAt))
							.limit(1);
						return {
							data: {
								...session,
								activeOrganizationId: membership?.organizationId ?? null,
							},
						};
					},
				},
			},
		},
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
				invitationExpiresIn: 60 * 60 * 24 * 7,
				cancelPendingInvitationsOnReInvite: true,
				sendInvitationEmail: async ({ id, email: to, organization }) => {
					await email.send(
						invitationEmail(
							to,
							organization.name,
							`${webUrl}/accept-invitation/${id}`,
						),
					);
				},
				organizationHooks: {
					beforeCreateInvitation: async ({ invitation }) => {
						assertSingleKnownRole(invitation.role);
					},
					beforeUpdateMemberRole: async ({ newRole }) => {
						assertSingleKnownRole(newRole);
					},
					afterCreateInvitation: ({ invitation }) =>
						audit({
							organizationId: invitation.organizationId,
							action: "invitation.create",
							entityType: "invitation",
							entityId: invitation.id,
							after: { role: invitation.role },
						}),
					afterCancelInvitation: ({ invitation }) =>
						audit({
							organizationId: invitation.organizationId,
							action: "invitation.cancel",
							entityType: "invitation",
							entityId: invitation.id,
						}),
					afterAcceptInvitation: ({ invitation, member }) =>
						audit({
							organizationId: member.organizationId,
							action: "member.join",
							entityType: "member",
							entityId: member.id,
							after: { role: member.role, invitationId: invitation.id },
						}),
					afterUpdateMemberRole: ({ member, previousRole }) =>
						audit({
							organizationId: member.organizationId,
							action: "member.role_change",
							entityType: "member",
							entityId: member.id,
							before: { role: previousRole },
							after: { role: member.role },
						}),
					afterRemoveMember: ({ member }) =>
						audit({
							organizationId: member.organizationId,
							action: "member.remove",
							entityType: "member",
							entityId: member.id,
							before: { role: member.role },
						}),
				},
			}),
			twoFactor({ issuer: "Real Estate CRM" }),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
export * from "./email";
export * from "./permissions";
