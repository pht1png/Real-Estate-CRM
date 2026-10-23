export const locales = ["th", "en"] as const;
export type Locale = (typeof locales)[number];

/** Thai is the default UI language (brief §2). */
export const defaultLocale: Locale = "th";

export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
	return locales.includes(value as Locale);
}
