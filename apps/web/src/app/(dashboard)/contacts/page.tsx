import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { ContactList } from "./contact-list";

export default async function ContactsPage() {
	const t = await getTranslations("contacts");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<ContactList />
		</>
	);
}
