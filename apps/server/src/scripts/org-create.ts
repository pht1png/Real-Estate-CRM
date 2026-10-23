// Usage: bun run org:create --name "Company" --owner-email owner@example.com [--owner-name "Name"]
import { parseArgs } from "node:util";

import { ENV } from "../env.server";
import { createOrganizationWithOwner } from "../operator";
import { auth, db } from "../services";

const { values } = parseArgs({
	options: {
		name: { type: "string" },
		"owner-email": { type: "string" },
		"owner-name": { type: "string" },
	},
});

if (!values.name || !values["owner-email"]) {
	console.error(
		'Usage: bun run org:create --name "Company" --owner-email owner@example.com [--owner-name "Name"]',
	);
	process.exit(1);
}

try {
	const result = await createOrganizationWithOwner(db, auth, ENV.WEB_URL, {
		name: values.name,
		ownerEmail: values["owner-email"],
		ownerName: values["owner-name"],
	});
	console.info(
		`Created organization ${result.slug} (${result.organizationId}).`,
		result.hasPassword
			? "The owner already has an account: they can sign in and switch to it."
			: "Account setup email sent to the owner.",
	);
} finally {
	await db.$client.end();
}
