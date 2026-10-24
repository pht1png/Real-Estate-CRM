"use client";

import {
	type OfficeHours,
	type Weekday,
	weekdays,
} from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import {
	FieldDescription,
	FieldGroup,
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

/** One open–close interval per weekday, in the project's time zone. */
export function HoursTab({ project }: { project: ProjectDetail }) {
	const t = useTranslations("projectSettings");
	const tw = useTranslations("weekdays");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const [hours, setHours] = useState<OfficeHours>(project.officeHours);

	const update = useMutation(
		trpc.project.update.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				await invalidate();
			},
			onError,
		}),
	);

	const set = (day: Weekday, value: OfficeHours[Weekday]) =>
		setHours((h) => ({ ...h, [day]: value }));
	const valid = weekdays.every((d) => {
		const i = hours[d];
		return !i || i.close > i.open;
	});

	return (
		<Card>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (valid)
							update.mutate({ projectId: project.id, officeHours: hours });
					}}
				>
					<FieldGroup className="max-w-xl">
						<FieldDescription>{t("hoursHint")}</FieldDescription>
						{weekdays.map((day) => {
							const interval = hours[day];
							const invalid = !!interval && interval.close <= interval.open;
							return (
								<div
									key={day}
									className="grid grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[10rem_auto_1fr]"
								>
									<div className="flex items-center gap-2">
										<Checkbox
											id={`open-${day}`}
											checked={!!interval}
											onCheckedChange={(checked) =>
												set(
													day,
													checked ? { open: "09:00", close: "18:00" } : null,
												)
											}
										/>
										<Label htmlFor={`open-${day}`}>{tw(day)}</Label>
									</div>
									{interval ? (
										<div className="col-span-2 flex items-center gap-2 sm:col-span-1">
											<Input
												type="time"
												aria-label={`${tw(day)} ${t("opens")}`}
												value={interval.open}
												aria-invalid={invalid || undefined}
												onChange={(e) =>
													set(day, { ...interval, open: e.target.value })
												}
												className="w-32"
											/>
											<span aria-hidden>–</span>
											<Input
												type="time"
												aria-label={`${tw(day)} ${t("closes")}`}
												value={interval.close}
												aria-invalid={invalid || undefined}
												onChange={(e) =>
													set(day, { ...interval, close: e.target.value })
												}
												className="w-32"
											/>
										</div>
									) : (
										<span className="text-muted-foreground text-sm">
											{t("closed")}
										</span>
									)}
								</div>
							);
						})}
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
