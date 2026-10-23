import type { Session } from "@Real-Estate-CRM/auth";
import type { Database } from "@Real-Estate-CRM/db";

export type Context = {
  session: Session | null;
  db: Database;
};
