"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Field,
	FieldError,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { defaultFollowUp, toDateTimeLocal } from "@/lib/follow-up";
import { useTRPC } from "@/utils/trpc";

export type Target = {
	kind: "lead" | "opportunity";
	id: string;
	nextFollowUpAt?: Date | string | null;
};

type PickKey = "in2h" | "nextWorkingDay" | "in3WorkingDays" | "nextWeek";
const PICKS: PickKey[] = [
	"in2h",
	"nextWorkingDay",
	"in3WorkingDays",
	"nextWeek",
];

/** Short day + time, e.g. "Mon 3 Nov 10:00". */
export function useShortTime() {
	const format = useFormatter();
	return (d: Date) =>
		format.dateTime(d, {
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
}

/**
 * Next follow-up: free date and time (today or later), plus quick picks that
 * the server places inside the project's office hours.
 */
export function useFollowUp(
	target: Target,
	suggest: PickKey | "current",
	submitted: boolean,
) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const shortTime = useShortTime();
	const leadPicks = useQuery(
		trpc.lead.followUpPicks.queryOptions(
			{ leadId: target.id },
			{ enabled: target.kind === "lead" },
		),
	);
	const opportunityPicks = useQuery(
		trpc.opportunity.followUpPicks.queryOptions(
			{ opportunityId: target.id },
			{ enabled: target.kind === "opportunity" },
		),
	);
	const picks = target.kind === "lead" ? leadPicks.data : opportunityPicks.data;
	const [chosen, setChosen] = useState<string | null>(null);
	const pickValue = (key: PickKey) => {
		const at = picks?.[key];
		return at ? toDateTimeLocal(new Date(at)) : null;
	};
	const current = target.nextFollowUpAt
		? new Date(target.nextFollowUpAt)
		: null;
	const suggested =
		suggest === "current"
			? current && current.getTime() > Date.now()
				? toDateTimeLocal(current)
				: pickValue("nextWorkingDay")
			: pickValue(suggest);
	const value = chosen ?? suggested ?? defaultFollowUp();
	const date = new Date(value);
	const valid = !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
	const invalid = submitted && !valid;

	const field = (
		<Field data-invalid={invalid || undefined}>
			<FieldLabel htmlFor="follow-up-at">{t("nextFollowUp")}</FieldLabel>
			<div className="grid grid-cols-2 gap-2">
				{PICKS.map((key) => {
					const pick = pickValue(key);
					return (
						<Button
							key={key}
							type="button"
							size="sm"
							variant={pick === value ? "default" : "outline"}
							aria-pressed={pick === value}
							disabled={!pick}
							className="h-auto flex-col items-start py-1.5"
							onClick={() => pick && setChosen(pick)}
						>
							<span>{t(`picks.${key}`)}</span>
							<span className="text-xs font-normal tabular-nums opacity-80">
								{pick ? shortTime(new Date(pick)) : "…"}
							</span>
						</Button>
					);
				})}
			</div>
			<Input
				id="follow-up-at"
				name="nextFollowUpAt"
				type="datetime-local"
				value={value}
				aria-invalid={invalid || undefined}
				onChange={(e) => setChosen(e.target.value)}
			/>
			{invalid && <FieldError>{t("followUpFuture")}</FieldError>}
		</Field>
	);
	return { field, valid, date, label: shortTime(date) };
}
