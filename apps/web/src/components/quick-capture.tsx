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
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@Real-Estate-CRM/ui/components/sheet";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCan, useMe } from "@/hooks/use-me";
import { bahtToSatang } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

const NONE = "none";
const POOL = "pool";

/** Tomorrow 10:00 local time, as a datetime-local value. */
function defaultFollowUp() {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	d.setHours(10, 0, 0, 0);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

/** Simple select bound to string values (items give the trigger its label). */
function SimpleSelect({
	id,
	value,
	onChange,
	items,
	groups,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	items: { value: string; label: string }[];
	groups?: { label: string; items: { value: string; label: string }[] }[];
}) {
	const all = groups ? groups.flatMap((g) => g.items) : items;
	return (
		<Select items={all} value={value} onValueChange={(v) => v && onChange(v)}>
			<SelectTrigger id={id} className="w-full">
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
export function QuickCapture() {
	const t = useTranslations("capture");
	const ts = useTranslations("stages");
	const tt = useTranslations("timelines");
	const tsrc = useTranslations("sources");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const can = useCan();
	const { data: me } = useMe();
	const [open, setOpen] = useState(false);

	const projects = useQuery(
		trpc.project.list.queryOptions(undefined, { enabled: open }),
	);
	const sources = useQuery(
		trpc.leadSource.list.queryOptions(undefined, { enabled: open }),
	);
	const campaigns = useQuery(
		trpc.campaign.list.queryOptions({}, { enabled: open }),
	);
	const canAssign = can({ lead: ["assign"] });
	const team = useQuery(
		trpc.team.listMembersInScope.queryOptions(undefined, {
			enabled: open && canAssign,
		}),
	);

	const [projectId, setProjectId] = useState("");
	const [phone, setPhone] = useState("");
	const [name, setName] = useState("");
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

	const normalized = normalizePhone(phone);
	// Debounced duplicate check once a valid number has been typed.
	useEffect(() => {
		const timer = setTimeout(() => setLookupPhone(normalized), 300);
		return () => clearTimeout(timer);
	}, [normalized]);
	const lookup = useQuery(
		trpc.lead.lookupPhone.queryOptions(
			{ phone: lookupPhone ?? "" },
			{ enabled: open && !!lookupPhone },
		),
	);
	const existing = lookupPhone ? lookup.data?.customer : null;
	useEffect(() => {
		if (existing && !name) setName(existing.name);
	}, [existing, name]);

	useEffect(() => {
		if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
	}, [projects.data, projectId]);

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

	function reset() {
		setPhone("");
		setName("");
		setCampaignId(NONE);
		setConsent(false);
		setFollowUp(defaultFollowUp());
		setBudgetMin("");
		setBudgetMax("");
		setTimeline(NONE);
		setNote("");
		setLookupPhone(null);
	}

	const capture = useMutation(
		trpc.lead.capture.mutationOptions({
			onSuccess: async (result) => {
				toast.success(t(`outcomes.${result.outcome}`));
				setOpen(false);
				reset();
				await queryClient.invalidateQueries(trpc.lead.pathFilter());
				await queryClient.invalidateQueries(trpc.customer.pathFilter());
				router.push(`/customers/${result.customerId}` as Route);
			},
			onError: (e) => toast.error(e.message),
		}),
	);

	if (!can({ lead: ["capture"] })) return null;

	const valid =
		!!projectId &&
		!!normalized &&
		name.trim() !== "" &&
		!!sourceId &&
		(!selfOwned || !!followUp);

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger render={<Button size="sm" />}>
				<PlusIcon data-icon="inline-start" />
				<span className="hidden sm:inline">{t("title")}</span>
				<span className="sr-only sm:hidden">{t("title")}</span>
			</SheetTrigger>
			<SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
				<SheetHeader>
					<SheetTitle>{t("title")}</SheetTitle>
					<SheetDescription>{t("description")}</SheetDescription>
				</SheetHeader>
				<form
					className="px-4 pb-6"
					onSubmit={(e) => {
						e.preventDefault();
						if (!valid) return;
						capture.mutate({
							projectId,
							name: name.trim(),
							phone,
							sourceId,
							campaignId: campaignId === NONE ? undefined : campaignId,
							marketingConsent: consent,
							...(canAssign && {
								ownerMemberId: owner === POOL ? null : owner,
							}),
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
						<Field>
							<FieldLabel htmlFor="cap-project">{t("project")}</FieldLabel>
							<SimpleSelect
								id="cap-project"
								value={projectId}
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
							data-invalid={(phone.length > 6 && !normalized) || undefined}
						>
							<FieldLabel htmlFor="cap-phone">{t("phone")}</FieldLabel>
							<Input
								id="cap-phone"
								type="tel"
								inputMode="tel"
								autoComplete="off"
								value={phone}
								aria-invalid={(phone.length > 6 && !normalized) || undefined}
								onChange={(e) => setPhone(e.target.value)}
							/>
							{phone.length > 6 && !normalized ? (
								<FieldError>{t("invalidPhone")}</FieldError>
							) : (
								<FieldDescription>{t("phoneHint")}</FieldDescription>
							)}
						</Field>
						{existing && (
							<Alert>
								<AlertDescription>
									<p className="font-medium">
										{t("existing", { name: existing.name })}
									</p>
									{existing.interests.length === 0 ? (
										<p>{t("existingNone")}</p>
									) : (
										<ul>
											{existing.interests.map((i) => (
												<li key={i.projectId}>
													{i.projectName} · {ts(i.stage)} · {i.ownerName ?? "—"}
												</li>
											))}
										</ul>
									)}
								</AlertDescription>
							</Alert>
						)}
						<Field>
							<FieldLabel htmlFor="cap-name">{t("name")}</FieldLabel>
							<Input
								id="cap-name"
								value={name}
								maxLength={120}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="cap-source">{t("source")}</FieldLabel>
							<SimpleSelect
								id="cap-source"
								value={sourceId}
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
							<Field>
								<FieldLabel htmlFor="cap-follow-up">{t("followUp")}</FieldLabel>
								<Input
									id="cap-follow-up"
									type="datetime-local"
									value={followUp}
									onChange={(e) => setFollowUp(e.target.value)}
								/>
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
											<FieldLabel htmlFor="cap-bmin">
												{t("budgetMin")}
											</FieldLabel>
											<Input
												id="cap-bmin"
												inputMode="decimal"
												value={budgetMin}
												onChange={(e) => setBudgetMin(e.target.value)}
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor="cap-bmax">
												{t("budgetMax")}
											</FieldLabel>
											<Input
												id="cap-bmax"
												inputMode="decimal"
												value={budgetMax}
												onChange={(e) => setBudgetMax(e.target.value)}
											/>
										</Field>
									</div>
									<Field>
										<FieldLabel htmlFor="cap-timeline">
											{t("timeline")}
										</FieldLabel>
										<SimpleSelect
											id="cap-timeline"
											value={timeline}
											onChange={setTimeline}
											items={[
												{ value: NONE, label: "—" },
												...buyingTimelines.map((b) => ({
													value: b,
													label: tt(b),
												})),
											]}
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="cap-note">{t("note")}</FieldLabel>
										<Textarea
											id="cap-note"
											value={note}
											maxLength={1000}
											onChange={(e) => setNote(e.target.value)}
										/>
									</Field>
								</FieldGroup>
							</CollapsibleContent>
						</Collapsible>
						<Button
							type="submit"
							size="lg"
							disabled={!valid || capture.isPending}
						>
							{capture.isPending && <Spinner data-icon="inline-start" />}
							{t("save")}
						</Button>
					</FieldGroup>
				</form>
			</SheetContent>
		</Sheet>
	);
}
