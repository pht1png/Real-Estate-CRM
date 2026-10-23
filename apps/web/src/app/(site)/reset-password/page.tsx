import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/components/auth-card";

import { ResetPasswordForm } from "./reset-password-form";

// Better Auth redirects here with ?token=… (or ?error=INVALID_TOKEN).
export default async function ResetPasswordPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string; error?: string }>;
}) {
	const { token, error } = await searchParams;
	const t = await getTranslations("resetPassword");
	return (
		<AuthCard title={t("title")}>
			<ResetPasswordForm token={error ? null : (token ?? null)} />
		</AuthCard>
	);
}
