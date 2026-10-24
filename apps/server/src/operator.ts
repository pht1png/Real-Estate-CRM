import type { Auth, BackgroundTasks } from "@Real-Estate-CRM/auth";
import type { Database } from "@Real-Estate-CRM/db";
import { insertAudit } from "@Real-Estate-CRM/db/audit";
import {
	account,
	member,
	organization,
	user,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";

export type CreateOrganizationInput = {
	name: string;
	ownerEmail: string;
	ownerName?: string;
};

function slugify(name: string) {
	const base = name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);
	return `${base || "org"}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Operator action (no self-serve sign-up, brief §11): creates a company and its
 * owner, then emails the owner a link to choose a password (or, if they already
 * have one, they simply sign in and switch to the new company).
 */
export async function createOrganizationWithOwner(
	db: Database,
	auth: Auth,
	background: BackgroundTasks,
	webUrl: string,
	input: CreateOrganizationInput,
) {
	const email = input.ownerEmail.trim().toLowerCase();
	const name = input.name.trim();
	if (!name) throw new Error("Organization name is required");

	const result = await db.transaction(async (tx) => {
		const [org] = await tx
			.insert(organization)
			.values({ id: crypto.randomUUID(), name, slug: slugify(name) })
			.returning({ id: organization.id, slug: organization.slug });
		if (!org) throw new Error("organization insert returned no row");

		const [existing] = await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		const userId =
			existing?.id ??
			(
				await tx
					.insert(user)
					.values({
						id: crypto.randomUUID(),
						email,
						name: input.ownerName?.trim() || email.split("@")[0] || email,
						emailVerified: true,
					})
					.returning({ id: user.id })
			)[0]?.id;
		if (!userId) throw new Error("user insert returned no row");

		const [owner] = await tx
			.insert(member)
			.values({
				id: crypto.randomUUID(),
				organizationId: org.id,
				userId,
				role: "owner",
			})
			.returning({ id: member.id });
		if (!owner) throw new Error("member insert returned no row");

		await insertAudit(tx, {
			organizationId: org.id,
			actorUserId: null,
			action: "organization.create",
			entityType: "organization",
			entityId: org.id,
			after: { ownerMemberId: owner.id },
		});

		const [credential] = await tx
			.select({ id: account.id })
			.from(account)
			.where(
				and(eq(account.userId, userId), eq(account.providerId, "credential")),
			);

		return {
			organizationId: org.id,
			slug: org.slug,
			userId,
			hasPassword: !!credential,
		};
	});

	if (!result.hasPassword) {
		await auth.api.requestPasswordReset({
			body: {
				email,
				redirectTo: `${webUrl.replace(/\/$/, "")}/reset-password`,
			},
		});
		// The email goes out after the reset response; wait for it before returning.
		await background.flush();
	}
	return result;
}
