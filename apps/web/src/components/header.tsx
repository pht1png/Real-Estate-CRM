import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "./language-switcher";
import { ModeToggle } from "./mode-toggle";

export default async function Header() {
	const t = await getTranslations("app");
	return (
		<header className="flex items-center justify-between border-b px-4 py-2">
			<span className="font-medium">{t("name")}</span>
			<div className="flex items-center gap-2">
				<LanguageSwitcher />
				<ModeToggle />
			</div>
		</header>
	);
}
