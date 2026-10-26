import type { Database } from "@Real-Estate-CRM/db";
import {
	contactActivityTypes,
	lead,
	openOpportunityStatuses,
	opportunity,
	project,
	soldStatuses,
} from "@Real-Estate-CRM/db/schema/index";
import { type AnyColumn, and, eq, inArray, type SQL, sql } from "drizzle-orm";

import { outerLeadId } from "./activity";
import { qualificationRulesOf } from "./fit";
import {
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { returnExpiredClaims } from "./pool";
import { liveTemperature } from "./temperature";
import type { Tenant } from "./tenancy";
import { monthBounds } from "./working-time";

const list = (values: readonly string[]) =>
	sql.join(
		values.map((v) => sql`${v}`),
		sql`, `,
	);
const count = (where: SQL) =>
	sql<number>`count(*) filter (where ${where})::int`;
const outerOpportunityId = sql.raw(`"opportunity"."id"`);
/** Share of `part` in `whole`, or null when nothing to divide. */
const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** The member's month: their first project's time zone, else Bangkok. */
async function tenantTimeZone(db: Database, tenant: Tenant) {
	const projectId = tenant.projectIds?.[0];
	const [row] = await db
		.select({ timeZone: project.timeZone })
		.from(project)
		.where(
			and(
				eq(project.organizationId, tenant.organizationId),
				projectId ? eq(project.id, projectId) : undefined,
			),
		)
		.limit(1);
	return row?.timeZone ?? "Asia/Bangkok";
}

/**
 * Salesperson Overview (brief §7): my leads and my opportunities, each with
 * counts per status, this month's numbers and rates, plus how many open
 * opportunities are hot or warm. Reasons are left to manager reports (M7).
 * Closed-won money needs deposits (M6).
 */
export async function getOverview(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const { start, end } = monthBounds(await tenantTimeZone(db, tenant));
	const inMonth = (col: SQL | AnyColumn) =>
		sql`${col} >= ${start} and ${col} < ${end}`;
	const received = inMonth(sql`coalesce(${lead.claimedAt}, ${lead.createdAt})`);
	const leadMoved = (to: string) =>
		sql`exists (select 1 from activity a where a.lead_id = ${outerLeadId} and a.opportunity_id is null
			and a.type = 'status_change' and a.data->>'to' = ${to} and a.at >= ${start} and a.at < ${end})`;
	const opportunityMoved = (to: readonly string[]) =>
		sql`exists (select 1 from activity a where a.opportunity_id = ${outerOpportunityId}
			and a.type = 'status_change' and a.data->>'to' in (${list(to)}) and a.at >= ${start} and a.at < ${end})`;
	const contacted = sql`exists (select 1 from activity c where c.lead_id = ${outerLeadId}
		and c.type in (${list(contactActivityTypes)}))`;

	const [[l], [o], open] = await Promise.all([
		db
			.select({
				new: count(sql`${lead.status} = 'new'`),
				attempting: count(sql`${lead.status} = 'attempting'`),
				connected: count(sql`${lead.status} = 'connected'`),
				qualified: count(sql`${lead.status} = 'qualified'`),
				received: count(received),
				converted: count(inMonth(lead.convertedAt)),
				disqualified: count(leadMoved("disqualified")),
				receivedContacted: count(sql`${received} and ${contacted}`),
				receivedQualified: count(
					sql`${received} and ${lead.qualifiedAt} is not null`,
				),
				receivedConverted: count(
					sql`${received} and ${lead.convertedAt} is not null`,
				),
			})
			.from(lead)
			.where(
				and(
					visibleLeadCondition(tenant),
					eq(lead.ownerMemberId, tenant.memberId),
				),
			),
		db
			.select({
				visited: count(sql`${opportunity.status} = 'visited'`),
				negotiating: count(sql`${opportunity.status} = 'negotiating'`),
				deposited: count(sql`${opportunity.status} = 'deposited'`),
				contracted: count(sql`${opportunity.status} = 'contracted'`),
				waitingMortgageResult: count(
					sql`${opportunity.status} = 'waiting_mortgage_result'`,
				),
				visits: count(inMonth(opportunity.firstVisitAt)),
				deposits: count(opportunityMoved(["deposited"])),
				won: count(opportunityMoved(["transferred"])),
				lost: count(inMonth(opportunity.lostAt)),
				visitsDeposited: count(
					sql`${inMonth(opportunity.firstVisitAt)} and ${inArray(opportunity.status, [...soldStatuses])}`,
				),
				closedWon: count(opportunityMoved(["contracted", "transferred"])),
			})
			.from(opportunity)
			.where(
				and(
					visibleOpportunityCondition(tenant),
					eq(opportunity.ownerMemberId, tenant.memberId),
				),
			),
		// Hot / warm is computed on read, from the lead's profile and funding.
		db
			.select({
				status: opportunity.status,
				fundingType: opportunity.fundingType,
				visitCount: opportunity.visitCount,
				budgetMinSatang: lead.budgetMinSatang,
				budgetMaxSatang: lead.budgetMaxSatang,
				buyingTimeline: lead.buyingTimeline,
				qualificationRules: project.qualificationRules,
				minPriceSatang: sql<
					number | null
				>`(select min(u.list_price_satang)::float8 from unit u where u.project_id = ${opportunity.projectId} and u.status = 'available')`,
				maxPriceSatang: sql<
					number | null
				>`(select max(u.list_price_satang)::float8 from unit u where u.project_id = ${opportunity.projectId} and u.status = 'available')`,
			})
			.from(opportunity)
			.innerJoin(lead, eq(lead.id, opportunity.leadId))
			.innerJoin(project, eq(project.id, opportunity.projectId))
			.where(
				and(
					visibleOpportunityCondition(tenant),
					eq(opportunity.ownerMemberId, tenant.memberId),
					inArray(opportunity.status, [...openOpportunityStatuses]),
				),
			),
	]);
	const temperatures = open.map((r) =>
		liveTemperature(
			r,
			r,
			r.minPriceSatang !== null && r.maxPriceSatang !== null
				? { min: r.minPriceSatang, max: r.maxPriceSatang }
				: null,
			qualificationRulesOf(r),
		),
	);

	const n = (v: number | undefined) => v ?? 0;
	return {
		month: { start, end },
		leads: {
			byStatus: {
				new: n(l?.new),
				attempting: n(l?.attempting),
				connected: n(l?.connected),
				qualified: n(l?.qualified),
			},
			thisMonth: {
				received: n(l?.received),
				converted: n(l?.converted),
				disqualified: n(l?.disqualified),
			},
			rates: {
				contact: rate(n(l?.receivedContacted), n(l?.received)),
				qualify: rate(n(l?.receivedQualified), n(l?.received)),
				conversion: rate(n(l?.receivedConverted), n(l?.received)),
			},
		},
		opportunities: {
			byStatus: {
				visited: n(o?.visited),
				negotiating: n(o?.negotiating),
				deposited: n(o?.deposited),
				contracted: n(o?.contracted),
				waiting_mortgage_result: n(o?.waitingMortgageResult),
			},
			temperature: {
				hot: temperatures.filter((t) => t === "hot").length,
				warm: temperatures.filter((t) => t === "warm").length,
			},
			thisMonth: {
				visits: n(o?.visits),
				deposits: n(o?.deposits),
				won: n(o?.won),
				lost: n(o?.lost),
			},
			rates: {
				visitToDeposit: rate(n(o?.visitsDeposited), n(o?.visits)),
				win: rate(n(o?.won), n(o?.won) + n(o?.lost)),
			},
			// Volume and commission estimate come from deposits (M6).
			closedWon: {
				count: n(o?.closedWon),
				volumeSatang: null as number | null,
				commissionSatang: null as number | null,
			},
		},
	};
}
