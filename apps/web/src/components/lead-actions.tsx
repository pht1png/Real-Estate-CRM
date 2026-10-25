"use client";

import {
	type InvalidReason,
	invalidReasons,
	type LostReason,
	lostReasons,
} from "@Real-Estate-CRM/db/constants";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@Real-Estate-CRM/ui/components/dropdown-menu";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CalendarClockIcon,
	EllipsisIcon,
	HandIcon,
	MessageCircleIcon,
	PhoneIcon,
	PhoneMissedIcon,
	PhoneOffIcon,
	StickyNoteIcon,
	ThumbsDownIcon,
	TimerResetIcon,
	UserCheckIcon,
	XCircleIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { defaultFollowUp, toDateTimeLocal } from "@/lib/follow-up";
import { useTRPC } from "@/utils/trpc";

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

/** Everything that shows a lead: Overview, pool, customer page and lists. */
function useRefreshLeads() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.today.pathFilter()),
			queryClient.invalidateQueries(trpc.pool.pathFilter()),
			queryClient.invalidateQueries(trpc.customer.pathFilter()),
			queryClient.invalidateQueries(trpc.lead.pathFilter()),
		]);
}

/** Take a lead from the pool (brief §6). */
export function ClaimButton({ interestId }: { interestId: string }) {
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
			size="sm"
			disabled={claim.isPending}
			onClick={() => claim.mutate({ interestId })}
		>
			<HandIcon data-icon="inline-start" />
			{t("claim")}
		</Button>
	);
}

export type ActionLead = {
	interestId: string;
	customerName: string;
	phoneE164?: string | null;
	nextFollowUpAt?: Date | string | null;
};

type Pane =
	| { kind: "result" }
	| { kind: "line" }
	| { kind: "followUp" }
	| { kind: "note" }
	| { kind: "close"; exit: "lost" | "nurture" | "invalid" };

/**
 * One-tap actions (brief §7): Call (dialler + result sheet), LINE and a ⋯ menu
 * for the rest. Every result ends with the next follow-up the salesperson picks.
 */
