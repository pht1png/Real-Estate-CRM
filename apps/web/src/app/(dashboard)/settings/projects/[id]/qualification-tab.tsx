"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Label } from "@Real-Estate-CRM/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

import {
	type ProjectDetail,
	useInvalidateProject,
	useMutationError,
} from "./shared";

/**
 * Qualification check (brief §6): budget tolerance and timeline window decide
 * the fit the system suggests; auto-qualify is opt-in, disqualify never automatic.
 */
export function QualificationTab({ project }: { project: ProjectDetail }) {
	const t = useTranslations("projectSettings.qualification");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const rules = project.qualificationRules;
	const [tolerance, setTolerance] = useState(String(rules.budgetTolerancePct));
	const [months, setMonths] = useState(String(rules.qualifyWithinMonths));
	const [auto, setAuto] = useState(rules.autoQualify);
	const update = useMutation(
		trpc.project.update.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				await invalidate();
			},
			onError,
		}),
	);
	const toleranceN = Number(tolerance);
	const monthsN = Number(months);
	const valid =
		Number.isInteger(toleranceN) &&
		toleranceN >= 0 &&
		toleranceN <= 50 &&
		Number.isInteger(monthsN) &&
		monthsN >= 1 &&
		monthsN <= 36;

	return (
		<Card>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!valid) return;
						update.mutate({
							projectId: project.id,
							qualificationRules: {
								budgetTolerancePct: toleranceN,
								qualifyWithinMonths: monthsN,
								autoQualify: auto,
							},
						});
					}}
				>
					<FieldGroup className="max-w-md">
						<p className="text-muted-foreground text-sm">{t("intro")}</p>
						<Field>
							<FieldLabel htmlFor="q-tolerance">{t("tolerance")}</FieldLabel>
							<Input
								id="q-tolerance"
								type="number"
								min={0}
								max={50}
								value={tolerance}
								onChange={(e) => setTolerance(e.target.value)}
							/>
							<FieldDescription>{t("toleranceHint")}</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="q-months">{t("months")}</FieldLabel>
							<Input
								id="q-months"
								type="number"
								min={1}
								max={36}
								value={months}
								onChange={(e) => setMonths(e.target.value)}
							/>
							<FieldDescription>{t("monthsHint")}</FieldDescription>
						</Field>
						<div className="flex items-start gap-2">
							<Checkbox
								id="q-auto"
								checked={auto}
								onCheckedChange={(c) => setAuto(!!c)}
							/>
							<div className="flex flex-col gap-1">
								<Label htmlFor="q-auto">{t("auto")}</Label>
								<p className="text-muted-foreground text-sm">{t("autoHint")}</p>
							</div>
						</div>
						<Button
							type="submit"
							className="sm:w-auto sm:self-start"
							disabled={!valid || update.isPending}
						>
							{tc("save")}
						</Button>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
