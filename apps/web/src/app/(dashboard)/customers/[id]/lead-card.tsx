"use client";

import {
	type DisqualifyReason,
	disqualifyReasons,
	type LeadStatus,
	type LostReason,
	leadStatuses,
	lostReasons,
	type OpportunityStage,
	openLeadStatuses,
	openOpportunityStages,
	opportunityStages,
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
import { Separator } from "@Real-Estate-CRM/ui/components/separator";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { ClaimButton, LeadActions } from "@/components/lead-actions";
import { useCan, useMe } from "@/hooks/use-me";
import { usePipelineLabel } from "@/hooks/use-pipeline-label";
import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import type { CustomerDetail } from "./profile-card";

type VisibleLead = Extract<CustomerDetail["leads"][number], { visible: true }>;

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === "string" && (list as readonly string[]).includes(v);

/** One project for this customer: the lead (vetting) and, once visited, its deal. */
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
	const tos = useTranslations("opportunityStages");
	const tdr = useTranslations("disqualifyReasons");
	const tlr = useTranslations("lostReasons");
	const ta = useTranslations("activityTypes");
	const tt = useTranslations("timelines");
	const ti = useTranslations("buyerIntents");
	const tsig = useTranslations("signals");
	const tcust = useTranslations("customers");
	const tc = useTranslations("common");
	const format = useFormatter();
	const formatBaht = useFormatBaht();
	const pipelineLabel = usePipelineLabel();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");
	const { data: me } = useMe();
	const can = useCan();
	const deal = l.opportunity;
	const inPool = l.ownerMemberId === null;
	const canAct = (ownerId: string | null) =>
		(!!me && ownerId === me.memberId) || can({ lead: ["assign"] });
	const leadOpen = openLeadStatuses.includes(l.status);
	const dealOpen = !!deal && openOpportunityStages.includes(deal.stage);
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

	/** "→ Disqualified · Spam", "→ Negotiating" for status and stage changes. */
	const change = (data: Record<string, unknown> | null) => {
		const to = data?.to;
		const label = isIn<LeadStatus>(leadStatuses, to)
			? tls(to)
			: isIn<OpportunityStage>(opportunityStages, to)
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
				<CardAction className="flex gap-2">
					{l.priority && <Badge>{tcust("priority")}</Badge>}
					<Badge variant={deal ? "default" : "secondary"}>
						{pipelineLabel(l.status, deal?.stage ?? null)}
					</Badge>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{l.priority && l.prioritySignals.length > 0 && (
					<p className="text-sm">
						{l.prioritySignals
							.map((s) => tsig(s as "budget_in_range"))
							.join(" · ")}
					</p>
				)}
				{inPool && leadOpen && can({ lead: ["claim"] }) && (
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-muted-foreground text-sm">{t("inPoolHint")}</p>
						<ClaimButton leadId={l.id} />
					</div>
				)}
				{deal && dealOpen && canAct(deal.ownerMemberId) && (
					<LeadActions
						target={{
							kind: "opportunity",
							id: deal.id,
							customerName,
							phoneE164,
							nextFollowUpAt: deal.nextFollowUpAt,
							stage: deal.stage,
						}}
					/>
				)}
				{!deal?.id && !inPool && leadOpen && canAct(l.ownerMemberId) && (
					<LeadActions
						target={{
							kind: "lead",
							id: l.id,
							customerName,
							phoneE164,
							nextFollowUpAt: l.nextFollowUpAt,
							status: l.status,
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

				{deal && (
					<section aria-label={t("deal")} className="flex flex-col gap-2">
						<h4 className="text-sm font-medium">{t("deal")}</h4>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
							<dt className="text-muted-foreground">{t("dealStage")}</dt>
							<dd>
								{tos(deal.stage)}
								{deal.lostReason && ` · ${tlr(deal.lostReason)}`}
							</dd>
							<dt className="text-muted-foreground">{t("firstVisit")}</dt>
							<dd>
								{dateTime(deal.firstVisitAt)}
								{deal.visitCount > 1 &&
									` · ${t("visits", { count: deal.visitCount })}`}
							</dd>
							{dealOpen && (
								<>
									<dt className="text-muted-foreground">{t("followUp")}</dt>
									<dd>
										{deal.nextFollowUpAt
											? dateTime(deal.nextFollowUpAt)
											: tc("none")}
									</dd>
								</>
							)}
						</dl>
					</section>
				)}

				<section aria-label={t("vetting")} className="flex flex-col gap-2">
					<h4 className="text-sm font-medium">{t("vetting")}</h4>
					<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
						<dt className="text-muted-foreground">{t("leadStatus")}</dt>
						<dd>
							{tls(l.status)}
							{l.disqualifyReason && ` · ${tdr(l.disqualifyReason)}`}
							{l.qualifiedAt &&
								` · ${t("qualifiedOn", { date: dateTime(l.qualifiedAt) })}`}
						</dd>
						<dt className="text-muted-foreground">{t("source")}</dt>
						<dd>{l.sourceName}</dd>
						{l.campaignName && (
							<>
								<dt className="text-muted-foreground">{t("campaign")}</dt>
								<dd>
									{l.campaignName} ({l.campaignCode})
								</dd>
							</>
						)}
						<dt className="text-muted-foreground">{t("budget")}</dt>
						<dd>
							{budget}
							{priceRange && (
								<span className="text-muted-foreground block text-xs">
									{t("projectRange", {
										min: formatBaht(priceRange.min),
										max: formatBaht(priceRange.max),
									})}
								</span>
							)}
						</dd>
						<dt className="text-muted-foreground">{t("timeline")}</dt>
						<dd>{l.buyingTimeline ? tt(l.buyingTimeline) : t("notSet")}</dd>
						<dt className="text-muted-foreground">{t("intent")}</dt>
						<dd>{l.buyerIntent ? ti(l.buyerIntent) : t("notSet")}</dd>
						{leadOpen && (
							<>
								<dt className="text-muted-foreground">{t("followUp")}</dt>
								<dd>
									{l.nextFollowUpAt ? dateTime(l.nextFollowUpAt) : tc("none")}
								</dd>
							</>
						)}
						{l.contactDeadlineAt && (
							<>
								<dt className="text-muted-foreground">
									{t("contactDeadline")}
								</dt>
								<dd className={deadlinePassed ? "text-destructive" : undefined}>
									{dateTime(l.contactDeadlineAt)}
								</dd>
							</>
						)}
					</dl>
				</section>
				<Separator />
				<section className="flex flex-col gap-3">
					<h4 className="font-medium">{t("timelineTitle")}</h4>
					<form
						className="flex flex-col gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (!note.trim()) return;
							addNote.mutate(
								deal && dealOpen
									? { opportunityId: deal.id, note: note.trim() }
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
								<p className="font-medium">
									{ta(a.type)}
									{a.type === "stage_change" && change(a.data)}
									{a.opportunityId && (
										<Badge variant="outline" className="ml-2">
											{t("dealTag")}
										</Badge>
									)}
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
