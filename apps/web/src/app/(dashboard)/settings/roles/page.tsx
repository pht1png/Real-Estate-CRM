import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { RoleLabelsSettings } from "./role-labels-settings";

export default async function RoleLabelsPage() {
	const t = await getTranslations("roleLabels");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<RoleLabelsSettings />
		</>
	);
}
