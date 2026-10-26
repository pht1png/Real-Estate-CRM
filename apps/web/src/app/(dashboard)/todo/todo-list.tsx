"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@Real-Estate-CRM/ui/components/empty";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon, DoorOpenIcon, PlayIcon } from "lucide-react";
import { useNow, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { useTRPC } from "@/utils/trpc";

import { CallMode } from "./call-mode";
import {
	AppointmentRow,
	type TodoAppointment,
	type TodoLead,
	TodoRow,
} from "./todo-row";

/**
 * To-do page (brief §7): showroom arrivals today, my leads and opportunities
 * due today, and what slipped (appointments nobody closed first). Start mode
 * walks Due today, then Stale.
 */
export function TodoList() {
	const t = useTranslations("todo");
	const trpc = useTRPC();
	// Refetch each minute so expired claims and newly due follow-ups show up.
	const todo = useQuery(
		trpc.todo.list.queryOptions(undefined, { refetchInterval: 60_000 }),
	);
	const now = useNow({ updateInterval: 60_000 });
	const [calling, setCalling] = useState(false);

	if (!todo.data) return <Spinner />;
	const {
		arrivals,
		dueToday,
		stale,
		unansweredAppointments,
		unreachableAttempts,
	} = todo.data;
	const queue = [...dueToday, ...stale];

	return (
		<>
			<div className="flex justify-end">
				<Button disabled={queue.length === 0} onClick={() => setCalling(true)}>
					<PlayIcon data-icon="inline-start" />
					{t("start")}
				</Button>
			</div>

			<section aria-labelledby="todo-arrivals" className="flex flex-col gap-2">
				<h2 id="todo-arrivals" className="text-lg font-semibold">
					{t("arrivals.title", { count: arrivals.items.length })}
				</h2>
				<Card size="sm">
					<CardContent className="flex flex-col gap-1 text-sm">
						<p className="flex items-center gap-2">
							<DoorOpenIcon className="size-4" />
							<span className="tabular-nums">
								{t("arrivals.breakdown", {
									qualified: arrivals.qualified,
									unvetted: arrivals.unvetted,
									followUps: arrivals.followUps,
								})}
							</span>
						</p>
						{arrivals.unvetted > 0 && (
							<p className="text-muted-foreground">{t("arrivals.hint")}</p>
						)}
						{arrivals.items.length === 0 && (
							<p className="text-muted-foreground">{t("arrivals.empty")}</p>
						)}
					</CardContent>
				</Card>
				<AppointmentList items={arrivals.items} />
			</section>

			{unansweredAppointments.length > 0 && (
				<section
					aria-labelledby="todo-unanswered"
					className="flex flex-col gap-2"
				>
					<h2 id="todo-unanswered" className="text-lg font-semibold">
						{t("unanswered.title", { count: unansweredAppointments.length })}
					</h2>
					<AppointmentList items={unansweredAppointments} late />
				</section>
			)}

			<Section
				id="todo-due"
				title={t("dueToday.title", { count: dueToday.length })}
				empty={t("dueToday.empty")}
				leads={dueToday}
				render={(l) => (
					<TodoRow
						lead={l}
						now={now}
						unreachableAttempts={unreachableAttempts}
					/>
				)}
			/>
			<Section
				id="todo-stale"
				title={t("stale.title", { count: stale.length })}
				empty={t("stale.empty")}
				leads={stale}
				render={(l) => (
					<TodoRow
						lead={l}
						now={now}
						unreachableAttempts={unreachableAttempts}
					/>
				)}
			/>
			{calling && (
				<CallMode
					leads={queue}
					now={now}
					unreachableAttempts={unreachableAttempts}
					onClose={() => setCalling(false)}
				/>
			)}
		</>
	);
}

function AppointmentList({
	items,
	late,
}: {
	items: TodoAppointment[];
	late?: boolean;
}) {
	if (items.length === 0) return null;
	return (
		<ul className="flex flex-col gap-3">
			{items.map((a) => (
				<li key={a.appointmentId}>
					<AppointmentRow appointment={a} late={late} />
				</li>
			))}
		</ul>
	);
}

function Section({
	id,
	title,
	empty,
	leads,
	render,
}: {
	id: string;
	title: string;
	empty: string;
	leads: TodoLead[];
	render: (lead: TodoLead) => ReactNode;
}) {
	return (
		<section aria-labelledby={id} className="flex flex-col gap-2">
			<h2 id={id} className="text-lg font-semibold">
				{title}
			</h2>
			{leads.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<CheckCircle2Icon />
						</EmptyMedia>
						<EmptyTitle>{empty}</EmptyTitle>
						<EmptyDescription />
					</EmptyHeader>
				</Empty>
			) : (
				<ul className="flex flex-col gap-3">
					{leads.map((l) => (
						<li key={`${l.kind}:${l.id}`}>{render(l)}</li>
					))}
				</ul>
			)}
		</section>
	);
}
