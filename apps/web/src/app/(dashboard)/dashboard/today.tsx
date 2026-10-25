"use client";

import { activeStages } from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
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
import { CheckCircle2Icon, LayoutDashboardIcon, PlayIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";

import { useMe, useRoleLabel } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

import { CallMode } from "./call-mode";
import { type TodoLead, TodoRow } from "./todo-row";

type Filter = "all" | "overdue" | "unreachable";

/** Roles that own leads see their work; others keep the welcome card until M7. */
const WORKING_ROLES = ["salesperson", "sales_manager"];

const customersLink = (stages: readonly string[]) =>
	`/customers?ownership=mine&stage=${stages.join(",")}` as Route;

export function Today({ name }: { name: string }) {
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
	const format = useFormatter();
	const trpc = useTRPC();
	// Refetch each minute so expired claims and newly due follow-ups show up.
	const overview = useQuery(
		trpc.today.get.queryOptions(undefined, { refetchInterval: 60_000 }),
	);
	const now = useNow({ updateInterval: 60_000 });
	const [filter, setFilter] = useState<Filter>("all");
	const [calling, setCalling] = useState(false);

	if (!overview.data) return <Spinner />;
	const { stats, todo, unreachableAttempts } = overview.data;
	const isOverdue = (l: TodoLead) =>
		!!l.nextFollowUpAt && new Date(l.nextFollowUpAt) < now;
	const shown = todo.filter((l) =>
		filter === "overdue"
			? isOverdue(l)
			: filter === "unreachable"
				? l.unreachable
				: true,
	);
	const toggle = (f: Filter) => setFilter((v) => (v === f ? "all" : f));

	return (
		<>
			<section aria-label={t("cardsLabel")} className="flex flex-col gap-3">
				<div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
					<StatCard
						label={t("cards.active")}
						value={stats.active}
						hint={t("hints.active")}
						href={customersLink(activeStages)}
					/>
					<StatCard
						label={t("cards.overdue")}
						value={stats.overdue.count}
						hint={
							stats.overdue.oldest
								? t("hints.oldest", {
										relative: format.relativeTime(
											new Date(stats.overdue.oldest),
											now,
										),
									})
								: t("hints.none")
						}
						alert={stats.overdue.count > 0}
						pressed={filter === "overdue"}
						onClick={() => toggle("overdue")}
					/>
					<StatCard
						label={t("cards.unreachable")}
						value={stats.unreachable}
						hint={stats.unreachable > 0 ? t("hints.decide") : t("hints.none")}
						alert={stats.unreachable > 0}
						pressed={filter === "unreachable"}
						onClick={() => toggle("unreachable")}
					/>
					<StatCard
						label={t("cards.qualified")}
						value={stats.qualified}
						hint={t("hints.qualified")}
						href={customersLink(["new", "contacted"])}
					/>
					<StatCard
						label={t("cards.opportunities")}
						value={stats.opportunities}
						hint={t("hints.opportunities")}
						href={customersLink(["visited"])}
					/>
					<StatCard
						label={t("cards.deposited")}
						value={stats.deposited}
						hint={t("hints.deposited")}
						href={customersLink(["deposited", "contracted"])}
					/>
				</div>
			</section>

			<section aria-labelledby="overview-todo" className="flex flex-col gap-3">
				<div className="flex items-center justify-between gap-2">
					<h2 id="overview-todo" className="text-lg font-semibold">
						{t("todo.title", { count: shown.length })}
					</h2>
					<div className="flex gap-2">
						{filter !== "all" && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setFilter("all")}
							>
								{t("todo.showAll")}
							</Button>
						)}
						{shown.length > 0 && (
							<Button size="sm" onClick={() => setCalling(true)}>
								<PlayIcon data-icon="inline-start" />
								{t("todo.start")}
							</Button>
						)}
					</div>
				</div>
				{shown.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CheckCircle2Icon />
							</EmptyMedia>
							<EmptyTitle>{t("todo.emptyTitle")}</EmptyTitle>
							<EmptyDescription>{t("todo.empty")}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="flex flex-col gap-3">
						{shown.map((l) => (
							<li key={l.interestId}>
								<Card size="sm">
									<CardContent className="flex flex-col gap-3">
										<TodoRow
											lead={l}
											now={now}
											unreachableAttempts={unreachableAttempts}
										/>
									</CardContent>
								</Card>
							</li>
						))}
					</ul>
				)}
			</section>
			{calling && (
				<CallMode
					leads={shown}
					now={now}
					unreachableAttempts={unreachableAttempts}
					onClose={() => setCalling(false)}
				/>
			)}
		</>
	);
}

function StatCard({
	label,
	value,
	hint,
	alert,
	href,
	pressed,
	onClick,
}: {
	label: string;
	value: number;
	hint: string;
	alert?: boolean;
	href?: Route;
	pressed?: boolean;
	onClick?: () => void;
}) {
	const body = (
		<Card
			size="sm"
			className={cn(
				"hover:bg-muted/50 h-full transition-colors",
				alert && "bg-destructive/5 ring-destructive/40",
				pressed && "ring-primary ring-2",
			)}
		>
			<CardContent className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs font-medium">
					{label}
				</span>
				<span
					className={cn(
						"text-3xl font-semibold tabular-nums",
						alert && "text-destructive",
					)}
				>
					{value}
				</span>
				<span className="text-muted-foreground truncate text-xs">{hint}</span>
			</CardContent>
		</Card>
	);
	if (href) {
		return (
			<Link href={href} className="block focus-visible:outline-2">
				{body}
			</Link>
		);
	}
	return (
		<button
			type="button"
			aria-pressed={pressed}
			className="block text-left focus-visible:outline-2"
			onClick={onClick}
		>
			{body}
		</button>
	);
}
