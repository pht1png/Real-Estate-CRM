"use client";

import { normalizePhone } from "@Real-Estate-CRM/api/phone";
import {
	type BuyingTimeline,
	buyingTimelines,
} from "@Real-Estate-CRM/db/constants";
import { Alert, AlertDescription } from "@Real-Estate-CRM/ui/components/alert";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@Real-Estate-CRM/ui/components/collapsible";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Label } from "@Real-Estate-CRM/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/hooks/use-me";
import { usePipelineLabel } from "@/hooks/use-pipeline-label";
import { defaultFollowUp } from "@/lib/follow-up";
import { bahtToSatang } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

const NONE = "none";
const POOL = "pool";
const ERROR_CODES = ["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"] as const;

/** Simple select bound to string values (items give the trigger its label). */
function SimpleSelect({
	id,
	value,
	onChange,
	items,
	groups,
	invalid,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	items: { value: string; label: string }[];
	groups?: { label: string; items: { value: string; label: string }[] }[];
	invalid?: boolean;
}) {
	const all = groups ? groups.flatMap((g) => g.items) : items;
	return (
		<Select items={all} value={value} onValueChange={(v) => v && onChange(v)}>
			<SelectTrigger
				id={id}
				className="w-full"
				aria-invalid={invalid || undefined}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{groups ? (
					groups.map((g) => (
						<SelectGroup key={g.label}>
							<SelectLabel>{g.label}</SelectLabel>
							{g.items.map((i) => (
								<SelectItem key={i.value} value={i.value}>
									{i.label}
								</SelectItem>
							))}
						</SelectGroup>
					))
				) : (
					<SelectGroup>
						{items.map((i) => (
							<SelectItem key={i.value} value={i.value}>
								{i.label}
							</SelectItem>
						))}
					</SelectGroup>
				)}
			</SelectContent>
		</Select>
	);
}

/**
 * Quick capture (brief §6): name, phone, project, source (+campaign) and
 * consent. Salespeople own what they log; managers pick an owner or the pool.
 */
