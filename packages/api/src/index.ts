import { type Permissions, roleCan } from "@Real-Estate-CRM/auth/permissions";
import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { loadTenant } from "./services/tenancy";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Authentication required",
			cause: "No session",
		});
	}
	return next({
		ctx: {
			...ctx,
			session: ctx.session,
		},
	});
});

/**
 * Injects `ctx.tenant` from the session's active organization and the user's
 * membership in it. Organization, role and member never come from input.
 */
export const orgProcedure = protectedProcedure.use(async ({ ctx, next }) => {
	const organizationId = ctx.session.session.activeOrganizationId;
	const tenant = organizationId
		? await loadTenant(ctx.db, organizationId, ctx.session.user.id)
		: null;
	if (!tenant) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "No active organization membership",
		});
	}
	return next({ ctx: { ...ctx, tenant } });
});

/** Organization procedure that also requires the member's role to grant `permissions`. */
export function requirePermission(permissions: Permissions) {
	return orgProcedure.use(({ ctx, next }) => {
		if (!roleCan(ctx.tenant.role, permissions)) {
			throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed" });
		}
		return next();
	});
}
