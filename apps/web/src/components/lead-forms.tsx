"use client";

import {
	type BuyerIntent,
	type BuyingTimeline,
	buyerIntents,
	buyingTimelines,
	type DisqualifyReason,
	disqualifyReasons,
	type FundingType,
	fundingTypes,
	type LostReason,
	lostReasons,
} from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@Real-Estate-CRM/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { toDateTimeLocal } from "@/lib/follow-up";
import { bahtToSatang, satangToBahtInput, useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { ChoiceChips } from "./choice-chips";
import { type Target, useFollowUp } from "./follow-up-picker";

const ERROR_CODES = [
	"FORBIDDEN",
	"NOT_FOUND",
	"BAD_REQUEST",
	"CONFLICT",
	"PRECONDITION_FAILED",
] as const;

/** Translated toast for a failed lead or opportunity action, by tRPC error code. */
export function useLeadError() {
	const t = useTranslations("leadActions.errors");
	return (e: { data?: { code?: string } | null }) => {
		const code = ERROR_CODES.find((c) => c === e.data?.code);
		toast.error(t(code ?? "default"));
	};
}

/** Everything that shows a lead or opportunity: Overview, pool, customer page, lists. */
export function useRefreshLeads() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.overview.pathFilter()),
			queryClient.invalidateQueries(trpc.todo.pathFilter()),
			queryClient.invalidateQueries(trpc.pool.pathFilter()),
			queryClient.invalidateQueries(trpc.customer.pathFilter()),
			queryClient.invalidateQueries(trpc.lead.pathFilter()),
			queryClient.invalidateQueries(trpc.opportunity.pathFilter()),
		]);
}

export type FormTarget = Target & {
	customerName: string;
	projectId?: string;
	/** Prefill for Mark qualified. */
	qualification?: {
		budgetMinSatang: number | null;
		budgetMaxSatang: number | null;
		buyingTimeline: BuyingTimeline | null;
		unitTypeIds: string[];
		buyerIntent: BuyerIntent | null;
	};
	priceRange?: { min: number; max: number } | null;
};

function Footer({
	pending,
	label,
	extra,
	destructive,
}: {
	pending: boolean;
	label: string;
	extra?: ReactNode;
	destructive?: boolean;
}) {
	const tc = useTranslations("common");
	return (
		<DialogFooter>
			<DialogClose render={<Button type="button" variant="outline" />}>
				{tc("cancel")}
			</DialogClose>
			{extra}
			<Button
				type="submit"
				variant={destructive ? "destructive" : "default"}
				disabled={pending}
			>
				{label}
			</Button>
		</DialogFooter>
	);
}

function NoteField({
	value,
	onChange,
	label,
	invalid,
	error,
}: {
	value: string;
	onChange: (v: string) => void;
	label?: string;
	invalid?: boolean;
	error?: string;
}) {
	const t = useTranslations("leadActions");
	return (
		<Field data-invalid={invalid || undefined}>
			<FieldLabel htmlFor="action-note">{label ?? t("note")}</FieldLabel>
			<Textarea
				id="action-note"
				name="note"
				value={value}
				maxLength={1000}
				placeholder={t("notePlaceholder")}
				aria-invalid={invalid || undefined}
				onChange={(e) => onChange(e.target.value)}
			/>
			{invalid && error && <FieldError>{error}</FieldError>}
		</Field>
	);
}

