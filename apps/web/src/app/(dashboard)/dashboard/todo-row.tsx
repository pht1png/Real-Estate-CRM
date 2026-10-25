"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { LeadActions, UnreachablePrompt } from "@/components/lead-actions";

export type TodoLead =
	inferRouterOutputs<AppRouter>["today"]["get"]["todo"][number];

/** Why the lead is on the list, and how urgent it is. */
export function ReasonLine({
	lead: l,
	now,
	unreachableAttempts,
}: {
	lead: TodoLead;
	now: Date;
	unreachableAttempts: number;
}) {
	const t = useTranslations("overview.reasons");
	const format = useFormatter();
	const relative = (d: Date | string) => format.relativeTime(new Date(d), now);
	const time = (d: Date | string) =>
		format.dateTime(new Date(d), { timeStyle: "short" });
	const tries =
		l.attempts > 0
			? ` · ${t("tries", { attempts: l.attempts, max: unreachableAttempts })}`
			: "";

	if (l.reason === "first_contact" && l.contactDeadlineAt) {
		const late = new Date(l.contactDeadlineAt) <= now;
		return (
			<p className={cn("text-sm", late && "text-destructive font-medium")}>
				{t(late ? "firstContactLate" : "firstContact", {
					time: time(l.contactDeadlineAt),
					relative: relative(l.contactDeadlineAt),
				})}
				{tries}
			</p>
		);
	}
	if (l.reason === "no_follow_up") {
		return <p className="text-destructive text-sm">{t("noFollowUp")}</p>;
	}
	if (!l.nextFollowUpAt) return null;
	const overdue = new Date(l.nextFollowUpAt) < now;
	return (
		<p className={cn("text-sm", overdue && "text-destructive font-medium")}>
			{t(overdue ? "overdue" : "due", { relative: relative(l.nextFollowUpAt) })}
			{tries}
		</p>
	);
}

export function TodoRow({
	lead: l,
	now,
	unreachableAttempts,
	onDone,
	size,
}: {
	lead: TodoLead;
	now: Date;
	unreachableAttempts: number;
	onDone?: () => void;
	size?: "default" | "lg";
}) {
	const tc = useTranslations("customers");
	return (
		<>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<Link
						href={`/customers/${l.customerId}` as Route}
						className={cn(
							"font-medium underline-offset-4 hover:underline",
							size === "lg" && "text-xl",
						)}
					>
						{l.customerName}
					</Link>
					<p className="text-muted-foreground truncate text-sm">
						{l.projectName}
						{l.primaryPhone && ` · ${l.primaryPhone}`}
					</p>
				</div>
				{l.priority && <Badge>{tc("priority")}</Badge>}
			</div>
			<ReasonLine
				lead={l}
				now={now}
				unreachableAttempts={unreachableAttempts}
			/>
			{l.unreachable && (
				<UnreachablePrompt lead={l} attempts={l.attempts} onDone={onDone} />
			)}
			<LeadActions lead={l} onDone={onDone} size={size} />
		</>
	);
}
