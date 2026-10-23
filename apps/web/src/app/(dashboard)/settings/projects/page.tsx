import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";

import { ProjectsSettings } from "./projects-settings";

export default async function ProjectsPage() {
	const t = await getTranslations("projects");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<ProjectsSettings />
		</>
	);
}