/** Answered, No answer or LINE: optional note + next follow-up. */
export function OutcomeForm({
	target,
	outcome,
	onDone,
	onQualify,
}: {
	target: FormTarget;
	outcome: "answered" | "no_answer" | "line";
	onDone: () => void;
	/** Leads only: save, then open Mark qualified. */
	onQualify?: (nextFollowUpAt: Date) => void;
}) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(
		target,
		outcome === "no_answer" ? "in2h" : "nextWorkingDay",
		submitted,
	);
	const done = async (
		thenQualify: boolean,
		result?: { attempt: number; unreachable: boolean },
	) => {
		if (result?.unreachable) {
			toast.warning(t("toasts.unreachable", { attempt: result.attempt }));
		} else if (outcome === "no_answer" && result) {
			toast.success(
				t("toasts.noAnswer", { attempt: result.attempt, time: followUp.label }),
			);
		} else {
			toast.success(t("toasts.saved", { time: followUp.label }));
		}
		// Refreshing now could drop this row from a list and take the form
		// with it; the qualify form (or closing the dialog) refreshes instead.
		if (thenQualify && onQualify) return onQualify(followUp.date);
		onDone();
		await refresh();
	};
	const leadLog = useMutation(
		trpc.lead.logOutcome.mutationOptions({ onError }),
	);
	const opportunityLog = useMutation(
		trpc.opportunity.logOutcome.mutationOptions({ onError }),
	);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!followUp.valid) return;
				// Which button submitted: "Save & qualify" opens the qualify form next.
				const submitter = (e.nativeEvent as SubmitEvent).submitter;
				const thenQualify = submitter?.dataset.qualify === "true";
				const fields = {
					outcome,
					note: note.trim() || undefined,
					nextFollowUpAt: followUp.date.toISOString(),
				};
				if (target.kind === "lead") {
					leadLog.mutate(
						{ leadId: target.id, ...fields },
						{ onSuccess: (result) => done(thenQualify, result) },
					);
				} else {
					opportunityLog.mutate(
						{ opportunityId: target.id, ...fields },
						{ onSuccess: () => done(false) },
					);
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>{t(`titles.${outcome}`)}</DialogTitle>
				<DialogDescription>{target.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<NoteField value={note} onChange={setNote} />
				{followUp.field}
			</FieldGroup>
			<Footer
				pending={leadLog.isPending || opportunityLog.isPending}
				label={t("save")}
				extra={
					onQualify && outcome !== "no_answer" ? (
						<Button type="submit" variant="secondary" data-qualify="true">
							{t("saveAndQualify")}
						</Button>
					) : null
				}
			/>
		</form>
	);
}

export function RescheduleForm({
	target,
	onDone,
}: {
	target: FormTarget;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(target, "current", submitted);
	const onSuccess = async () => {
		toast.success(t("toasts.saved", { time: followUp.label }));
		onDone();
		await refresh();
	};
	const leadSet = useMutation(
		trpc.lead.setFollowUp.mutationOptions({ onSuccess, onError }),
	);
	const opportunitySet = useMutation(
		trpc.opportunity.setFollowUp.mutationOptions({ onSuccess, onError }),
	);
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!followUp.valid) return;
				const nextFollowUpAt = followUp.date.toISOString();
				if (target.kind === "lead") {
					leadSet.mutate({ leadId: target.id, nextFollowUpAt });
				} else {
					opportunitySet.mutate({ opportunityId: target.id, nextFollowUpAt });
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("changeFollowUp")}</DialogTitle>
				<DialogDescription>{target.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">{followUp.field}</FieldGroup>
			<Footer
				pending={leadSet.isPending || opportunitySet.isPending}
				label={t("save")}
			/>
		</form>
	);
}

export function NoteForm({
	target,
	onDone,
}: {
	target: FormTarget;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
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
				if (!note.trim()) return;
				addNote.mutate(
					target.kind === "lead"
						? { leadId: target.id, note: note.trim() }
						: { opportunityId: target.id, note: note.trim() },
				);
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("addNote")}</DialogTitle>
				<DialogDescription>{target.customerName}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<NoteField value={note} onChange={setNote} />
			</FieldGroup>
			<Footer pending={addNote.isPending} label={t("save")} />
		</form>
	);
}

/**
 * Mark qualified (brief §6): the salesperson confirms a budget that fits,
 * when they plan to buy, which unit types they want and why they're buying.
 */
