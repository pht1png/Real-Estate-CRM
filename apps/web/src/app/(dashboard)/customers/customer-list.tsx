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
	const [query, setQuery] = useState("");
	const [projectId, setProjectId] = useState(ALL);
	const [stage, setStage] = useState(ALL);
	const [ownership, setOwnership] = useState<"all" | "mine" | "pool">("all");
	const deferredQuery = useDeferredValue(query);

	const projects = useQuery(trpc.project.list.queryOptions());
	const leads = useQuery(
		trpc.lead.list.queryOptions(
			{
				query: deferredQuery.trim() || undefined,
				projectId: projectId === ALL ? undefined : projectId,
				stage: stage === ALL ? undefined : (stage as InterestStage),
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
						onChange={(e) => setQuery(e.target.value)}
					/>
				</Field>
				<FilterSelect
					id="lead-project"
					label={t("project")}
					value={projectId}
					onChange={setProjectId}
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
					onChange={setStage}
					items={[
						{ value: ALL, label: tc("all") },
						...interestStages.map((s) => ({ value: s, label: ts(s) })),
					]}
				/>
				<FilterSelect
					id="lead-ownership"
					label={t("ownership")}
					value={ownership}
					onChange={(v) => setOwnership(v as typeof ownership)}
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
