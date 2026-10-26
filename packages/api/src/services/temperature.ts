import {
	type BuyingTimeline,
	type FundingType,
	type OpportunityStatus,
	openOpportunityStatuses,
	type QualificationRules,
	type Temperature,
	timelineMaxMonths,
} from "@Real-Estate-CRM/db/schema/index";

import { budgetFits, type FitInputs } from "./fit";

/**
 * Hot / warm on an opportunity (brief §6), computed on read so nothing has to
 * stay in sync. Versioned like the fit check so reports can compare rule sets.
 */
export const TEMPERATURE_VERSION = "temp-v1";

/** Buying within this many months counts as soon. */
const SOON_MONTHS = 3;

export type TemperatureInputs = Pick<
	FitInputs,
	"budgetMinSatang" | "budgetMaxSatang" | "priceRange"
> & {
	buyingTimeline: BuyingTimeline | null;
	fundingType: FundingType | null;
	visitCount: number;
};

/**
 * Signals: visited (always, on an opportunity); buying within 3 months; the
 * budget fits the available price range; paying cash (mortgage readiness
 * joins in M6b). Warm = 2–3 signals; Hot = all 4, or warm plus a second visit.
 */
export function assessTemperature(
	inputs: TemperatureInputs,
	rules: Pick<QualificationRules, "budgetTolerancePct">,
): Temperature | null {
	const months = inputs.buyingTimeline
		? timelineMaxMonths[inputs.buyingTimeline]
		: null;
	const signals = [
		true,
		months !== null && months <= SOON_MONTHS,
		budgetFits(inputs, rules) === true,
		inputs.fundingType === "cash",
	].filter(Boolean).length;
	if (signals === 4) return "hot";
	if (signals < 2) return null;
	return inputs.visitCount >= 2 ? "hot" : "warm";
}

/** Hot / warm of an opportunity still being worked; null once sold or lost. */
export function liveTemperature(
	opp: {
		status: OpportunityStatus;
		fundingType: FundingType | null;
		visitCount: number;
	},
	profile: Pick<
		TemperatureInputs,
		"budgetMinSatang" | "budgetMaxSatang" | "buyingTimeline"
	>,
	priceRange: TemperatureInputs["priceRange"],
	rules: Pick<QualificationRules, "budgetTolerancePct">,
) {
	if (!openOpportunityStatuses.includes(opp.status)) return null;
	return assessTemperature({ ...profile, ...opp, priceRange }, rules);
}
