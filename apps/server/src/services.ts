import { createAuth } from "@Real-Estate-CRM/auth";
import { createDb } from "@Real-Estate-CRM/db";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
