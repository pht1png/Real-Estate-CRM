"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { XIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

export type CustomerDetail = inferRouterOutputs<AppRouter>["customer"]["get"];

/** Shared profile (brief §4): name, phones, LINE, email, consent, referrer. */
export function ProfileCard({ customer }: { customer: CustomerDetail }) {
	const t = useTranslations("customer");
	const tc = useTranslations("common");
	const format = useFormatter();
	const can = useCan();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const editable = can({ customer: ["update"] });

	const [name, setName] = useState(customer.name);
	const [lineId, setLineId] = useState(customer.lineId ?? "");
	const [email, setEmail] = useState(customer.email ?? "");
	const [newPhone, setNewPhone] = useState("");
	const [referrerPhone, setReferrerPhone] = useState("");

	const refresh = () =>
		queryClient.invalidateQueries(trpc.customer.pathFilter());
	const onError = (e: { message: string }) => toast.error(e.message);
	const ok = async () => {
		toast.success(t("saved"));
		await refresh();
	};
	const update = useMutation(
		trpc.customer.update.mutationOptions({ onSuccess: ok, onError }),
	);
	const addPhone = useMutation(
		trpc.customer.addPhone.mutationOptions({
			onSuccess: async () => {
				setNewPhone("");
				await ok();
			},
			onError,
		}),
	);
	const removePhone = useMutation(
		trpc.customer.removePhone.mutationOptions({ onSuccess: ok, onError }),
	);
	const setConsent = useMutation(
		trpc.customer.setConsent.mutationOptions({ onSuccess: ok, onError }),
	);
	const setReferrer = useMutation(
		trpc.customer.setReferrer.mutationOptions({ onSuccess: ok, onError }),
	);

	async function findReferrer() {
		const result = await queryClient.fetchQuery(
			trpc.lead.lookupPhone.queryOptions({ phone: referrerPhone }),
		);
		if (!result.customer) return toast.error(t("referrerNotFound"));
		setReferrer.mutate({
			customerId: customer.id,
			referrerCustomerId: result.customer.id,
		});
		setReferrerPhone("");
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("profile")}</h2>
				</CardTitle>
				<CardDescription>{t("profileHint")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate({
							customerId: customer.id,
							name: name.trim(),
							lineId: lineId.trim() || null,
							email: email.trim() || null,
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="cust-name">{t("name")}</FieldLabel>
							<Input
								id="cust-name"
								value={name}
								disabled={!editable}
								maxLength={120}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<div className="grid gap-4 sm:grid-cols-2">
							<Field>
								<FieldLabel htmlFor="cust-line">{t("lineId")}</FieldLabel>
								<Input
									id="cust-line"
									value={lineId}
									disabled={!editable}
									onChange={(e) => setLineId(e.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="cust-email">{t("email")}</FieldLabel>
								<Input
									id="cust-email"
									type="email"
									value={email}
									disabled={!editable}
									onChange={(e) => setEmail(e.target.value)}
								/>
							</Field>
						</div>
						{editable && (
							<Button
								type="submit"
								className="sm:w-auto sm:self-start"
								disabled={!name.trim() || update.isPending}
							>
								{tc("save")}
							</Button>
						)}
					</FieldGroup>
				</form>

				<FieldSet>
					<FieldLegend variant="label">{t("phones")}</FieldLegend>
					<ul className="flex flex-col gap-2">
						{customer.phones.map((p) => (
							<li key={p.phoneE164} className="flex items-center gap-2">
								<a
									href={`tel:${p.phoneE164}`}
									className="font-medium underline-offset-4 hover:underline"
								>
									{p.display}
								</a>
								{p.isPrimary && (
									<Badge variant="secondary">{t("primary")}</Badge>
								)}
								{editable && customer.phones.length > 1 && (
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`${tc("remove")} ${p.display}`}
										onClick={() =>
											removePhone.mutate({
												customerId: customer.id,
												phone: p.phoneE164,
											})
										}
									>
										<XIcon />
									</Button>
								)}
							</li>
						))}
					</ul>
					{editable && (
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (newPhone.trim())
									addPhone.mutate({ customerId: customer.id, phone: newPhone });
							}}
						>
							<Input
								aria-label={t("addPhone")}
								type="tel"
								value={newPhone}
								onChange={(e) => setNewPhone(e.target.value)}
							/>
							<Button
								type="submit"
								variant="outline"
								disabled={addPhone.isPending}
							>
								{t("addPhone")}
							</Button>
						</form>
					)}
				</FieldSet>

				<FieldSet>
					<FieldLegend variant="label">{t("consent")}</FieldLegend>
					<div className="flex flex-wrap items-center gap-2">
						<Badge
							variant={customer.marketingConsent ? "default" : "secondary"}
						>
							{customer.marketingConsent ? t("consentOn") : t("consentOff")}
						</Badge>
						<span className="text-muted-foreground text-sm">
							{t("consentRecorded", {
								name: customer.consentRecordedBy ?? t("system"),
								date: format.dateTime(new Date(customer.consentRecordedAt), {
									dateStyle: "medium",
									timeStyle: "short",
								}),
							})}
						</span>
						{editable && (
							<Button
								variant="outline"
								size="sm"
								disabled={setConsent.isPending}
								onClick={() =>
									setConsent.mutate({
										customerId: customer.id,
										marketingConsent: !customer.marketingConsent,
									})
								}
							>
								{customer.marketingConsent
									? t("withdrawConsent")
									: t("giveConsent")}
							</Button>
						)}
					</div>
				</FieldSet>

				<FieldSet>
					<FieldLegend variant="label">{t("referrer")}</FieldLegend>
					<div className="flex flex-wrap items-center gap-2 text-sm">
						{customer.referredBy ? (
							<>
								<Link
									href={`/customers/${customer.referredBy.id}` as Route}
									className="underline-offset-4 hover:underline"
								>
									{customer.referredBy.name}
								</Link>
								{editable && (
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={tc("remove")}
										onClick={() =>
											setReferrer.mutate({
												customerId: customer.id,
												referrerCustomerId: null,
											})
										}
									>
										<XIcon />
									</Button>
								)}
							</>
						) : (
							<span className="text-muted-foreground">{t("noReferrer")}</span>
						)}
					</div>
					{editable && (
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (referrerPhone.trim()) findReferrer();
							}}
						>
							<Input
								aria-label={t("referrerSet")}
								placeholder={t("referrerSet")}
								type="tel"
								value={referrerPhone}
								onChange={(e) => setReferrerPhone(e.target.value)}
							/>
							<Button type="submit" variant="outline">
								{tc("save")}
							</Button>
						</form>
					)}
				</FieldSet>
			</CardContent>
		</Card>
	);
}
