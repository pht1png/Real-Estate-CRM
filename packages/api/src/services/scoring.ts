import {
	type BuyingTimeline,
	type Rules,
	timelineMaxMonths,
} from "@Real-Estate-CRM/db/schema/index";

/**
 * The only place lead priority is decided (brief §6 pre-score). Versioned so
 * later scoring (hot/warm in M5, a predictive model in Phase 2) can replace it
 * and reports can compare versions.
 */
export const SCORING_VERSION = "rules-v1";

export type ScoreSignal = "budget_in_range" | "timeline_soon";

export type ScoreInputs = {
	budgetMinSatang: number | null;
	budgetMaxSatang: number | null;
	buyingTimeline: BuyingTimeline | null;
	/** The project's price range from available units (null when none). */
	priceRange: { min: number; max: number } | null;
};

export type Score = {
	priority: boolean;
	signals: ScoreSignal[];
	version: string;
};

/** Budget overlaps the price range; an open-ended budget is open on that side. */
function budgetOverlaps(inputs: ScoreInputs) {
	const { budgetMinSatang: min, budgetMaxSatang: max, priceRange } = inputs;
	if (!priceRange || (min === null && max === null)) return false;
	return (
		(min ?? 0) <= priceRange.max &&
		(max ?? Number.POSITIVE_INFINITY) >= priceRange.min
	);
}

function timelineSoon(inputs: ScoreInputs, rules: Rules) {
	if (!inputs.buyingTimeline) return false;
	const months = timelineMaxMonths[inputs.buyingTimeline];
	return months !== null && months <= rules.preScoreTimelineMonths;
}

/** Priority = budget overlaps the project's price range AND buying soon. */
export function scoreInterest(inputs: ScoreInputs, rules: Rules): Score {
	const signals: ScoreSignal[] = [];
	if (budgetOverlaps(inputs)) signals.push("budget_in_range");
	if (timelineSoon(inputs, rules)) signals.push("timeline_soon");
	return {
		priority: signals.length === 2,
		signals,
		version: SCORING_VERSION,
	};
}
