import type { Context as ApiContext } from "@Real-Estate-CRM/api/context";
import type { Context as HonoContext } from "hono";
import { auth, db, storage } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		session,
		files: storage,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
