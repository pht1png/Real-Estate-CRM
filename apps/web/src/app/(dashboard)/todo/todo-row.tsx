"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";

import { LeadActions, UnreachablePrompt } from "@/components/lead-actions";
import {
	AttributeList,
	PipelineCard,
	TypeBadge,
} from "@/components/pipeline-card";
import { usePipelineLabel } from "@/hooks/use-pipeline-label";

type Todo = inferRouterOutputs<AppRouter>["todo"]["list"];
export type TodoLead = Todo["dueToday"][number];

/** A to-do card: lead (blue) or deal (green), type badge top left, aligned attributes. */
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
	const t = useTranslations("todo");
	const tc = useTranslations("customers");
	const tf = useTranslations("fit");
	const format = useFormatter();
	const pipelineLabel = usePipelineLabel();
	// Deal rows carry null where an action target expects "not given".
	const target = {
		...l,
		qualification: l.qualification ?? undefined,
		priceRange: l.priceRange ?? undefined,
	};
	const relative = (d: Date | string) => format.relativeTime(new Date(d), now);
	const time = (d: Date | string) =>
		format.dateTime(new Date(d), { timeStyle: "short" });

	const due = (() => {
		switch (l.reason) {
			case "first_contact":
				return l.contactDeadlineAt
					? {
							value: t("due.firstContact", {
								time: time(l.contactDeadlineAt),
								relative: relative(l.contactDeadlineAt),
							}),
						}
					: { value: "" };
			case "no_follow_up":
				return { value: t("due.noFollowUp"), tone: "danger" as const };
			case "overdue":
				return l.nextFollowUpAt
					? {
							value: t("due.overdue", { relative: relative(l.nextFollowUpAt) }),
							tone: "danger" as const,
						}
					: { value: "" };
			case "unreachable":
				return { value: t("due.unreachable"), tone: "danger" as const };
			default:
				return l.nextFollowUpAt
					? {
							value: t("due.today", {
								time: time(l.nextFollowUpAt),
								relative: relative(l.nextFollowUpAt),
							}),
						}
					: { value: "" };
		}
	})();
	const items = [
		{
			label: l.kind === "lead" ? t("attrs.status") : t("attrs.stage"),
			value: pipelineLabel(l.status, l.stage),
		},
		{ label: t("attrs.project"), value: l.projectName },
		...(l.primaryPhone
			? [{ label: t("attrs.phone"), value: l.primaryPhone }]
			: []),
		{ label: t("attrs.due"), ...due },
		...(l.attempts > 0
			? [
					{
						label: t("attrs.tries"),
						value: t("triesValue", {
							attempts: l.attempts,
							max: unreachableAttempts,
						}),
						tone: l.unreachable ? ("danger" as const) : undefined,
					},
				]
			: []),
		...(l.kind === "lead" && l.fit && l.fit !== "unknown"
			? [{ label: t("attrs.fit"), value: tf(l.fit) }]
			: []),
	];

	return (
		<PipelineCard kind={l.kind}>
			<div className="flex items-start justify-between gap-2">
				<div className="flex min-w-0 flex-col gap-1">
					<TypeBadge kind={l.kind} />
					<Link
						href={`/customers/${l.customerId}` as Route}
						className={cn(
							"font-medium underline-offset-4 hover:underline",
							size === "lg" && "text-xl",
						)}
					>
						{l.customerName}
					</Link>
				</div>
				{l.priority && <Badge>{tc("priority")}</Badge>}
			</div>
			<AttributeList items={items} />
			{l.unreachable && (
				<UnreachablePrompt
					target={target}
					attempts={l.attempts}
					onDone={onDone}
				/>
			)}
			<LeadActions target={target} onDone={onDone} size={size} />
		</PipelineCard>
	);
}
