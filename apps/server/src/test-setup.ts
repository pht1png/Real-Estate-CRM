import { prepareTestDatabase, truncateAll } from "@Real-Estate-CRM/db/testing";
import { afterAll, beforeAll, beforeEach } from "bun:test";

import { ENV } from "./env.server";
import { db } from "./services";

beforeAll(() => prepareTestDatabase(db, ENV.DATABASE_URL));
beforeEach(() => truncateAll(db, ENV.DATABASE_URL));
afterAll(() => db.$client.end());
