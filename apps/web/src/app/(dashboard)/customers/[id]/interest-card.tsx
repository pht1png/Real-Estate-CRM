"use client";

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
import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import type { CustomerDetail } from "./profile-card";

type VisibleInterest = Extract<
	CustomerDetail["interests"][number],
	{ visible: true }
>;

export function InterestCard({
	interest: i,
	phoneE164,
}: {
	interest: VisibleInterest;
	phoneE164: string | null;
}) {
	const t = useTranslations("customer");
	const ts = useTranslations("stages");
	const ta = useTranslations("activityTypes");
	const tt = useTranslations("timelines");
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
	const isOwner = !!me && i.ownerMemberId === me.memberId;
	const inPool = i.ownerMemberId === null;
	const canAct = isOwner || can({ lead: ["assign"] });
	const deadlinePassed =
		i.contactDeadlineAt !== null && new Date(i.contactDeadlineAt) <= new Date();

	const addNote = useMutation(
		trpc.lead.addNote.mutationOptions({
			onSuccess: async () => {
				setNote("");
				await queryClient.invalidateQueries(trpc.customer.pathFilter());
			},
			onError: (e) => toast.error(e.message),
		}),
	);

	const dateTime = (d: Date | string) =>
		format.dateTime(new Date(d), { dateStyle: "medium", timeStyle: "short" });
	const budget =
		i.budgetMinSatang !== null && i.budgetMaxSatang !== null
			? t("budgetRange", {
					min: formatBaht(i.budgetMinSatang),
					max: formatBaht(i.budgetMaxSatang),
				})
			: i.budgetMinSatang !== null
				? t("budgetFrom", { min: formatBaht(i.budgetMinSatang) })
				: i.budgetMaxSatang !== null
					? t("budgetUpTo", { max: formatBaht(i.budgetMaxSatang) })
					: t("notSet");

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h3>{i.projectName}</h3>
				</CardTitle>
				<CardDescription>
					{t("owner")}: {i.ownerName ?? t("pool")}
				</CardDescription>
				<CardAction className="flex gap-2">
					{i.priority && <Badge>{tcust("priority")}</Badge>}
					<Badge variant="secondary">{ts(i.stage)}</Badge>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{i.priority && i.prioritySignals.length > 0 && (
					<p className="text-sm">
						{i.prioritySignals
							.map((s) => tsig(s as "budget_in_range"))
							.join(" · ")}
					</p>
				)}
				{inPool && i.stage === "new" && can({ lead: ["claim"] }) && (
					<div className="flex flex-wrap items-center gap-2">
						<p className="text-muted-foreground text-sm">{t("inPoolHint")}</p>
						<ClaimButton interestId={i.id} />
					</div>
				)}
				{canAct && !inPool && (
					<LeadActions
						interestId={i.id}
						phoneE164={phoneE164}
						nextFollowUpAt={i.nextFollowUpAt}
					/>
				)}
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					<dt className="text-muted-foreground">{t("source")}</dt>
					<dd>{i.sourceName}</dd>
					{i.campaignName && (
						<>
							<dt className="text-muted-foreground">{t("campaign")}</dt>
							<dd>
								{i.campaignName} ({i.campaignCode})
							</dd>
						</>
					)}
					<dt className="text-muted-foreground">{t("budget")}</dt>
					<dd>
						{budget}
						{i.projectMinPriceSatang !== null &&
							i.projectMaxPriceSatang !== null && (
								<span className="text-muted-foreground block text-xs">
									{t("projectRange", {
										min: formatBaht(i.projectMinPriceSatang),
										max: formatBaht(i.projectMaxPriceSatang),
									})}
								</span>
							)}
					</dd>
					<dt className="text-muted-foreground">{t("timeline")}</dt>
					<dd>{i.buyingTimeline ? tt(i.buyingTimeline) : t("notSet")}</dd>
					<dt className="text-muted-foreground">{t("followUp")}</dt>
					<dd>{i.nextFollowUpAt ? dateTime(i.nextFollowUpAt) : tc("none")}</dd>
					{i.contactDeadlineAt && (
						<>
							<dt className="text-muted-foreground">{t("contactDeadline")}</dt>
							<dd className={deadlinePassed ? "text-destructive" : undefined}>
								{dateTime(i.contactDeadlineAt)}
							</dd>
						</>
					)}
				</dl>
				<Separator />
				<section className="flex flex-col gap-3">
					<h4 className="font-medium">{t("timelineTitle")}</h4>
					<form
						className="flex flex-col gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (note.trim())
								addNote.mutate({ interestId: i.id, note: note.trim() });
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
						{i.activities.map((a) => (
							<li key={a.id} className="text-sm">
								<p className="font-medium">{ta(a.type)}</p>
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
