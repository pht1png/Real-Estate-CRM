import type { Database } from "@Real-Estate-CRM/db";
import { type AuditEntry, insertAudit } from "@Real-Estate-CRM/db/audit";
import {
	activity,
	campaign,
	customer,
	lead,
	leadSource,
	member,
	poolLeadStatuses,
	project,
	projectClosedDate,
	user,
} from "@Real-Estate-CRM/db/schema/index";
import { TRPCError } from "@trpc/server";
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	sql,
} from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import { badRequest, conflict, notFound } from "./errors";
import { visibleLeadCondition } from "./lead-access";
import { getRules } from "./rules";
import { coversProject, type Tenant } from "./tenancy";
import {
	contactDeadline,
	localDate,
	type WorkingCalendar,
} from "./working-time";

export const claimInput = z.strictObject({ leadId: z.uuid() });
export const listPoolInput = z.strictObject({ projectId: z.uuid().optional() });

type Executor = Pick<Database, "select">;

/** The project's office calendar, with closed dates from yesterday on. */
export async function loadCalendar(
	db: Executor,
	proj: Pick<typeof project.$inferSelect, "id" | "timeZone" | "officeHours">,
	now = new Date(),
): Promise<WorkingCalendar> {
	const from = localDate(new Date(now.getTime() - 86_400_000), proj.timeZone);
	const closed = await db
		.select({ date: projectClosedDate.date })
		.from(projectClosedDate)
		.where(
			and(
				eq(projectClosedDate.projectId, proj.id),
				gte(projectClosedDate.date, from),
			),
		);
	return {
		timeZone: proj.timeZone,
		officeHours: proj.officeHours,
		closedDates: new Set(closed.map((c) => c.date)),
	};
}

/** Contact deadline for a lead that reaches an owner now (claim or assignment). */
export async function deadlineFor(
	db: Executor,
	proj: Pick<typeof project.$inferSelect, "id" | "timeZone" | "officeHours">,
	rollHours: number,
	now = new Date(),
) {
	const deadline = contactDeadline(
		await loadCalendar(db, proj, now),
		now,
		rollHours,
	);
	if (!deadline) badRequest("The project has no office hours");
	return deadline;
}

/**
 * Claim a lead from the pool (brief §6): first salesperson wins; at most
 * `claimCap` claimed leads still waiting for first contact per person.
 */
export async function claimLead(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof claimInput>,
) {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(lead)
			.where(
				and(
					eq(lead.id, input.leadId),
					eq(lead.organizationId, tenant.organizationId),
				),
			)
			.for("update");
		// In my projects is enough here: a lost race may name the owner (brief §4 summary line).
		if (!row || !coversProject(tenant, row.projectId)) notFound("Lead");
		if (row.ownerMemberId) {
			const [owner] = await tx
				.select({ name: user.name })
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(member.id, row.ownerMemberId));
			conflict(`Already claimed by ${owner?.name ?? "someone else"}`);
		}
		if (!poolLeadStatuses.includes(row.status)) {
			badRequest("Only leads in the pool can be claimed");
		}

		// One claim at a time per person, so the cap can't be raced.
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`claim:${tenant.memberId}`}, 0))`,
		);
		const rules = await getRules(tx, tenant.organizationId);
		const [held] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(lead)
			.where(
				and(
					eq(lead.ownerMemberId, tenant.memberId),
					isNotNull(lead.claimedAt),
					isNotNull(lead.contactDeadlineAt),
				),
			);
		if ((held?.n ?? 0) >= rules.claimCap) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: `Contact your ${rules.claimCap} claimed leads before claiming more`,
			});
		}

		const [proj] = await tx
			.select()
			.from(project)
			.where(eq(project.id, row.projectId));
		if (!proj) notFound("Project");
		const now = new Date();
		const contactDeadlineAt = await deadlineFor(
			tx,
			proj,
			rules.deadlineRollHours,
			now,
		);
		await tx
			.update(lead)
			.set({
				ownerMemberId: tenant.memberId,
				claimedAt: now,
				contactDeadlineAt,
			})
			.where(eq(lead.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type: "assignment",
			byUserId: tenant.userId,
			data: { from: null, to: tenant.memberId, via: "claim" },
		});
		await writeAudit(tx, tenant, {
			action: "lead.claim",
			entityType: "lead",
			entityId: row.id,
			before: { ownerMemberId: null },
			after: { ownerMemberId: tenant.memberId },
		});
		return { contactDeadlineAt };
	});
}

/**
 * Leads whose contact deadline has passed go back to the pool (brief §6).
 * Run by the scheduler for every company, and lazily for one company on reads.
 */
export async function returnExpiredClaims(
	db: Pick<Database, "transaction">,
	options: { organizationId?: string; now?: Date } = {},
) {
	const now = options.now ?? new Date();
	return db.transaction(async (tx) => {
		const expired = await tx
			.select({
				id: lead.id,
				organizationId: lead.organizationId,
				ownerMemberId: lead.ownerMemberId,
			})
			.from(lead)
			.where(
				and(
					lte(lead.contactDeadlineAt, now),
					options.organizationId
						? eq(lead.organizationId, options.organizationId)
						: undefined,
				),
			)
			.for("update", { skipLocked: true });
		if (expired.length === 0) return 0;

		await tx
			.update(lead)
			.set({ ownerMemberId: null, claimedAt: null, contactDeadlineAt: null })
			.where(
				inArray(
					lead.id,
					expired.map((e) => e.id),
				),
			);
		await tx.insert(activity).values(
			expired.map((e) => ({
				organizationId: e.organizationId,
				leadId: e.id,
				type: "assignment" as const,
				data: {
					from: e.ownerMemberId,
					to: null,
					reason: "contact_deadline_missed",
				},
			})),
		);
		for (const e of expired) {
			const entry: AuditEntry = {
				organizationId: e.organizationId,
				actorUserId: null,
				action: "lead.assign",
				entityType: "lead",
				entityId: e.id,
				before: { ownerMemberId: e.ownerMemberId },
				after: { ownerMemberId: null, reason: "contact_deadline_missed" },
			};
			await insertAudit(tx, entry);
		}
		return expired.length;
	});
}

/** Unclaimed leads in the tenant's projects (brief §6 pool). */
function inPool(tenant: Tenant) {
	return and(
		visibleLeadCondition(tenant),
		isNull(lead.ownerMemberId),
		inArray(lead.status, [...poolLeadStatuses]),
	);
}

/** Pool page: priority first, then the longest waiting. */
export async function listPool(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listPoolInput>,
) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	return db
		.select({
			leadId: lead.id,
			customerId: customer.id,
			customerName: customer.name,
			projectId: project.id,
			projectName: project.name,
			priority: lead.priority,
			sourceName: leadSource.name,
			campaignCode: campaign.code,
			createdAt: lead.createdAt,
		})
		.from(lead)
		.innerJoin(customer, eq(customer.id, lead.customerId))
		.innerJoin(project, eq(project.id, lead.projectId))
		.innerJoin(leadSource, eq(leadSource.id, lead.sourceId))
		.leftJoin(campaign, eq(campaign.id, lead.campaignId))
		.where(
			and(
				inPool(tenant),
				input.projectId ? eq(lead.projectId, input.projectId) : undefined,
			),
		)
		.orderBy(desc(lead.priority), asc(lead.createdAt))
		.limit(200);
}

/** Sidebar badge: how many leads wait to be claimed. */
export async function poolCount(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(lead)
		.where(inPool(tenant));
	return { count: row?.count ?? 0 };
}
