import { defaultOfficeHours } from "@Real-Estate-CRM/db/constants";
import { describe, expect, test } from "bun:test";

import {
	contactDeadline,
	followUpPicks,
	localDate,
	nextOpening,
	type WorkingCalendar,
	zonedTime,
} from "./working-time";

// 09:00–18:00 every day, Sundays closed; Bangkok is UTC+7 all year.
const bangkok: WorkingCalendar = {
	timeZone: "Asia/Bangkok",
	officeHours: { ...defaultOfficeHours, sun: null },
	closedDates: new Set(),
};
/** Bangkok wall time → instant. 2026-11-02 is a Monday. */
const bkk = (date: string, hhmm: string) =>
	zonedTime(date, hhmm, "Asia/Bangkok");

describe("zonedTime / localDate", () => {
	test("Bangkok wall time is UTC+7", () => {
		expect(bkk("2026-11-02", "09:00").toISOString()).toBe(
			"2026-11-02T02:00:00.000Z",
		);
		expect(localDate(new Date("2026-11-02T18:30:00Z"), "Asia/Bangkok")).toBe(
			"2026-11-03",
		);
	});

	test("follows daylight saving in zones that have it", () => {
		// London: GMT in January, BST (UTC+1) in July.
		expect(
			zonedTime("2026-01-15", "09:00", "Europe/London").toISOString(),
		).toBe("2026-01-15T09:00:00.000Z");
		expect(
			zonedTime("2026-07-15", "09:00", "Europe/London").toISOString(),
		).toBe("2026-07-15T08:00:00.000Z");
	});
});

describe("nextOpening", () => {
	test("inside office hours the clock starts now", () => {
		const t = bkk("2026-11-02", "10:15");
		expect(nextOpening(bangkok, t)).toEqual(t);
	});

	test("before opening it starts at opening; after closing, the next day", () => {
		expect(nextOpening(bangkok, bkk("2026-11-02", "07:00"))).toEqual(
			bkk("2026-11-02", "09:00"),
		);
		expect(nextOpening(bangkok, bkk("2026-11-02", "19:00"))).toEqual(
			bkk("2026-11-03", "09:00"),
		);
	});

	test("skips closed weekdays and closed dates", () => {
		// Saturday evening → Sunday closed → Monday.
		expect(nextOpening(bangkok, bkk("2026-11-07", "18:30"))).toEqual(
			bkk("2026-11-09", "09:00"),
		);
		const holiday = { ...bangkok, closedDates: new Set(["2026-11-09"]) };
		expect(nextOpening(holiday, bkk("2026-11-07", "18:30"))).toEqual(
			bkk("2026-11-10", "09:00"),
		);
	});

	test("an office that never opens has no next opening", () => {
		const closed = {
			...bangkok,
			officeHours: Object.fromEntries(
				Object.keys(defaultOfficeHours).map((d) => [d, null]),
			) as WorkingCalendar["officeHours"],
		};
		expect(nextOpening(closed, bkk("2026-11-02", "10:00"))).toBeNull();
		expect(contactDeadline(closed, bkk("2026-11-02", "10:00"), 2)).toBeNull();
	});
});

describe("contactDeadline", () => {
	test("same working day's close when 2+ office hours remain", () => {
		expect(contactDeadline(bangkok, bkk("2026-11-02", "10:00"), 2)).toEqual(
			bkk("2026-11-02", "18:00"),
		);
		expect(contactDeadline(bangkok, bkk("2026-11-02", "16:00"), 2)).toEqual(
			bkk("2026-11-02", "18:00"),
		);
	});

	test("fewer than 2 hours left rolls to the next working day's close", () => {
		expect(contactDeadline(bangkok, bkk("2026-11-02", "16:01"), 2)).toEqual(
			bkk("2026-11-03", "18:00"),
		);
	});

	test("after hours the clock starts at next opening", () => {
		expect(contactDeadline(bangkok, bkk("2026-11-02", "22:00"), 2)).toEqual(
			bkk("2026-11-03", "18:00"),
		);
	});

	test("the roll skips Sundays and holidays", () => {
		// Saturday 17:00 → roll; Sunday closed; Monday is a holiday → Tuesday.
		const holiday = { ...bangkok, closedDates: new Set(["2026-11-09"]) };
		expect(contactDeadline(holiday, bkk("2026-11-07", "17:00"), 2)).toEqual(
			bkk("2026-11-10", "18:00"),
		);
	});

	test("uses each weekday's own hours", () => {
		const shortSaturday = {
			...bangkok,
			officeHours: {
				...bangkok.officeHours,
				sat: { open: "10:00", close: "15:00" },
			},
		};
		expect(
			contactDeadline(shortSaturday, bkk("2026-11-07", "12:30"), 2),
		).toEqual(bkk("2026-11-07", "15:00"));
	});
});

describe("followUpPicks", () => {
	test("in office hours: 2 hours ahead, rounded up to the quarter hour", () => {
		const picks = followUpPicks(bangkok, bkk("2026-11-02", "10:07"));
		expect(picks.in2h).toEqual(bkk("2026-11-02", "12:15"));
		expect(picks.nextWorkingDay).toEqual(bkk("2026-11-03", "10:00"));
		expect(picks.in3WorkingDays).toEqual(bkk("2026-11-05", "10:00"));
		expect(picks.nextWeek).toEqual(bkk("2026-11-09", "10:00"));
	});

	test("near closing, 'in 2 hours' becomes the next opening; picks skip closed days", () => {
		// Friday 17:52 → office closed at 19:52 → Saturday opening.
		const holiday = { ...bangkok, closedDates: new Set(["2026-11-09"]) };
		const picks = followUpPicks(holiday, bkk("2026-11-06", "17:52"));
		expect(picks.in2h).toEqual(bkk("2026-11-07", "09:00"));
		// Saturday; then Sunday (closed) and Monday (holiday) are skipped.
		expect(picks.nextWorkingDay).toEqual(bkk("2026-11-07", "10:00"));
		expect(picks.in3WorkingDays).toEqual(bkk("2026-11-11", "10:00"));
	});

	test("an office opening after 10:00 uses its opening time", () => {
		const late = {
			...bangkok,
			officeHours: {
				...bangkok.officeHours,
				tue: { open: "11:00", close: "19:00" },
			},
		};
		expect(
			followUpPicks(late, bkk("2026-11-02", "12:00")).nextWorkingDay,
		).toEqual(bkk("2026-11-03", "11:00"));
	});
});
