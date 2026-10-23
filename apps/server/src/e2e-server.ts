// Entry point for Playwright: fresh test database, then the normal app.
import { prepareTestDatabase, truncateAll } from "@Real-Estate-CRM/db/testing";

import { ENV } from "./env.server";
import app from "./index";
import { db } from "./services";

await prepareTestDatabase(db, ENV.DATABASE_URL);
await truncateAll(db, ENV.DATABASE_URL);

export default app;
