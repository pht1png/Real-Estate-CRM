import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/components/auth-card";

import { TwoFactorForm } from "./two-factor-form";

export default async function TwoFactorPage() {
	const t = await getTranslations("twoFactor");
	return (
		<AuthCard title={t("title")}>
			<TwoFactorForm />
		</AuthCard>
	);
}
