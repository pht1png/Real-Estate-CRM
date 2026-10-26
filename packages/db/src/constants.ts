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

/**
 * Lead pipeline (the vetting queue, brief §2): a customer's enquiry about one
 * project. A confirmed showroom visit converts it into an opportunity.
 */
export const leadStatuses = [
	"new",
	"attempting",
	"connected",
	"qualified",
	"nurturing",
	"converted",
	"disqualified",
] as const;
export type LeadStatus = (typeof leadStatuses)[number];

/** Leads still being worked: they need a next follow-up (brief §6). */
export const openLeadStatuses: readonly LeadStatus[] = [
	"new",
	"attempting",
	"connected",
	"qualified",
];

/** Unowned leads in these statuses form the project pool. */
export const poolLeadStatuses: readonly LeadStatus[] = [
	"new",
	"attempting",
	"connected",
];

/** Lead exits; a re-enquiry reopens them as new. */
export const closedLeadStatuses: readonly LeadStatus[] = [
	"disqualified",
	"nurturing",
];

/** Opportunity pipeline, from the first confirmed visit. */
export const opportunityStatuses = [
	"visited",
	"negotiating",
	"deposited",
	"contracted",
	"waiting_mortgage_result",
	"transferred",
	"lost",
] as const;
export type OpportunityStatus = (typeof opportunityStatuses)[number];

/** Opportunities still being worked before a deposit: they need a next follow-up. */
export const openOpportunityStatuses: readonly OpportunityStatus[] = [
	"visited",
	"negotiating",
];

/** After a deposit: re-enquiry only logs an activity. */
export const soldStatuses: readonly OpportunityStatus[] = [
	"deposited",
	"contracted",
	"waiting_mortgage_result",
	"transferred",
];

/** Opportunities that block a new one for the same lead (all but lost). */
export const liveOpportunityStatuses: readonly OpportunityStatus[] = [
	"visited",
	"negotiating",
	"deposited",
	"contracted",
	"waiting_mortgage_result",
	"transferred",
];

/** Unowned nurturing leads form the nurturing pool (claimable, no deadline). */
export const nurturePoolStatuses: readonly LeadStatus[] = ["nurturing"];

export const activityTypes = [
	"enquiry",
	"call",
	"no_answer",
	"line",
	"meeting",
	"visit",
	"note",
	"status_change",
	"re_engagement",
	"assignment",
	"qualified",
	"conversion",
	"appointment_booked",
	"appointment_rescheduled",
	"appointment_cancelled",
	"appointment_no_show",
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

/** How the buyer pays (brief §5). Loan details wait for the mortgage milestone (M6b). */
export const fundingTypes = ["cash", "mortgage", "cash_mortgage"] as const;
export type FundingType = (typeof fundingTypes)[number];

/** Computed on read (temp-v1), never stored. */
export const temperatures = ["warm", "hot"] as const;
export type Temperature = (typeof temperatures)[number];

export const buyerIntents = ["own_stay", "investment"] as const;
export type BuyerIntent = (typeof buyerIntents)[number];

/** Why a lead leaves the vetting queue (brief §6); "other" needs a note. */
export const disqualifyReasons = [
	"invalid_data",
	"spam",
	"duplicate",
	"agent_competitor",
	"job_seeker",
	"bad_budget_fit",
	"bad_location_fit",
	"unreachable",
	"not_interested",
	"bought_elsewhere",
	"unresponsive",
	"other",
] as const;
export type DisqualifyReason = (typeof disqualifyReasons)[number];

/** Why an opportunity is lost after a visit (brief §6); "other" needs a note. */
export const lostReasons = [
	"bought_competitor",
	"loan_rejected",
	"cold_feet",
	"product_mismatch",
	"timing_postponed",
	"other",
] as const;
export type LostReason = (typeof lostReasons)[number];

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
	/** This many no-answers within the window (since the last contact) → suggest Unreachable. */
	unreachableAttempts: number;
	unreachableWindowDays: number;
	/** Length of a showroom appointment; a salesperson's appointments can't overlap. */
	appointmentMinutes: number;
	/** Hot or warm opportunities with no activity for this many days go to Stale. */
	quietOpportunityDays: number;
};

export const defaultRules: Rules = {
	reEnquiryWindowDays: 90,
	preScoreTimelineMonths: 3,
	claimCap: 5,
	deadlineRollHours: 2,
	unreachableAttempts: 3,
	unreachableWindowDays: 7,
	appointmentMinutes: 60,
	quietOpportunityDays: 3,
};

export const appointmentStatuses = [
	"scheduled",
	"arrived",
	"no_show",
	"cancelled",
] as const;
export type AppointmentStatus = (typeof appointmentStatuses)[number];

/** Why an appointment was cancelled; "other" needs a note. A reschedule is not a cancel. */
export const appointmentCancelReasons = [
	"customer_cancelled",
	"customer_unreachable",
	"salesperson_unavailable",
	"showroom_closed",
	"other",
] as const;
export type AppointmentCancelReason = (typeof appointmentCancelReasons)[number];

/**
 * Per-project qualification check (brief §6): the system assesses fit, the
 * salesperson confirms. Auto-qualify is opt-in; disqualify is never automatic.
 */
export type QualificationRules = {
	/** Budget may be this % outside the available price range and still fit. */
	budgetTolerancePct: number;
	/** Buying within this many months fits; later is "too early" (→ Nurture). */
	qualifyWithinMonths: number;
	/** Mark leads that fit (with unit types and intent) Qualified automatically. */
	autoQualify: boolean;
};

export const defaultQualificationRules: QualificationRules = {
	budgetTolerancePct: 10,
	qualifyWithinMonths: 6,
	autoQualify: false,
};

export const fitResults = [
	"fits",
	"too_early",
	"budget_no_fit",
	"unknown",
] as const;
export type FitResult = (typeof fitResults)[number];
