import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { SourcesSettings } from "./sources-settings";

export default async function Page() {
	const t = await getTranslations("sources");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<SourcesSettings />
		</>
	);
}
