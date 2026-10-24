import { loadTenant } from "@Real-Estate-CRM/api/services/tenancy";
import { floorPlanPrefix } from "@Real-Estate-CRM/api/services/unit-type";
import { roleCan } from "@Real-Estate-CRM/auth/permissions";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { ENV } from "./env.server";
import { auth, db, localStorage, storage } from "./services";

export const MAX_FLOOR_PLAN_BYTES = 5 * 1024 * 1024;

/** Detects the image type from the file's first bytes (the browser's claim isn't trusted). */
function imageType(bytes: Uint8Array) {
	const starts = (sig: number[], at = 0) =>
		sig.every((b, i) => bytes[at + i] === b);
	if (starts([0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return { ext: "png", mime: "image/png" };
	}
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
		return { ext: "webp", mime: "image/webp" };
	}
	return null;
}

export const files = new Hono();

/** Floor plan upload: admins of the active organization; returns the storage key. */
files.post(
	"/floor-plans",
	bodyLimit({
		maxSize: MAX_FLOOR_PLAN_BYTES + 64 * 1024,
		onError: (c) => c.json({ error: "FILE_TOO_LARGE" }, 413),
	}),
	async (c) => {
		// Cookie-authenticated POST: only from the web app (defence against CSRF).
		if (c.req.header("origin") !== ENV.CORS_ORIGIN) {
			return c.json({ error: "FORBIDDEN" }, 403);
		}
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		const organizationId = session?.session.activeOrganizationId;
		const tenant =
			session && organizationId
				? await loadTenant(db, organizationId, session.user.id)
				: null;
		if (!tenant) return c.json({ error: "UNAUTHORIZED" }, 401);
		if (!roleCan(tenant.role, { unit: ["manage"] })) {
			return c.json({ error: "FORBIDDEN" }, 403);
		}

		const body = await c.req.parseBody();
		const file = body.file;
		if (!(file instanceof File)) return c.json({ error: "NO_FILE" }, 400);
		if (file.size > MAX_FLOOR_PLAN_BYTES) {
			return c.json({ error: "FILE_TOO_LARGE" }, 413);
		}
		const type = imageType(
			new Uint8Array(await file.slice(0, 16).arrayBuffer()),
		);
		if (!type) return c.json({ error: "UNSUPPORTED_TYPE" }, 415);

		const key = `${floorPlanPrefix(tenant.organizationId)}${crypto.randomUUID()}.${type.ext}`;
		await storage.put(key, file, type.mime);
		return c.json({ key, url: await storage.url(key) });
	},
);

/** Signed local file URLs (STORAGE_DRIVER=local only; S3 URLs are presigned by the provider). */
files.get("/local/*", async (c) => {
	if (ENV.STORAGE_DRIVER !== "local") return c.notFound();
	const key = c.req.path.replace(/^\/files\/local\//, "");
	const file = await localStorage.verify(
		decodeURIComponent(key),
		c.req.query("exp"),
		c.req.query("sig"),
	);
	if (!file) return c.json({ error: "NOT_FOUND" }, 404);
	return new Response(file, {
		headers: {
			"Content-Type": file.type,
			"Cache-Control": "private, max-age=3600",
			"X-Content-Type-Options": "nosniff",
		},
	});
});
