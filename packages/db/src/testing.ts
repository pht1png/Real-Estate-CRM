import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import type { Database } from "./index";

const migrationsFolder = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

function databaseName(url: string) {
	return decodeURIComponent(new URL(url).pathname.slice(1));
}

function assertTestDatabase(url: string) {
	const name = databaseName(url);
	if (!name.endsWith("_test")) {
		throw new Error(
			`Refusing to touch "${name}": test helpers only run against a *_test database`,
		);
	}
	return name;
}

/** Creates the *_test database if it does not exist yet (local Docker or CI service). */
async function ensureDatabase(url: string) {
	const name = assertTestDatabase(url);
	const admin = new URL(url);
	admin.pathname = "/postgres";
	const client = new Client({ connectionString: admin.toString() });
	await client.connect();
	try {
		const { rowCount } = await client.query(
			"select 1 from pg_database where datname = $1",
			[name],
		);
		if (!rowCount) {
			await client.query(`create database "${name.replaceAll('"', '""')}"`);
		}
	} finally {
		await client.end();
	}
}

/** Creates the test database if needed and applies the committed migrations. */
export async function prepareTestDatabase(db: Database, url: string) {
	await ensureDatabase(url);
	const failure = await migrate(db, { migrationsFolder });
	if (failure) {
		throw new Error(`Migrations failed: ${JSON.stringify(failure)}`);
	}
}

/**
 * Empties every table in the public schema. Migration history is kept.
 * Triggers are off for this transaction only, so the append-only audit_log can
 * be reset between tests (requires the superuser of the local/CI test DB).
 */
export async function truncateAll(db: Database, url: string) {
	assertTestDatabase(url);
	const { rows } = await db.execute<{ tablename: string }>(
		sql`select tablename from pg_tables where schemaname = 'public'`,
	);
	if (rows.length === 0) return;
	const tables = rows
		.map(({ tablename }) => `"public"."${tablename}"`)
		.join(", ");
	await db.transaction(async (tx) => {
		await tx.execute(sql`set local session_replication_role = replica`);
		await tx.execute(
			sql.raw(`truncate table ${tables} restart identity cascade`),
		);
	});
}
