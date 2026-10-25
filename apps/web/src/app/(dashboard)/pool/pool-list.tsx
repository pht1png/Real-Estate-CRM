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
import { useQuery } from "@tanstack/react-query";
import { InboxIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";

import { ClaimButton } from "@/components/lead-actions";
import { useCan } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

const ALL = "all";

/** Unclaimed leads in my projects (brief §6): priority first, then the longest waiting. */
export function PoolList() {
	const t = useTranslations("pool");
	const tc = useTranslations("common");
	const tcust = useTranslations("customers");
	const format = useFormatter();
	const now = useNow({ updateInterval: 60_000 });
	const can = useCan();
	const trpc = useTRPC();
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const projectId = params.get("project") ?? ALL;

	const projects = useQuery(trpc.project.list.queryOptions());
	const pool = useQuery(
		trpc.pool.list.queryOptions(
			{ projectId: projectId === ALL ? undefined : projectId },
			{ refetchInterval: 60_000 },
		),
	);
	const items = [
		{ value: ALL, label: tc("all") },
		...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
	];

	return (
		<>
			<Field className="max-w-xs">
				<FieldLabel htmlFor="pool-project">{t("project")}</FieldLabel>
				<Select
					items={items}
					value={projectId}
					onValueChange={(v) => {
						if (!v) return;
						router.replace(
							(v === ALL ? pathname : `${pathname}?project=${v}`) as Route,
							{ scroll: false },
						);
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
							<InboxIcon />
						</EmptyMedia>
						<EmptyTitle>{t("emptyTitle")}</EmptyTitle>
						<EmptyDescription>{t("empty")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex flex-col gap-3" aria-label={t("title")}>
					{pool.data.map((l) => (
						<li key={l.leadId}>
							<Card size="sm">
								<CardContent className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<Link
												href={`/customers/${l.customerId}` as Route}
												className="truncate font-medium underline-offset-4 hover:underline"
											>
												{l.customerName}
											</Link>
											{l.priority && <Badge>{tcust("priority")}</Badge>}
										</div>
										<p className="text-muted-foreground truncate text-sm">
											{l.projectName} · {l.sourceName}
											{l.campaignCode && ` · ${l.campaignCode}`}
										</p>
										<p className="text-muted-foreground text-xs tabular-nums">
											{t("waiting", {
												relative: format.relativeTime(
													new Date(l.createdAt),
													now,
												),
											})}
										</p>
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
