"use client";

import { Alert, AlertDescription } from "@Real-Estate-CRM/ui/components/alert";
import { FieldGroup } from "@Real-Estate-CRM/ui/components/field";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import { SubmitButton } from "@/components/submit-button";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string | null }) {
	const t = useTranslations("resetPassword");
	const tv = useTranslations("validation");
	const tf = useTranslations("forgotPassword");
	const router = useRouter();

	const form = useForm({
		defaultValues: { newPassword: "" },
		validators: {
			onSubmit: z.object({ newPassword: z.string().min(8, tv("password")) }),
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.resetPassword({
				newPassword: value.newPassword,
				token: token ?? "",
			});
			if (error) {
				toast.error(t("invalidLink"));
				return;
			}
			toast.success(t("done"));
			router.push("/login");
		},
	});

	if (!token) {
		return (
			<FieldGroup>
				<Alert variant="destructive">
					<AlertDescription>{t("invalidLink")}</AlertDescription>
				</Alert>
				<Link
					href="/forgot-password"
					className="text-center text-sm underline-offset-4 hover:underline"
				>
					{tf("title")}
				</Link>
			</FieldGroup>
		);
	}

	return (
		<form
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<FieldGroup>
				<form.Field name="newPassword">
					{(field) => (
						<TextField
							field={field}
							label={t("newPassword")}
							type="password"
							autoComplete="new-password"
						/>
					)}
				</form.Field>
				<SubmitButton form={form}>{t("submit")}</SubmitButton>
			</FieldGroup>
		</form>
	);
}
