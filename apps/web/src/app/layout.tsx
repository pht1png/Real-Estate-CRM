import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import "../index.css";
import Providers from "@/components/providers";

// Covers Thai and Latin; wired to Tailwind's font-sans via --font-app.
const plexThai = IBM_Plex_Sans_Thai({
	variable: "--font-app",
	subsets: ["thai", "latin"],
	weight: ["400", "500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("app");
	return { title: t("name") };
}

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const locale = await getLocale();
	return (
		<html lang={locale} suppressHydrationWarning>
			<body className={`${plexThai.variable} antialiased`}>
				<NextIntlClientProvider>
					<Providers>{children}</Providers>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
