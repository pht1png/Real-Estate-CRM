"use client";

import { Alert, AlertDescription } from "@Real-Estate-CRM/ui/components/alert";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { FieldGroup } from "@Real-Estate-CRM/ui/components/field";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import SignInForm from "@/components/sign-in-form";
import { SubmitButton } from "@/components/submit-button";
import { authClient } from "@/lib/auth-client";

/**
 * Invitation link target. New people create their account (allowed only with
 * this invitation id, for the invited email); existing users sign in. Either
 * way the invitation is then accepted and the new company becomes active.
 */
export function AcceptInvitation({ invitationId }: { invitationId: string }) {
	const t = useTranslations("invitation");
	const ts = useTranslations("signIn");
	const tv = useTranslations("validation");
	const router = useRouter();
	const [mode, setMode] = useState<"create" | "signIn">("create");
	const [failed, setFailed] = useState(false);

	async function accept() {
		const { data, error } = await authClient.organization.acceptInvitation({
			invitationId,
		});
		if (error || !data) {
			setFailed(true);
			return;
		}
		await authClient.organization.setActive({
			organizationId: data.member.organizationId,
		});
		toast.success(t("joined"));
		router.push("/dashboard");
	}

	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: {
			onSubmit: z.object({
				name: z.string().trim().min(2, tv("name")),
				email: z.email(tv("email")),
				password: z.string().min(8, tv("password")),
			}),
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.signUp.email(value, {
				query: { invitationId },
			});
			if (error) {
				setFailed(true);
				return;
			}
			await accept();
		},
	});

	if (failed) {
		return (
			<Alert variant="destructive">
				<AlertDescription>{t("failed")}</AlertDescription>
			</Alert>
		);
	}

	return (
		<FieldGroup>
			<p className="text-muted-foreground text-sm">
				{mode === "create"
					? t("newAccountDescription")
					: t("existingDescription")}
			</p>
			{mode === "create" ? (
				<form
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<FieldGroup>
						<form.Field name="name">
							{(field) => (
								<TextField
									field={field}
									label={t("name")}
									autoComplete="name"
								/>
							)}
						</form.Field>
						<form.Field name="email">
							{(field) => (
								<TextField
									field={field}
									label={ts("email")}
									type="email"
									autoComplete="email"
								/>
							)}
						</form.Field>
						<form.Field name="password">
							{(field) => (
								<TextField
									field={field}
									label={ts("password")}
									type="password"
									autoComplete="new-password"
								/>
							)}
						</form.Field>
						<SubmitButton form={form}>{t("createAndJoin")}</SubmitButton>
					</FieldGroup>
				</form>
			) : (
				<SignInForm submitLabel={t("signInAndJoin")} onSignedIn={accept} />
			)}
			<Button
				type="button"
				variant="link"
				onClick={() => setMode(mode === "create" ? "signIn" : "create")}
			>
				{mode === "create" ? t("haveAccount") : t("needAccount")}
			</Button>
		</FieldGroup>
	);
}
