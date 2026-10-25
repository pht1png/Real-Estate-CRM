import { returnExpiredClaims } from "@Real-Estate-CRM/api/services/pool";
import type { Database } from "@Real-Estate-CRM/db";
import { sql } from "drizzle-orm";

const EVERY_MS = 5 * 60_000;
/** Advisory lock key: only one server instance runs the jobs at a time. */
const JOBS_LOCK = 4_271_001;

/** Runs every scheduled job once, if no other instance holds the lock. */
export async function runScheduledJobs(db: Database, now = new Date()) {
	return db.transaction(async (tx) => {
		const result = await tx.execute<{ locked: boolean }>(
			sql`select pg_try_advisory_xact_lock(${JOBS_LOCK}) as locked`,
		);
		if (!result.rows[0]?.locked) return null;
		return { expiredClaims: await returnExpiredClaims(tx, { now }) };
	});
}

/** In-process scheduler (brief §3): every 5 minutes, plus once at start. */
export function startScheduler(db: Database) {
	const tick = () =>
		runScheduledJobs(db).catch((error) =>
			console.error("[scheduler] run failed", error),
		);
	void tick();
	return setInterval(tick, EVERY_MS);
}