export function QuickCaptureForm({ onDone }: { onDone: () => void }) {
	const t = useTranslations("capture");
	const pipelineLabel = usePipelineLabel();
	const tt = useTranslations("timelines");
	const tsrc = useTranslations("sources");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const can = useCan();
	const { data: me } = useMe();
	const canAssign = can({ lead: ["assign"] });

	const projects = useQuery(trpc.project.list.queryOptions());
	const sources = useQuery(trpc.leadSource.list.queryOptions());
	const campaigns = useQuery(trpc.campaign.list.queryOptions({}));
	const team = useQuery(
		trpc.team.listMembersInScope.queryOptions(undefined, {
			enabled: canAssign,
		}),
	);

	const [chosenProjectId, setProjectId] = useState("");
	const [phone, setPhone] = useState("");
	const [typedName, setName] = useState<string | null>(null);
	const [sourceId, setSourceId] = useState("");
	const [campaignId, setCampaignId] = useState(NONE);
	const [consent, setConsent] = useState(false);
	const [owner, setOwner] = useState(POOL);
	const [followUp, setFollowUp] = useState(defaultFollowUp);
	const [budgetMin, setBudgetMin] = useState("");
	const [budgetMax, setBudgetMax] = useState("");
	const [timeline, setTimeline] = useState<string>(NONE);
	const [note, setNote] = useState("");
	const [lookupPhone, setLookupPhone] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);

	const normalized = normalizePhone(phone);
	// Debounce the duplicate check so it runs once the number stops changing.
	useEffect(() => {
		const timer = setTimeout(() => setLookupPhone(normalized), 300);
		return () => clearTimeout(timer);
	}, [normalized]);
	const lookup = useQuery(
		trpc.lead.lookupPhone.queryOptions(
			{ phone: lookupPhone ?? "" },
			{ enabled: !!lookupPhone },
		),
	);
	const existing = lookupPhone ? lookup.data?.customer : null;

	// Derived, not copied into state: default project, and the existing
	// customer's name until the user types their own.
	const projectId = chosenProjectId || projects.data?.[0]?.id || "";
	const name = typedName ?? existing?.name ?? "";

	const selectedSource = sources.data?.channels
		.flatMap((c) => c.sources)
		.find((s) => s.id === sourceId);
	const campaignItems = [
		{ value: NONE, label: t("noCampaign") },
		...(campaigns.data ?? [])
			.filter(
				(c) =>
					c.projectId === projectId &&
					(!selectedSource?.channelId ||
						c.channelId === selectedSource.channelId),
			)
			.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
	];
	const ownerItems = [
		{ value: POOL, label: t("pool") },
		...(team.data ?? [])
			.filter(
				(m) =>
					["salesperson", "sales_manager"].includes(m.role) &&
					m.projectIds.includes(projectId),
			)
			.map((m) => ({
				value: m.memberId,
				label: m.memberId === me?.memberId ? `${m.name} (${t("me")})` : m.name,
			})),
	];
	const selfOwned = !canAssign || owner === me?.memberId;

	const missing = {
		project: !projectId,
		phone: !normalized,
		name: name.trim() === "",
		source: !sourceId,
		followUp: selfOwned && !followUp,
	};
	const missingLabels = (
		[
			["project", t("project")],
			["phone", t("phone")],
			["name", t("name")],
			["source", t("source")],
			["followUp", t("followUp")],
		] as const
	)
		.filter(([key]) => missing[key])
		.map(([, label]) => label);
	const show = (key: keyof typeof missing) => submitted && missing[key];

	const capture = useMutation(
		trpc.lead.capture.mutationOptions({
			onSuccess: async (result) => {
				toast.success(t(`outcomes.${result.outcome}`));
				onDone();
				await queryClient.invalidateQueries(trpc.lead.pathFilter());
				await queryClient.invalidateQueries(trpc.customer.pathFilter());
				await queryClient.invalidateQueries(trpc.today.pathFilter());
				router.push(`/customers/${result.customerId}` as Route);
			},
			onError: (e) => {
				const code = ERROR_CODES.find((c) => c === e.data?.code);
				toast.error(t(code ? `errors.${code}` : "errors.default"));
			},
		}),
	);

	return (
		<form
			className="px-4 pb-6"
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				setSubmitted(true);
				if (missingLabels.length > 0) return;
				capture.mutate({
					projectId,
					name: name.trim(),
					phone,
					sourceId,
					campaignId: campaignId === NONE ? undefined : campaignId,
					marketingConsent: consent,
					...(canAssign && { ownerMemberId: owner === POOL ? null : owner }),
					nextFollowUpAt:
						selfOwned && followUp
							? new Date(followUp).toISOString()
							: undefined,
					budgetMinSatang: bahtToSatang(budgetMin) ?? undefined,
					budgetMaxSatang: bahtToSatang(budgetMax) ?? undefined,
					buyingTimeline:
						timeline === NONE ? undefined : (timeline as BuyingTimeline),
					note: note.trim() || undefined,
				});
			}}
		>
			<FieldGroup>
				<Field data-invalid={show("project") || undefined}>
					<FieldLabel htmlFor="cap-project">{t("project")}</FieldLabel>
					<SimpleSelect
						id="cap-project"
						value={projectId}
						invalid={show("project")}
						onChange={(v) => {
							setProjectId(v);
							setCampaignId(NONE);
						}}
						items={(projects.data ?? []).map((p) => ({
							value: p.id,
							label: p.name,
						}))}
					/>
				</Field>
				<Field
					data-invalid={
						(phone.length > 6 && !normalized) || show("phone") || undefined
					}
				>
					<FieldLabel htmlFor="cap-phone">{t("phone")}</FieldLabel>
					<Input
						id="cap-phone"
						name="phone"
						type="tel"
						inputMode="tel"
						autoComplete="off"
						value={phone}
						aria-invalid={
							(phone.length > 6 && !normalized) || show("phone") || undefined
						}
						onChange={(e) => setPhone(e.target.value)}
					/>
					{phone.length > 6 && !normalized ? (
						<FieldError>{t("invalidPhone")}</FieldError>
					) : show("phone") ? (
						<FieldError>{t("required")}</FieldError>
					) : (
						<FieldDescription>{t("phoneHint")}</FieldDescription>
					)}
				</Field>
				{/* Announced to screen readers when the duplicate check finds someone. */}
				<div aria-live="polite" aria-atomic="true">
					{existing && (
						<Alert>
							<AlertDescription>
								<p className="font-medium">
									{t("existing", { name: existing.name })}
								</p>
								{existing.leads.length === 0 ? (
									<p>{t("existingNone")}</p>
								) : (
									<ul>
										{existing.leads.map((i) => (
											<li key={i.projectId}>
												{i.projectName} · {pipelineLabel(i.status, i.stage)} ·{" "}
												{i.ownerName ?? "—"}
											</li>
										))}
									</ul>
								)}
							</AlertDescription>
						</Alert>
					)}
				</div>
				<Field data-invalid={show("name") || undefined}>
					<FieldLabel htmlFor="cap-name">{t("name")}</FieldLabel>
					<Input
						id="cap-name"
						name="customerName"
						autoComplete="off"
						value={name}
						maxLength={120}
						aria-invalid={show("name") || undefined}
						onChange={(e) => setName(e.target.value)}
					/>
					{show("name") && <FieldError>{t("required")}</FieldError>}
				</Field>
				<Field data-invalid={show("source") || undefined}>
					<FieldLabel htmlFor="cap-source">{t("source")}</FieldLabel>
					<SimpleSelect
						id="cap-source"
						value={sourceId}
						invalid={show("source")}
						onChange={(v) => {
							setSourceId(v);
							setCampaignId(NONE);
						}}
						items={[]}
						groups={[
							...(sources.data?.channels ?? []).map((c) => ({
								label: c.name,
								items: c.sources
									.filter((s) => !s.archived)
									.map((s) => ({ value: s.id, label: s.name })),
							})),
							...(sources.data?.unknownSourceId
								? [
										{
											label: tsrc("unknown"),
											items: [
												{
													value: sources.data.unknownSourceId,
													label: tsrc("unknown"),
												},
											],
										},
									]
								: []),
						]}
					/>
					{show("source") && <FieldError>{t("required")}</FieldError>}
				</Field>
				{campaignItems.length > 1 && (
					<Field>
						<FieldLabel htmlFor="cap-campaign">{t("campaign")}</FieldLabel>
						<SimpleSelect
							id="cap-campaign"
							value={campaignId}
							onChange={setCampaignId}
							items={campaignItems}
						/>
					</Field>
				)}
				<div className="flex items-start gap-2">
					<Checkbox
						id="cap-consent"
						name="marketingConsent"
						checked={consent}
						onCheckedChange={(c) => setConsent(!!c)}
					/>
					<Label htmlFor="cap-consent" className="leading-snug">
						{t("consent")}
					</Label>
				</div>
				{canAssign && (
					<Field>
						<FieldLabel htmlFor="cap-owner">{t("owner")}</FieldLabel>
						<SimpleSelect
							id="cap-owner"
							value={owner}
							onChange={setOwner}
							items={ownerItems}
						/>
					</Field>
				)}
				{selfOwned && (
					<Field data-invalid={show("followUp") || undefined}>
						<FieldLabel htmlFor="cap-follow-up">{t("followUp")}</FieldLabel>
						<Input
							id="cap-follow-up"
							name="nextFollowUpAt"
							type="datetime-local"
							value={followUp}
							aria-invalid={show("followUp") || undefined}
							onChange={(e) => setFollowUp(e.target.value)}
						/>
						{show("followUp") && <FieldError>{t("required")}</FieldError>}
					</Field>
				)}
				<Collapsible>
					<CollapsibleTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="w-fit"
							/>
						}
					>
						{t("more")}
						<ChevronDownIcon data-icon="inline-end" />
					</CollapsibleTrigger>
					<CollapsibleContent>
						<FieldGroup className="pt-3">
							<div className="grid grid-cols-2 gap-3">
								<Field>
									<FieldLabel htmlFor="cap-bmin">{t("budgetMin")}</FieldLabel>
									<Input
										id="cap-bmin"
										name="budgetMin"
										inputMode="decimal"
										value={budgetMin}
										onChange={(e) => setBudgetMin(e.target.value)}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="cap-bmax">{t("budgetMax")}</FieldLabel>
									<Input
										id="cap-bmax"
										name="budgetMax"
										inputMode="decimal"
										value={budgetMax}
										onChange={(e) => setBudgetMax(e.target.value)}
									/>
								</Field>
							</div>
							<Field>
								<FieldLabel htmlFor="cap-timeline">{t("timeline")}</FieldLabel>
								<SimpleSelect
									id="cap-timeline"
									value={timeline}
									onChange={setTimeline}
									items={[
										{ value: NONE, label: "—" },
										...buyingTimelines.map((b) => ({ value: b, label: tt(b) })),
									]}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="cap-note">{t("note")}</FieldLabel>
								<Textarea
									id="cap-note"
									name="note"
									value={note}
									maxLength={1000}
									onChange={(e) => setNote(e.target.value)}
								/>
							</Field>
						</FieldGroup>
					</CollapsibleContent>
				</Collapsible>
				{submitted && missingLabels.length > 0 && (
					<p role="alert" className="text-destructive text-sm">
						{t("missing", { fields: missingLabels.join(", ") })}
					</p>
				)}
				<Button type="submit" size="lg" disabled={capture.isPending}>
					{capture.isPending && <Spinner data-icon="inline-start" />}
					{t("save")}
				</Button>
			</FieldGroup>
		</form>
	);
}
