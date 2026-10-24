import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { CampaignsSettings } from "./campaigns-settings";

export default async function Page() {
	const t = await getTranslations("campaigns");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<CampaignsSettings />
		</>
	);
}
