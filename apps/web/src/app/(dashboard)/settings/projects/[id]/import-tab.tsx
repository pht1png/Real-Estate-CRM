"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Alert, AlertDescription } from "@Real-Estate-CRM/ui/components/alert";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Label } from "@Real-Estate-CRM/ui/components/label";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { useInvalidateProject, useMutationError } from "./shared";

type Preview = inferRouterOutputs<AppRouter>["unit"]["importPreview"];

/**
 * Reads a CSV file as text. Excel "CSV UTF-8" is UTF-8 (often with a BOM);
 * plain "CSV" on Thai Windows is Windows-874 (TIS-620), so fall back to that.
 */
async function readCsv(file: File) {
	const bytes = await file.arrayBuffer();
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("windows-874").decode(bytes);
	}
}

export function ImportTab({ projectId }: { projectId: string }) {
	const t = useTranslations("unitImport");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const formatBaht = useFormatBaht();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const [csv, setCsv] = useState<string | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [onlyErrors, setOnlyErrors] = useState(false);

	const previewMutation = useMutation(
		trpc.unit.importPreview.mutationOptions({ onSuccess: setPreview, onError }),
	);
	const commit = useMutation(
		trpc.unit.importCommit.mutationOptions({
			onSuccess: async (result) => {
				toast.success(t("imported", result));
				setCsv(null);
				setPreview(null);
				await invalidate();
			},
			onError,
		}),
	);

	async function downloadTemplate() {
		const text = await queryClient.fetchQuery(
			trpc.unit.importTemplate.queryOptions(),
		);
		// BOM so Excel opens the UTF-8 file with Thai text intact.
		const blob = new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "units-template.csv";
		a.click();
		URL.revokeObjectURL(url);
	}

	const tCol = (col: string) => t(`columns.${col}` as "columns.section");
	const errorText = (e: Preview["rows"][number]["errors"][number]) =>
		t(`codes.${e.code}`, { field: tCol(e.field) });
	const rows =
		preview?.rows.filter((r) => !onlyErrors || r.errors.length > 0) ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("title")}</h2>
				</CardTitle>
				<CardDescription>{t("description")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<FieldGroup className="sm:flex-row sm:items-end">
					<Field>
						<FieldLabel htmlFor="import-file">{t("chooseFile")}</FieldLabel>
						<Input
							id="import-file"
							type="file"
							accept=".csv,text/csv"
							onChange={async (e) => {
								const file = e.target.files?.[0];
								setPreview(null);
								setCsv(file ? await readCsv(file) : null);
							}}
						/>
					</Field>
					<Button
						className="sm:w-auto"
						disabled={!csv || previewMutation.isPending}
						onClick={() => csv && previewMutation.mutate({ projectId, csv })}
					>
						{previewMutation.isPending && <Spinner data-icon="inline-start" />}
						{t("preview")}
					</Button>
					<Button
						variant="outline"
						className="sm:w-auto"
						onClick={downloadTemplate}
					>
						{t("template")}
					</Button>
				</FieldGroup>

				{preview && (
					<>
						{preview.missingColumns.length > 0 && (
							<Alert variant="destructive">
								<AlertDescription>
									{t("missingColumns", {
										columns: preview.missingColumns.map(tCol).join(", "),
									})}
								</AlertDescription>
							</Alert>
						)}
						{preview.unknownHeaders.length > 0 && (
							<p className="text-muted-foreground text-sm">
								{t("unknownHeaders", {
									columns: preview.unknownHeaders.join(", "),
								})}
							</p>
						)}
						<p className="font-medium">
							{t("summary", {
								valid: preview.validCount,
								errors: preview.errorCount,
							})}
						</p>
						{(preview.newSections.length > 0 ||
							preview.newUnitTypes.length > 0 ||
							preview.newTags.length > 0) && (
							<div className="text-sm">
								<p className="font-medium">{t("willCreate")}</p>
								<ul className="text-muted-foreground list-disc pl-5">
									{preview.newSections.length > 0 && (
										<li>
											{t("newSections", {
												names: preview.newSections.join(", "),
											})}
										</li>
									)}
									{preview.newUnitTypes.length > 0 && (
										<li>
											{t("newUnitTypes", {
												names: preview.newUnitTypes.join(", "),
											})}
										</li>
									)}
									{preview.newTags.length > 0 && (
										<li>
											{t("newTags", { names: preview.newTags.join(", ") })}
										</li>
									)}
								</ul>
							</div>
						)}
						<div className="flex items-center gap-2">
							<Checkbox
								id="only-errors"
								checked={onlyErrors}
								onCheckedChange={(c) => setOnlyErrors(!!c)}
							/>
							<Label htmlFor="only-errors">{t("onlyErrors")}</Label>
						</div>
						<div className="max-h-[28rem] overflow-auto rounded border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("line")}</TableHead>
										<TableHead>{tCol("section")}</TableHead>
										<TableHead>{tCol("unitNumber")}</TableHead>
										<TableHead>{tCol("floor")}</TableHead>
										<TableHead>{tCol("unitType")}</TableHead>
										<TableHead>{tCol("listPrice")}</TableHead>
										<TableHead>{t("errors")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{rows.map((r) => (
										<TableRow
											key={r.line}
											data-state={r.errors.length > 0 ? "error" : undefined}
											className="data-[state=error]:bg-destructive/5"
										>
											<TableCell>{r.line}</TableCell>
											<TableCell>{r.section}</TableCell>
											<TableCell>{r.unitNumber}</TableCell>
											<TableCell>{r.floor ?? ""}</TableCell>
											<TableCell>{r.unitType}</TableCell>
											<TableCell>
												{r.listPriceSatang !== null
													? formatBaht(r.listPriceSatang)
													: ""}
											</TableCell>
											<TableCell>
												<div className="flex flex-wrap gap-1">
													{r.errors.map((e) => (
														<Badge
															key={`${e.field}-${e.code}`}
															variant="destructive"
														>
															{errorText(e)}
														</Badge>
													))}
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<Button
							className="sm:w-auto sm:self-start"
							disabled={
								preview.validCount === 0 ||
								preview.missingColumns.length > 0 ||
								commit.isPending
							}
							onClick={() => csv && commit.mutate({ projectId, csv })}
						>
							{commit.isPending && <Spinner data-icon="inline-start" />}
							{t("import", { count: preview.validCount })}
						</Button>
					</>
				)}
			</CardContent>
		</Card>
	);
}
