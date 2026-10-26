"use client";

import type {
	LeadStatus,
	OpportunityStatus,
} from "@Real-Estate-CRM/db/constants";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@Real-Estate-CRM/ui/components/empty";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboardIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { type Pipeline, TypeBadge } from "@/components/pipeline-card";
import { useMe, useRoleLabel } from "@/hooks/use-me";
import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

/** Roles that own leads see their numbers; others keep the welcome card until M7. */
const WORKING_ROLES = ["salesperson", "sales_manager"];

const leadsLink = (status: LeadStatus) =>
	`/customers?ownership=mine&status=${status}` as Route;
const opportunitiesLink = (status: OpportunityStatus) =>
	`/customers?pipeline=opportunities&ownership=mine&opportunityStatus=${status}` as Route;

export function Overview({ name }: { name: string }) {
	const t = useTranslations("overview");
	const { data: me } = useMe();
	const roleLabel = useRoleLabel();

	return (
		<>
			<div>
				<h1 className="text-2xl font-semibold">{t("title")}</h1>
				<p className="text-muted-foreground">
					{t("welcome", { name })}
					{me &&
						` · ${t("summary", {
							role: roleLabel(me.role),
							organization: me.organization?.name ?? "",
						})}`}
				</p>
			</div>
			{me && WORKING_ROLES.includes(me.role) ? (
				<OverviewBody />
			) : (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<LayoutDashboardIcon />
						</EmptyMedia>
						<EmptyTitle>{t("title")}</EmptyTitle>
						<EmptyDescription>{t("comingSoon")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</>
	);
}

function OverviewBody() {
	const t = useTranslations("overview");
	const tls = useTranslations("leadStatuses");
	const tos = useTranslations("opportunityStatuses");
	const tt = useTranslations("temperatures");
	const format = useFormatter();
	const formatBaht = useFormatBaht();
	const trpc = useTRPC();
	const overview = useQuery(
		trpc.overview.get.queryOptions(undefined, { refetchInterval: 60_000 }),
	);
	if (!overview.data) return <Spinner />;
	const { leads, opportunities } = overview.data;
	const pct = (v: number | null) =>
		v === null ? "—" : format.number(v, { style: "percent" });
	const money = (v: number | null) => (v === null ? "—" : formatBaht(v));

	return (
		<div className="grid gap-6 xl:grid-cols-2">
			<PipelineSection
				kind="lead"
				id="overview-leads"
				title={t("leads.title")}
				cards={(["new", "attempting", "connected", "qualified"] as const).map(
					(s) => ({
						label: tls(s),
						value: leads.byStatus[s],
						href: leadsLink(s),
					}),
				)}
			>
				<StatLine
					label={t("thisMonth")}
					items={[
						t("leads.received", { count: leads.thisMonth.received }),
						t("leads.converted", { count: leads.thisMonth.converted }),
						t("leads.disqualified", { count: leads.thisMonth.disqualified }),
					]}
				/>
				<StatLine
					label={t("rates")}
					items={[
						t("leads.contactRate", { rate: pct(leads.rates.contact) }),
						t("leads.qualifyRate", { rate: pct(leads.rates.qualify) }),
						t("leads.conversionRate", { rate: pct(leads.rates.conversion) }),
					]}
				/>
			</PipelineSection>

			<PipelineSection
				kind="opportunity"
				id="overview-opportunities"
				title={t("opportunities.title")}
				cards={(
					[
						"visited",
						"negotiating",
						"deposited",
						"contracted",
						"waiting_mortgage_result",
					] as const
				).map((s) => ({
					label: tos(s),
					value: opportunities.byStatus[s],
					href: opportunitiesLink(s),
				}))}
			>
				<StatLine
					label={`${tt("hot")} / ${tt("warm")}`}
					items={[
						t("opportunities.hot", { count: opportunities.temperature.hot }),
						t("opportunities.warm", { count: opportunities.temperature.warm }),
					]}
				/>
				<StatLine
					label={t("thisMonth")}
					items={[
						t("opportunities.visits", {
							count: opportunities.thisMonth.visits,
						}),
						t("opportunities.deposits", {
							count: opportunities.thisMonth.deposits,
						}),
						t("opportunities.won", { count: opportunities.thisMonth.won }),
						t("opportunities.lost", { count: opportunities.thisMonth.lost }),
					]}
				/>
				<StatLine
					label={t("rates")}
					items={[
						t("opportunities.visitToDeposit", {
							rate: pct(opportunities.rates.visitToDeposit),
						}),
						t("opportunities.winRate", { rate: pct(opportunities.rates.win) }),
					]}
				/>
				<Card size="sm">
					<CardContent className="flex flex-col gap-1">
						<span className="text-muted-foreground text-xs font-medium">
							{t("opportunities.closedWon.title")}
						</span>
						<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
							<span className="text-2xl font-semibold tabular-nums">
								{t("opportunities.closedWon.count", {
									count: opportunities.closedWon.count,
								})}
							</span>
							<span className="tabular-nums">
								{t("opportunities.closedWon.volume", {
									value: money(opportunities.closedWon.volumeSatang),
								})}
							</span>
							<span className="tabular-nums">
								{t("opportunities.closedWon.commission", {
									value: money(opportunities.closedWon.commissionSatang),
								})}
							</span>
						</div>
						{opportunities.closedWon.volumeSatang === null && (
							<span className="text-muted-foreground text-xs">
								{t("opportunities.closedWon.fromM6")}
							</span>
						)}
					</CardContent>
				</Card>
			</PipelineSection>
		</div>
	);
}

const sectionTone = {
	lead: "border-t-4 border-t-lead",
	opportunity: "border-t-4 border-t-opportunity",
} as const;
const cardTone = {
	lead: "bg-lead-muted/60 hover:bg-lead-muted",
	opportunity: "bg-opportunity-muted/60 hover:bg-opportunity-muted",
} as const;

function PipelineSection({
	kind,
	id,
	title,
	cards,
	children,
}: {
	kind: Pipeline;
	id: string;
	title: string;
	cards: { label: string; value: number; href: Route }[];
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className={cn("flex flex-col gap-3 pt-3", sectionTone[kind])}
		>
			<div className="flex items-center gap-2">
				<TypeBadge kind={kind} />
				<h2 id={id} className="text-lg font-semibold">
					{title}
				</h2>
			</div>
			<div
				className={cn(
					"grid grid-cols-2 gap-3",
					cards.length > 4 ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-4",
				)}
			>
				{cards.map((c) => (
					<Link
						key={c.label}
						href={c.href}
						className="block focus-visible:outline-2"
					>
						<Card size="sm" className={cn("h-full", cardTone[kind])}>
							<CardContent className="flex flex-col gap-1">
								<span className="text-muted-foreground text-xs font-medium">
									{c.label}
								</span>
								<span className="text-3xl font-semibold tabular-nums">
									{c.value}
								</span>
							</CardContent>
						</Card>
					</Link>
				))}
			</div>
			{children}
		</section>
	);
}

function StatLine({ label, items }: { label: string; items: string[] }) {
	return (
		<p className="text-sm">
			<span className="text-muted-foreground mr-2">{label}</span>
			<span className="tabular-nums">{items.join(" · ")}</span>
		</p>
	);
}
