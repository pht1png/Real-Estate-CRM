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
	addClosedDate,
	closedDateInput,
	createProject,
	createProjectInput,
	getProject,
	listProjects,
	projectIdInput,
	removeClosedDate,
	removeClosedDateInput,
	renameProject,
	renameProjectInput,
	updateProject,
	updateProjectInput,
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
import {
	appointmentRouter,
	campaignRouter,
	contactRouter,
	leadRouter,
	leadSourceRouter,
	opportunityRouter,
	overviewRouter,
	poolRouter,
	rulesRouter,
	todoRouter,
} from "./crm";
import { sectionRouter, unitRouter, unitTypeRouter } from "./inventory";

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
		get: orgProcedure
			.input(projectIdInput)
			.query(({ ctx, input }) => getProject(ctx.db, ctx.tenant, input)),
		update: requirePermission({ project: ["update"] })
			.input(updateProjectInput)
			.mutation(({ ctx, input }) => updateProject(ctx.db, ctx.tenant, input)),
		addClosedDate: requirePermission({ project: ["update"] })
			.input(closedDateInput)
			.mutation(({ ctx, input }) => addClosedDate(ctx.db, ctx.tenant, input)),
		removeClosedDate: requirePermission({ project: ["update"] })
			.input(removeClosedDateInput)
			.mutation(({ ctx, input }) =>
				removeClosedDate(ctx.db, ctx.tenant, input),
			),
	}),
	section: sectionRouter,
	unitType: unitTypeRouter,
	unit: unitRouter,
	lead: leadRouter,
	opportunity: opportunityRouter,
	appointment: appointmentRouter,
	contact: contactRouter,
	leadSource: leadSourceRouter,
	campaign: campaignRouter,
	rules: rulesRouter,
	overview: overviewRouter,
	todo: todoRouter,
	pool: poolRouter,
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
