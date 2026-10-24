import type { Database } from "@Real-Estate-CRM/db";
import {
	customer,
	interest,
	openStages,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";

import { formatPhone } from "../phone";
import { visibleInterestCondition } from "./lead-access";
import { returnExpiredClaims } from "./pool";
import type { Tenant } from "./tenancy";

const LIMIT = 50;

function leadRows(db: Database, where: SQL | undefined) {
	return db
		.select({
			interestId: interest.id,
			customerId: customer.id,
			customerName: customer.name,
			projectName: project.name,
			stage: interest.stage,
			priority: interest.priority,
			createdAt: interest.createdAt,
			contactDeadlineAt: interest.contactDeadlineAt,
			nextFollowUpAt: interest.nextFollowUpAt,
			primaryPhone: sql<
				string | null
			>`(select p.phone_e164 from customer_phone p where p.customer_id = ${customer.id} order by p.is_primary desc limit 1)`,
		})
		.from(interest)
		.innerJoin(customer, eq(customer.id, interest.customerId))
		.innerJoin(project, eq(project.id, interest.projectId))
		.where(where);
}

const withPhone = <T extends { primaryPhone: string | null }>(rows: T[]) =>
	rows.map((r) => ({
		...r,
		phoneE164: r.primaryPhone,
		primaryPhone: r.primaryPhone ? formatPhone(r.primaryPhone) : null,
	}));

/**
 * Salesperson Today (brief §7), M4 part: new in my pools, my claims waiting
 * for first contact (soonest deadline first), and follow-ups due by the end of
 * today in each project's time zone (overdue and missing ones first).
 */
export async function getToday(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const now = new Date();
	const visible = visibleInterestCondition(tenant);
	const mine = eq(interest.ownerMemberId, tenant.memberId);
	const endOfToday = sql`((date_trunc('day', ${now}::timestamptz at time zone ${project.timeZone}) + interval '1 day') at time zone ${project.timeZone})`;

	const [pool, claims, followUps] = await Promise.all([
		leadRows(
			db,
			and(visible, isNull(interest.ownerMemberId), eq(interest.stage, "new")),
		)
			.orderBy(desc(interest.priority), asc(interest.createdAt))
			.limit(LIMIT),
		leadRows(db, and(visible, mine, isNotNull(interest.contactDeadlineAt)))
			.orderBy(asc(interest.contactDeadlineAt))
			.limit(LIMIT),
		leadRows(
			db,
			and(
				visible,
				mine,
				isNull(interest.contactDeadlineAt),
				inArray(interest.stage, [...openStages]),
				or(
					isNull(interest.nextFollowUpAt),
					sql`${interest.nextFollowUpAt} < ${endOfToday}`,
				),
			),
		)
			.orderBy(sql`${interest.nextFollowUpAt} asc nulls first`)
			.limit(LIMIT),
	]);

	return {
		pool: withPhone(pool),
		claims: withPhone(claims),
		followUps: withPhone(followUps),
	};
}
