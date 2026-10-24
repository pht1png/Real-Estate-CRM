import { headers } from "next/headers";
import { cache } from "react";

import { authClient } from "./auth-client";

/**
 * The session for the current request, fetched from the API once and shared by
 * the layout and the page (React.cache dedupes per request).
 */
export const getServerSession = cache(async () =>
	authClient.getSession({
		fetchOptions: { headers: await headers(), throw: true },
	}),
);
