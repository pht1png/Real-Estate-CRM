import { weekdays } from "@Real-Estate-CRM/db/schema/index";
import { z } from "zod";

/** Money in integer satang (brief §3). Max ≈ 10 billion baht. */
export const satang = z.number().int().positive().max(1_000_000_000_000);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const interval = z
	.strictObject({ open: hhmm, close: hhmm })
	.refine((i) => i.close > i.open, "Closing time must be after opening time");

export const officeHours = z.strictObject(
	Object.fromEntries(weekdays.map((d) => [d, interval.nullable()])) as Record<
		(typeof weekdays)[number],
		z.ZodNullable<typeof interval>
	>,
);

export const timeZone = z.string().refine((tz) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}, "Unknown time zone");

export const isoDate = z.iso.date();

export const tag = z.string().trim().min(1).max(40);
