"use client";

import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@Real-Estate-CRM/ui/components/empty";
import { Field, FieldLabel } from "@Real-Estate-CRM/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import {
	Tabs,
	TabsList,
	TabsTrigger,
} from "@Real-Estate-CRM/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { InboxIcon, TimerResetIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { ClaimButton } from "@/components/lead-actions";
import { useCan } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

const ALL = "all";

/**
 * Unclaimed leads in my projects (brief §6), told apart by status. New:
 * priority first, then the longest waiting. Nurturing: leads moved to
 * nurture, the longest untouched first; anyone can claim them again.
 */
export function PoolList() {
	const t = useTranslations("pool");
	const tc = useTranslations("common");
	const tcust = useTranslations("contacts");
	const format = useFormatter();
	const now = useNow({ updateInterval: 60_000 });
	const can = useCan();
	const trpc = useTRPC();
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const projectId = params.get("project") ?? ALL;
	const tab = params.get("tab") === "nurturing" ? "nurturing" : "new";
	const nurturing = tab === "nurturing";
	/** Keeps the other filter when one changes. */
	const sync = (key: "project" | "tab", value: string) => {
		const next = new URLSearchParams(params);
		if (value === ALL || value === "new") next.delete(key);
		else next.set(key, value);
		const qs = next.toString();
		router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, {
			scroll: false,
		});
	};

	const projects = useQuery(trpc.project.list.queryOptions());
	const pool = useQuery(
		trpc.pool.list.queryOptions(
			{ projectId: projectId === ALL ? undefined : projectId, tab },
			{ refetchInterval: 60_000 },
		),
	);
	const items = [
		{ value: ALL, label: tc("all") },
		...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
	];

	return (
		<>
			<Tabs value={tab} onValueChange={(v) => sync("tab", String(v))}>
				<TabsList>
					<TabsTrigger value="new">{t("tabs.new")}</TabsTrigger>
					<TabsTrigger value="nurturing">{t("tabs.nurturing")}</TabsTrigger>
				</TabsList>
			</Tabs>
			<Field className="max-w-xs">
				<FieldLabel htmlFor="pool-project">{t("project")}</FieldLabel>
				<Select
					items={items}
					value={projectId}
					onValueChange={(v) => {
						if (v) sync("project", v);
					}}
				>
					<SelectTrigger id="pool-project">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{items.map((i) => (
								<SelectItem key={i.value} value={i.value}>
									{i.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>

			{!pool.data ? (
				<Spinner />
			) : pool.data.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							{nurturing ? <TimerResetIcon /> : <InboxIcon />}
						</EmptyMedia>
						<EmptyTitle>
							{t(nurturing ? "nurturingEmptyTitle" : "emptyTitle")}
						</EmptyTitle>
						<EmptyDescription>
							{t(nurturing ? "nurturingEmpty" : "empty")}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul
					className="flex flex-col gap-3"
					aria-label={nurturing ? t("tabs.nurturing") : t("title")}
				>
					{pool.data.map((l) => (
						<li key={l.leadId}>
							<Card size="sm">
								<CardContent className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<Link
												href={`/contacts/${l.contactId}` as Route}
												className="truncate font-medium underline-offset-4 hover:underline"
											>
												{l.contactName}
											</Link>
											{l.priority && <Badge>{tcust("priority")}</Badge>}
										</div>
										<p className="text-muted-foreground truncate text-sm">
											{l.projectName} · {l.sourceName}
											{l.campaignCode && ` · ${l.campaignCode}`}
										</p>
										<p className="text-muted-foreground text-xs tabular-nums">
											{nurturing && l.nurturedAt
												? l.previousOwnerName
													? t("nurtured", {
															relative: format.relativeTime(
																new Date(l.nurturedAt),
																now,
															),
															owner: l.previousOwnerName,
														})
													: t("nurturedNoOwner", {
															relative: format.relativeTime(
																new Date(l.nurturedAt),
																now,
															),
														})
												: t("waiting", {
														relative: format.relativeTime(
															new Date(l.createdAt),
															now,
														),
													})}
										</p>
										{nurturing && l.nurtureNote && (
											<p className="text-sm whitespace-pre-wrap">
												{l.nurtureNote}
											</p>
										)}
									</div>
									{can({ lead: ["claim"] }) && (
										<ClaimButton leadId={l.leadId} />
									)}
								</CardContent>
							</Card>
						</li>
					))}
				</ul>
			)}
		</>
	);
}
