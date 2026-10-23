import type { Database } from "./index";
import { auditLog } from "./schema";

export type AuditEntry = {
	organizationId: string;
	actorUserId: string | null;
	action: string;
	entityType: string;
	entityId: string;
	/** IDs and codes only — never names, phones or other personal data. */
	before?: Record<string, unknown> | null;
	after?: Record<string, unknown> | null;
};

type Executor = Pick<Database, "insert">;

/** Appends one audit entry; pass a transaction to write it atomically with the change. */
export async function insertAudit(db: Executor, entry: AuditEntry) {
	await db.insert(auditLog).values({
		...entry,
		before: entry.before ?? null,
		after: entry.after ?? null,
	});
}
