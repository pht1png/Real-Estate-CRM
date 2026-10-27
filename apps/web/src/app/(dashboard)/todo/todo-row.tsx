"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import type { inferRouterOutputs } from "@trpc/server";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { AppointmentActions } from "@/components/appointment-forms";
import { LeadActions, UnreachablePrompt } from "@/components/lead-actions";
import {
	AttributeList,
	PipelineCard,
	TemperatureBadge,
	TypeBadge,
} from "@/components/pipeline-card";
import { usePipelineLabel } from "@/hooks/use-pipeline-label";

type Todo = inferRouterOutputs<AppRouter>["todo"]["list"];
export type TodoLead = Todo["dueToday"][number];
export type TodoAppointment = Todo["arrivals"]["items"][number];

/** A to-do card: lead (blue) or opportunity (green), type badge top left, aligned attributes. */
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
	const tc = useTranslations("contacts");
	const tf = useTranslations("fit");
	const format = useFormatter();
	const pipelineLabel = usePipelineLabel();
	// Opportunity rows carry null where an action target expects "not given".
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
			case "quiet":
				return { value: t("due.quiet"), tone: "danger" as const };
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
			label: t("attrs.status"),
			value:
				l.kind === "lead"
					? pipelineLabel(l.status, null)
					: pipelineLabel(null, l.status),
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
						href={`/contacts/${l.contactId}` as Route}
						className={cn(
							"font-medium underline-offset-4 hover:underline",
							size === "lg" && "text-xl",
						)}
					>
						{l.contactName}
					</Link>
				</div>
				{l.priority && <Badge>{tc("priority")}</Badge>}
				<TemperatureBadge temperature={l.temperature} />
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

/**
 * A booked showroom visit: a first tour (lead, blue) or a follow-up visit
 * (opportunity, green), with Arrived / Didn't come and Reschedule / Cancel.
 */
export function AppointmentRow({
	appointment: a,
	late,
}: {
	appointment: TodoAppointment;
	/** Still scheduled 2 hours after the start: "did they come?". */
	late?: boolean;
}) {
	const t = useTranslations("todo");
	const ta = useTranslations("appointments");
	const tl = useTranslations("leadStatuses");
	const format = useFormatter();
	const kind = a.firstTour ? "lead" : "opportunity";
	const when = format.dateTime(new Date(a.startsAt), {
		...(late && { weekday: "short", day: "numeric", month: "short" }),
		hour: "2-digit",
		minute: "2-digit",
	});
	const visitKind = ta(a.firstTour ? "firstTour" : "followUpVisit");
	const items = [
		{
			label: t("attrs.appointment"),
			value: `${late ? t("unanswered.booked", { time: when }) : when} · ${visitKind}`,
			tone: late ? ("danger" as const) : undefined,
		},
		...(a.firstTour
			? [
					{
						label: t("attrs.status"),
						value: tl(a.qualified ? "qualified" : "connected"),
					},
				]
			: []),
		{ label: t("attrs.project"), value: a.projectName },
		...(a.primaryPhone
			? [{ label: t("attrs.phone"), value: a.primaryPhone }]
			: []),
	];
	return (
		<PipelineCard kind={kind}>
			<div className="flex min-w-0 flex-col gap-1">
				<TypeBadge kind={kind} />
				<Link
					href={`/contacts/${a.contactId}` as Route}
					className="font-medium underline-offset-4 hover:underline"
				>
					{a.contactName}
				</Link>
			</div>
			<AttributeList items={items} />
			<AppointmentActions
				appointment={{ ...a, priceRange: a.priceRange ?? undefined }}
			/>
		</PipelineCard>
	);
}
