"use client";

import {
	type AppointmentCancelReason,
	appointmentCancelReasons,
	type DisqualifyReason,
	disqualifyReasons,
	type FundingType,
	fundingTypes,
	type LeadStatus,
	type LostReason,
	leadStatuses,
	lostReasons,
	type OpportunityStatus,
	openLeadStatuses,
	openOpportunityStatuses,
	opportunityStatuses,
} from "@Real-Estate-CRM/db/constants";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { AppointmentActions } from "@/components/appointment-forms";
import { ClaimButton, LeadActions } from "@/components/lead-actions";
import {
	AttributeList,
	PipelineCard,
	TemperatureBadge,
	TypeBadge,
} from "@/components/pipeline-card";
import { useCan, useMe } from "@/hooks/use-me";
import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import type { CustomerDetail } from "./profile-card";

type VisibleLead = Extract<CustomerDetail["leads"][number], { visible: true }>;

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * One project for this customer: the opportunity (green) once a visit
 * converted the lead, the lead (blue, vetting) with its qualification, the
 * showroom appointments, and one timeline.
 */
export function LeadCard({
	lead: l,
	phoneE164,
	customerName,
}: {
	lead: VisibleLead;
	phoneE164: string | null;
	customerName: string;
}) {
	const t = useTranslations("customer");
	const tls = useTranslations("leadStatuses");
	const tos = useTranslations("opportunityStatuses");
	const tfund = useTranslations("fundingTypes");
	const tap = useTranslations("appointments");
	const taps = useTranslations("appointmentStatuses");
	const tacr = useTranslations("appointmentCancelReasons");
	const tdr = useTranslations("disqualifyReasons");
	const tlr = useTranslations("lostReasons");
	const ta = useTranslations("activityTypes");
	const tt = useTranslations("timelines");
	const ti = useTranslations("buyerIntents");
	const tf = useTranslations("fit");
	const tsig = useTranslations("signals");
	const tcust = useTranslations("customers");
	const tc = useTranslations("common");
	const format = useFormatter();
	const formatBaht = useFormatBaht();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");
	const { data: me } = useMe();
	const can = useCan();
	const opp = l.opportunity;
	const inPool = l.ownerMemberId === null;
	const canAct = (ownerId: string | null) =>
		(!!me && ownerId === me.memberId) || can({ lead: ["assign"] });
	const leadOpen = openLeadStatuses.includes(l.status);
	const opportunityOpen = !!opp && openOpportunityStatuses.includes(opp.status);
	// Status, funding and notes stay possible until the transfer (or lost).
	const opportunityLive =
		!!opp && opp.status !== "lost" && opp.status !== "transferred";
	const deadlinePassed =
		l.contactDeadlineAt !== null && new Date(l.contactDeadlineAt) <= new Date();

	const addNote = useMutation(
		trpc.lead.addNote.mutationOptions({
			onSuccess: async () => {
				setNote("");
				await queryClient.invalidateQueries(trpc.customer.pathFilter());
			},
			onError: (e) => toast.error(e.message),
		}),
	);

	/** "→ Disqualified · Spam", "→ Negotiating" for lead and opportunity status changes. */
	const change = (data: Record<string, unknown> | null) => {
		const to = data?.to;
		const label = isIn<LeadStatus>(leadStatuses, to)
			? tls(to)
			: isIn<OpportunityStatus>(opportunityStatuses, to)
				? tos(to)
				: null;
		if (!label) return null;
		const reason = data?.reason;
		const reasonLabel = isIn<DisqualifyReason>(disqualifyReasons, reason)
			? tdr(reason)
			: isIn<LostReason>(lostReasons, reason)
				? tlr(reason)
				: null;
		return ` → ${label}${reasonLabel ? ` · ${reasonLabel}` : ""}`;
	};
	const dateTime = (d: Date | string) =>
		format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short" });
	/** The extra on a timeline line: appointment time, cancel reason, funding. */
	const detail = (type: string, data: Record<string, unknown> | null) => {
		if (type === "status_change") return change(data);
		const at = (v: unknown) => (typeof v === "string" ? dateTime(v) : "");
		if (type === "appointment_booked") return ` · ${at(data?.startsAt)}`;
		if (type === "appointment_rescheduled") {
			return ` · ${at(data?.from)} → ${at(data?.to)}`;
		}
		if (
			type === "appointment_cancelled" &&
			isIn<AppointmentCancelReason>(appointmentCancelReasons, data?.reason)
		) {
			return ` · ${tacr(data.reason)}`;
		}
		const funding = data?.funding as { to?: unknown } | undefined;
		if (type === "note" && isIn<FundingType>(fundingTypes, funding?.to)) {
			return ` · ${t("funding")} → ${tfund(funding.to)}`;
		}
		return null;
	};
	const budget =
		l.budgetMinSatang !== null && l.budgetMaxSatang !== null
			? t("budgetRange", {
					min: formatBaht(l.budgetMinSatang),
					max: formatBaht(l.budgetMaxSatang),
				})
			: l.budgetMinSatang !== null
				? t("budgetFrom", { min: formatBaht(l.budgetMinSatang) })
				: l.budgetMaxSatang !== null
					? t("budgetUpTo", { max: formatBaht(l.budgetMaxSatang) })
					: t("notSet");
	const priceRange =
		l.projectMinPriceSatang !== null && l.projectMaxPriceSatang !== null
			? { min: l.projectMinPriceSatang, max: l.projectMaxPriceSatang }
			: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h3>{l.projectName}</h3>
				</CardTitle>
				<CardDescription>
					{t("owner")}: {l.ownerName ?? t("pool")}
				</CardDescription>
				{l.priority && (
					<CardAction>
						<Badge>{tcust("priority")}</Badge>
					</CardAction>
				)}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{opp && (
					<PipelineCard kind="opportunity">
						<div className="flex items-start justify-between gap-2">
							<TypeBadge kind="opportunity" />
							<TemperatureBadge temperature={opp.temperature} />
						</div>
						<AttributeList
							items={[
								{
									label: t("opportunityStatus"),
									value: opp.lostReason
										? `${tos(opp.status)} · ${tlr(opp.lostReason)}`
										: tos(opp.status),
								},
								{
									label: t("firstVisit"),
									value:
										opp.visitCount > 1
											? `${dateTime(opp.firstVisitAt)} · ${t("visits", { count: opp.visitCount })}`
											: dateTime(opp.firstVisitAt),
								},
								{
									label: t("funding"),
									value: opp.fundingType ? tfund(opp.fundingType) : t("notSet"),
								},
								...(opportunityOpen
									? [
											{
												label: t("followUp"),
												value: opp.nextFollowUpAt
													? dateTime(opp.nextFollowUpAt)
													: tc("none"),
												tone: opp.nextFollowUpAt
													? undefined
													: ("danger" as const),
											},
										]
									: []),
							]}
						/>
						{opportunityLive && canAct(opp.ownerMemberId) && (
							<LeadActions
								target={{
									kind: "opportunity",
									id: opp.id,
									customerName,
									phoneE164,
									nextFollowUpAt: opp.nextFollowUpAt,
									status: opp.status,
									fundingType: opp.fundingType,
								}}
							/>
						)}
					</PipelineCard>
				)}

				<PipelineCard kind="lead">
					<TypeBadge kind="lead" />
					{l.priority && l.prioritySignals.length > 0 && (
						<p className="text-sm">
							{l.prioritySignals
								.map((s) => tsig(s as "budget_in_range"))
								.join(" · ")}
						</p>
					)}
					<AttributeList
						items={[
							{
								label: t("leadStatus"),
								value: [
									tls(l.status),
									l.disqualifyReason && tdr(l.disqualifyReason),
									l.qualifiedAt &&
										t("qualifiedOn", { date: dateTime(l.qualifiedAt) }),
								]
									.filter(Boolean)
									.join(" · "),
							},
							...(leadOpen && l.fit !== "unknown"
								? [{ label: t("fit"), value: tf(l.fit) }]
								: []),
							{ label: t("source"), value: l.sourceName },
							...(l.campaignName
								? [
										{
											label: t("campaign"),
											value: `${l.campaignName} (${l.campaignCode})`,
										},
									]
								: []),
							{
								label: t("budget"),
								value: priceRange ? (
									<>
										{budget}
										<span className="text-muted-foreground block text-xs">
											{t("projectRange", {
												min: formatBaht(priceRange.min),
												max: formatBaht(priceRange.max),
											})}
										</span>
									</>
								) : (
									budget
								),
							},
							{
								label: t("timeline"),
								value: l.buyingTimeline ? tt(l.buyingTimeline) : t("notSet"),
							},
							{
								label: t("intent"),
								value: l.buyerIntent ? ti(l.buyerIntent) : t("notSet"),
							},
							...(leadOpen
								? [
										{
											label: t("followUp"),
											value: l.nextFollowUpAt
												? dateTime(l.nextFollowUpAt)
												: tc("none"),
										},
									]
								: []),
							...(l.contactDeadlineAt
								? [
										{
											label: t("contactDeadline"),
											value: dateTime(l.contactDeadlineAt),
											tone: deadlinePassed ? ("danger" as const) : undefined,
										},
									]
								: []),
						]}
					/>
					{inPool && leadOpen && can({ lead: ["claim"] }) && (
						<div className="flex flex-wrap items-center gap-2">
							<p className="text-muted-foreground text-sm">{t("inPoolHint")}</p>
							<ClaimButton leadId={l.id} />
						</div>
					)}
					{!inPool && leadOpen && canAct(l.ownerMemberId) && (
						<LeadActions
							target={{
								kind: "lead",
								id: l.id,
								customerName,
								phoneE164,
								nextFollowUpAt: l.nextFollowUpAt,
								status: l.status,
								fit: l.fit,
								projectId: l.projectId,
								priceRange,
								qualification: {
									budgetMinSatang: l.budgetMinSatang,
									budgetMaxSatang: l.budgetMaxSatang,
									buyingTimeline: l.buyingTimeline,
									unitTypeIds: l.unitTypeIds,
									buyerIntent: l.buyerIntent,
								},
							}}
						/>
					)}
				</PipelineCard>

				{l.appointments.length > 0 && (
					<section className="flex flex-col gap-2">
						<h4 className="font-medium">{tap("title")}</h4>
						<ul className="flex flex-col gap-3">
							{l.appointments.map((a) => (
								<li key={a.id} className="flex flex-col gap-2 text-sm">
									<p className="flex flex-wrap items-center gap-2">
										<TypeBadge
											kind={a.kind === "first_tour" ? "lead" : "opportunity"}
										/>
										<span className="font-medium">
											{tap(
												a.kind === "first_tour" ? "firstTour" : "followUpVisit",
											)}
										</span>
										<Badge
											variant={a.status === "scheduled" ? "default" : "outline"}
										>
											{taps(a.status)}
										</Badge>
									</p>
									<p className="text-muted-foreground tabular-nums">
										{tap("line", {
											time: dateTime(a.startsAt),
											host: a.hostName,
										})}
										{a.cancelReason && ` · ${tacr(a.cancelReason)}`}
									</p>
									{a.status === "scheduled" && canAct(a.memberId) && (
										<AppointmentActions
											appointment={{
												appointmentId: a.id,
												leadId: l.id,
												opportunityId: a.opportunityId,
												startsAt: a.startsAt,
												customerName,
												projectId: l.projectId,
												qualified: l.status === "qualified",
												qualification: {
													budgetMinSatang: l.budgetMinSatang,
													budgetMaxSatang: l.budgetMaxSatang,
													buyingTimeline: l.buyingTimeline,
													unitTypeIds: l.unitTypeIds,
													buyerIntent: l.buyerIntent,
												},
												priceRange,
											}}
										/>
									)}
								</li>
							))}
						</ul>
					</section>
				)}

				<section className="flex flex-col gap-3">
					<h4 className="font-medium">{t("timelineTitle")}</h4>
					<form
						className="flex flex-col gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (!note.trim()) return;
							addNote.mutate(
								opp && opportunityLive
									? { opportunityId: opp.id, note: note.trim() }
									: { leadId: l.id, note: note.trim() },
							);
						}}
					>
						<Textarea
							aria-label={t("addNote")}
							placeholder={t("notePlaceholder")}
							value={note}
							maxLength={2000}
							onChange={(e) => setNote(e.target.value)}
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							className="self-start"
							disabled={!note.trim() || addNote.isPending}
						>
							{t("addNote")}
						</Button>
					</form>
					<ol className="flex flex-col gap-3 border-l pl-4">
						{l.activities.map((a) => (
							<li key={a.id} className="text-sm">
								<p className="flex flex-wrap items-center gap-2 font-medium">
									<TypeBadge kind={a.opportunityId ? "opportunity" : "lead"} />
									<span>
										{ta(a.type)}
										{detail(a.type, a.data)}
									</span>
								</p>
								{a.note && <p className="whitespace-pre-wrap">{a.note}</p>}
								<p className="text-muted-foreground text-xs">
									{t("by", {
										name: a.byName ?? t("system"),
										date: dateTime(a.at),
									})}
								</p>
							</li>
						))}
					</ol>
				</section>
			</CardContent>
		</Card>
	);
}
