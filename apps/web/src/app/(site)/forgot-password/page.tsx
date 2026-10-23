import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/components/auth-card";

import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
	const t = await getTranslations("forgotPassword");
	return (
		<AuthCard title={t("title")} description={t("description")}>
			<ForgotPasswordForm />
		</AuthCard>
	);
}
