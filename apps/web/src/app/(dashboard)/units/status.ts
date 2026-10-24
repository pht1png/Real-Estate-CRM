import type { UnitStatus } from "@Real-Estate-CRM/db/constants";

/** Tile / badge classes per unit status (tokens defined in index.css). */
export const statusClasses: Record<UnitStatus, string> = {
	available: "bg-unit-available text-unit-available-foreground",
	blocked: "bg-unit-blocked text-unit-blocked-foreground line-through",
	deposited: "bg-unit-deposited text-unit-deposited-foreground",
	contracted: "bg-unit-contracted text-unit-contracted-foreground",
	transferred: "bg-unit-transferred text-unit-transferred-foreground",
};
