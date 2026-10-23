import "varlock/auto-load";

import { afterAll, beforeAll, beforeEach } from "bun:test";

import { ENV } from "./env";
import { createDb } from "./index";
import { prepareTestDatabase, truncateAll } from "./testing";

export const testDb = createDb(ENV);

beforeAll(() => prepareTestDatabase(testDb, ENV.DATABASE_URL));
beforeEach(() => truncateAll(testDb, ENV.DATABASE_URL));
afterAll(() => testDb.$client.end());
