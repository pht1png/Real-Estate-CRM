import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { MembersSettings } from "./members-settings";

export default async function MembersPage() {
	const t = await getTranslations("members");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<MembersSettings />
		</>
	);
}
