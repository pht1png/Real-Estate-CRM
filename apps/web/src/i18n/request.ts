import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, isLocale, LOCALE_COOKIE } from "./config";

// No locale in the URL: the app sits behind login, so the choice lives in a cookie.
export default getRequestConfig(async () => {
	const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
	const locale = isLocale(stored) ? stored : defaultLocale;
	return {
		locale,
		timeZone: "Asia/Bangkok",
		messages: (await import(`../../messages/${locale}.json`)).default,
	};
});
