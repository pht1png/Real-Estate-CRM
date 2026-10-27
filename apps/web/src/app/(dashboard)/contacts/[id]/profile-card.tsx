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
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@Real-Estate-CRM/ui/components/dialog";
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
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

export type ContactDetail = inferRouterOutputs<AppRouter>["contact"]["get"];

/** Shared profile (brief §4): name, phones, LINE, email, consent. */
export function ProfileCard({ contact }: { contact: ContactDetail }) {
	const t = useTranslations("contact");
	const tc = useTranslations("common");
	const format = useFormatter();
	const can = useCan();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const editable = can({ contact: ["update"] });

	const [name, setName] = useState(contact.name);
	const [lineId, setLineId] = useState(contact.lineId ?? "");
	const [email, setEmail] = useState(contact.email ?? "");
	const [newPhone, setNewPhone] = useState("");

	const refresh = () =>
		queryClient.invalidateQueries(trpc.contact.pathFilter());
	const onError = (e: { message: string }) => toast.error(e.message);
	const ok = async () => {
		toast.success(t("saved"));
		await refresh();
	};
	const update = useMutation(
		trpc.contact.update.mutationOptions({ onSuccess: ok, onError }),
	);
	const addPhone = useMutation(
		trpc.contact.addPhone.mutationOptions({
			onSuccess: async () => {
				setNewPhone("");
				await ok();
			},
			onError,
		}),
	);
	const removePhone = useMutation(
		trpc.contact.removePhone.mutationOptions({ onSuccess: ok, onError }),
	);
	const setConsent = useMutation(
		trpc.contact.setConsent.mutationOptions({ onSuccess: ok, onError }),
	);
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
							contactId: contact.id,
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
						{contact.phones.map((p) => (
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
								{editable && contact.phones.length > 1 && (
									<Dialog>
										<DialogTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`${tc("remove")} ${p.display}`}
												/>
											}
										>
											<XIcon />
										</DialogTrigger>
										<DialogContent>
											<DialogHeader>
												<DialogTitle>
													{t("removePhoneTitle", { phone: p.display })}
												</DialogTitle>
												<DialogDescription>
													{t("removePhoneDescription")}
												</DialogDescription>
											</DialogHeader>
											<DialogFooter>
												<DialogClose render={<Button variant="outline" />}>
													{tc("cancel")}
												</DialogClose>
												<DialogClose
													render={<Button variant="destructive" />}
													onClick={() =>
														removePhone.mutate({
															contactId: contact.id,
															phone: p.phoneE164,
														})
													}
												>
													{tc("remove")}
												</DialogClose>
											</DialogFooter>
										</DialogContent>
									</Dialog>
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
									addPhone.mutate({ contactId: contact.id, phone: newPhone });
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
						<Badge variant={contact.marketingConsent ? "default" : "secondary"}>
							{contact.marketingConsent ? t("consentOn") : t("consentOff")}
						</Badge>
						<span className="text-muted-foreground text-sm">
							{t("consentRecorded", {
								name: contact.consentRecordedBy ?? t("system"),
								date: format.dateTime(new Date(contact.consentRecordedAt), {
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
										contactId: contact.id,
										marketingConsent: !contact.marketingConsent,
									})
								}
							>
								{contact.marketingConsent
									? t("withdrawConsent")
									: t("giveConsent")}
							</Button>
						)}
					</div>
				</FieldSet>
			</CardContent>
		</Card>
	);
}
