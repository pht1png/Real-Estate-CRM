"use client";

import type {
	DisqualifyReason,
	FitResult,
	FundingType,
	LeadStatus,
	OpportunityStatus,
} from "@Real-Estate-CRM/db/constants";
import { Button, buttonVariants } from "@Real-Estate-CRM/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import {
	BadgeCheckIcon,
	BanknoteIcon,
	CalendarClockIcon,
	CalendarPlusIcon,
	DoorOpenIcon,
	EllipsisIcon,
	HandIcon,
	HandshakeIcon,
	HourglassIcon,
	KeyRoundIcon,
	MessageCircleIcon,
	PhoneIcon,
	PhoneMissedIcon,
	PhoneOffIcon,
	SparklesIcon,
	StickyNoteIcon,
	ThumbsDownIcon,
	TimerResetIcon,
	UserCheckIcon,
	UsersIcon,
	XCircleIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

import { BookAppointmentForm } from "./appointment-forms";
import {
	CloseForm,
	type FormTarget,
	FundingForm,
	NoteForm,
	OutcomeForm,
	QualifyForm,
	ReferrerForm,
	RescheduleForm,
	useLeadError,
	useRefreshLeads,
	VisitForm,
} from "./lead-forms";

/** Take a lead from the pool (brief §6). */
export function ClaimButton({ leadId }: { leadId: string }) {
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
			onClick={() => claim.mutate({ leadId })}
		>
			<HandIcon data-icon="inline-start" />
			{t("claim")}
		</Button>
	);
}

export type ActionTarget = FormTarget & {
	phoneE164?: string | null;
	/** The lead's status, or the opportunity's (by `kind`). */
	status?: LeadStatus | OpportunityStatus | null;
	/** Qualification check (brief §6): suggests the next step, never acts alone. */
	fit?: FitResult | null;
	fundingType?: FundingType | null;
	/** Leads: who referred the contact (shown and changed from the ⋯ menu). */
	referredBy?: { name: string } | null;
};

/** Manual moves offered on an opportunity; the rest come from deposits (M6). */
const nextStatuses: Partial<
	Record<
		OpportunityStatus,
		"negotiating" | "waiting_mortgage_result" | "transferred"
	>
> = {
	visited: "negotiating",
	contracted: "waiting_mortgage_result",
	waiting_mortgage_result: "transferred",
};
const withMortgage = (f: FundingType | null | undefined) =>
	f === "mortgage" || f === "cash_mortgage";

type Pane =
	| { kind: "result" }
	| { kind: "outcome"; outcome: "answered" | "no_answer" | "line" }
	| { kind: "followUp" }
	| { kind: "note" }
	| {
			kind: "qualify";
			thenConvert?: boolean;
			/** Just chosen in the call result: the row's own value is stale. */
			nextFollowUpAt?: Date;
	  }
	| { kind: "convert" }
	| { kind: "book" }
	| { kind: "referrer" }
	| { kind: "funding" }
	| {
			kind: "close";
			exit: "disqualify" | "nurture" | "lost";
			reason?: DisqualifyReason;
	  };

/**
 * One-tap actions (brief §7) on a lead or an opportunity: Call (dialler + result),
 * LINE, and a ⋯ menu. Every result ends with the next follow-up.
 */
