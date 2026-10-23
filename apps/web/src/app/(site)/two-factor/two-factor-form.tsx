"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { FieldGroup } from "@Real-Estate-CRM/ui/components/field";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import { SubmitButton } from "@/components/submit-button";
import { authClient } from "@/lib/auth-client";

/** Second sign-in step: authenticator code, or a one-time backup code. */
export function TwoFactorForm() {
	const t = useTranslations("twoFactor");
	const tv = useTranslations("validation");
	const router = useRouter();
	const [useBackup, setUseBackup] = useState(false);

	const form = useForm({
		defaultValues: { code: "" },
		validators: {
			onSubmit: z.object({
				code: useBackup
					? z.string().trim().min(1, tv("code"))
					: z
							.string()
							.trim()
							.regex(/^\d{6}$/, tv("code")),
			}),
		},
		onSubmit: async ({ value }) => {
			const code = value.code.trim();
			const { error } = useBackup
				? await authClient.twoFactor.verifyBackupCode({ code })
				: await authClient.twoFactor.verifyTotp({ code });
			if (error) {
				toast.error(t("invalid"));
				return;
			}
			router.push("/dashboard");
		},
	});

	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<FieldGroup>
				<p className="text-muted-foreground text-sm">
					{useBackup ? t("backupDescription") : t("description")}
				</p>
				<form.Field name="code">
					{(field) => (
						<TextField
							field={field}
							label={useBackup ? t("backupCode") : t("code")}
							autoComplete="one-time-code"
							inputMode={useBackup ? "text" : "numeric"}
							autoFocus
						/>
					)}
				</form.Field>
				<SubmitButton form={form}>{t("submit")}</SubmitButton>
				<Button
					type="button"
					variant="link"
					onClick={() => {
						setUseBackup((v) => !v);
						form.reset();
					}}
				>
					{useBackup ? t("useApp") : t("useBackup")}
				</Button>
			</FieldGroup>
		</form>
	);
}