export function QualifyForm({
	target,
	onDone,
	onNext,
}: {
	target: FormTarget;
	onDone: () => void;
	/** Chained flow (qualify → confirm visit): go on without refreshing lists yet. */
	onNext?: () => void;
}) {
	const t = useTranslations("leadActions.qualify");
	const ta = useTranslations("leadActions");
	const tt = useTranslations("timelines");
	const ti = useTranslations("buyerIntents");
	const formatBaht = useFormatBaht();
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const q = target.qualification;
	const [min, setMin] = useState(
		q?.budgetMinSatang ? satangToBahtInput(q.budgetMinSatang) : "",
	);
	const [max, setMax] = useState(
		q?.budgetMaxSatang ? satangToBahtInput(q.budgetMaxSatang) : "",
	);
	const [timeline, setTimeline] = useState<BuyingTimeline[]>(
		q?.buyingTimeline ? [q.buyingTimeline] : [],
	);
	const [types, setTypes] = useState<string[]>(q?.unitTypeIds ?? []);
	const [intent, setIntent] = useState<BuyerIntent[]>(
		q?.buyerIntent ? [q.buyerIntent] : [],
	);
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(target, "current", submitted);
	const unitTypes = useQuery(
		trpc.unitType.list.queryOptions(
			{ projectId: target.projectId ?? "" },
			{ enabled: !!target.projectId },
		),
	);
	const qualify = useMutation(
		trpc.lead.qualify.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				// Refreshing now could drop this row (and the dialog) from a list.
				if (onNext) return onNext();
				onDone();
				await refresh();
			},
			onError,
		}),
	);

	const minSatang = bahtToSatang(min);
	const maxSatang = bahtToSatang(max);
	const budgetOk =
		minSatang !== null && maxSatang !== null && minSatang <= maxSatang;
	const hasTypes = (unitTypes.data?.length ?? 0) > 0;
	const typesOk = !hasTypes || types.length > 0;
	const valid =
		budgetOk &&
		timeline.length === 1 &&
		intent.length === 1 &&
		typesOk &&
		followUp.valid;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!valid || minSatang === null || maxSatang === null) return;
				const [buyingTimeline] = timeline;
				const [buyerIntent] = intent;
				if (!buyingTimeline || !buyerIntent) return;
				qualify.mutate({
					leadId: target.id,
					budgetMinSatang: minSatang,
					budgetMaxSatang: maxSatang,
					buyingTimeline,
					unitTypeIds: types,
					buyerIntent,
					nextFollowUpAt: followUp.date.toISOString(),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("title")}</DialogTitle>
				<DialogDescription>
					{t("description", { name: target.customerName })}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<FieldSet data-invalid={(submitted && !budgetOk) || undefined}>
					<FieldLegend variant="label">{t("budget")}</FieldLegend>
					<div className="grid grid-cols-2 gap-2">
						<Input
							aria-label={t("budgetMin")}
							placeholder={t("budgetMin")}
							inputMode="numeric"
							name="budgetMin"
							value={min}
							onChange={(e) => setMin(e.target.value)}
						/>
						<Input
							aria-label={t("budgetMax")}
							placeholder={t("budgetMax")}
							inputMode="numeric"
							name="budgetMax"
							value={max}
							onChange={(e) => setMax(e.target.value)}
						/>
					</div>
					{target.priceRange && (
						<FieldDescription>
							{t("projectRange", {
								min: formatBaht(target.priceRange.min),
								max: formatBaht(target.priceRange.max),
							})}
						</FieldDescription>
					)}
					{submitted && !budgetOk && (
						<FieldError>{t("budgetError")}</FieldError>
					)}
				</FieldSet>
				<ChoiceChips
					legend={t("timeline")}
					options={buyingTimelines.map((v) => ({ value: v, label: tt(v) }))}
					value={timeline}
					onChange={setTimeline}
					invalid={submitted && timeline.length !== 1}
					error={t("required")}
				/>
				{hasTypes && (
					<ChoiceChips
						legend={t("unitTypes")}
						multiple
						options={(unitTypes.data ?? []).map((u) => ({
							value: u.id,
							label: u.name,
						}))}
						value={types}
						onChange={setTypes}
						invalid={submitted && !typesOk}
						error={t("required")}
					/>
				)}
				<ChoiceChips
					legend={t("intent")}
					options={buyerIntents.map((v) => ({ value: v, label: ti(v) }))}
					value={intent}
					onChange={setIntent}
					invalid={submitted && intent.length !== 1}
					error={t("required")}
				/>
				{followUp.field}
			</FieldGroup>
			<Footer pending={qualify.isPending} label={ta("markQualified")} />
		</form>
	);
}

