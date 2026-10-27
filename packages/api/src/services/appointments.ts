import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	appointment,
	appointmentCancelReasons,
	customer,
	lead,
	opportunity,
	project,
} from "@Real-Estate-CRM/db/schema/index";
import { and, asc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";

import {
	futureDateTime,
	requireActor,
	requireFutureFollowUp,
	requireOpenLead,
	requireOpenOpportunity,
} from "./activity";
import { badRequest, conflict, isExclusionViolation, notFound } from "./errors";
import { requireVisibleLead, requireVisibleOpportunity } from "./lead-access";
import { loadCalendar } from "./pool";
import { getRules } from "./rules";
import type { Tenant } from "./tenancy";
import { lockVisibleLead, recordVisit, visitTime } from "./visits";
import { freeSlots, zonedTime } from "./working-time";

type Tx = Pick<Database, "select" | "insert" | "update" | "execute">;

const note = z.string().trim().max(1000).optional();

/** A first tour (lead) or a follow-up visit (opportunity): exactly one. */
const target = {
	leadId: z.uuid().optional(),
	opportunityId: z.uuid().optional(),
};
const oneTarget = (v: { leadId?: string; opportunityId?: string }) =>
	!!v.leadId !== !!v.opportunityId;
const oneTargetMessage = { message: "Give a lead or an opportunity" };

export const bookAppointmentInput = z
	.strictObject({ ...target, startsAt: futureDateTime, note })
	.refine(oneTarget, oneTargetMessage);

export const rescheduleAppointmentInput = z.strictObject({
	appointmentId: z.uuid(),
	startsAt: futureDateTime,
});

export const cancelAppointmentInput = z
	.strictObject({
		appointmentId: z.uuid(),
		reason: z.enum(appointmentCancelReasons),
		note,
	})
	.refine((v) => v.reason !== "other" || !!v.note, {
		message: "Add a note for “Other”",
		path: ["note"],
	});

export const arrivedInput = z.strictObject({
	appointmentId: z.uuid(),
	/** When they arrived; defaults to now. */
	visitedAt: z.iso.datetime({ offset: true }).optional(),
	note,
	nextFollowUpAt: futureDateTime,
});

export const noShowInput = z.strictObject({
	appointmentId: z.uuid(),
	note,
	nextFollowUpAt: futureDateTime,
});

export const appointmentSlotsInput = z
	.strictObject({
		...target,
		/** Local date (YYYY-MM-DD) in the project's time zone. */
		date: z.iso.date(),
		/** Rescheduling: leave this appointment's own time free. */
		appointmentId: z.uuid().optional(),
	})
	.refine(oneTarget, oneTargetMessage);

/**
 * Who and what an appointment is for. A first tour needs a connected or
 * qualified lead without a live opportunity; a follow-up visit needs an open
 * opportunity. The host is always the owner, never chosen by the client.
 */
async function resolveTarget(
	tx: Tx,
	tenant: Tenant,
	input: { leadId?: string; opportunityId?: string },
) {
	if (input.opportunityId) {
		const opp = await requireVisibleOpportunity(
			tx,
			tenant,
			input.opportunityId,
		);
		requireActor(tenant, opp);
		requireOpenOpportunity(opp);
		return {
			leadId: opp.leadId,
			opportunityId: opp.id,
			projectId: opp.projectId,
			memberId: opp.ownerMemberId,
		};
	}
	const row = await requireVisibleLead(tx, tenant, input.leadId ?? "");
	requireActor(tenant, row);
	if (row.status !== "connected" && row.status !== "qualified") {
		badRequest("Book a tour once you've spoken to the customer");
	}
	if (!row.ownerMemberId) badRequest("Claim or assign the lead first");
	return {
		leadId: row.id,
		opportunityId: null,
		projectId: row.projectId,
		memberId: row.ownerMemberId,
	};
}

/** The appointment, if its lead or opportunity is visible; locked for the change. */
async function requireAppointment(
	tx: Tx,
	tenant: Tenant,
	appointmentId: string,
) {
	const [row] = await tx
		.select()
		.from(appointment)
		.where(
			and(
				eq(appointment.id, appointmentId),
				eq(appointment.organizationId, tenant.organizationId),
			),
		)
		.for("update");
	if (!row) notFound("Appointment");
	// Hidden lead or opportunity: NOT_FOUND, like a missing appointment.
	if (row.opportunityId) {
		await requireVisibleOpportunity(tx, tenant, row.opportunityId);
	} else {
		await requireVisibleLead(tx, tenant, row.leadId);
	}
	requireActor(tenant, { ownerMemberId: row.memberId });
	return row;
}

function futureStart(value: string) {
	const startsAt = new Date(value);
	if (startsAt <= new Date()) badRequest("Pick a time in the future");
	return startsAt;
}

function requireScheduled(row: { status: string }) {
	if (row.status !== "scheduled") {
		badRequest("This appointment is no longer scheduled");
	}
}

const slotTaken = () =>
	conflict("The salesperson already has an appointment at this time");

/**
 * One booking change at a time per salesperson: concurrent inserts checking
 * the exclusion constraint can deadlock instead of failing cleanly.
 */
function lockHost(tx: Pick<Database, "execute">, memberId: string) {
	return tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`appointment:${memberId}`}, 0))`,
	);
}

/** The no-overlap constraint rolls the transaction back; report it as a clash. */
async function withoutClash<T>(run: () => Promise<T>) {
	try {
		return await run();
	} catch (error) {
		if (isExclusionViolation(error)) slotTaken();
		throw error;
	}
}

/**
 * Book a showroom appointment (brief §6): 60 minutes by default, never
 * overlapping the salesperson's other scheduled appointments.
 */
export async function bookAppointment(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof bookAppointmentInput>,
) {
	const startsAt = futureStart(input.startsAt);
	return withoutClash(() =>
		db.transaction(async (tx) => {
			const to = await resolveTarget(tx, tenant, input);
			await lockHost(tx, to.memberId);
			const rules = await getRules(tx, tenant.organizationId);
			const endsAt = new Date(
				startsAt.getTime() + rules.appointmentMinutes * 60_000,
			);
			const [created] = await tx
				.insert(appointment)
				.values({
					organizationId: tenant.organizationId,
					leadId: to.leadId,
					opportunityId: to.opportunityId,
					memberId: to.memberId,
					startsAt,
					endsAt,
					createdByUserId: tenant.userId,
				})
				.returning({ id: appointment.id });
			if (!created) throw new Error("insert returned no row");
			await tx.insert(activity).values({
				organizationId: tenant.organizationId,
				leadId: to.leadId,
				opportunityId: to.opportunityId,
				type: "appointment_booked",
				byUserId: tenant.userId,
				note: input.note || null,
				data: {
					appointmentId: created.id,
					startsAt: startsAt.toISOString(),
					endsAt: endsAt.toISOString(),
					memberId: to.memberId,
				},
			});
			return { appointmentId: created.id, startsAt, endsAt };
		}),
	);
}

/** A new time for the same appointment: it stays scheduled; not a cancel. */
export async function rescheduleAppointment(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof rescheduleAppointmentInput>,
) {
	const startsAt = futureStart(input.startsAt);
	return withoutClash(() =>
		db.transaction(async (tx) => {
			const row = await requireAppointment(tx, tenant, input.appointmentId);
			requireScheduled(row);
			await lockHost(tx, row.memberId);
			const endsAt = new Date(
				startsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime()),
			);
			await tx
				.update(appointment)
				.set({ startsAt, endsAt })
				.where(eq(appointment.id, row.id));
			await tx.insert(activity).values({
				organizationId: tenant.organizationId,
				leadId: row.leadId,
				opportunityId: row.opportunityId,
				type: "appointment_rescheduled",
				byUserId: tenant.userId,
				data: {
					appointmentId: row.id,
					from: row.startsAt.toISOString(),
					to: startsAt.toISOString(),
				},
			});
			return { startsAt, endsAt };
		}),
	);
}

export async function cancelAppointment(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof cancelAppointmentInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireAppointment(tx, tenant, input.appointmentId);
		requireScheduled(row);
		await tx
			.update(appointment)
			.set({ status: "cancelled", cancelReason: input.reason })
			.where(eq(appointment.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.opportunityId,
			type: "appointment_cancelled",
			byUserId: tenant.userId,
			note: input.note || null,
			data: { appointmentId: row.id, reason: input.reason },
		});
	});
}

/**
 * They came: the visit is recorded through `recordVisit` (a first tour
 * converts a qualified lead; qualify face to face first if needed).
 */
export async function markArrived(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof arrivedInput>,
) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const row = await requireAppointment(tx, tenant, input.appointmentId);
		requireScheduled(row);
		const leadRow = await lockVisibleLead(tx, tenant, row.leadId);
		const result = await recordVisit(
			tx,
			tenant,
			{
				lead: leadRow,
				visitedAt: visitTime(input.visitedAt, now),
				nextFollowUpAt: requireFutureFollowUp(input.nextFollowUpAt, now),
				appointmentId: row.id,
				note: input.note,
			},
			now,
		);
		// A first tour keeps no opportunity: that's how it reads as the first.
		await tx
			.update(appointment)
			.set({ status: "arrived" })
			.where(eq(appointment.id, row.id));
		return result;
	});
}

/** They didn't come: logged, and the lead or opportunity gets its next follow-up. */
export async function markNoShow(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof noShowInput>,
) {
	const now = new Date();
	await db.transaction(async (tx) => {
		const row = await requireAppointment(tx, tenant, input.appointmentId);
		requireScheduled(row);
		const nextFollowUpAt = requireFutureFollowUp(input.nextFollowUpAt, now);
		if (row.opportunityId) {
			const opp = await requireVisibleOpportunity(
				tx,
				tenant,
				row.opportunityId,
			);
			requireOpenOpportunity(opp);
			await tx
				.update(opportunity)
				.set({ nextFollowUpAt })
				.where(eq(opportunity.id, opp.id));
		} else {
			const leadRow = await requireVisibleLead(tx, tenant, row.leadId);
			requireOpenLead(leadRow);
			await tx
				.update(lead)
				.set({ nextFollowUpAt })
				.where(eq(lead.id, leadRow.id));
		}
		await tx
			.update(appointment)
			.set({ status: "no_show" })
			.where(eq(appointment.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.leadId,
			opportunityId: row.opportunityId,
			type: "appointment_no_show",
			at: now,
			byUserId: tenant.userId,
			note: input.note || null,
			data: {
				appointmentId: row.id,
				nextFollowUpAt: nextFollowUpAt.toISOString(),
			},
		});
	});
}

/**
 * The host's day for the booking picker: their scheduled appointments and
 * the free start times inside the project's office hours.
 */
export async function appointmentSlots(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof appointmentSlotsInput>,
) {
	const to = await resolveTarget(db, tenant, input);
	const [proj] = await db
		.select()
		.from(project)
		.where(eq(project.id, to.projectId));
	if (!proj) notFound("Project");
	const now = new Date();
	const rules = await getRules(db, tenant.organizationId);
	const nextDate = new Date(Date.parse(`${input.date}T00:00:00Z`) + 86_400_000)
		.toISOString()
		.slice(0, 10);
	const dayStart = zonedTime(input.date, "00:00", proj.timeZone);
	const dayEnd = zonedTime(nextDate, "00:00", proj.timeZone);
	const booked = await db
		.select({
			id: appointment.id,
			startsAt: appointment.startsAt,
			endsAt: appointment.endsAt,
			customerName: customer.name,
		})
		.from(appointment)
		.innerJoin(lead, eq(lead.id, appointment.leadId))
		.innerJoin(customer, eq(customer.id, lead.customerId))
		.where(
			and(
				eq(appointment.organizationId, tenant.organizationId),
				eq(appointment.memberId, to.memberId),
				eq(appointment.status, "scheduled"),
				lt(appointment.startsAt, dayEnd),
				gt(appointment.endsAt, dayStart),
				input.appointmentId
					? ne(appointment.id, input.appointmentId)
					: undefined,
			),
		)
		.orderBy(asc(appointment.startsAt));
	return {
		minutes: rules.appointmentMinutes,
		booked,
		free: freeSlots(
			await loadCalendar(db, proj, now),
			input.date,
			booked,
			rules.appointmentMinutes,
			now,
		),
	};
}
