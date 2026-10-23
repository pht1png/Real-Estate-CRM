import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { user } from "./schema";
import { testDb as db } from "./test-setup";

describe("database baseline", () => {
	test("every timestamp column is timestamptz", async () => {
		const { rows } = await db.execute<{ column: string }>(
			sql`select table_name || '.' || column_name as column
				from information_schema.columns
				where table_schema = 'public'
					and data_type = 'timestamp without time zone'`,
		);
		expect(rows).toEqual([]);
	});

	test("interactive transaction commits and rolls back", async () => {
		await db.transaction(async (tx) => {
			await tx
				.insert(user)
				.values({ id: "u1", name: "A", email: "a@example.com" });
		});

		await expect(
			db.transaction(async (tx) => {
				await tx
					.insert(user)
					.values({ id: "u2", name: "B", email: "b@example.com" });
				throw new Error("rollback");
			}),
		).rejects.toThrow("rollback");

		const rows = await db.select({ id: user.id }).from(user);
		expect(rows).toEqual([{ id: "u1" }]);
	});

	test("tables are emptied between tests", async () => {
		const rows = await db.select().from(user).where(eq(user.id, "u1"));
		expect(rows).toEqual([]);
	});
});
