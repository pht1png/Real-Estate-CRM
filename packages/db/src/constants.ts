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

/** Lead lifecycle (brief §2). "In the pool" = stage new with no owner. */
export const interestStages = [
	"new",
	"contacted",
	"visited",
	"deposited",
	"contracted",
	"transferred",
	"lost",
	"nurture",
	"invalid",
] as const;
export type InterestStage = (typeof interestStages)[number];

/** Stages that end the funnel (re-enquiry reopens them as new). */
export const closedStages: readonly InterestStage[] = [
	"lost",
	"nurture",
	"invalid",
];

/** Open stages: an owned interest here always needs a next follow-up (brief §6). */
export const openStages: readonly InterestStage[] = [
	"new",
	"contacted",
	"visited",
];

/** Stages after a deposit: re-enquiry only logs an activity. */
export const soldStages: readonly InterestStage[] = [
	"deposited",
	"contracted",
	"transferred",
];

export const activityTypes = [
	"enquiry",
	"call",
	"no_answer",
	"line",
	"meeting",
	"visit",
	"note",
	"stage_change",
	"re_engagement",
	"assignment",
] as const;
export type ActivityType = (typeof activityTypes)[number];

/** Activities that count as the owner having contacted the customer. */
export const contactActivityTypes: readonly ActivityType[] = [
	"call",
	"line",
	"meeting",
	"visit",
];

export const buyingTimelines = [
	"under_1_month",
	"1_3_months",
	"3_6_months",
	"6_12_months",
	"over_12_months",
	"unknown",
] as const;
export type BuyingTimeline = (typeof buyingTimelines)[number];

/** Upper bound in months for each timeline bucket (null = unknown). */
export const timelineMaxMonths: Record<BuyingTimeline, number | null> = {
	under_1_month: 1,
	"1_3_months": 3,
	"3_6_months": 6,
	"6_12_months": 12,
	over_12_months: Number.POSITIVE_INFINITY,
	unknown: null,
};

export const paymentMethods = ["cash", "mortgage"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

export const temperatures = ["warm", "hot"] as const;
export type Temperature = (typeof temperatures)[number];

/** Per-company rules (brief §6), stored as overrides of these defaults. */
export type Rules = {
	/** Re-enquiry stays with the owner if they made contact within this many days. */
	reEnquiryWindowDays: number;
	/** Pre-score: buying within this many months counts as soon. */
	preScoreTimelineMonths: number;
	/** Max claimed leads a salesperson may hold before contacting them. */
	claimCap: number;
	/** Fewer office hours than this left at claim → deadline rolls to the next working day. */
	deadlineRollHours: number;
};

export const defaultRules: Rules = {
	reEnquiryWindowDays: 90,
	preScoreTimelineMonths: 3,
	claimCap: 5,
	deadlineRollHours: 2,
};