/**
 * A showroom visit, recorded one way (brief §6): Confirm visit on a lead (the
 * first visit converts it), Record visit on an opportunity (a repeat walk-in),
 * or Arrived on an appointment. The visit time can't be in the future (a
 * booked tour isn't a visit); a future follow-up is always set.
 */
export function VisitForm({
	target,
	appointmentId,
	onDone,
}: {
	target: FormTarget;
	/** Arrived on this appointment. */
	appointmentId?: string;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions.convert");
	const tv = useTranslations("leadActions.recordVisit");
	const ta = useTranslations("appointments");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [visitedAt, setVisitedAt] = useState(() => toDateTimeLocal(new Date()));
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(target, "nextWorkingDay", submitted);
	const visitDate = new Date(visitedAt);
	// A minute of slack so "now" from the form doesn't fail on a slow clock.
	const visitOk =
		!Number.isNaN(visitDate.getTime()) &&
		visitDate.getTime() <= Date.now() + 60_000;
	const mode = appointmentId
		? "arrived"
		: target.kind === "lead"
			? "convert"
			: "recordVisit";
	const saved = {
		arrived: ta("arrivedSaved"),
		convert: t("saved"),
		recordVisit: tv("saved"),
	}[mode];
	const options = {
		onSuccess: async () => {
			toast.success(saved);
			onDone();
			await refresh();
		},
		onError,
	};
	const convert = useMutation(trpc.lead.convert.mutationOptions(options));
	const recordVisit = useMutation(
		trpc.opportunity.recordVisit.mutationOptions(options),
	);
	const arrived = useMutation(
		trpc.appointment.arrived.mutationOptions(options),
	);
	const pending =
		convert.isPending || recordVisit.isPending || arrived.isPending;
	const title = {
		arrived: ta("arrivedTitle", { name: target.customerName }),
		convert: t("title"),
		recordVisit: tv("title"),
	}[mode];
	const description = {
		arrived: ta("arrivedDescription"),
		convert: t("description", { name: target.customerName }),
		recordVisit: tv("description", { name: target.customerName }),
	}[mode];
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!visitOk || !followUp.valid) return;
				const fields = {
					visitedAt: new Date(
						Math.min(visitDate.getTime(), Date.now()),
					).toISOString(),
					note: note.trim() || undefined,
					nextFollowUpAt: followUp.date.toISOString(),
				};
				if (appointmentId) arrived.mutate({ appointmentId, ...fields });
				else if (target.kind === "lead") {
					convert.mutate({ leadId: target.id, ...fields });
				} else recordVisit.mutate({ opportunityId: target.id, ...fields });
			}}
		>
			<DialogHeader>
				<DialogTitle>{title}</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<Field data-invalid={(submitted && !visitOk) || undefined}>
					<FieldLabel htmlFor="visited-at">{t("visitedAt")}</FieldLabel>
					<Input
						id="visited-at"
						name="visitedAt"
						type="datetime-local"
						value={visitedAt}
						max={toDateTimeLocal(new Date())}
						onChange={(e) => setVisitedAt(e.target.value)}
					/>
					{submitted && !visitOk && <FieldError>{t("future")}</FieldError>}
				</Field>
				<NoteField value={note} onChange={setNote} />
				{followUp.field}
			</FieldGroup>
			<Footer pending={pending} label={t("confirm")} />
		</form>
	);
}

