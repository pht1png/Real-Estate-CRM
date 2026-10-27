import type { Database } from "@Real-Estate-CRM/db";
import {
	appointment,
	contact,
	type FitResult,
	lead,
	openLeadStatuses,
	openOpportunityStatuses,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { formatPhone } from "../phone";
import { noAnswerStreak, streakSince } from "./activity";
import { assessFit, qualificationRulesOf } from "./fit";
import {
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { returnExpiredClaims } from "./pool";
import { getRules } from "./rules";
import { liveTemperature } from "./temperature";
import type { Tenant } from "./tenancy";

const LIMIT = 100;

const primaryPhone = sql<
	string | null
>`(select p.phone_e164 from contact_phone p where p.contact_id = ${contact.id} order by p.is_primary desc limit 1)`;
/** Start of today in the project's time zone (brief §3: working days per project). */
const startOfToday = (now: Date) =>
	sql<string>`(date_trunc('day', ${now}::timestamptz at time zone ${project.timeZone}) at time zone ${project.timeZone})`;
/** End of today in the project's time zone. */
const endOfToday = (now: Date) =>
	sql<string>`((date_trunc('day', ${now}::timestamptz at time zone ${project.timeZone}) + interval '1 day') at time zone ${project.timeZone})`;
/** An appointment still scheduled this long after its start asks "did they come?". */
const ARRIVAL_CHECK_MS = 2 * 3_600_000;
const priceBound = (fn: "min" | "max", projectId: unknown) =>
	sql<
		number | null
	>`(select ${sql.raw(fn)}(u.list_price_satang)::float8 from unit u where u.project_id = ${projectId} and u.status = 'available')`;

export type TodoReason =
	| "first_contact"
	| "follow_up_today"
	| "overdue"
	| "no_follow_up"
	| "unreachable"
	| "quiet";

/**
 * To-do page (brief §7): showroom arrivals today, my leads and opportunities
 * due today, and what slipped (overdue, missing follow-up, unreachable,
 * appointments nobody closed, hot or warm opportunities gone quiet). Expired
 * claims are returned to the pool first (lazy check).
 */
export async function getTodo(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const now = new Date();
	const rules = await getRules(db, tenant.organizationId);
	const streak = noAnswerStreak(streakSince(rules.unreachableWindowDays, now));

	const quietSince = new Date(
		now.getTime() - rules.quietOpportunityDays * 86_400_000,
	);
	const lastActivityAt = sql<
		string | null
	>`(select max(a.at) from activity a where a.opportunity_id = ${opportunity.id})`;

	const [leadRows, opportunityRows, appointmentRows] = await Promise.all([
		db
			.select({
				id: lead.id,
				contactId: contact.id,
				contactName: contact.name,
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
				incomeRange: lead.incomeRange,
				qualificationRules: project.qualificationRules,
				minPriceSatang: priceBound("min", lead.projectId),
				maxPriceSatang: priceBound("max", lead.projectId),
				primaryPhone,
			})
			.from(lead)
			.innerJoin(contact, eq(contact.id, lead.contactId))
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
				contactId: contact.id,
				contactName: contact.name,
				projectId: project.id,
				projectName: project.name,
				status: opportunity.status,
				fundingType: opportunity.fundingType,
				visitCount: opportunity.visitCount,
				nextFollowUpAt: opportunity.nextFollowUpAt,
				dueToday: sql<boolean>`(${opportunity.nextFollowUpAt} is null or ${opportunity.nextFollowUpAt} < ${endOfToday(now)})`,
				lastActivityAt,
				budgetMinSatang: lead.budgetMinSatang,
				budgetMaxSatang: lead.budgetMaxSatang,
				buyingTimeline: lead.buyingTimeline,
				qualificationRules: project.qualificationRules,
				minPriceSatang: priceBound("min", opportunity.projectId),
				maxPriceSatang: priceBound("max", opportunity.projectId),
				primaryPhone,
			})
			.from(opportunity)
			.innerJoin(lead, eq(lead.id, opportunity.leadId))
			.innerJoin(contact, eq(contact.id, opportunity.contactId))
			.innerJoin(project, eq(project.id, opportunity.projectId))
			.where(
				and(
					visibleOpportunityCondition(tenant),
					eq(opportunity.ownerMemberId, tenant.memberId),
					inArray(opportunity.status, [...openOpportunityStatuses]),
					// Due today, or quiet long enough to be a "gone quiet" candidate.
					sql`(${opportunity.nextFollowUpAt} is null or ${opportunity.nextFollowUpAt} < ${endOfToday(now)}
						or coalesce(${lastActivityAt}::timestamptz, ${opportunity.createdAt}) < ${quietSince})`,
				),
			)
			.limit(LIMIT),
		// My scheduled appointments up to the end of today: today's arrivals,
		// and older ones nobody marked arrived, no-show or cancelled.
		db
			.select({
				appointmentId: appointment.id,
				leadId: appointment.leadId,
				opportunityId: appointment.opportunityId,
				startsAt: appointment.startsAt,
				endsAt: appointment.endsAt,
				contactId: contact.id,
				contactName: contact.name,
				projectId: project.id,
				projectName: project.name,
				leadStatus: lead.status,
				budgetMinSatang: lead.budgetMinSatang,
				budgetMaxSatang: lead.budgetMaxSatang,
				buyingTimeline: lead.buyingTimeline,
				unitTypeIds: lead.unitTypeIds,
				buyerIntent: lead.buyerIntent,
				incomeRange: lead.incomeRange,
				minPriceSatang: priceBound("min", lead.projectId),
				maxPriceSatang: priceBound("max", lead.projectId),
				today: sql<boolean>`${appointment.startsAt} >= ${startOfToday(now)}`,
				primaryPhone,
			})
			.from(appointment)
			.innerJoin(lead, eq(lead.id, appointment.leadId))
			.innerJoin(contact, eq(contact.id, lead.contactId))
			.innerJoin(project, eq(project.id, lead.projectId))
			.where(
				and(
					eq(appointment.organizationId, tenant.organizationId),
					eq(appointment.memberId, tenant.memberId),
					eq(appointment.status, "scheduled"),
					lt(appointment.startsAt, endOfToday(now)),
				),
			)
			.orderBy(asc(appointment.startsAt))
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
			contactId: r.contactId,
			contactName: r.contactName,
			projectId: r.projectId,
			projectName: r.projectName,
			status: r.status,
			temperature: null,
			fundingType: null,
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
				incomeRange: r.incomeRange,
			},
			priceRange:
				r.minPriceSatang !== null && r.maxPriceSatang !== null
					? { min: r.minPriceSatang, max: r.maxPriceSatang }
					: null,
			...phone(r.primaryPhone),
		};
	});
	const opportunities = opportunityRows.flatMap((r) => {
		const temperature = liveTemperature(
			r,
			r,
			r.minPriceSatang !== null && r.maxPriceSatang !== null
				? { min: r.minPriceSatang, max: r.maxPriceSatang }
				: null,
			qualificationRulesOf(r),
		);
		// Hot or warm with nothing logged for a while (brief §6).
		const quiet =
			temperature !== null && new Date(r.lastActivityAt ?? 0) < quietSince;
		if (!r.dueToday && !quiet) return [];
		const followUp = followUpReason(r.nextFollowUpAt);
		const reason: TodoReason =
			quiet && (!r.dueToday || followUp === "follow_up_today")
				? "quiet"
				: followUp;
		return [
			{
				kind: "opportunity" as const,
				id: r.id,
				contactId: r.contactId,
				contactName: r.contactName,
				projectId: r.projectId,
				projectName: r.projectName,
				status: r.status,
				temperature,
				fundingType: r.fundingType,
				priority: false,
				contactDeadlineAt: null,
				nextFollowUpAt: r.nextFollowUpAt,
				attempts: 0,
				unreachable: false,
				reason,
				fit: null,
				qualification: null,
				priceRange: null,
				...phone(r.primaryPhone),
			},
		];
	});

	const appointments = appointmentRows.map((r) => ({
		kind: "appointment" as const,
		appointmentId: r.appointmentId,
		leadId: r.leadId,
		opportunityId: r.opportunityId,
		/** No opportunity at booking = a first tour; else a follow-up visit. */
		firstTour: r.opportunityId === null,
		/** A qualified lead converts on arrival; others qualify face to face first. */
		qualified: r.leadStatus === "qualified",
		today: r.today,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		contactId: r.contactId,
		contactName: r.contactName,
		projectId: r.projectId,
		projectName: r.projectName,
		/** Prefill for qualifying an unvetted guest face to face. */
		qualification: {
			budgetMinSatang: r.budgetMinSatang,
			budgetMaxSatang: r.budgetMaxSatang,
			buyingTimeline: r.buyingTimeline,
			unitTypeIds: r.unitTypeIds,
			buyerIntent: r.buyerIntent,
			incomeRange: r.incomeRange,
		},
		priceRange:
			r.minPriceSatang !== null && r.maxPriceSatang !== null
				? { min: r.minPriceSatang, max: r.maxPriceSatang }
				: null,
		...phone(r.primaryPhone),
	}));
	const unanswered = (a: (typeof appointments)[number]) =>
		a.startsAt.getTime() + ARRIVAL_CHECK_MS <= now.getTime();
	const arrivals = appointments.filter((a) => a.today && !unanswered(a));

	type Row = (typeof leads)[number] | (typeof opportunities)[number];
	const isStale = (r: Row) =>
		r.reason === "overdue" ||
		r.reason === "no_follow_up" ||
		r.reason === "unreachable" ||
		r.reason === "quiet";
	const time = (d: Date | null) => d?.getTime() ?? Number.NEGATIVE_INFINITY;
	const dueAt = (r: Row) => r.contactDeadlineAt ?? r.nextFollowUpAt;
	const byTime = (a: Row, b: Row) =>
		time(dueAt(a)) - time(dueAt(b)) || Number(b.priority) - Number(a.priority);
	const rows: Row[] = [...leads, ...opportunities];

	return {
		arrivals: {
			qualified: arrivals.filter((a) => a.firstTour && a.qualified).length,
			unvetted: arrivals.filter((a) => a.firstTour && !a.qualified).length,
			followUps: arrivals.filter((a) => !a.firstTour).length,
			items: arrivals,
		},
		dueToday: rows.filter((r) => !isStale(r)).sort(byTime),
		stale: rows.filter(isStale).sort(byTime),
		/** "Did they come?": still scheduled 2 hours after the start. */
		unansweredAppointments: appointments.filter(unanswered),
		unreachableAttempts: rules.unreachableAttempts,
	};
}

/** Sidebar badge: arrivals, items due today and what slipped. */
export async function todoCount(db: Database, tenant: Tenant) {
	const todo = await getTodo(db, tenant);
	return {
		count:
			todo.arrivals.items.length +
			todo.dueToday.length +
			todo.stale.length +
			todo.unansweredAppointments.length,
	};
}
