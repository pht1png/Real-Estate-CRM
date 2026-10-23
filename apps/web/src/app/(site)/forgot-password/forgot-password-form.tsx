"use client";

import { Alert, AlertDescription } from "@Real-Estate-CRM/ui/components/alert";
import { FieldGroup } from "@Real-Estate-CRM/ui/components/field";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import { SubmitButton } from "@/components/submit-button";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
	const t = useTranslations("forgotPassword");
	const tv = useTranslations("validation");
	const ts = useTranslations("signIn");
	const [sent, setSent] = useState(false);

	const form = useForm({
		defaultValues: { email: "" },
		validators: { onSubmit: z.object({ email: z.email(tv("email")) }) },
		onSubmit: async ({ value }) => {
			// Same answer whether or not the account exists.
			await authClient.requestPasswordReset({
				email: value.email,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			setSent(true);
		},
	});

	return (
		<FieldGroup>
			{sent ? (
				<Alert>
					<AlertDescription>{t("sent")}</AlertDescription>
				</Alert>
			) : (
				<form
					noValidate
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
				>
					<FieldGroup>
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
						<SubmitButton form={form}>{t("submit")}</SubmitButton>
					</FieldGroup>
				</form>
			)}
			<Link
				href="/login"
				className="text-muted-foreground text-center text-sm underline-offset-4 hover:underline"
			>
				{t("back")}
			</Link>
		</FieldGroup>
	);
}
