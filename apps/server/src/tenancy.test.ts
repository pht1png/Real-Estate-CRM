import { auditLog, projectMember } from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";

import { db } from "./services";
import {
	addMember,
	callerAs,
	createOrg,
	createProjectRow,
} from "./test-support";

async function expectCode(promise: Promise<unknown>, code: TRPCError["code"]) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(TRPCError);
	expect((error as TRPCError).code).toBe(code);
}

describe("permissions", () => {
	test("an invited salesperson cannot call manager or admin procedures", async () => {
		const org = await createOrg();
		const p = await createProjectRow(org.id);
		const { caller } = await callerAs(org.id, "salesperson", [p.id]);

		await expectCode(caller.team.listMembersInScope(), "FORBIDDEN");
		await expectCode(caller.project.create({ name: "New" }), "FORBIDDEN");
		await expectCode(
			caller.roleLabel.update({ role: "salesperson", label: "x" }),
			"FORBIDDEN",
		);
		await expectCode(
			caller.projectScope.assign({ projectId: p.id, memberId: "m" }),
			"FORBIDDEN",
		);
		// Allowed: their own scoped project list.
		expect(await caller.project.list()).toEqual([
			{ id: p.id, name: p.name, type: "condo" },
		]);
	});

	test("a sales manager sees only members sharing their projects", async () => {
		const org = await createOrg();
		const mine = await createProjectRow(org.id, "Mine");
		const other = await createProjectRow(org.id, "Other");
		const { caller, member: manager } = await callerAs(
			org.id,
			"sales_manager",
			[mine.id],
		);
		const { member: mySales } = await addMember(org.id, "salesperson", {
			projectIds: [mine.id],
		});
		await addMember(org.id, "salesperson", { projectIds: [other.id] });

		const team = await caller.team.listMembersInScope();
		expect(team.map((m) => m.memberId).sort()).toEqual(
			[manager.id, mySales.id].sort(),
		);
		await expectCode(caller.project.create({ name: "X" }), "FORBIDDEN");
	});

	test("an executive sees all members and projects", async () => {
		const org = await createOrg();
		await createProjectRow(org.id, "A");
		await createProjectRow(org.id, "B");
		await addMember(org.id, "salesperson");
		const { caller } = await callerAs(org.id, "executive");
		expect((await caller.project.list()).map((p) => p.name)).toEqual([
			"A",
			"B",
		]);
		expect((await caller.team.listMembersInScope()).length).toBe(2);
	});

	test("an admin manages projects, scopes and role labels, all audited", async () => {
		const org = await createOrg();
		const { caller } = await callerAs(org.id, "admin");
		const { member: sales } = await addMember(org.id, "salesperson");

		const created = await caller.project.create({ name: "Baan Suan Phase 1" });
		await caller.project.rename({ projectId: created.id, name: "Baan Suan" });
		await expectCode(caller.project.create({ name: "Baan Suan" }), "CONFLICT");
		await caller.projectScope.assign({
			projectId: created.id,
			memberId: sales.id,
		});
		expect(
			(await caller.projectScope.list({ projectId: created.id })).map(
				(m) => m.memberId,
			),
		).toEqual([sales.id]);
		await caller.roleLabel.update({
			role: "sales_manager",
			label: "Head of sales",
		});
		expect(await caller.roleLabel.list()).toContainEqual({
			role: "sales_manager",
			label: "Head of sales",
		});
		await caller.projectScope.unassign({
			projectId: created.id,
			memberId: sales.id,
		});

		const actions = (
			await db
				.select({ action: auditLog.action })
				.from(auditLog)
				.where(eq(auditLog.organizationId, org.id))
		).map((a) => a.action);
		expect(actions.sort()).toEqual(
			[
				"project.create",
				"project.rename",
				"project_scope.assign",
				"project_scope.unassign",
				"role_label.update",
			].sort(),
		);
	});

	test("organization, role and member ids are never taken from input", async () => {
		const org = await createOrg();
		const { caller } = await callerAs(org.id, "admin");
		await expectCode(
			// @ts-expect-error extra field on purpose
			caller.project.create({ name: "X", organizationId: "other" }),
			"BAD_REQUEST",
		);
	});
});

