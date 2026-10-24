import { defaultRules } from "@Real-Estate-CRM/db/constants";
import { describe, expect, test } from "bun:test";

import { type ScoreInputs, scoreInterest } from "./scoring";

const range = { min: 300_000_000, max: 500_000_000 }; // ฿3M – ฿5M
const base: ScoreInputs = {
	budgetMinSatang: null,
	budgetMaxSatang: null,
	buyingTimeline: null,
	priceRange: range,
};

describe("scoreInterest", () => {
	test("budget overlapping the range and buying within 3 months is priority", () => {
		const score = scoreInterest(
			{
				...base,
				budgetMinSatang: 400_000_000,
				budgetMaxSatang: 600_000_000,
				buyingTimeline: "1_3_months",
			},
			defaultRules,
		);
		expect(score).toEqual({
			priority: true,
			signals: ["budget_in_range", "timeline_soon"],
			version: "rules-v1",
		});
	});

	test("one signal alone is not priority", () => {
		expect(
			scoreInterest(
				{
					...base,
					budgetMaxSatang: 450_000_000,
					buyingTimeline: "6_12_months",
				},
				defaultRules,
			),
		).toMatchObject({ priority: false, signals: ["budget_in_range"] });
		expect(
			scoreInterest(
				{
					...base,
					budgetMaxSatang: 200_000_000,
					buyingTimeline: "under_1_month",
				},
				defaultRules,
			),
		).toMatchObject({ priority: false, signals: ["timeline_soon"] });
	});

	test("budget edges: touching the range overlaps, below it doesn't", () => {
		const s = (min: number | null, max: number | null) =>
			scoreInterest(
				{
					...base,
					budgetMinSatang: min,
					budgetMaxSatang: max,
					buyingTimeline: "under_1_month",
				},
				defaultRules,
			).priority;
		expect(s(null, 300_000_000)).toBe(true);
		expect(s(500_000_000, null)).toBe(true);
		expect(s(null, 299_999_999)).toBe(false);
		expect(s(500_000_001, null)).toBe(false);
	});

	test("timeline limit follows the company rule", () => {
		const inputs = {
			...base,
			budgetMaxSatang: 400_000_000,
			buyingTimeline: "3_6_months" as const,
		};
		expect(scoreInterest(inputs, defaultRules).priority).toBe(false);
		expect(
			scoreInterest(inputs, { ...defaultRules, preScoreTimelineMonths: 6 })
				.priority,
		).toBe(true);
	});

	test("no budget, unknown timeline or no available units is never priority", () => {
		expect(
			scoreInterest({ ...base, buyingTimeline: "under_1_month" }, defaultRules)
				.priority,
		).toBe(false);
		expect(
			scoreInterest(
				{ ...base, budgetMaxSatang: 400_000_000, buyingTimeline: "unknown" },
				defaultRules,
			).priority,
		).toBe(false);
		expect(
			scoreInterest(
				{
					...base,
					priceRange: null,
					budgetMaxSatang: 400_000_000,
					buyingTimeline: "under_1_month",
				},
				defaultRules,
			).priority,
		).toBe(false);
	});
});
