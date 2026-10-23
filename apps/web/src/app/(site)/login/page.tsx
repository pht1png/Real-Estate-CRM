import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/components/auth-card";
import SignInForm from "@/components/sign-in-form";

export default async function LoginPage() {
	const t = await getTranslations("signIn");
	return (
		<AuthCard title={t("title")}>
			<SignInForm />
		</AuthCard>
	);
}
