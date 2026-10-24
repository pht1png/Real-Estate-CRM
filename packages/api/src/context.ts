import type { Session } from "@Real-Estate-CRM/auth";
import type { Database } from "@Real-Estate-CRM/db";

/** Signed, short-lived URLs for stored files (floor plans). */
export type FileUrls = {
	url(key: string): Promise<string>;
};

export type Context = {
	session: Session | null;
	db: Database;
	files: FileUrls;
};
