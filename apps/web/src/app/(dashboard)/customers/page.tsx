import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { CustomerList } from "./customer-list";

export default async function CustomersPage() {
	const t = await getTranslations("customers");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<CustomerList />
		</>
	);
}
