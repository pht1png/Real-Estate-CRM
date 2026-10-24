// Plain values shared by the schema, the API and the web app. No imports here,
// so the browser bundle can use them without pulling in the database driver.

export const projectTypes = ["condo", "low_rise", "mixed"] as const;
export type ProjectType = (typeof projectTypes)[number];

export const weekdays = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;
export type Weekday = (typeof weekdays)[number];

/** One open–close interval per weekday ("HH:MM", project time zone); null = closed. */
export type OfficeHours = Record<
	Weekday,
	{ open: string; close: string } | null
>;

export const defaultOfficeHours: OfficeHours = Object.fromEntries(
	weekdays.map((d) => [d, { open: "09:00", close: "18:00" }]),
) as OfficeHours;

export const sectionKinds = ["phase", "zone", "building"] as const;
export type SectionKind = (typeof sectionKinds)[number];

export const facings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Facing = (typeof facings)[number];

export const unitStatuses = [
	"available",
	"blocked",
	"deposited",
	"contracted",
	"transferred",
] as const;
export type UnitStatus = (typeof unitStatuses)[number];
