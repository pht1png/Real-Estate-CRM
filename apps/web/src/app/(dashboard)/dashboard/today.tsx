"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@Real-Estate-CRM/ui/components/empty";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { SunIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ClaimButton, LeadActions } from "@/components/lead-actions";
import { useMe, useRoleLabel } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

type TodayData = inferRouterOutputs<AppRouter>["today"]["get"];
type Lead = TodayData["pool"][number];

/** Roles that own leads see their work; others keep the welcome card until M7. */
const WORKING_ROLES = ["salesperson", "sales_manager"];

export function Today({ name }: { name: string }) {
	const t = useTranslations("today");
	const { data: me } = useMe();
	const roleLabel = useRoleLabel();

	return (
		<>
			<div>
				<h1 className="text-2xl font-semibold">{t("welcome", { name })}</h1>
				{me && (
					<p className="text-muted-foreground">
						{t("summary", {
							role: roleLabel(me.role),
							organization: me.organization?.name ?? "",
						})}
					</p>
				)}
			</div>
			{me && WORKING_ROLES.includes(me.role) ? (
				<TodayLists canClaim={me.role === "salesperson"} />
			) : (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SunIcon />
						</EmptyMedia>
						<EmptyTitle>{t("title")}</EmptyTitle>
						<EmptyDescription>{t("comingSoon")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</>
	);
}

function TodayLists({ canClaim }: { canClaim: boolean }) {
	const t = useTranslations("today");
	const trpc = useTRPC();
	// Refetch each minute so expired claims and newly due follow-ups show up.
	const today = useQuery(
		trpc.today.get.queryOptions(undefined, { refetchInterval: 60_000 }),
	);
	const now = useNow({ updateInterval: 60_000 });

	if (!today.data) return <Spinner />;
	const { pool, claims, followUps } = today.data;

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			<Section
				id="today-claims"
				title={t("claims.title", { count: claims.length })}
				description={t("claims.description")}
				empty={t("claims.empty")}
				leads={claims}
				renderMeta={(l) => (
					<DueLabel
						at={l.contactDeadlineAt}
						now={now}
						label="contactBy"
						overdueLabel="contactOverdue"
					/>
				)}
				renderActions={(l) => (
					<LeadActions
						interestId={l.interestId}
						phoneE164={l.phoneE164}
						nextFollowUpAt={l.nextFollowUpAt}
					/>
				)}
			/>
			<Section
				id="today-follow-ups"
				title={t("followUps.title", { count: followUps.length })}
				description={t("followUps.description")}
				empty={t("followUps.empty")}
				leads={followUps}
				renderMeta={(l) =>
					l.nextFollowUpAt ? (
						<DueLabel
							at={l.nextFollowUpAt}
							now={now}
							label="dueAt"
							overdueLabel="overdue"
						/>
					) : (
						<Badge variant="destructive">{t("noFollowUp")}</Badge>
					)
				}
				renderActions={(l) => (
					<LeadActions
						interestId={l.interestId}
						phoneE164={l.phoneE164}
						nextFollowUpAt={l.nextFollowUpAt}
					/>
				)}
			/>
			<Section
				id="today-pool"
				title={t("pool.title", { count: pool.length })}
				description={t("pool.description")}
				empty={t("pool.empty")}
				leads={pool}
				renderMeta={(l) => <ReceivedLabel at={l.createdAt} now={now} />}
				renderActions={(l) =>
					canClaim ? <ClaimButton interestId={l.interestId} /> : null
				}
			/>
		</div>
	);
}

function Section({
	id,
	title,
	description,
	empty,
	leads,
	renderMeta,
	renderActions,
}: {
	id: string;
	title: string;
	description: string;
	empty: string;
	leads: Lead[];
	renderMeta: (lead: Lead) => ReactNode;
	renderActions: (lead: Lead) => ReactNode;
}) {
	const tc = useTranslations("customers");
	return (
		<section aria-labelledby={id}>
			<Card className="h-full">
				<CardHeader>
					<CardTitle>
						<h2 id={id}>{title}</h2>
					</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent>
					{leads.length === 0 ? (
						<p className="text-muted-foreground text-sm">{empty}</p>
					) : (
						<ul className="flex flex-col divide-y">
							{leads.map((l) => (
								<li
									key={l.interestId}
									className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<Link
												href={`/customers/${l.customerId}` as Route}
												className="font-medium underline-offset-4 hover:underline"
											>
												{l.customerName}
											</Link>
											<p className="text-muted-foreground truncate text-sm">
												{l.projectName}
												{l.primaryPhone && ` · ${l.primaryPhone}`}
											</p>
										</div>
										{l.priority && <Badge>{tc("priority")}</Badge>}
									</div>
									<div className="text-sm">{renderMeta(l)}</div>
									{renderActions(l)}
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
		</section>
	);
}

function DueLabel({
	at,
	now,
	label,
	overdueLabel,
}: {
	at: Date | string | null;
	now: Date;
	label: "contactBy" | "dueAt";
	overdueLabel: "contactOverdue" | "overdue";
}) {
	const t = useTranslations("today");
	const format = useFormatter();
	if (!at) return null;
	const date = new Date(at);
	const time = format.dateTime(date, {
		dateStyle: "medium",
		timeStyle: "short",
	});
	const relative = format.relativeTime(date, now);
	return date <= now ? (
		<span className="text-destructive font-medium">
			{t(overdueLabel, { time, relative })}
		</span>
	) : (
		<span className="tabular-nums">{t(label, { time, relative })}</span>
	);
}

function ReceivedLabel({ at, now }: { at: Date | string; now: Date }) {
	const t = useTranslations("today");
	const format = useFormatter();
	return (
		<span className="text-muted-foreground">
			{t("received", { relative: format.relativeTime(new Date(at), now) })}
		</span>
	);
}
