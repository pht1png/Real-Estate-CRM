import type { Database } from "@Real-Estate-CRM/db";
import {
	type BuyingTimeline,
	defaultQualificationRules,
	type FitResult,
	type QualificationRules,
	timelineMaxMonths,
	unit,
} from "@Real-Estate-CRM/db/schema/index";
import { and, eq } from "drizzle-orm";

import { availablePriceRange } from "./project";

/**
 * The qualification check (brief §6): the system assesses fit from budget and
 * timeline, the salesperson confirms. Versioned like the pre-score so reports
 * can compare rule sets.
 */
export const FIT_VERSION = "fit-v1";

export type FitInputs = {
	budgetMinSatang: number | null;
	budgetMaxSatang: number | null;
	buyingTimeline: BuyingTimeline | null;
	/** The project's price range from available units (null when none). */
	priceRange: { min: number; max: number } | null;
};

/**
 * - fits: the budget overlaps the price range (widened by the tolerance) and
 *   they buy within the qualify window;
 * - too_early: the budget fits but the timeline is later (or not sure) → Nurture;
 * - budget_no_fit: the budget sits outside the range beyond the tolerance;
 * - unknown: budget or timeline missing, or no priced available units.
 * Never decides on its own: callers suggest, or auto-qualify "fits" when the
 * project opts in.
 */
export function assessFit(
	inputs: FitInputs,
	rules: QualificationRules = defaultQualificationRules,
): FitResult {
	const budget = budgetFits(inputs, rules);
	if (budget === null || !inputs.buyingTimeline) return "unknown";
	if (!budget) return "budget_no_fit";
	const months = timelineMaxMonths[inputs.buyingTimeline];
	return months !== null && months <= rules.qualifyWithinMonths
		? "fits"
		: "too_early";
}

/**
 * Whether the budget overlaps the price range widened by the tolerance; null
 * without a budget or priced available units.
 */
export function budgetFits(
	inputs: Pick<FitInputs, "budgetMinSatang" | "budgetMaxSatang" | "priceRange">,
	rules: Pick<QualificationRules, "budgetTolerancePct">,
): boolean | null {
	const { budgetMinSatang: min, budgetMaxSatang: max, priceRange } = inputs;
	if (!priceRange || (min === null && max === null)) return null;
	const slack = rules.budgetTolerancePct / 100;
	const lowest = priceRange.min * (1 - slack);
	const highest = priceRange.max * (1 + slack);
	return (max ?? Number.POSITIVE_INFINITY) >= lowest && (min ?? 0) <= highest;
}

/** The project's effective rules (overrides on top of the defaults). */
export const qualificationRulesOf = (proj: {
	qualificationRules: Partial<QualificationRules>;
}): QualificationRules => ({
	...defaultQualificationRules,
	...proj.qualificationRules,
});

/** The available-unit price range of a project, or null without priced units. */
export async function projectPriceRange(
	db: Pick<Database, "select">,
	projectId: string,
) {
	const [range] = await db
		.select(availablePriceRange())
		.from(unit)
		.where(and(eq(unit.projectId, projectId), eq(unit.status, "available")));
	return range?.minPriceSatang != null && range.maxPriceSatang != null
		? { min: range.minPriceSatang, max: range.maxPriceSatang }
		: null;
}
