import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { RulesSettings } from "./rules-settings";

export default async function Page() {
	const t = await getTranslations("rules");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<RulesSettings />
		</>
	);
}
