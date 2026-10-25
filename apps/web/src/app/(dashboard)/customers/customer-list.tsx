"use client";

import {
	type InterestStage,
	interestStages,
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { useTRPC } from "@/utils/trpc";

const ALL = "all";

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

export function CustomerList() {
	const t = useTranslations("customers");
	const ts = useTranslations("stages");
	const tc = useTranslations("common");
	const format = useFormatter();
	const trpc = useTRPC();
	// Filters live in the URL so links (e.g. Overview cards) can open them.
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const [query, setQuery] = useState(params.get("q") ?? "");
	const [projectId, setProjectId] = useState(params.get("project") ?? ALL);
	const [stage, setStage] = useState(() => {
		const valid = (params.get("stage") ?? "")
			.split(",")
			.filter((v): v is InterestStage =>
				(interestStages as readonly string[]).includes(v),
			);
		return valid.length ? valid.join(",") : ALL;
	});
	const [ownership, setOwnership] = useState<"all" | "mine" | "pool">(() => {
		const v = params.get("ownership");
		return v === "mine" || v === "pool" ? v : "all";
	});
	const deferredQuery = useDeferredValue(query);
	const sync = (changes: Record<string, string>) => {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(changes)) {
			if (!value || value === ALL) next.delete(key);
			else next.set(key, value);
		}
		const qs = next.toString();
		router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, {
			scroll: false,
		});
	};
	const stageItems = [
		{ value: ALL, label: tc("all") },
		...interestStages.map((s) => ({ value: s, label: ts(s) })),
	];
	// A combined filter from a link (e.g. deposited + contracted).
	if (stage.includes(",")) {
		stageItems.push({
			value: stage,
			label: stage
				.split(",")
				.map((s) => ts(s as InterestStage))
				.join(" + "),
		});
	}

	const projects = useQuery(trpc.project.list.queryOptions());
	const leads = useQuery(
		trpc.lead.list.queryOptions(
			{
				query: deferredQuery.trim() || undefined,
				projectId: projectId === ALL ? undefined : projectId,
				stages:
					stage === ALL ? undefined : (stage.split(",") as InterestStage[]),
				ownership,
			},
			{ placeholderData: keepPreviousData },
		),
	);

	return (
		<>
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
				<FilterSelect
					id="lead-stage"
					label={t("stage")}
					value={stage}
					onChange={(v) => {
						setStage(v);
						sync({ stage: v });
					}}
					items={stageItems}
				/>
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
						{ value: "pool", label: t("ownershipPool") },
					]}
				/>
			</div>

			{leads.isSuccess && leads.data.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyDescription>{t("empty")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
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
								<TableHead>{t("followUp")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{leads.data?.map((l) => (
								<TableRow key={l.interestId}>
									<TableCell className="font-medium">
										<Link
											href={`/customers/${l.customerId}` as Route}
											className="underline-offset-4 hover:underline"
										>
											{l.customerName}
										</Link>
										{l.priority && (
											<Badge className="ml-2" variant="secondary">
												{t("priority")}
											</Badge>
										)}
									</TableCell>
									<TableCell>{l.primaryPhone}</TableCell>
									<TableCell>{l.projectName}</TableCell>
									<TableCell>{ts(l.stage)}</TableCell>
									<TableCell>{l.ownerName ?? t("ownershipPool")}</TableCell>
									<TableCell>
										{l.nextFollowUpAt
											? format.dateTime(new Date(l.nextFollowUpAt), {
													dateStyle: "medium",
													timeStyle: "short",
												})
											: tc("none")}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
