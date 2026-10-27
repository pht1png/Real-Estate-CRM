import { describe, expect, test } from "bun:test";

import { assessTemperature, type TemperatureInputs } from "./temperature";

const rules = { budgetTolerancePct: 10 };
const base: TemperatureInputs = {
	budgetMinSatang: 300_000_000,
	budgetMaxSatang: 400_000_000,
	priceRange: { min: 350_000_000, max: 500_000_000 },
	buyingTimeline: "1_3_months",
	fundingType: "cash",
	visitCount: 1,
};

describe("assessTemperature (temp-v1)", () => {
	test("all four signals: hot", () => {
		expect(assessTemperature(base, rules)).toBe("hot");
	});

	test("two or three signals: warm", () => {
		expect(assessTemperature({ ...base, fundingType: "mortgage" }, rules)).toBe(
			"warm",
		);
		expect(
			assessTemperature(
				{ ...base, fundingType: null, buyingTimeline: "6_12_months" },
				rules,
			),
		).toBe("warm");
	});

	test("warm plus a second visit: hot", () => {
		expect(
			assessTemperature(
				{ ...base, fundingType: "cash_mortgage", visitCount: 2 },
				rules,
			),
		).toBe("hot");
	});

	test("only the visit: neither, even after several visits", () => {
		const cold: TemperatureInputs = {
			...base,
			buyingTimeline: "over_12_months",
			fundingType: "mortgage",
			priceRange: null,
			visitCount: 3,
		};
		expect(assessTemperature(cold, rules)).toBeNull();
	});

	test("budget outside the range beyond the tolerance doesn't count", () => {
		const far = {
			...base,
			budgetMinSatang: 100_000_000,
			budgetMaxSatang: 200_000_000,
		};
		expect(assessTemperature(far, rules)).toBe("warm");
		expect(assessTemperature({ ...far, fundingType: null }, rules)).toBe(
			"warm",
		);
		expect(
			assessTemperature(
				{ ...far, fundingType: null, buyingTimeline: "unknown" },
				rules,
			),
		).toBeNull();
	});
});
