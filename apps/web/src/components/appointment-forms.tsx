"use client";

import {
	type AppointmentCancelReason,
	appointmentCancelReasons,
} from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
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
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@Real-Estate-CRM/ui/components/dropdown-menu";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	CalendarClockIcon,
	DoorOpenIcon,
	EllipsisIcon,
	UserXIcon,
	XCircleIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { toDateTimeLocal } from "@/lib/follow-up";
import { useTRPC } from "@/utils/trpc";

import { ChoiceChips } from "./choice-chips";
import { useFollowUp, useShortTime } from "./follow-up-picker";
import {
	type FormTarget,
	QualifyForm,
	useLeadError,
	useRefreshLeads,
	VisitForm,
} from "./lead-forms";

const pad = (n: number) => String(n).padStart(2, "0");
/** A date as a date input value (YYYY-MM-DD), in the browser's time zone. */
const toDateInput = (d: Date) =>
	`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function Footer({ pending, label }: { pending: boolean; label: string }) {
	const tc = useTranslations("common");
	return (
		<DialogFooter>
			<DialogClose render={<Button type="button" variant="outline" />}>
				{tc("cancel")}
			</DialogClose>
			<Button type="submit" disabled={pending}>
				{label}
			</Button>
		</DialogFooter>
	);
}

/** The clash (CONFLICT) gets its own message; other errors the usual ones. */
function useAppointmentError() {
	const t = useTranslations("appointments");
	const onError = useLeadError();
	return (e: { data?: { code?: string } | null }) =>
		e.data?.code === "CONFLICT" ? toast.error(t("clash")) : onError(e);
}

/**
 * Book a showroom visit (brief §6), or move one: the host's free times that
 * day inside office hours, their booked slots, or any future time. A first
 * tour for a lead; a follow-up visit for an opportunity.
 */
export function BookAppointmentForm({
	target,
	appointment,
	onDone,
}: {
	target: FormTarget;
	/** Reschedule this appointment instead of booking a new one. */
	appointment?: { id: string; startsAt: Date | string };
	onDone: () => void;
}) {
	const t = useTranslations("appointments");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useAppointmentError();
	const shortTime = useShortTime();
	const format = useFormatter();
	const [date, setDate] = useState(() =>
		toDateInput(appointment ? new Date(appointment.startsAt) : new Date()),
	);
	const [chosen, setChosen] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);
	const forTarget =
		target.kind === "lead"
			? { leadId: target.id }
			: { opportunityId: target.id };
	const slots = useQuery(
		trpc.appointment.slots.queryOptions(
			{ ...forTarget, date, appointmentId: appointment?.id },
			{ enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) },
		),
	);
	const value =
		chosen ??
		(slots.data?.free[0] ? toDateTimeLocal(new Date(slots.data.free[0])) : "");
	const startsAt = new Date(value);
	const valid =
		!Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now();
	const onSuccess = async () => {
		toast.success(
			t(appointment ? "rescheduled" : "saved", { time: shortTime(startsAt) }),
		);
		onDone();
		await refresh();
	};
	const book = useMutation(
		trpc.appointment.book.mutationOptions({ onSuccess, onError }),
	);
	const reschedule = useMutation(
		trpc.appointment.reschedule.mutationOptions({ onSuccess, onError }),
	);
	const time = (d: Date | string) =>
		format.dateTime(new Date(d), { timeStyle: "short" });

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!valid) return;
				if (appointment) {
					reschedule.mutate({
						appointmentId: appointment.id,
						startsAt: startsAt.toISOString(),
					});
				} else {
					book.mutate({ ...forTarget, startsAt: startsAt.toISOString() });
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{t(appointment ? "rescheduleTitle" : "bookTitle")}
				</DialogTitle>
				<DialogDescription>
					{t("bookDescription", {
						name: target.contactName,
						minutes: slots.data?.minutes ?? 60,
					})}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<Field>
					<FieldLabel htmlFor="appointment-date">{t("date")}</FieldLabel>
					<Input
						id="appointment-date"
						name="date"
						type="date"
						value={date}
						min={toDateInput(new Date())}
						onChange={(e) => {
							setDate(e.target.value);
							setChosen(null);
						}}
					/>
				</Field>
				<FieldSet>
					<FieldLegend variant="label">{t("free")}</FieldLegend>
					{slots.data && slots.data.free.length === 0 ? (
						<FieldDescription>{t("noFree")}</FieldDescription>
					) : (
						<div className="grid grid-cols-4 gap-2">
							{slots.data?.free.map((slot) => {
								const v = toDateTimeLocal(new Date(slot));
								return (
									<Button
										key={v}
										type="button"
										size="sm"
										variant={v === value ? "default" : "outline"}
										aria-pressed={v === value}
										className="tabular-nums"
										onClick={() => setChosen(v)}
									>
										{time(slot)}
									</Button>
								);
							})}
						</div>
					)}
					{(slots.data?.booked.length ?? 0) > 0 && (
						<FieldDescription>
							{t("booked")}:{" "}
							{slots.data?.booked
								.map((b) =>
									t("bookedItem", {
										time: `${time(b.startsAt)}–${time(b.endsAt)}`,
										name: b.contactName,
									}),
								)
								.join(", ")}
						</FieldDescription>
					)}
				</FieldSet>
				<Field data-invalid={(submitted && !valid) || undefined}>
					<FieldLabel htmlFor="appointment-at">{t("time")}</FieldLabel>
					<Input
						id="appointment-at"
						name="startsAt"
						type="datetime-local"
						value={value}
						aria-invalid={(submitted && !valid) || undefined}
						onChange={(e) => setChosen(e.target.value)}
					/>
					{submitted && !valid && <FieldError>{t("future")}</FieldError>}
				</Field>
			</FieldGroup>
			<Footer
				pending={book.isPending || reschedule.isPending}
				label={t(appointment ? "rescheduleSave" : "save")}
			/>
		</form>
	);
}

/** Cancel with a reason (Other needs a note). Rescheduling is not a cancel. */
export function CancelAppointmentForm({
	appointmentId,
	contactName,
	onDone,
}: {
	appointmentId: string;
	contactName: string;
	onDone: () => void;
}) {
	const t = useTranslations("appointments");
	const ta = useTranslations("leadActions");
	const tr = useTranslations("appointmentCancelReasons");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [reason, setReason] = useState<AppointmentCancelReason[]>([]);
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const cancel = useMutation(
		trpc.appointment.cancel.mutationOptions({
			onSuccess: async () => {
				toast.success(t("cancelled"));
				onDone();
				await refresh();
			},
			onError,
		}),
	);
	const [chosen] = reason;
	const missingNote = chosen === "other" && !note.trim();
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (!chosen || missingNote) return;
				cancel.mutate({
					appointmentId,
					reason: chosen,
					note: note.trim() || undefined,
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{t("cancel")}</DialogTitle>
				<DialogDescription>
					{t("cancelDescription", { name: contactName })}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<ChoiceChips
					legend={ta("reason")}
					options={appointmentCancelReasons.map((r) => ({
						value: r,
						label: tr(r),
					}))}
					value={reason}
					onChange={setReason}
					invalid={submitted && !chosen}
					error={ta("reasonRequired")}
				/>
				<Field data-invalid={(submitted && missingNote) || undefined}>
					<FieldLabel htmlFor="cancel-note">
						{chosen === "other" ? ta("noteRequired") : ta("note")}
					</FieldLabel>
					<Textarea
						id="cancel-note"
						name="note"
						value={note}
						maxLength={1000}
						placeholder={ta("notePlaceholder")}
						onChange={(e) => setNote(e.target.value)}
					/>
					{submitted && missingNote && (
						<FieldError>{ta("noteRequiredError")}</FieldError>
					)}
				</Field>
			</FieldGroup>
			<Footer pending={cancel.isPending} label={t("cancel")} />
		</form>
	);
}

/** They didn't come: logged, with the next follow-up on the lead or opportunity. */
function NoShowForm({
	appointmentId,
	target,
	onDone,
}: {
	appointmentId: string;
	target: FormTarget;
	onDone: () => void;
}) {
	const t = useTranslations("appointments");
	const ta = useTranslations("leadActions");
	const trpc = useTRPC();
	const refresh = useRefreshLeads();
	const onError = useLeadError();
	const [note, setNote] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const followUp = useFollowUp(target, "in2h", submitted);
	const noShow = useMutation(
		trpc.appointment.noShow.mutationOptions({
			onSuccess: async () => {
				toast.success(t("noShowSaved", { time: followUp.label }));
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
				noShow.mutate({
					appointmentId,
					note: note.trim() || undefined,
					nextFollowUpAt: followUp.date.toISOString(),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{t("noShowTitle", { name: target.contactName })}
				</DialogTitle>
				<DialogDescription>{t("noShowDescription")}</DialogDescription>
			</DialogHeader>
			<FieldGroup className="py-4">
				<Field>
					<FieldLabel htmlFor="no-show-note">{ta("note")}</FieldLabel>
					<Textarea
						id="no-show-note"
						name="note"
						value={note}
						maxLength={1000}
						placeholder={ta("notePlaceholder")}
						onChange={(e) => setNote(e.target.value)}
					/>
				</Field>
				{followUp.field}
			</FieldGroup>
			<Footer pending={noShow.isPending} label={ta("save")} />
		</form>
	);
}

export type AppointmentTarget = {
	appointmentId: string;
	leadId: string;
	opportunityId: string | null;
	startsAt: Date | string;
	contactName: string;
	projectId?: string;
	/** First tours: a qualified lead converts on arrival; others qualify first. */
	qualified?: boolean;
	qualification?: FormTarget["qualification"];
	priceRange?: FormTarget["priceRange"];
};

type Pane = "arrived" | "qualify" | "noShow" | "reschedule" | "cancel";

/** Arrived / Didn't come, and Reschedule / Cancel in a menu. */
export function AppointmentActions({
	appointment: a,
}: {
	appointment: AppointmentTarget;
}) {
	const t = useTranslations("appointments");
	const tl = useTranslations("leadActions");
	const refresh = useRefreshLeads();
	const [pane, setPane] = useState<Pane | null>(null);
	// The visit's follow-up belongs to the lead (first tour) or the opportunity.
	const target: FormTarget = a.opportunityId
		? { kind: "opportunity", id: a.opportunityId, contactName: a.contactName }
		: {
				kind: "lead",
				id: a.leadId,
				contactName: a.contactName,
				projectId: a.projectId,
				qualification: a.qualification,
				priceRange: a.priceRange,
			};
	const firstTourUnvetted = !a.opportunityId && !a.qualified;
	const done = () => setPane(null);

	return (
		<div className="flex gap-2">
			<Button
				className="flex-1"
				onClick={() => setPane(firstTourUnvetted ? "qualify" : "arrived")}
			>
				<DoorOpenIcon data-icon="inline-start" />
				{t("arrived")}
			</Button>
			<Button variant="outline" onClick={() => setPane("noShow")}>
				<UserXIcon data-icon="inline-start" />
				{t("noShow")}
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="outline" size="icon" aria-label={tl("more")} />
					}
				>
					<EllipsisIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => setPane("reschedule")}>
						<CalendarClockIcon />
						{t("reschedule")}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => setPane("cancel")}
					>
						<XCircleIcon />
						{t("cancel")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog
				open={pane !== null}
				onOpenChange={(open) => {
					if (open) return;
					setPane(null);
					// Qualify may have saved before the visit was confirmed.
					void refresh();
				}}
			>
				<DialogContent className="max-h-[90svh] overflow-y-auto">
					{pane === "qualify" && (
						<QualifyForm
							target={target}
							onDone={done}
							onNext={() => setPane("arrived")}
						/>
					)}
					{pane === "arrived" && (
						<VisitForm
							target={target}
							appointmentId={a.appointmentId}
							onDone={done}
						/>
					)}
					{pane === "noShow" && (
						<NoShowForm
							appointmentId={a.appointmentId}
							target={target}
							onDone={done}
						/>
					)}
					{pane === "reschedule" && (
						<BookAppointmentForm
							target={target}
							appointment={{ id: a.appointmentId, startsAt: a.startsAt }}
							onDone={done}
						/>
					)}
					{pane === "cancel" && (
						<CancelAppointmentForm
							appointmentId={a.appointmentId}
							contactName={a.contactName}
							onDone={done}
						/>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
