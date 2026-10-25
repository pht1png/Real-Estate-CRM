import type { Database } from "@Real-Estate-CRM/db";
import {
	customer,
	lead,
	openLeadStatuses,
	openOpportunityStages,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";

import { formatPhone } from "../phone";
import { noAnswerStreak, streakSince } from "./activity";
import {
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { returnExpiredClaims } from "./pool";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";

const LIMIT = 100;

const list = (values: readonly string[]) =>
	sql.join(
		values.map((v) => sql`${v}`),
		sql`, `,
	);
const count = (where: SQL) =>
	sql<number>`count(*) filter (where ${where})::int`;
const primaryPhone = sql<
	string | null
>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`;

export type TodoReason =
	| "first_contact"
	| "unreachable"
	| "no_follow_up"
	| "follow_up_due";

/**
 * Salesperson Overview (brief §7): six number cards across both pipelines and
 * one To do list of leads (vetting) and deals that need a step now. Expired
 * claims are returned to the pool first (lazy check).
 */
export async function getToday(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const now = new Date();
	const rules = await getRules(db, tenant.organizationId);
	const streak = noAnswerStreak(streakSince(rules.unreachableWindowDays, now));
	const openLead = sql`${lead.status} in (${list(openLeadStatuses)})`;
	const vetting = sql`${lead.status} in (${list(["new", "attempting", "connected"])})`;
	const unreachable = sql`${vetting} and ${streak} >= ${rules.unreachableAttempts}`;
	const openDeal = sql`${opportunity.stage} in (${list(openOpportunityStages)})`;
	const myLeads = and(
		visibleLeadCondition(tenant),
		eq(lead.ownerMemberId, tenant.memberId),
	);
	const myDeals = and(
		visibleOpportunityCondition(tenant),
		eq(opportunity.ownerMemberId, tenant.memberId),
	);

	const [leadStats, dealStats, leadRows, dealRows] = await Promise.all([
		db
			.select({
				open: count(openLead),
				overdue: count(sql`${openLead} and ${lead.nextFollowUpAt} < ${now}`),
				oldest: sql<
					string | null
				>`min(${lead.nextFollowUpAt}) filter (where ${openLead} and ${lead.nextFollowUpAt} < ${now})`,
				unreachable: count(unreachable),
				qualified: count(sql`${lead.status} = 'qualified'`),
			})
			.from(lead)
			.where(myLeads),
		db
			.select({
				open: count(
					sql`${opportunity.stage} in (${list(["visited", "negotiating", "deposited", "contracted"])})`,
				),
				overdue: count(
					sql`${openDeal} and ${opportunity.nextFollowUpAt} < ${now}`,
				),
				oldest: sql<
					string | null
				>`min(${opportunity.nextFollowUpAt}) filter (where ${openDeal} and ${opportunity.nextFollowUpAt} < ${now})`,
				opportunities: count(openDeal),
				deposited: count(
					sql`${opportunity.stage} in (${list(["deposited", "contracted"])})`,
				),
			})
			.from(opportunity)
			.where(myDeals),
		db
			.select({
				id: lead.id,
				customerId: customer.id,
				customerName: customer.name,
				projectId: project.id,
				projectName: project.name,
				status: lead.status,
				priority: lead.priority,
				contactDeadlineAt: lead.contactDeadlineAt,
				nextFollowUpAt: lead.nextFollowUpAt,
				attempts: streak,
				primaryPhone,
			})
			.from(lead)
			.innerJoin(customer, eq(customer.id, lead.customerId))
			.innerJoin(project, eq(project.id, lead.projectId))
			.where(
				and(
					myLeads,
					inArray(lead.status, [...openLeadStatuses]),
					sql`(${lead.contactDeadlineAt} is not null
						or ${lead.nextFollowUpAt} is null
						or ${lead.nextFollowUpAt} <= ${now}
						or ${unreachable})`,
				),
			)
			.limit(LIMIT),
		db
			.select({
				id: opportunity.id,
				customerId: customer.id,
				customerName: customer.name,
				projectId: project.id,
				projectName: project.name,
				stage: opportunity.stage,
				nextFollowUpAt: opportunity.nextFollowUpAt,
				primaryPhone,
			})
			.from(opportunity)
			.innerJoin(customer, eq(customer.id, opportunity.customerId))
			.innerJoin(project, eq(project.id, opportunity.projectId))
			.where(
				and(
					myDeals,
					openDeal,
					sql`(${opportunity.nextFollowUpAt} is null or ${opportunity.nextFollowUpAt} <= ${now})`,
				),
			)
			.limit(LIMIT),
	]);

	const phone = (p: string | null) => ({
		phoneE164: p,
		primaryPhone: p ? formatPhone(p) : null,
	});
	const leads = leadRows.map((r) => {
		const isUnreachable =
			r.status !== "qualified" && r.attempts >= rules.unreachableAttempts;
		const reason: TodoReason =
			r.contactDeadlineAt !== null
				? "first_contact"
				: isUnreachable
					? "unreachable"
					: r.nextFollowUpAt === null
						? "no_follow_up"
						: "follow_up_due";
		return {
			kind: "lead" as const,
			id: r.id,
			customerId: r.customerId,
			customerName: r.customerName,
			projectId: r.projectId,
			projectName: r.projectName,
			status: r.status,
			stage: null,
			priority: r.priority,
			contactDeadlineAt: r.contactDeadlineAt,
			nextFollowUpAt: r.nextFollowUpAt,
			attempts: r.attempts,
			unreachable: isUnreachable,
			reason,
			...phone(r.primaryPhone),
		};
	});
	const deals = dealRows.map((r) => ({
		kind: "opportunity" as const,
		id: r.id,
		customerId: r.customerId,
		customerName: r.customerName,
		projectId: r.projectId,
		projectName: r.projectName,
		status: null,
		stage: r.stage,
		priority: false,
		contactDeadlineAt: null,
		nextFollowUpAt: r.nextFollowUpAt,
		attempts: 0,
		unreachable: false,
		reason: (r.nextFollowUpAt === null
			? "no_follow_up"
			: "follow_up_due") as TodoReason,
		...phone(r.primaryPhone),
	}));
	// First contact by deadline, then missing follow-ups, then the oldest due.
	const time = (d: Date | null) => d?.getTime() ?? Number.NEGATIVE_INFINITY;
	const todo = [...leads, ...deals].sort((a, b) => {
		if (!!a.contactDeadlineAt !== !!b.contactDeadlineAt) {
			return a.contactDeadlineAt ? -1 : 1;
		}
		if (a.contactDeadlineAt && b.contactDeadlineAt) {
			return a.contactDeadlineAt.getTime() - b.contactDeadlineAt.getTime();
		}
		const byDue = time(a.nextFollowUpAt) - time(b.nextFollowUpAt);
		return byDue !== 0 ? byDue : Number(b.priority) - Number(a.priority);
	});

	const l = leadStats[0];
	const o = dealStats[0];
	const oldest = [l?.oldest, o?.oldest]
		.filter((v): v is string => !!v)
		.map((v) => new Date(v))
		.sort((a, b) => a.getTime() - b.getTime())[0];
	return {
		stats: {
			active: (l?.open ?? 0) + (o?.open ?? 0),
			overdue: {
				count: (l?.overdue ?? 0) + (o?.overdue ?? 0),
				oldest: oldest ?? null,
			},
			unreachable: l?.unreachable ?? 0,
			qualified: l?.qualified ?? 0,
			opportunities: o?.opportunities ?? 0,
			deposited: o?.deposited ?? 0,
		},
		unreachableAttempts: rules.unreachableAttempts,
		todo: todo.slice(0, LIMIT),
	};
}
