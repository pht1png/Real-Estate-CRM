"use client";

import {
	type LeadStatus,
	leadStatuses,
	type OpportunityStage,
	opportunityStages,
} from "@Real-Estate-CRM/db/constants";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "@Real-Estate-CRM/ui/components/empty";
import { Field, FieldLabel } from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import {
	Tabs,
	TabsList,
	TabsTrigger,
} from "@Real-Estate-CRM/ui/components/tabs";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { useTRPC } from "@/utils/trpc";

const ALL = "all";
type Pipeline = "leads" | "deals";

function FilterSelect({
	id,
	label,
	value,
	onChange,
	items,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	items: { value: string; label: string }[];
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={items}
				value={value}
				onValueChange={(v) => v && onChange(v)}
			>
				<SelectTrigger id={id}>
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
	);
}

/** Comma-separated values from the URL that belong to `allowed`, or ALL. */
function listParam(raw: string | null, allowed: readonly string[]) {
	const valid = (raw ?? "").split(",").filter((v) => allowed.includes(v));
	return valid.length ? valid.join(",") : ALL;
}

/** Status/stage options, plus a combined one when a link asked for several. */
function statusItems(
	value: string,
	all: readonly string[],
	label: (v: string) => string,
	allLabel: string,
) {
	const items = [
		{ value: ALL, label: allLabel },
		...all.map((s) => ({ value: s, label: label(s) })),
	];
	if (value.includes(",")) {
		items.push({ value, label: value.split(",").map(label).join(" + ") });
	}
	return items;
}

/**
 * Two pipelines (brief §2): Leads (vetting queue) and Deals (after a
 * confirmed visit). Filters live in the URL so links (e.g. Overview cards)
 * can open them.
 */
