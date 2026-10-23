"use client";

import { FieldGroup } from "@Real-Estate-CRM/ui/components/field";
import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

import { TextField } from "./form/text-field";
import { SubmitButton } from "./submit-button";

/**
 * Email + password sign-in. `onSignedIn` runs after a full sign-in (e.g. to
 * accept an invitation); otherwise the user lands on the dashboard. With
 * two-step login on, the auth client redirects to /two-factor instead.
 */
export default function SignInForm({
	defaultEmail = "",
	submitLabel,
	onSignedIn,
}: {
	defaultEmail?: string;
	submitLabel?: string;
	onSignedIn?: () => Promise<void> | void;
}) {
	const t = useTranslations("signIn");
	const tv = useTranslations("validation");
	const router = useRouter();

	const form = useForm({
		defaultValues: { email: defaultEmail, password: "" },
		validators: {
			onSubmit: z.object({
				email: z.email(tv("email")),
				password: z.string().min(8, tv("password")),
			}),
		},
		onSubmit: async ({ value }) => {
			const { data, error } = await authClient.signIn.email(value);
			if (error) {
				toast.error(t("failed"));
				return;
			}
			if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
			if (onSignedIn) await onSignedIn();
			else router.push("/dashboard");
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
				<form.Field name="email">
					{(field) => (
						<TextField
							field={field}
							label={t("email")}
							type="email"
							autoComplete="email"
						/>
					)}
				</form.Field>
				<form.Field name="password">
					{(field) => (
						<TextField
							field={field}
							label={t("password")}
							type="password"
							autoComplete="current-password"
						/>
					)}
				</form.Field>
				<SubmitButton form={form}>{submitLabel ?? t("submit")}</SubmitButton>
				<Link
					href="/forgot-password"
					className="text-muted-foreground text-center text-sm underline-offset-4 hover:underline"
				>
					{t("forgot")}
				</Link>
			</FieldGroup>
		</form>
	);
}
