import type { Database } from "@Real-Estate-CRM/db";
import {
	contactActivityTypes,
	lead,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { type AnyColumn, and, eq, inArray, type SQL, sql } from "drizzle-orm";

import { outerLeadId } from "./activity";
import {
	visibleLeadCondition,
	visibleOpportunityCondition,
} from "./lead-access";
import { returnExpiredClaims } from "./pool";
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
 * Salesperson Overview (brief §7): my leads and my deals, each with counts per
 * status / stage, this month's numbers and rates. Reasons are left to manager
 * reports (M7). Closed-won money needs deposits (M6).
 */
export async function getOverview(db: Database, tenant: Tenant) {
	await returnExpiredClaims(db, { organizationId: tenant.organizationId });
	const { start, end } = monthBounds(await tenantTimeZone(db, tenant));
	const inMonth = (col: SQL | AnyColumn) =>
		sql`${col} >= ${start} and ${col} < ${end}`;
	const received = inMonth(sql`coalesce(${lead.claimedAt}, ${lead.createdAt})`);
	const leadMoved = (to: string) =>
		sql`exists (select 1 from activity a where a.lead_id = ${outerLeadId} and a.opportunity_id is null
			and a.type = 'stage_change' and a.data->>'to' = ${to} and a.at >= ${start} and a.at < ${end})`;
	const dealMoved = (to: readonly string[]) =>
		sql`exists (select 1 from activity a where a.opportunity_id = ${outerOpportunityId}
			and a.type = 'stage_change' and a.data->>'to' in (${list(to)}) and a.at >= ${start} and a.at < ${end})`;
	const contacted = sql`exists (select 1 from activity c where c.lead_id = ${outerLeadId}
		and c.type in (${list(contactActivityTypes)}))`;

	const [[l], [o]] = await Promise.all([
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
				visited: count(sql`${opportunity.stage} = 'visited'`),
				negotiating: count(sql`${opportunity.stage} = 'negotiating'`),
				deposited: count(sql`${opportunity.stage} = 'deposited'`),
				contracted: count(sql`${opportunity.stage} = 'contracted'`),
				visits: count(inMonth(opportunity.firstVisitAt)),
				deposits: count(dealMoved(["deposited"])),
				won: count(dealMoved(["transferred"])),
				lost: count(inMonth(opportunity.lostAt)),
				visitsDeposited: count(
					sql`${inMonth(opportunity.firstVisitAt)} and ${inArray(opportunity.stage, ["deposited", "contracted", "transferred"])}`,
				),
				closedWon: count(dealMoved(["contracted", "transferred"])),
			})
			.from(opportunity)
			.where(
				and(
					visibleOpportunityCondition(tenant),
					eq(opportunity.ownerMemberId, tenant.memberId),
				),
			),
	]);

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
		deals: {
			byStage: {
				visited: n(o?.visited),
				negotiating: n(o?.negotiating),
				deposited: n(o?.deposited),
				contracted: n(o?.contracted),
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
