"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import { useMutation } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { useTRPC } from "@/utils/trpc";

import {
	type ProjectDetail,
	useInvalidateProject,
	useMutationError,
} from "./shared";

export function ClosedDatesTab({ project }: { project: ProjectDetail }) {
	const t = useTranslations("projectSettings");
	const tc = useTranslations("common");
	const format = useFormatter();
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const [date, setDate] = useState("");
	const [note, setNote] = useState("");

	const add = useMutation(
		trpc.project.addClosedDate.mutationOptions({
			onSuccess: async () => {
				setDate("");
				setNote("");
				await invalidate();
			},
			onError,
		}),
	);
	const remove = useMutation(
		trpc.project.removeClosedDate.mutationOptions({
			onSuccess: invalidate,
			onError,
		}),
	);

	return (
		<Card>
			<CardContent className="flex flex-col gap-6">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (date) {
							add.mutate({
								projectId: project.id,
								date,
								note: note.trim() || undefined,
							});
						}
					}}
				>
					<FieldGroup className="sm:flex-row sm:items-end">
						<Field className="sm:w-auto">
							<FieldLabel htmlFor="closed-date">{t("date")}</FieldLabel>
							<Input
								id="closed-date"
								type="date"
								value={date}
								onChange={(e) => setDate(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="closed-note">{t("note")}</FieldLabel>
							<Input
								id="closed-note"
								value={note}
								maxLength={120}
								onChange={(e) => setNote(e.target.value)}
							/>
						</Field>
						<Button
							type="submit"
							className="sm:w-auto"
							disabled={!date || add.isPending}
						>
							{tc("add")}
						</Button>
					</FieldGroup>
					<FieldDescription className="mt-2">
						{t("closedHint")}
					</FieldDescription>
				</form>
				{project.closedDates.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t("noClosedDates")}</p>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("date")}</TableHead>
								<TableHead>{t("note")}</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{project.closedDates.map((d) => (
								<TableRow key={d.date}>
									<TableCell>
										{/* Thai locale formats in the Buddhist era by default. */}
										{format.dateTime(new Date(`${d.date}T00:00:00`), {
											dateStyle: "full",
										})}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{d.note}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												remove.mutate({ projectId: project.id, date: d.date })
											}
										>
											{tc("remove")}
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
