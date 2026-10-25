import type { Database } from "@Real-Estate-CRM/db";
import {
	activeStages,
	contactActivityTypes,
	customer,
	interest,
	openStages,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";

import { formatPhone } from "../phone";
import { noAnswerStreak, outerInterestId, streakSince } from "./activity";
import { visibleInterestCondition } from "./lead-access";
import { returnExpiredClaims } from "./pool";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";

const LIMIT = 100;

const list = (values: readonly string[]) =>
	sql.join(
		values.map((v) => sql`${v}`),
		sql`, `,
	);
const inStages = (stages: readonly string[]) =>
	sql`${interest.stage} in (${list(stages)})`;
const count = (where: SQL) =>
	sql<number>`count(*) filter (where ${where})::int`;

/**
 * Salesperson Overview (brief §7): six number cards for my leads and one To do
 * list: leads waiting for first contact (by deadline), then follow-ups due or
 * missing, plus leads that look unreachable. Expired claims are returned to
 * the pool first (lazy check).
 */
export async function getToday(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const now = new Date();
	const rules = await getRules(db, tenant.organizationId);
	const streak = noAnswerStreak(streakSince(rules.unreachableWindowDays, now));
	const open = inStages(openStages);
	const unreachable = sql`${open} and ${streak} >= ${rules.unreachableAttempts}`;
	const overdue = sql`${open} and ${interest.nextFollowUpAt} < ${now}`;
	const contacted = sql`exists (select 1 from interest_activity c where c.interest_id = ${outerInterestId} and c.type in (${list(contactActivityTypes)}))`;
	const mine = and(
		visibleInterestCondition(tenant),
		eq(interest.ownerMemberId, tenant.memberId),
	);

	const [statsRow, todo] = await Promise.all([
		db
			.select({
				active: count(inStages(activeStages)),
				overdue: count(overdue),
				oldestOverdue: sql<
					string | null
				>`min(${interest.nextFollowUpAt}) filter (where ${overdue})`,
				unreachable: count(unreachable),
				qualified: count(
					sql`${inStages(["new", "contacted"])} and ${contacted}`,
				),
				opportunities: count(inStages(["visited"])),
				deposited: count(inStages(["deposited", "contracted"])),
			})
			.from(interest)
			.where(mine),
		db
			.select({
				interestId: interest.id,
				customerId: customer.id,
				customerName: customer.name,
				projectName: project.name,
				stage: interest.stage,
				priority: interest.priority,
				contactDeadlineAt: interest.contactDeadlineAt,
				nextFollowUpAt: interest.nextFollowUpAt,
				attempts: streak,
				primaryPhone: sql<
					string | null
				>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`,
			})
			.from(interest)
			.innerJoin(customer, eq(customer.id, interest.customerId))
			.innerJoin(project, eq(project.id, interest.projectId))
			.where(
				and(
					mine,
					inArray(interest.stage, [...openStages]),
					sql`(${interest.contactDeadlineAt} is not null
						or ${interest.nextFollowUpAt} is null
						or ${interest.nextFollowUpAt} <= ${now}
						or ${streak} >= ${rules.unreachableAttempts})`,
				),
			)
			.orderBy(
				sql`${interest.contactDeadlineAt} is null`,
				sql`${interest.contactDeadlineAt} asc`,
				sql`${interest.nextFollowUpAt} is null`,
				sql`${interest.nextFollowUpAt} asc`,
				sql`${interest.priority} desc`,
			)
			.limit(LIMIT),
	]);

	const stats = statsRow[0];
	return {
		stats: {
			active: stats?.active ?? 0,
			overdue: {
				count: stats?.overdue ?? 0,
				oldest: stats?.oldestOverdue ? new Date(stats.oldestOverdue) : null,
			},
			unreachable: stats?.unreachable ?? 0,
			qualified: stats?.qualified ?? 0,
			opportunities: stats?.opportunities ?? 0,
			deposited: stats?.deposited ?? 0,
		},
		unreachableAttempts: rules.unreachableAttempts,
		todo: todo.map((r) => ({
			...r,
			phoneE164: r.primaryPhone,
			primaryPhone: r.primaryPhone ? formatPhone(r.primaryPhone) : null,
			unreachable: r.attempts >= rules.unreachableAttempts,
			reason:
				r.contactDeadlineAt !== null
					? ("first_contact" as const)
					: r.attempts >= rules.unreachableAttempts
						? ("unreachable" as const)
						: r.nextFollowUpAt === null
							? ("no_follow_up" as const)
							: ("follow_up_due" as const),
		})),
	};
}
