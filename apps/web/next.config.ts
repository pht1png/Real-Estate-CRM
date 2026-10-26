import { varlockNextConfigPlugin } from "@varlock/nextjs-integration/plugin";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withVarlock = varlockNextConfigPlugin();
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	// Customers were renamed to contacts (M6a); keep old links working.
	async redirects() {
		return [
			{ source: "/customers", destination: "/contacts", permanent: true },
			{
				source: "/customers/:id",
				destination: "/contacts/:id",
				permanent: true,
			},
		];
	},
};

export default withVarlock(withNextIntl(nextConfig));
