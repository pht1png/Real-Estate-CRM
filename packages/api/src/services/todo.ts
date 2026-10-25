import type { Database } from "@Real-Estate-CRM/db";
import {
	customer,
	type FitResult,
	lead,
	openLeadStatuses,
	openOpportunityStages,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, sql } from "drizzle-orm";

import { formatPhone } from "../phone";
import { noAnswerStreak, streakSince } from "./activity";
import { assessFit, qualificationRulesOf } from "./fit";
import {
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { returnExpiredClaims } from "./pool";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";

const LIMIT = 100;

const primaryPhone = sql<
	string | null
>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`;
/** End of today in the project's time zone (brief §3: working days per project). */
const endOfToday = (now: Date) =>
	sql<string>`((date_trunc('day', ${now}::timestamptz at time zone ${project.timeZone}) + interval '1 day') at time zone ${project.timeZone})`;
const priceBound = (fn: "min" | "max", projectId: unknown) =>
	sql<
		number | null
	>`(select ${sql.raw(fn)}(u.list_price_satang)::float8 from unit u where u.project_id = ${projectId} and u.status = 'available')`;

export type TodoReason =
	| "first_contact"
	| "follow_up_today"
	| "overdue"
	| "no_follow_up"
	| "unreachable";

/**
 * To-do page (brief §7): showroom arrivals today (bookings arrive in M5), my
 * leads and deals due today, and what slipped (overdue, missing follow-up,
 * unreachable). Expired claims are returned to the pool first (lazy check).
 */
export async function getTodo(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const now = new Date();
	const rules = await getRules(db, tenant.organizationId);
	const streak = noAnswerStreak(streakSince(rules.unreachableWindowDays, now));

	const [leadRows, dealRows] = await Promise.all([
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
				budgetMinSatang: lead.budgetMinSatang,
				budgetMaxSatang: lead.budgetMaxSatang,
				buyingTimeline: lead.buyingTimeline,
				unitTypeIds: lead.unitTypeIds,
				buyerIntent: lead.buyerIntent,
				qualificationRules: project.qualificationRules,
				minPriceSatang: priceBound("min", lead.projectId),
				maxPriceSatang: priceBound("max", lead.projectId),
				primaryPhone,
			})
			.from(lead)
			.innerJoin(customer, eq(customer.id, lead.customerId))
			.innerJoin(project, eq(project.id, lead.projectId))
			.where(
				and(
					visibleLeadCondition(tenant),
					eq(lead.ownerMemberId, tenant.memberId),
					inArray(lead.status, [...openLeadStatuses]),
					sql`(${lead.contactDeadlineAt} is not null
						or ${lead.nextFollowUpAt} is null
						or ${lead.nextFollowUpAt} < ${endOfToday(now)}
						or ${streak} >= ${rules.unreachableAttempts})`,
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
					visibleOpportunityCondition(tenant),
					eq(opportunity.ownerMemberId, tenant.memberId),
					inArray(opportunity.stage, [...openOpportunityStages]),
					sql`(${opportunity.nextFollowUpAt} is null or ${opportunity.nextFollowUpAt} < ${endOfToday(now)})`,
				),
			)
			.limit(LIMIT),
	]);

	const phone = (p: string | null) => ({
		phoneE164: p,
		primaryPhone: p ? formatPhone(p) : null,
	});
	/** Overdue, missing, or later today. */
	const followUpReason = (next: Date | null): TodoReason =>
		next === null
			? "no_follow_up"
			: next <= now
				? "overdue"
				: "follow_up_today";

	const leads = leadRows.map((r) => {
		const unreachable =
			r.status !== "qualified" && r.attempts >= rules.unreachableAttempts;
		const reason: TodoReason = unreachable
			? "unreachable"
			: r.contactDeadlineAt
				? "first_contact"
				: followUpReason(r.nextFollowUpAt);
		const fit: FitResult = assessFit(
			{
				budgetMinSatang: r.budgetMinSatang,
				budgetMaxSatang: r.budgetMaxSatang,
				buyingTimeline: r.buyingTimeline,
				priceRange:
					r.minPriceSatang !== null && r.maxPriceSatang !== null
						? { min: r.minPriceSatang, max: r.maxPriceSatang }
						: null,
			},
			qualificationRulesOf(r),
		);
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
			unreachable,
			reason,
			fit,
			qualification: {
				budgetMinSatang: r.budgetMinSatang,
				budgetMaxSatang: r.budgetMaxSatang,
				buyingTimeline: r.buyingTimeline,
				unitTypeIds: r.unitTypeIds,
				buyerIntent: r.buyerIntent,
			},
			priceRange:
				r.minPriceSatang !== null && r.maxPriceSatang !== null
					? { min: r.minPriceSatang, max: r.maxPriceSatang }
					: null,
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
		reason: followUpReason(r.nextFollowUpAt),
		fit: null,
		qualification: null,
		priceRange: null,
		...phone(r.primaryPhone),
	}));

	type Row = (typeof leads)[number] | (typeof deals)[number];
	const isStale = (r: Row) =>
		r.reason === "overdue" ||
		r.reason === "no_follow_up" ||
		r.reason === "unreachable";
	const time = (d: Date | null) => d?.getTime() ?? Number.NEGATIVE_INFINITY;
	const dueAt = (r: Row) => r.contactDeadlineAt ?? r.nextFollowUpAt;
	const byTime = (a: Row, b: Row) =>
		time(dueAt(a)) - time(dueAt(b)) || Number(b.priority) - Number(a.priority);
	const rows: Row[] = [...leads, ...deals];

	return {
		// Booked showroom visits arrive with appointments (M5).
		arrivals: { qualified: 0, unvetted: 0, items: [] as Row[] },
		dueToday: rows.filter((r) => !isStale(r)).sort(byTime),
		stale: rows.filter(isStale).sort(byTime),
		unreachableAttempts: rules.unreachableAttempts,
	};
}

/** Sidebar badge: items due today plus what slipped. */
export async function todoCount(db: Database, tenant: Tenant) {
	const todo = await getTodo(db, tenant);
	return { count: todo.dueToday.length + todo.stale.length };
}