export function CustomerList() {
	const t = useTranslations("customers");
	const tls = useTranslations("leadStatuses");
	const tos = useTranslations("opportunityStages");
	const tc = useTranslations("common");
	const format = useFormatter();
	const trpc = useTRPC();
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const [pipeline, setPipeline] = useState<Pipeline>(
		params.get("pipeline") === "deals" ? "deals" : "leads",
	);
	const [query, setQuery] = useState(params.get("q") ?? "");
	const [projectId, setProjectId] = useState(params.get("project") ?? ALL);
	const [status, setStatus] = useState(() =>
		listParam(params.get("status"), leadStatuses),
	);
	const [stage, setStage] = useState(() =>
		listParam(params.get("stage"), opportunityStages),
	);
	const [ownership, setOwnership] = useState<"all" | "mine" | "pool">(() => {
		const v = params.get("ownership");
		return v === "mine" || v === "pool" ? v : "all";
	});
	const deferredQuery = useDeferredValue(query);
	const sync = (changes: Record<string, string>) => {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(changes)) {
			if (!value || value === ALL || (key === "pipeline" && value === "leads"))
				next.delete(key);
			else next.set(key, value);
		}
		const qs = next.toString();
		router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, {
			scroll: false,
		});
	};

	const projects = useQuery(trpc.project.list.queryOptions());
	const common = {
		query: deferredQuery.trim() || undefined,
		projectId: projectId === ALL ? undefined : projectId,
	};
	const leads = useQuery(
		trpc.lead.list.queryOptions(
			{
				...common,
				statuses:
					status === ALL ? undefined : (status.split(",") as LeadStatus[]),
				ownership,
			},
			{ placeholderData: keepPreviousData, enabled: pipeline === "leads" },
		),
	);
	const deals = useQuery(
		trpc.opportunity.list.queryOptions(
			{
				...common,
				stages:
					stage === ALL ? undefined : (stage.split(",") as OpportunityStage[]),
				ownership: ownership === "pool" ? "all" : ownership,
			},
			{ placeholderData: keepPreviousData, enabled: pipeline === "deals" },
		),
	);
	const dateTime = (d: Date | string | null) =>
		d
			? format.dateTime(new Date(d), {
					dateStyle: "medium",
					timeStyle: "short",
				})
			: tc("none");
	const nameCell = (customerId: string, name: string, priority = false) => (
		<TableCell className="font-medium">
			<Link
				href={`/customers/${customerId}` as Route}
				className="underline-offset-4 hover:underline"
			>
				{name}
			</Link>
			{priority && (
				<Badge className="ml-2" variant="secondary">
					{t("priority")}
				</Badge>
			)}
		</TableCell>
	);
	const empty = (
		<Empty className="border">
			<EmptyHeader>
				<EmptyDescription>{t("empty")}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);

	return (
		<>
			<Tabs
				value={pipeline}
				onValueChange={(v) => {
					const next = v === "deals" ? "deals" : "leads";
					setPipeline(next);
					sync({ pipeline: next });
				}}
			>
				<TabsList>
					<TabsTrigger value="leads">{t("pipelines.leads")}</TabsTrigger>
					<TabsTrigger value="deals">{t("pipelines.deals")}</TabsTrigger>
				</TabsList>
			</Tabs>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<Field>
					<FieldLabel htmlFor="lead-search">{t("search")}</FieldLabel>
					<Input
						id="lead-search"
						type="search"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							sync({ q: e.target.value.trim() });
						}}
					/>
				</Field>
				<FilterSelect
					id="lead-project"
					label={t("project")}
					value={projectId}
					onChange={(v) => {
						setProjectId(v);
						sync({ project: v });
					}}
					items={[
						{ value: ALL, label: tc("all") },
						...(projects.data ?? []).map((p) => ({
							value: p.id,
							label: p.name,
						})),
					]}
				/>
				{pipeline === "leads" ? (
					<FilterSelect
						id="lead-status"
						label={t("status")}
						value={status}
						onChange={(v) => {
							setStatus(v);
							sync({ status: v });
						}}
						items={statusItems(
							status,
							leadStatuses,
							(s) => tls(s as LeadStatus),
							tc("all"),
						)}
					/>
				) : (
					<FilterSelect
						id="deal-stage"
						label={t("stage")}
						value={stage}
						onChange={(v) => {
							setStage(v);
							sync({ stage: v });
						}}
						items={statusItems(
							stage,
							opportunityStages,
							(s) => tos(s as OpportunityStage),
							tc("all"),
						)}
					/>
				)}
				<FilterSelect
					id="lead-ownership"
					label={t("ownership")}
					value={ownership}
					onChange={(v) => {
						setOwnership(v as typeof ownership);
						sync({ ownership: v });
					}}
					items={[
						{ value: "all", label: t("ownershipAll") },
						{ value: "mine", label: t("ownershipMine") },
						...(pipeline === "leads"
							? [{ value: "pool", label: t("ownershipPool") }]
							: []),
					]}
				/>
			</div>

			{pipeline === "leads" ? (
				leads.isSuccess && leads.data.length === 0 ? (
					empty
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("name")}</TableHead>
									<TableHead>{t("phone")}</TableHead>
									<TableHead>{t("project")}</TableHead>
									<TableHead>{t("status")}</TableHead>
									<TableHead>{t("ownership")}</TableHead>
									<TableHead>{t("followUp")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{leads.data?.map((l) => (
									<TableRow key={l.leadId}>
										{nameCell(l.customerId, l.customerName, l.priority)}
										<TableCell>{l.primaryPhone}</TableCell>
										<TableCell>{l.projectName}</TableCell>
										<TableCell>{tls(l.status)}</TableCell>
										<TableCell>{l.ownerName ?? t("ownershipPool")}</TableCell>
										<TableCell>{dateTime(l.nextFollowUpAt)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)
			) : deals.isSuccess && deals.data.length === 0 ? (
				empty
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("name")}</TableHead>
								<TableHead>{t("phone")}</TableHead>
								<TableHead>{t("project")}</TableHead>
								<TableHead>{t("stage")}</TableHead>
								<TableHead>{t("ownership")}</TableHead>
								<TableHead>{t("lastVisit")}</TableHead>
								<TableHead>{t("followUp")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{deals.data?.map((d) => (
								<TableRow key={d.opportunityId}>
									{nameCell(d.customerId, d.customerName)}
									<TableCell>{d.primaryPhone}</TableCell>
									<TableCell>{d.projectName}</TableCell>
									<TableCell>{tos(d.stage)}</TableCell>
									<TableCell>{d.ownerName}</TableCell>
									<TableCell>{dateTime(d.lastVisitAt)}</TableCell>
									<TableCell>{dateTime(d.nextFollowUpAt)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
