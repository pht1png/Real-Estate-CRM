import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { TwoFactorSettings } from "./two-factor-settings";

export default async function SecurityPage() {
	const t = await getTranslations("security");
	return (
		<>
			<PageHeader title={t("title")} />
			<TwoFactorSettings />
		</>
	);
}
