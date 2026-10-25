import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { PoolList } from "./pool-list";

export default async function PoolPage() {
	const t = await getTranslations("pool");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<PoolList />
		</>
	);
}
