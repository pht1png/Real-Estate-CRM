"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@Real-Estate-CRM/ui/components/dialog";
import { CheckCircle2Icon, SkipForwardIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { type TodoLead, TodoRow } from "./todo-row";

/**
 * Start mode: one lead at a time, full screen. The queue is fixed when it
 * starts, so leads that leave the list after an action don't shift it.
 */
export function CallMode({
	leads,
	now,
	unreachableAttempts,
	onClose,
}: {
	leads: TodoLead[];
	now: Date;
	unreachableAttempts: number;
	onClose: () => void;
}) {
	const t = useTranslations("overview.callMode");
	const [queue] = useState(leads);
	const [index, setIndex] = useState(0);
	const lead = queue[index];
	const next = () => setIndex((i) => i + 1);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="flex h-svh max-w-none flex-col sm:h-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("title")}</DialogTitle>
					<DialogDescription aria-live="polite">
						{lead
							? t("progress", { current: index + 1, total: queue.length })
							: t("doneDescription", { total: queue.length })}
					</DialogDescription>
				</DialogHeader>
				{lead ? (
					<div key={lead.interestId} className="flex flex-1 flex-col gap-4">
						<TodoRow
							lead={lead}
							now={now}
							unreachableAttempts={unreachableAttempts}
							onDone={next}
							size="lg"
						/>
						<Button variant="ghost" className="self-start" onClick={next}>
							<SkipForwardIcon data-icon="inline-start" />
							{t("skip")}
						</Button>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
						<CheckCircle2Icon className="text-primary size-10" />
						<p className="text-base font-medium">{t("doneTitle")}</p>
						<Button onClick={onClose}>{t("close")}</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
