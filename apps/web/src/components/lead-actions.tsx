"use client";

import { Button, buttonVariants } from "@Real-Estate-CRM/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@Real-Estate-CRM/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CalendarClockIcon,
	HandIcon,
	MessageCircleIcon,
	PhoneIcon,
	PhoneMissedIcon,
	PhoneOutgoingIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import {
	daysAtTen,
	defaultFollowUp,
	hoursFromNow,
	toDateTimeLocal,
} from "@/lib/follow-up";
import { useTRPC } from "@/utils/trpc";

type Action = "call" | "no_answer" | "line" | "followUp";

const ERROR_CODES = [
	"FORBIDDEN",
	"NOT_FOUND",
	"BAD_REQUEST",
	"CONFLICT",
	"PRECONDITION_FAILED",
] as const;

/** Translated toast for a failed lead action, by tRPC error code. */
function useLeadError() {
	const t = useTranslations("leadActions.errors");
	return (e: { data?: { code?: string } | null }) => {
		const code = ERROR_CODES.find((c) => c === e.data?.code);
		toast.error(t(code ?? "default"));
	};
}

/** Everything that shows a lead: Today, the customer page and lead lists. */
function useRefreshLeads() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.today.pathFilter()),
			queryClient.invalidateQueries(trpc.customer.pathFilter()),
			queryClient.invalidateQueries(trpc.lead.pathFilter()),
		]);
}

/** Take a lead from the pool (brief §6). */
export function ClaimButton({
	interestId,
	size = "sm",
}: {
	interestId: string;
	size?: "sm" | "default";
}) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const claim = useMutation(
		trpc.lead.claim.mutationOptions({
			onSuccess: async () => {
				toast.success(t("claimed"));
				await refresh();
			},
			onError: async (e) => {
				onError(e);
				await refresh();
			},
		}),
	);
	return (
		<Button
			size={size}
			disabled={claim.isPending}
			onClick={() => claim.mutate({ interestId })}
		>
			<HandIcon data-icon="inline-start" />
			{t("claim")}
		</Button>
	);
}

/**
 * One-tap actions (brief §7, M4 part): Call, Called, No answer, LINE and
 * reschedule. Each asks for the next follow-up so nothing sits without one.
 */
export function LeadActions({
	interestId,
	phoneE164,
	nextFollowUpAt,
}: {
	interestId: string;
	phoneE164?: string | null;
	nextFollowUpAt?: Date | string | null;
}) {
	const t = useTranslations("leadActions");
	const [action, setAction] = useState<Action | null>(null);

	return (
		<div className="flex flex-wrap gap-2">
			{phoneE164 && (
				<a
					href={`tel:${phoneE164}`}
					className={buttonVariants({ size: "sm", variant: "outline" })}
				>
					<PhoneIcon data-icon="inline-start" />
					{t("dial")}
				</a>
			)}
			<Button size="sm" variant="outline" onClick={() => setAction("call")}>
				<PhoneOutgoingIcon data-icon="inline-start" />
				{t("call")}
			</Button>
			<Button
				size="sm"
				variant="outline"
				onClick={() => setAction("no_answer")}
			>
				<PhoneMissedIcon data-icon="inline-start" />
				{t("no_answer")}
			</Button>
			<Button size="sm" variant="outline" onClick={() => setAction("line")}>
				<MessageCircleIcon data-icon="inline-start" />
				{t("line")}
			</Button>
			<Button size="sm" variant="ghost" onClick={() => setAction("followUp")}>
				<CalendarClockIcon data-icon="inline-start" />
				{t("followUp")}
			</Button>
			<Dialog
				open={action !== null}
				onOpenChange={(open) => !open && setAction(null)}
			>
				<DialogContent>
					{action && (
						<ActionForm
							action={action}
							interestId={interestId}
							nextFollowUpAt={nextFollowUpAt}
							onDone={() => setAction(null)}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

function initialFollowUp(current?: Date | string | null) {
	const d = current ? new Date(current) : null;
	return d && d.getTime() > Date.now() ? toDateTimeLocal(d) : defaultFollowUp();
}

function ActionForm({
	action,
	interestId,
	nextFollowUpAt,
	onDone,
}: {
	action: Action;
	interestId: string;
	nextFollowUpAt?: Date | string | null;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [note, setNote] = useState("");
	const [followUp, setFollowUp] = useState(() =>
		action === "no_answer" ? hoursFromNow(2) : initialFollowUp(nextFollowUpAt),
	);
	const [submitted, setSubmitted] = useState(false);
	const onSuccess = async () => {
		toast.success(t("saved"));
		onDone();
		await refresh();
	};
	const log = useMutation(
		trpc.lead.logActivity.mutationOptions({ onSuccess, onError }),
	);
	const reschedule = useMutation(
		trpc.lead.setFollowUp.mutationOptions({ onSuccess, onError }),
	);
	const pending = log.isPending || reschedule.isPending;
	const followUpDate = followUp ? new Date(followUp) : null;
	const followUpValid =
		!!followUpDate &&
		!Number.isNaN(followUpDate.getTime()) &&
		followUpDate.getTime() > Date.now();

	const picks = [
		{ key: "in2h", value: () => hoursFromNow(2) },
		{ key: "tomorrow", value: () => daysAtTen(1) },
		{ key: "in3days", value: () => daysAtTen(3) },
		{ key: "nextWeek", value: () => daysAtTen(7) },
	] as const;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!followUpValid || !followUpDate) return;
				const nextFollowUpAt = followUpDate.toISOString();
				if (action === "followUp") {
					reschedule.mutate({ interestId, nextFollowUpAt });
				} else {
					log.mutate({
						interestId,
						type: action,
						note: note.trim() || undefined,
						nextFollowUpAt,
					});
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>{t(`titles.${action}`)}</DialogTitle>
				<DialogDescription>{t("followUpHint")}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				{action !== "followUp" && (
					<Field>
						<FieldLabel htmlFor="action-note">{t("note")}</FieldLabel>
						<Textarea
							id="action-note"
							name="note"
							value={note}
							maxLength={1000}
							placeholder={t("notePlaceholder")}
							onChange={(e) => setNote(e.target.value)}
						/>
					</Field>
				)}
				<Field data-invalid={(submitted && !followUpValid) || undefined}>
					<FieldLabel htmlFor="action-follow-up">
						{t("nextFollowUp")}
					</FieldLabel>
					<div className="flex flex-wrap gap-2">
						{picks.map((p) => (
							<Button
								key={p.key}
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => setFollowUp(p.value())}
							>
								{t(`picks.${p.key}`)}
							</Button>
						))}
					</div>
					<Input
						id="action-follow-up"
						name="nextFollowUpAt"
						type="datetime-local"
						value={followUp}
						aria-invalid={(submitted && !followUpValid) || undefined}
						onChange={(e) => setFollowUp(e.target.value)}
					/>
					{submitted && !followUpValid && (
						<FieldError>{t("followUpFuture")}</FieldError>
					)}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{tc("cancel")}
				</DialogClose>
				<Button type="submit" disabled={pending}>
					{t("save")}
				</Button>
			</DialogFooter>
		</form>
	);
}