export function LeadActions({
	lead,
	onDone,
	size = "default",
}: {
	lead: ActionLead;
	/** Called after any saved action (Start mode moves to the next lead). */
	onDone?: () => void;
	size?: "default" | "lg";
}) {
	const t = useTranslations("leadActions");
	const [pane, setPane] = useState<Pane | null>(null);
	const big = size === "lg";
	const done = () => {
		setPane(null);
		onDone?.();
	};

	return (
		<div className="flex gap-2">
			{lead.phoneE164 ? (
				<a
					href={`tel:${lead.phoneE164}`}
					className={cn(
						buttonVariants({ size: big ? "lg" : "default" }),
						"flex-1",
					)}
					onClick={() => setPane({ kind: "result" })}
				>
					<PhoneIcon data-icon="inline-start" />
					{t("call")}
				</a>
			) : (
				<Button
					size={big ? "lg" : "default"}
					className="flex-1"
					onClick={() => setPane({ kind: "result" })}
				>
					<PhoneIcon data-icon="inline-start" />
					{t("logCall")}
				</Button>
			)}
			<Button
				variant="outline"
				size={big ? "lg" : "default"}
				onClick={() => setPane({ kind: "line" })}
			>
				<MessageCircleIcon data-icon="inline-start" />
				{t("line")}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							size={big ? "icon-lg" : "icon"}
							aria-label={t("more")}
						/>
					}
				>
					<EllipsisIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuGroup>
						<DropdownMenuItem onClick={() => setPane({ kind: "followUp" })}>
							<CalendarClockIcon />
							{t("changeFollowUp")}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setPane({ kind: "note" })}>
							<StickyNoteIcon />
							{t("addNote")}
						</DropdownMenuItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuItem
							onClick={() => setPane({ kind: "close", exit: "nurture" })}
						>
							<TimerResetIcon />
							{t("exits.nurture")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => setPane({ kind: "close", exit: "lost" })}
						>
							<ThumbsDownIcon />
							{t("exits.lost")}
						</DropdownMenuItem>
						<DropdownMenuItem
							variant="destructive"
							onClick={() => setPane({ kind: "close", exit: "invalid" })}
						>
							<XCircleIcon />
							{t("exits.invalid")}
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog
				open={pane !== null}
				onOpenChange={(open) => !open && setPane(null)}
			>
				<DialogContent className="max-h-[90svh] overflow-y-auto">
					{pane?.kind === "result" && <ResultForm lead={lead} onDone={done} />}
					{pane?.kind === "line" && (
						<OutcomeForm lead={lead} outcome="line" onDone={done} />
					)}
					{pane?.kind === "followUp" && (
						<RescheduleForm lead={lead} onDone={done} />
					)}
					{pane?.kind === "note" && <NoteForm lead={lead} onDone={done} />}
					{pane?.kind === "close" && (
						<CloseForm lead={lead} exit={pane.exit} onDone={done} />
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** After a call: Answered / No answer / Wrong number. */
function ResultForm({
	lead,
	onDone,
}: {
	lead: ActionLead;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const [outcome, setOutcome] = useState<"answered" | "no_answer" | null>(null);
	const closeLead = useCloseLead(onDone);

	if (outcome) {
		return <OutcomeForm lead={lead} outcome={outcome} onDone={onDone} />;
	}
	const choices = [
		{
			key: "answered",
			icon: <UserCheckIcon />,
			onClick: () => setOutcome("answered"),
		},
		{
			key: "no_answer",
			icon: <PhoneMissedIcon />,
			onClick: () => setOutcome("no_answer"),
		},
		{
			key: "wrong_number",
			icon: <PhoneOffIcon />,
			onClick: () =>
				closeLead.mutate({
					interestId: lead.interestId,
					exit: "invalid",
					reason: "wrong_number",
				}),
		},
	] as const;
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t("result.title", { name: lead.customerName })}
				</DialogTitle>
				<DialogDescription>{t("result.description")}</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-2 py-2">
				{choices.map((c) => (
					<Button
						key={c.key}
						size="lg"
						variant={c.key === "wrong_number" ? "outline" : "secondary"}
						className="justify-start"
						disabled={closeLead.isPending}
						onClick={c.onClick}
					>
						{c.icon}
						{t(`result.${c.key}`)}
					</Button>
				))}
			</div>
		</>
	);
}

type PickKey = "in2h" | "nextWorkingDay" | "in3WorkingDays" | "nextWeek";
const PICKS: PickKey[] = [
	"in2h",
	"nextWorkingDay",
	"in3WorkingDays",
	"nextWeek",
];

/** Short day + time, e.g. "Mon 3 Nov 10:00". */
function useShortTime() {
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
function useFollowUp(
	lead: ActionLead,
	suggest: PickKey | "current",
	submitted: boolean,
) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const shortTime = useShortTime();
	const picks = useQuery(
		trpc.lead.followUpPicks.queryOptions({ interestId: lead.interestId }),
	);
	const [chosen, setChosen] = useState<string | null>(null);
	const pickValue = (key: PickKey) => {
		const at = picks.data?.[key];
		return at ? toDateTimeLocal(new Date(at)) : null;
	};
	const current = lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt) : null;
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

/** Answered, No answer or LINE: optional note + next follow-up. */
function OutcomeForm({
	lead,
	outcome,
	onDone,
}: {
	lead: ActionLead;
	outcome: "answered" | "no_answer" | "line";
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(
		lead,
		outcome === "no_answer" ? "in2h" : "nextWorkingDay",
		submitted,
	);
	const log = useMutation(
		trpc.lead.logOutcome.mutationOptions({
			onSuccess: async (result) => {
				if (result.unreachable) {
					toast.warning(t("toasts.unreachable", { attempt: result.attempt }));
				} else if (outcome === "no_answer") {
					toast.success(
						t("toasts.noAnswer", {
							attempt: result.attempt,
							time: followUp.label,
						}),
					);
				} else {
					toast.success(t("toasts.saved", { time: followUp.label }));
				}
				onDone();
				await refresh();
			},
			onError,
		}),
	);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!followUp.valid) return;
				log.mutate({
					interestId: lead.interestId,
					outcome,
					note: note.trim() || undefined,
					nextFollowUpAt: followUp.date.toISOString(),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{t(`titles.${outcome}`)}</DialogTitle>
				<DialogDescription>{lead.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
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
				{followUp.field}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{tc("cancel")}
				</DialogClose>
				<Button type="submit" disabled={log.isPending}>
					{t("save")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function RescheduleForm({
	lead,
	onDone,
}: {
	lead: ActionLead;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(lead, "current", submitted);
	const reschedule = useMutation(
		trpc.lead.setFollowUp.mutationOptions({
			onSuccess: async () => {
				toast.success(t("toasts.saved", { time: followUp.label }));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!followUp.valid) return;
				reschedule.mutate({
					interestId: lead.interestId,
					nextFollowUpAt: followUp.date.toISOString(),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("changeFollowUp")}</DialogTitle>
				<DialogDescription>{lead.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">{followUp.field}</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{tc("cancel")}
				</DialogClose>
				<Button type="submit" disabled={reschedule.isPending}>
					{t("save")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function NoteForm({ lead, onDone }: { lead: ActionLead; onDone: () => void }) {
	const t = useTranslations("leadActions");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [note, setNote] = useState("");
	const addNote = useMutation(
		trpc.lead.addNote.mutationOptions({
			onSuccess: async () => {
				toast.success(t("toasts.noteSaved"));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (note.trim())
					addNote.mutate({ interestId: lead.interestId, note: note.trim() });
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("addNote")}</DialogTitle>
				<DialogDescription>{lead.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<Field>
					<FieldLabel htmlFor="lead-note">{t("note")}</FieldLabel>
					<Textarea
						id="lead-note"
						name="note"
						value={note}
						maxLength={2000}
						onChange={(e) => setNote(e.target.value)}
					/>
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{tc("cancel")}
				</DialogClose>
				<Button type="submit" disabled={!note.trim() || addNote.isPending}>
					{t("save")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function useCloseLead(onDone: () => void) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	return useMutation(
		trpc.lead.close.mutationOptions({
			onSuccess: async (_data, input) => {
				toast.success(t(`toasts.closed.${input.exit}`));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
}

/** Lost (reason; Other needs a note), Invalid (reason) or Nurture. */
function CloseForm({
	lead,
	exit,
	onDone,
}: {
	lead: ActionLead;
	exit: "lost" | "nurture" | "invalid";
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const tc = useTranslations("common");
	const tl = useTranslations("lostReasons");
	const ti = useTranslations("invalidReasons");
	const [reason, setReason] = useState<string | null>(null);
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const closeLead = useCloseLead(onDone);
	const reasons =
		exit === "lost"
			? lostReasons.map((r) => ({ value: r, label: tl(r) }))
			: exit === "invalid"
				? invalidReasons.map((r) => ({ value: r, label: ti(r) }))
				: [];
	const needsNote = exit === "lost" && reason === "other";
	const missingReason = reasons.length > 0 && !reason;
	const missingNote = needsNote && !note.trim();

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (missingReason || missingNote) return;
				const base = {
					interestId: lead.interestId,
					note: note.trim() || undefined,
				};
				closeLead.mutate(
					exit === "lost"
						? { ...base, exit, reason: reason as LostReason }
						: exit === "invalid"
							? { ...base, exit, reason: reason as InvalidReason }
							: { ...base, exit },
				);
			}}
		>
			<DialogHeader>
				<DialogTitle>{t(`exits.${exit}`)}</DialogTitle>
				<DialogDescription>
					{t(`exitHints.${exit}`, { name: lead.customerName })}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				{reasons.length > 0 && (
					<FieldSet data-invalid={(submitted && missingReason) || undefined}>
						<FieldLegend variant="label">{t("reason")}</FieldLegend>
						<div className="grid grid-cols-2 gap-2">
							{reasons.map((r) => (
								<Button
									key={r.value}
									type="button"
									size="sm"
									variant={reason === r.value ? "default" : "outline"}
									aria-pressed={reason === r.value}
									className="h-auto justify-start py-2 text-left whitespace-normal"
									onClick={() => setReason(r.value)}
								>
									{r.label}
								</Button>
							))}
						</div>
						{submitted && missingReason && (
							<FieldError>{t("reasonRequired")}</FieldError>
						)}
					</FieldSet>
				)}
				<Field data-invalid={(submitted && missingNote) || undefined}>
					<FieldLabel htmlFor="close-note">
						{needsNote ? t("noteRequired") : t("note")}
					</FieldLabel>
					<Textarea
						id="close-note"
						name="note"
						value={note}
						maxLength={1000}
						aria-invalid={(submitted && missingNote) || undefined}
						onChange={(e) => setNote(e.target.value)}
					/>
					{submitted && missingNote && (
						<FieldError>{t("noteRequiredError")}</FieldError>
					)}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{tc("cancel")}
				</DialogClose>
				<Button
					type="submit"
					variant={exit === "invalid" ? "destructive" : "default"}
					disabled={closeLead.isPending}
				>
					{t(`exits.${exit}`)}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** Brief §6: after N no-answers the salesperson confirms Lost (Unreachable) or Nurture. */
export function UnreachablePrompt({
	lead,
	attempts,
	onDone,
}: {
	lead: ActionLead;
	attempts: number;
	onDone?: () => void;
}) {
	const t = useTranslations("leadActions");
	const closeLead = useCloseLead(() => onDone?.());
	return (
		<section
			aria-label={t("unreachable.title", { attempts })}
			className="bg-destructive/10 flex flex-col gap-2 p-3"
		>
			<p className="text-sm font-medium">
				{t("unreachable.title", { attempts })}
			</p>
			<div className="flex gap-2">
				<Button
					size="sm"
					variant="destructive"
					disabled={closeLead.isPending}
					onClick={() =>
						closeLead.mutate({
							interestId: lead.interestId,
							exit: "lost",
							reason: "unreachable",
						})
					}
				>
					{t("unreachable.lost")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={closeLead.isPending}
					onClick={() =>
						closeLead.mutate({ interestId: lead.interestId, exit: "nurture" })
					}
				>
					{t("unreachable.nurture")}
				</Button>
			</div>
		</section>
	);
}
