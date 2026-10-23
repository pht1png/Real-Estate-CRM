import { type RoleName, roleNames } from "@Real-Estate-CRM/auth/permissions";
import type { Database } from "@Real-Estate-CRM/db";
import { roleLabel } from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import type { Tenant } from "./tenancy";

export const updateRoleLabelInput = z.strictObject({
	role: z.enum(roleNames as [RoleName, ...RoleName[]]),
	/** Empty resets to the default label from the i18n messages. */
	label: z.string().trim().max(60),
});

/** Custom labels by role; roles without one use the default translated label. */
export async function getRoleLabels(db: Database, tenant: Tenant) {
	const rows = await db
		.select({ role: roleLabel.role, label: roleLabel.label })
		.from(roleLabel)
		.where(eq(roleLabel.organizationId, tenant.organizationId));
	const custom = new Map(rows.map((r) => [r.role, r.label]));
	return roleNames.map((role) => ({ role, label: custom.get(role) ?? null }));
}

export async function updateRoleLabel(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateRoleLabelInput>,
) {
	await db.transaction(async (tx) => {
		const key = and(
			eq(roleLabel.organizationId, tenant.organizationId),
			eq(roleLabel.role, input.role),
		);
		const [previous] = await tx
			.select({ label: roleLabel.label })
			.from(roleLabel)
			.where(key);
		if (input.label === "") {
			await tx.delete(roleLabel).where(key);
		} else {
			await tx
				.insert(roleLabel)
				.values({
					organizationId: tenant.organizationId,
					role: input.role,
					label: input.label,
				})
				.onConflictDoUpdate({
					target: [roleLabel.organizationId, roleLabel.role],
					set: { label: input.label },
				});
		}
		await writeAudit(tx, tenant, {
			action: "role_label.update",
			entityType: "role",
			entityId: input.role,
			before: { label: previous?.label ?? null },
			after: { label: input.label || null },
		});
	});
}