/** How the buyer pays (brief §5); loan details wait for the mortgage milestone. */
export function FundingForm({
	target,
	current,
	onDone,
}: {
	target: FormTarget;
	current?: FundingType | null;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions.funding");
	const ta = useTranslations("leadActions");
	const tf = useTranslations("fundingTypes");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [value, setValue] = useState<FundingType[]>(current ? [current] : []);
	const [submitted, setSubmitted] = useState(false);
	const setFunding = useMutation(
		trpc.opportunity.setFunding.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
	const [chosen] = value;
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!chosen) return;
				setFunding.mutate({ opportunityId: target.id, fundingType: chosen });
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("title", { name: target.customerName })}</DialogTitle>
				<DialogDescription>{t("hint")}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<ChoiceChips
					legend={t("menu")}
					options={fundingTypes.map((v) => ({ value: v, label: tf(v) }))}
					value={value}
					onChange={setValue}
					invalid={submitted && !chosen}
					error={ta("reasonRequired")}
				/>
			</FieldGroup>
			<Footer pending={setFunding.isPending} label={ta("save")} />
		</form>
	);
}

/** Lead exits (Disqualify with a reason, Nurture) and the opportunity exit (Lost). */
export function CloseForm({
	target,
	exit,
	presetReason,
	onDone,
}: {
	target: FormTarget;
	exit: "disqualify" | "nurture" | "lost";
	/** Pre-chosen reason (e.g. from the fit check); still needs a confirm. */
	presetReason?: string;
	onDone: () => void;
}) {
	const t = useTranslations("leadActions");
	const td = useTranslations("disqualifyReasons");
	const tl = useTranslations("lostReasons");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [reason, setReason] = useState<string[]>(
		presetReason ? [presetReason] : [],
	);
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const onSuccess = async () => {
		toast.success(t(`toasts.closed.${exit}`));
		onDone();
		await refresh();
	};
	const disqualify = useMutation(
		trpc.lead.disqualify.mutationOptions({ onSuccess, onError }),
	);
	const nurture = useMutation(
		trpc.lead.nurture.mutationOptions({ onSuccess, onError }),
	);
	const lost = useMutation(
		trpc.opportunity.markLost.mutationOptions({ onSuccess, onError }),
	);
	const options =
		exit === "disqualify"
			? disqualifyReasons.map((r) => ({ value: r as string, label: td(r) }))
			: exit === "lost"
				? lostReasons.map((r) => ({ value: r as string, label: tl(r) }))
				: [];
	const [chosen] = reason;
	const missingReason = options.length > 0 && !chosen;
	const needsNote = chosen === "other";
	const missingNote = needsNote && !note.trim();
	const pending = disqualify.isPending || nurture.isPending || lost.isPending;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (missingReason || missingNote) return;
				const text = note.trim() || undefined;
				if (exit === "nurture") {
					nurture.mutate({ leadId: target.id, note: text });
				} else if (exit === "disqualify") {
					disqualify.mutate({
						leadId: target.id,
						reason: chosen as DisqualifyReason,
						note: text,
					});
				} else {
					lost.mutate({
						opportunityId: target.id,
						reason: chosen as LostReason,
						note: text,
					});
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>{t(`exits.${exit}`)}</DialogTitle>
				<DialogDescription>
					{t(`exitHints.${exit}`, { name: target.customerName })}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				{options.length > 0 && (
					<ChoiceChips
						legend={t("reason")}
						options={options}
						value={reason}
						onChange={setReason}
						invalid={submitted && missingReason}
						error={t("reasonRequired")}
					/>
				)}
				<NoteField
					value={note}
					onChange={setNote}
					label={needsNote ? t("noteRequired") : undefined}
					invalid={submitted && missingNote}
					error={t("noteRequiredError")}
				/>
			</FieldGroup>
			<Footer
				pending={pending}
				label={t(`exits.${exit}`)}
				destructive={exit !== "nurture"}
			/>
		</form>
	);
}
