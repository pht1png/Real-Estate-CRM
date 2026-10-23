import type { Database } from "@Real-Estate-CRM/db";
import { type AuditEntry, insertAudit } from "@Real-Estate-CRM/db/audit";

import type { Tenant } from "./tenancy";

/** Records a sensitive change by the tenant; pass the transaction that makes the change. */
export function writeAudit(
	tx: Pick<Database, "insert">,
	tenant: Tenant,
	entry: Omit<AuditEntry, "organizationId" | "actorUserId">,
) {
	return insertAudit(tx, {
		...entry,
		organizationId: tenant.organizationId,
		actorUserId: tenant.userId,
	});
}
