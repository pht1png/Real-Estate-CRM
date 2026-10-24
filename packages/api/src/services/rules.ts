import type { Database } from "@Real-Estate-CRM/db";
import {
	defaultRules,
	organizationSettings,
	type Rules,
} from "@Real-Estate-CRM/db/schema/index";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "./audit";
import type { Tenant } from "./tenancy";

export const updateRulesInput = z.strictObject({
	reEnquiryWindowDays: z.number().int().min(1).max(730).optional(),
	preScoreTimelineMonths: z.number().int().min(1).max(24).optional(),
	claimCap: z.number().int().min(1).max(50).optional(),
	deadlineRollHours: z.number().int().min(0).max(8).optional(),
});

type Executor = Pick<Database, "select">;

/** The company's effective rules: its overrides on top of the defaults (brief §6). */
export async function getRules(
	db: Executor,
	organizationId: string,
): Promise<Rules> {
	const [row] = await db
		.select({ rules: organizationSettings.rules })
		.from(organizationSettings)
		.where(eq(organizationSettings.organizationId, organizationId));
	return { ...defaultRules, ...row?.rules };
}

export async function getRulesForTenant(db: Database, tenant: Tenant) {
	return {
		rules: await getRules(db, tenant.organizationId),
		defaults: defaultRules,
	};
}

export async function updateRules(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof updateRulesInput>,
) {
	await db.transaction(async (tx) => {
		const before = await getRules(tx, tenant.organizationId);
		const [row] = await tx
			.select({ rules: organizationSettings.rules })
			.from(organizationSettings)
			.where(eq(organizationSettings.organizationId, tenant.organizationId));
		const rules = { ...row?.rules, ...input };
		await tx
			.insert(organizationSettings)
			.values({ organizationId: tenant.organizationId, rules })
			.onConflictDoUpdate({
				target: organizationSettings.organizationId,
				set: { rules },
			});
		await writeAudit(tx, tenant, {
			action: "rules.update",
			entityType: "organization",
			entityId: tenant.organizationId,
			before,
			after: { ...before, ...input },
		});
	});
}
