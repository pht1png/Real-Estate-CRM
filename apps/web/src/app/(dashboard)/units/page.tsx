import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";

import { UnitsBrowser } from "./units-browser";

export default async function UnitsPage() {
	const t = await getTranslations("units");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			{/* useSearchParams (selected project) needs a Suspense boundary. */}
			<Suspense>
				<UnitsBrowser />
			</Suspense>
		</>
	);
}
