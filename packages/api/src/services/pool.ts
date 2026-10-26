import type { Database } from "@Real-Estate-CRM/db";
import { type AuditEntry, insertAudit } from "@Real-Estate-CRM/db/audit";
import {
	activity,
	campaign,
	customer,
	lead,
	leadSource,
	member,
	nurturePoolStatuses,
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
import { logStatusChange } from "./activity";
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
/** New: waiting to be claimed (deadline, badge). Nurturing: released by Nurture. */
export const poolTabs = ["new", "nurturing"] as const;
export const listPoolInput = z.strictObject({
	projectId: z.uuid().optional(),
	tab: z.enum(poolTabs).default("new"),
});

const claimableStatuses = [...poolLeadStatuses, ...nurturePoolStatuses];

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
 * `claimCap` claimed leads still waiting for first contact per person. A
 * nurturing lead reopens as Attempting: we're trying to reach them again.
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
		if (!claimableStatuses.includes(row.status)) {
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
		const reopen = nurturePoolStatuses.includes(row.status);
		await tx
			.update(lead)
			.set({
				ownerMemberId: tenant.memberId,
				claimedAt: now,
				contactDeadlineAt,
				...(reopen && { status: "attempting" as const }),
			})
			.where(eq(lead.id, row.id));
		if (reopen) {
			await logStatusChange(
				tx,
				tenant,
				row.id,
				row.status,
				"attempting",
				"claim",
				now,
			);
		}
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

/** Unclaimed leads in the tenant's projects (brief §6 pool), by tab. */
function inPool(tenant: Tenant, tab: (typeof poolTabs)[number] = "new") {
	return and(
		visibleLeadCondition(tenant),
		isNull(lead.ownerMemberId),
		inArray(lead.status, [
			...(tab === "new" ? poolLeadStatuses : nurturePoolStatuses),
		]),
	);
}

/** The latest nurture of the outer lead: when, the note, and the owner it was released from. */
const lastNurture = sql`(select a.at, a.note, u.name from activity a
	left join activity r on r.lead_id = a.lead_id and r.at = a.at
		and r.type = 'assignment' and r.data->>'reason' = 'nurtured'
	left join member m on m.id = r.data->>'from'
	left join "user" u on u.id = m.user_id
	where a.lead_id = ${sql.raw(`"lead"."id"`)} and a.type = 'status_change' and a.data->>'to' = 'nurturing'
	order by a.at desc limit 1)`;

/**
 * Pool page. New: priority first, then the longest waiting. Nurturing: the
 * longest untouched first, with when and by whom it was nurtured.
 */
export async function listPool(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof listPoolInput>,
) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const nurturing = input.tab === "nurturing";
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
			nurturedAt: sql<Date | null>`(select x.at from ${lastNurture} x)`.mapWith(
				(v) => (v === null ? null : new Date(v)),
			),
			previousOwnerName: sql<
				string | null
			>`(select x.name from ${lastNurture} x)`,
			nurtureNote: sql<string | null>`(select x.note from ${lastNurture} x)`,
		})
		.from(lead)
		.innerJoin(customer, eq(customer.id, lead.customerId))
		.innerJoin(project, eq(project.id, lead.projectId))
		.innerJoin(leadSource, eq(leadSource.id, lead.sourceId))
		.leftJoin(campaign, eq(campaign.id, lead.campaignId))
		.where(
			and(
				inPool(tenant, input.tab),
				input.projectId ? eq(lead.projectId, input.projectId) : undefined,
			),
		)
		.orderBy(
			...(nurturing
				? [asc(lead.updatedAt)]
				: [desc(lead.priority), asc(lead.createdAt)]),
		)
		.limit(200);
}

/** Sidebar badge: how many new leads wait to be claimed (not the nurturing tab). */
export async function poolCount(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const [row] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(lead)
		.where(inPool(tenant));
	return { count: row?.count ?? 0 };
}
