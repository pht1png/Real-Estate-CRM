import { defaultQualificationRules } from "@Real-Estate-CRM/db/constants";
import { describe, expect, test } from "bun:test";

import { assessFit, type FitInputs } from "./fit";

const range = { min: 300_000_000, max: 500_000_000 }; // ฿3M – ฿5M
const base: FitInputs = {
	budgetMinSatang: 350_000_000,
	budgetMaxSatang: 450_000_000,
	buyingTimeline: "1_3_months",
	priceRange: range,
};

describe("assessFit", () => {
	test("budget in range and buying soon fits", () => {
		expect(assessFit(base)).toBe("fits");
	});

	test("buying later than the window, or not sure, is too early", () => {
		expect(assessFit({ ...base, buyingTimeline: "6_12_months" })).toBe(
			"too_early",
		);
		expect(assessFit({ ...base, buyingTimeline: "unknown" })).toBe("too_early");
		// The window is a project setting.
		expect(
			assessFit(
				{ ...base, buyingTimeline: "6_12_months" },
				{ ...defaultQualificationRules, qualifyWithinMonths: 12 },
			),
		).toBe("fits");
	});

	test("budget below or above the range beyond the tolerance doesn't fit", () => {
		// 10 % under ฿3M = ฿2.7M: ฿2.8M still fits, ฿2.6M doesn't.
		expect(
			assessFit({
				...base,
				budgetMinSatang: null,
				budgetMaxSatang: 280_000_000,
			}),
		).toBe("fits");
		expect(
			assessFit({
				...base,
				budgetMinSatang: null,
				budgetMaxSatang: 260_000_000,
			}),
		).toBe("budget_no_fit");
		// 10 % over ฿5M = ฿5.5M.
		expect(
			assessFit({
				...base,
				budgetMinSatang: 600_000_000,
				budgetMaxSatang: null,
			}),
		).toBe("budget_no_fit");
		// No tolerance: ฿2.8M is out.
		expect(
			assessFit(
				{ ...base, budgetMinSatang: null, budgetMaxSatang: 280_000_000 },
				{ ...defaultQualificationRules, budgetTolerancePct: 0 },
			),
		).toBe("budget_no_fit");
	});

	test("unknown without budget, timeline or priced units", () => {
		expect(
			assessFit({ ...base, budgetMinSatang: null, budgetMaxSatang: null }),
		).toBe("unknown");
		expect(assessFit({ ...base, buyingTimeline: null })).toBe("unknown");
		expect(assessFit({ ...base, priceRange: null })).toBe("unknown");
	});
});
