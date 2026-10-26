import type { Database } from "@Real-Estate-CRM/db";
import {
	activity,
	contact,
	contactPhone,
	lead,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { normalizePhone } from "../phone";
import { requireActor } from "./activity";
import { writeAudit } from "./audit";
import { badRequest, notFound } from "./errors";
import { requireVisibleLead } from "./lead-access";
import type { Tenant } from "./tenancy";

const phone = z.string().trim().min(3).max(40);

export const setReferrerInput = z.strictObject({
	leadId: z.uuid(),
	/** The referrer's phone; null clears it. */
	referrerPhone: phone.nullable(),
});

/**
 * The contact behind a referrer's phone (brief §5: who referred this lead).
 * Never the lead's own contact.
 */
export async function findReferrer(
	db: Pick<Database, "select">,
	tenant: Tenant,
	rawPhone: string,
	contactId: string,
) {
	const e164 = normalizePhone(rawPhone);
	if (!e164) badRequest("Invalid referrer phone number");
	const [row] = await db
		.select({ id: contact.id, name: contact.name })
		.from(contactPhone)
		.innerJoin(contact, eq(contact.id, contactPhone.contactId))
		.where(
			and(
				eq(contactPhone.organizationId, tenant.organizationId),
				eq(contactPhone.phoneE164, e164),
			),
		);
	if (!row) notFound("Referrer");
	if (row.id === contactId) badRequest("A contact can't refer themselves");
	return row;
}

/** Set or clear who referred the lead's contact to this project. */
export async function setLeadReferrer(
	db: Database,
	tenant: Tenant,
	input: z.infer<typeof setReferrerInput>,
) {
	await db.transaction(async (tx) => {
		const row = await requireVisibleLead(tx, tenant, input.leadId);
		requireActor(tenant, row);
		const referrer = input.referrerPhone
			? await findReferrer(tx, tenant, input.referrerPhone, row.contactId)
			: null;
		if ((referrer?.id ?? null) === row.referredByContactId) return;
		await tx
			.update(lead)
			.set({ referredByContactId: referrer?.id ?? null })
			.where(eq(lead.id, row.id));
		await tx.insert(activity).values({
			organizationId: tenant.organizationId,
			leadId: row.id,
			type: "note",
			byUserId: tenant.userId,
			data: { referrer: referrer ? { contactId: referrer.id } : null },
		});
		await writeAudit(tx, tenant, {
			action: "lead.referrer_change",
			entityType: "lead",
			entityId: row.id,
			before: { referredByContactId: row.referredByContactId },
			after: { referredByContactId: referrer?.id ?? null },
		});
	});
}
