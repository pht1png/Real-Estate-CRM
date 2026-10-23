import { organization } from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";

import {
	orgProcedure,
	protectedProcedure,
	publicProcedure,
	requirePermission,
	router,
} from "../index";
import {
	createProject,
	createProjectInput,
	listProjects,
	renameProject,
	renameProjectInput,
} from "../services/project";
import {
	assignProjectScope,
	listProjectScope,
	listProjectScopeInput,
	projectScopeInput,
	unassignProjectScope,
} from "../services/project-scope";
import {
	getRoleLabels,
	updateRoleLabel,
	updateRoleLabelInput,
} from "../services/role-label";
import { listMembersInScope } from "../services/team";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	privateData: protectedProcedure.query(({ ctx }) => {
		return {
			message: "This is private",
			user: ctx.session.user,
		};
	}),
	me: orgProcedure.query(async ({ ctx }) => {
		const [org] = await ctx.db
			.select({ id: organization.id, name: organization.name })
			.from(organization)
			.where(eq(organization.id, ctx.tenant.organizationId));
		return {
			organization: org,
			memberId: ctx.tenant.memberId,
			role: ctx.tenant.role,
			projectIds: ctx.tenant.projectIds,
		};
	}),
	project: router({
		list: orgProcedure.query(({ ctx }) => listProjects(ctx.db, ctx.tenant)),
		create: requirePermission({ project: ["create"] })
			.input(createProjectInput)
			.mutation(({ ctx, input }) => createProject(ctx.db, ctx.tenant, input)),
		rename: requirePermission({ project: ["update"] })
			.input(renameProjectInput)
			.mutation(({ ctx, input }) => renameProject(ctx.db, ctx.tenant, input)),
	}),
	projectScope: router({
		list: requirePermission({ projectScope: ["assign"] })
			.input(listProjectScopeInput)
			.query(({ ctx, input }) => listProjectScope(ctx.db, ctx.tenant, input)),
		assign: requirePermission({ projectScope: ["assign"] })
			.input(projectScopeInput)
			.mutation(({ ctx, input }) =>
				assignProjectScope(ctx.db, ctx.tenant, input),
			),
		unassign: requirePermission({ projectScope: ["assign"] })
			.input(projectScopeInput)
			.mutation(({ ctx, input }) =>
				unassignProjectScope(ctx.db, ctx.tenant, input),
			),
	}),
	roleLabel: router({
		list: orgProcedure.query(({ ctx }) => getRoleLabels(ctx.db, ctx.tenant)),
		update: requirePermission({ roleLabel: ["update"] })
			.input(updateRoleLabelInput)
			.mutation(({ ctx, input }) => updateRoleLabel(ctx.db, ctx.tenant, input)),
	}),
	team: router({
		/** Manager procedure: members in the tenant's scope. */
		listMembersInScope: requirePermission({ team: ["read"] }).query(({ ctx }) =>
			listMembersInScope(ctx.db, ctx.tenant),
		),
	}),
});
export type AppRouter = typeof appRouter;
