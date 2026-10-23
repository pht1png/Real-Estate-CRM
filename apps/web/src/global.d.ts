import type messages from "../messages/en.json";
import type { Locale } from "./i18n/config";

// Type-checks translation keys and locales across the app.
declare module "next-intl" {
	interface AppConfig {
		Locale: Locale;
		Messages: typeof messages;
	}
}
