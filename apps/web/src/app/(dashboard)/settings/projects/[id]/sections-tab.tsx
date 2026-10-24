"use client";

import { type SectionKind, sectionKinds } from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useTRPC } from "@/utils/trpc";

import { useInvalidateProject, useMutationError } from "./shared";

function KindSelect({
	id,
	value,
	onChange,
	label,
}: {
	id?: string;
	value: SectionKind;
	onChange: (kind: SectionKind) => void;
	label?: string;
}) {
	const tk = useTranslations("sectionKinds");
	const items = sectionKinds.map((k) => ({ value: k, label: tk(k) }));
	return (
		<Select
			items={items}
			value={value}
			onValueChange={(v) => v && onChange(v as SectionKind)}
		>
			<SelectTrigger id={id} aria-label={label} className="min-w-32">
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
	);
}

/** Phases, zones or buildings of a project, in display order. */
export function SectionsTab({ projectId }: { projectId: string }) {
	const t = useTranslations("projectSettings");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const sections = useQuery(trpc.section.list.queryOptions({ projectId }));
	const [name, setName] = useState("");
	const [kind, setKind] = useState<SectionKind>("building");

	const options = { onSuccess: invalidate, onError };
	const create = useMutation(
		trpc.section.create.mutationOptions({
			onSuccess: async () => {
				setName("");
				await invalidate();
			},
			onError,
		}),
	);
	const update = useMutation(trpc.section.update.mutationOptions(options));
	const move = useMutation(trpc.section.move.mutationOptions(options));
	const remove = useMutation(trpc.section.delete.mutationOptions(options));
	const rows = sections.data ?? [];

	return (
		<Card>
			<CardContent className="flex flex-col gap-6">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim())
							create.mutate({ projectId, kind, name: name.trim() });
					}}
				>
					<FieldGroup className="sm:flex-row sm:items-end">
						<Field>
							<FieldLabel htmlFor="section-name">{t("sectionName")}</FieldLabel>
							<Input
								id="section-name"
								value={name}
								maxLength={80}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<Field className="sm:w-auto">
							<FieldLabel htmlFor="section-kind">{t("kind")}</FieldLabel>
							<KindSelect id="section-kind" value={kind} onChange={setKind} />
						</Field>
						<Button
							type="submit"
							className="sm:w-auto"
							disabled={create.isPending}
						>
							{tc("add")}
						</Button>
					</FieldGroup>
				</form>
				{rows.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t("noSections")}</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("sectionName")}</TableHead>
								<TableHead>{t("kind")}</TableHead>
								<TableHead>{t("units")}</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((s, i) => (
								<TableRow key={s.id}>
									<TableCell className="font-medium">{s.name}</TableCell>
									<TableCell>
										<KindSelect
											label={`${t("kind")} ${s.name}`}
											value={s.kind}
											onChange={(k) =>
												update.mutate({ sectionId: s.id, kind: k })
											}
										/>
									</TableCell>
									<TableCell>{s.unitCount}</TableCell>
									<TableCell className="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`${tc("moveUp")} ${s.name}`}
											disabled={i === 0 || move.isPending}
											onClick={() =>
												move.mutate({ sectionId: s.id, direction: "up" })
											}
										>
											<ArrowUpIcon />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`${tc("moveDown")} ${s.name}`}
											disabled={i === rows.length - 1 || move.isPending}
											onClick={() =>
												move.mutate({ sectionId: s.id, direction: "down" })
											}
										>
											<ArrowDownIcon />
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`${tc("delete")} ${s.name}`}
											disabled={s.unitCount > 0 || remove.isPending}
											onClick={() => remove.mutate({ sectionId: s.id })}
										>
											<Trash2Icon />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