describe("cross-tenant isolation (org B cannot read or change org A)", () => {
	async function twoOrgs() {
		const a = await createOrg("Company A");
		const b = await createOrg("Company B");
		const projectA = await createProjectRow(a.id, "A project");
		const { member: salesA } = await addMember(a.id, "salesperson", {
			projectIds: [projectA.id],
		});
		const { caller: adminB } = await callerAs(b.id, "admin");
		const { caller: executiveB } = await callerAs(b.id, "executive");
		return { a, b, projectA, salesA, adminB, executiveB };
	}

	test("projects", async () => {
		const { projectA, adminB } = await twoOrgs();
		expect(await adminB.project.list()).toEqual([]);
		await expectCode(
			adminB.project.rename({ projectId: projectA.id, name: "Hijacked" }),
			"NOT_FOUND",
		);
		// Same name is fine in another company.
		await adminB.project.create({ name: "A project" });
	});

	test("project scopes", async () => {
		const { b, projectA, salesA, adminB } = await twoOrgs();
		const projectB = await createProjectRow(b.id);
		await expectCode(
			adminB.projectScope.list({ projectId: projectA.id }),
			"NOT_FOUND",
		);
		await expectCode(
			adminB.projectScope.assign({
				projectId: projectA.id,
				memberId: salesA.id,
			}),
			"NOT_FOUND",
		);
		await expectCode(
			adminB.projectScope.assign({
				projectId: projectB.id,
				memberId: salesA.id,
			}),
			"NOT_FOUND",
		);
		await expectCode(
			adminB.projectScope.unassign({
				projectId: projectA.id,
				memberId: salesA.id,
			}),
			"NOT_FOUND",
		);
	});

	test("the database rejects a scope linking two organizations", async () => {
		const { b, salesA } = await twoOrgs();
		const projectB = await createProjectRow(b.id);
		await expect(
			(async () =>
				await db.insert(projectMember).values({
					organizationId: b.id,
					projectId: projectB.id,
					memberId: salesA.id,
				}))(),
		).rejects.toThrow();
	});

	test("role labels", async () => {
		const { a, adminB } = await twoOrgs();
		const { caller: adminA } = await callerAs(a.id, "admin");
		await adminA.roleLabel.update({ role: "executive", label: "MD" });
		expect(await adminB.roleLabel.list()).toContainEqual({
			role: "executive",
			label: null,
		});
	});

	test("team", async () => {
		const { salesA, executiveB } = await twoOrgs();
		const team = await executiveB.team.listMembersInScope();
		expect(team.map((m) => m.memberId)).not.toContain(salesA.id);
	});

	test("me", async () => {
		const { b, adminB } = await twoOrgs();
		expect((await adminB.me()).organization?.id).toBe(b.id);
	});
});

describe("audit log", () => {
	test("is append-only", async () => {
		const org = await createOrg();
		const { caller } = await callerAs(org.id, "admin");
		await caller.project.create({ name: "Audited" });
		// Catch manually: Bun 1.4.3 crashes formatting this pg error in rejects.toThrow().
		const errorOf = async (query: ReturnType<typeof sql>) => {
			try {
				await db.execute(query);
				return "no error";
			} catch (error) {
				const cause = (error as { cause?: { message?: string } }).cause;
				return String(cause?.message ?? (error as Error).message);
			}
		};
		expect(await errorOf(sql`update audit_log set action = 'x'`)).toContain(
			"append-only",
		);
		expect(await errorOf(sql`delete from audit_log`)).toContain("append-only");
		const [{ count } = { count: 0 }] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(auditLog);
		expect(count).toBe(1);
	});
});
