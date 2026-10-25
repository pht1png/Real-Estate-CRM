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
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

const fields = [
	{ key: "reEnquiryWindowDays", min: 1, max: 730 },
	{ key: "preScoreTimelineMonths", min: 1, max: 24 },
	{ key: "claimCap", min: 1, max: 50 },
	{ key: "deadlineRollHours", min: 0, max: 8 },
	{ key: "unreachableAttempts", min: 1, max: 20 },
	{ key: "unreachableWindowDays", min: 1, max: 60 },
	{ key: "nurtureCheckDays", min: 1, max: 365 },
] as const;
type Key = (typeof fields)[number]["key"];

export function RulesSettings() {
	const t = useTranslations("rules");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const rules = useQuery(trpc.rules.get.queryOptions());
	const [edits, setEdits] = useState<Partial<Record<Key, string>>>({});
	const update = useMutation(
		trpc.rules.update.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				setEdits({});
				await queryClient.invalidateQueries(trpc.rules.pathFilter());
			},
			onError: (e) => toast.error(e.message),
		}),
	);

	if (!rules.data) return <Spinner />;
	const { rules: current, defaults } = rules.data;
	const values = Object.fromEntries(
		fields.map(({ key }) => [key, edits[key] ?? String(current[key])]),
	) as Record<Key, string>;
	const valid = fields.every(({ key, min, max }) => {
		const n = Number(values[key]);
		return Number.isInteger(n) && n >= min && n <= max;
	});

	return (
		<Card>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!valid) return;
						update.mutate(
							Object.fromEntries(
								fields.map(({ key }) => [key, Number(values[key])]),
							) as Record<Key, number>,
						);
					}}
				>
					<FieldGroup className="max-w-md">
						{fields.map(({ key, min, max }) => (
							<Field key={key}>
								<FieldLabel htmlFor={`rule-${key}`}>{t(key)}</FieldLabel>
								<Input
									id={`rule-${key}`}
									type="number"
									min={min}
									max={max}
									value={values[key]}
									onChange={(e) =>
										setEdits((v) => ({ ...v, [key]: e.target.value }))
									}
								/>
								<FieldDescription>
									{t("default", { value: defaults[key] })}
								</FieldDescription>
							</Field>
						))}
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
