"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { setLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";

/** Toggles Thai / English; the choice is stored in a cookie. */
export function LanguageSwitcher() {
	const t = useTranslations("language");
	const locale = useLocale();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const next = locales.find((l) => l !== locale) ?? "th";

	return (
		<Button
			variant="ghost"
			size="sm"
			disabled={isPending}
			aria-label={t("label")}
			onClick={() =>
				startTransition(async () => {
					await setLocale(next);
					router.refresh();
				})
			}
		>
			{t(next)}
		</Button>
	);
}