export function LeadActions({
	target,
	onDone,
	size = "default",
}: {
	target: ActionTarget;
	/** Called after any saved action (Start mode moves to the next lead). */
	onDone?: () => void;
	size?: "default" | "lg";
}) {
	const t = useTranslations("leadActions");
	const ta = useTranslations("appointments");
	const can = useCan();
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [pane, setPane] = useState<Pane | null>(null);
	const big = size === "lg";
	const isLead = target.kind === "lead";
	const done = () => {
		setPane(null);
		onDone?.();
	};
	const tos = useTranslations("opportunityStatuses");
	const setStatus = useMutation(
		trpc.opportunity.setStatus.mutationOptions({
			onSuccess: async (_, input) => {
				toast.success(t("status.saved", { status: tos(input.status) }));
				onDone?.();
				await refresh();
			},
			onError,
		}),
	);
	const opportunityStatus = isLead
		? null
		: (target.status as OpportunityStatus | null | undefined);
	const next = opportunityStatus ? nextStatuses[opportunityStatus] : undefined;
	const canMove =
		!!next &&
		(next !== "waiting_mortgage_result" || withMortgage(target.fundingType)) &&
		// A sales manager marks the transfer (brief §4).
		(next !== "transferred" || can({ lead: ["assign"] }));
	const open =
		opportunityStatus === "visited" || opportunityStatus === "negotiating";
	// After a deposit there are no calls to log; only status, funding, notes.
	const working = isLead || open;
	// A tour is booked once you've spoken to them (brief §6).
	const canBook = isLead
		? target.status === "connected" || target.status === "qualified"
		: open;

	// One-tap suggestion from the fit check; the salesperson confirms.
	const suggest =
		isLead &&
		target.status !== "qualified" &&
		target.fit &&
		target.fit !== "unknown"
			? target.fit
			: null;
	const suggestion = suggest && (
		<Button
			size="sm"
			variant="secondary"
			className="self-start"
			onClick={() =>
				setPane(
					suggest === "fits"
						? { kind: "qualify" }
						: suggest === "too_early"
							? { kind: "close", exit: "nurture" }
							: { kind: "close", exit: "disqualify", reason: "bad_budget_fit" },
				)
			}
		>
			<SparklesIcon data-icon="inline-start" />
			{t(`fitSuggest.${suggest}`)}
		</Button>
	);
	// Converting needs a qualified lead: qualify first, face to face, then confirm.
	const confirmVisit = () =>
		setPane(
			target.status === "qualified"
				? { kind: "convert" }
				: { kind: "qualify", thenConvert: true },
		);

	return (
		<div className="flex flex-col gap-2">
			{suggestion}
			<div className="flex gap-2">
				{!working ? null : target.phoneE164 ? (
					<a
						href={`tel:${target.phoneE164}`}
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
				{working && (
					<Button
						variant="outline"
						size={big ? "lg" : "default"}
						onClick={() => setPane({ kind: "outcome", outcome: "line" })}
					>
						<MessageCircleIcon data-icon="inline-start" />
						{t("line")}
					</Button>
				)}
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
							{isLead && (
								<>
									<DropdownMenuItem
										onClick={() => setPane({ kind: "qualify" })}
									>
										<BadgeCheckIcon />
										{t("markQualified")}
									</DropdownMenuItem>
									<DropdownMenuItem onClick={confirmVisit}>
										<DoorOpenIcon />
										{t("confirmVisit")}
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setPane({ kind: "referrer" })}
									>
										<UsersIcon />
										{t("referrer.title")}
									</DropdownMenuItem>
								</>
							)}
							{canBook && (
								<DropdownMenuItem onClick={() => setPane({ kind: "book" })}>
									<CalendarPlusIcon />
									{ta("book")}
								</DropdownMenuItem>
							)}
							{!isLead && open && (
								<DropdownMenuItem onClick={() => setPane({ kind: "convert" })}>
									<DoorOpenIcon />
									{t("recordVisit.menu")}
								</DropdownMenuItem>
							)}
							{!isLead && opportunityStatus !== "transferred" && (
								<DropdownMenuItem onClick={() => setPane({ kind: "funding" })}>
									<BanknoteIcon />
									{t("funding.menu")}
								</DropdownMenuItem>
							)}
							{canMove && next && (
								<DropdownMenuItem
									onClick={() =>
										setStatus.mutate({ opportunityId: target.id, status: next })
									}
								>
									{next === "negotiating" ? (
										<HandshakeIcon />
									) : next === "transferred" ? (
										<KeyRoundIcon />
									) : (
										<HourglassIcon />
									)}
									{next === "negotiating"
										? t("markNegotiating")
										: t(`status.${next}`)}
								</DropdownMenuItem>
							)}
							{working && (
								<DropdownMenuItem onClick={() => setPane({ kind: "followUp" })}>
									<CalendarClockIcon />
									{t("changeFollowUp")}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onClick={() => setPane({ kind: "note" })}>
								<StickyNoteIcon />
								{t("addNote")}
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							{isLead ? (
								<>
									<DropdownMenuItem
										onClick={() => setPane({ kind: "close", exit: "nurture" })}
									>
										<TimerResetIcon />
										{t("exits.nurture")}
									</DropdownMenuItem>
									<DropdownMenuItem
										variant="destructive"
										onClick={() =>
											setPane({ kind: "close", exit: "disqualify" })
										}
									>
										<XCircleIcon />
										{t("exits.disqualify")}
									</DropdownMenuItem>
								</>
							) : (
								(open || opportunityStatus === "waiting_mortgage_result") && (
									<DropdownMenuItem
										variant="destructive"
										onClick={() => setPane({ kind: "close", exit: "lost" })}
									>
										<ThumbsDownIcon />
										{t("exits.lost")}
									</DropdownMenuItem>
								)
							)}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<Dialog
				open={pane !== null}
				onOpenChange={(open) => {
					if (open) return;
					setPane(null);
					// A chained step (e.g. Save & qualify) may have saved before closing.
					void refresh();
				}}
			>
				<DialogContent className="max-h-[90svh] overflow-y-auto">
					{pane?.kind === "result" && (
						<ResultChoice
							target={target}
							onChoose={(outcome) => setPane({ kind: "outcome", outcome })}
							onDone={done}
						/>
					)}
					{pane?.kind === "outcome" && (
						<OutcomeForm
							target={target}
							outcome={pane.outcome}
							onDone={done}
							onQualify={
								isLead && target.status !== "qualified"
									? (nextFollowUpAt) =>
											setPane({ kind: "qualify", nextFollowUpAt })
									: undefined
							}
						/>
					)}
					{pane?.kind === "followUp" && (
						<RescheduleForm target={target} onDone={done} />
					)}
					{pane?.kind === "note" && <NoteForm target={target} onDone={done} />}
					{pane?.kind === "qualify" && (
						<QualifyForm
							target={{
								...target,
								nextFollowUpAt: pane.nextFollowUpAt ?? target.nextFollowUpAt,
							}}
							onDone={done}
							onNext={
								pane.thenConvert
									? () => setPane({ kind: "convert" })
									: undefined
							}
						/>
					)}
					{pane?.kind === "convert" && (
						<VisitForm target={target} onDone={done} />
					)}
					{pane?.kind === "referrer" && (
						<ReferrerForm
							target={target}
							current={target.referredBy}
							onDone={done}
						/>
					)}
					{pane?.kind === "book" && (
						<BookAppointmentForm target={target} onDone={done} />
					)}
					{pane?.kind === "funding" && (
						<FundingForm
							target={target}
							current={target.fundingType}
							onDone={done}
						/>
					)}
					{pane?.kind === "close" && (
						<CloseForm
							target={target}
							exit={pane.exit}
							presetReason={pane.reason}
							onDone={done}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** After a call: Answered / No answer, and for leads Wrong number. */
function ResultChoice({
	target,
	onChoose,
	onDone,
}: {
	target: ActionTarget;
	onChoose: (outcome: "answered" | "no_answer") => void;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const wrongNumber = useMutation(
		trpc.lead.disqualify.mutationOptions({
			onSuccess: async () => {
				toast.success(t("toasts.closed.disqualify"));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{t("result.title", { name: target.contactName })}
				</DialogTitle>
				<DialogDescription>{t("result.description")}</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-2 py-2">
				<Button
					size="lg"
					variant="secondary"
					className="justify-start"
					onClick={() => onChoose("answered")}
				>
					<UserCheckIcon />
					{t("result.answered")}
				</Button>
				<Button
					size="lg"
					variant="secondary"
					className="justify-start"
					onClick={() => onChoose("no_answer")}
				>
					<PhoneMissedIcon />
					{t("result.no_answer")}
				</Button>
				{target.kind === "lead" && (
					<Button
						size="lg"
						variant="outline"
						className="justify-start"
						disabled={wrongNumber.isPending}
						onClick={() =>
							wrongNumber.mutate({
								leadId: target.id,
								reason: "invalid_data",
								note: t("result.wrong_number"),
							})
						}
					>
						<PhoneOffIcon />
						{t("result.wrong_number")}
					</Button>
				)}
			</div>
		</>
	);
}

/** Brief §6: after N no-answers the salesperson confirms Disqualify (Unreachable) or Nurture. */
export function UnreachablePrompt({
	target,
	attempts,
	onDone,
}: {
	target: ActionTarget;
	attempts: number;
	onDone?: () => void;
}) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const options = (exit: "disqualify" | "nurture") => ({
		onSuccess: async () => {
			toast.success(t(`toasts.closed.${exit}`));
			onDone?.();
			await refresh();
		},
		onError,
	});
	const disqualify = useMutation(
		trpc.lead.disqualify.mutationOptions(options("disqualify")),
	);
	const nurture = useMutation(
		trpc.lead.nurture.mutationOptions(options("nurture")),
	);
	const pending = disqualify.isPending || nurture.isPending;
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
					disabled={pending}
					onClick={() =>
						disqualify.mutate({ leadId: target.id, reason: "unreachable" })
					}
				>
					{t("unreachable.disqualify")}
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={pending}
					onClick={() => nurture.mutate({ leadId: target.id })}
				>
					{t("unreachable.nurture")}
				</Button>
			</div>
		</section>
	);
}
