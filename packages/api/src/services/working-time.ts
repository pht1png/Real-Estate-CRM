import { type OfficeHours, weekdays } from "@Real-Estate-CRM/db/constants";

/** A project's sales-office calendar (brief §6 "Working days"). */
export type WorkingCalendar = {
	timeZone: string;
	officeHours: OfficeHours;
	/** Closed dates as YYYY-MM-DD in the project's time zone. */
	closedDates: ReadonlySet<string>;
};

const HOUR = 3_600_000;
const MAX_DAYS = 400;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
	let f = formatters.get(timeZone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(timeZone, f);
	}
	return f;
}

/** Wall-clock time in the zone, read as if it were UTC (ms). */
function wallClock(t: Date, timeZone: string) {
	const p = Object.fromEntries(
		formatter(timeZone)
			.formatToParts(t)
			.map((x) => [x.type, x.value]),
	);
	return Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour),
		Number(p.minute),
		Number(p.second),
	);
}

/** The local date (YYYY-MM-DD) of an instant in the zone. */
export function localDate(t: Date, timeZone: string) {
	return new Date(wallClock(t, timeZone)).toISOString().slice(0, 10);
}

/** The instant of a local date + HH:MM in the zone (handles DST shifts). */
export function zonedTime(date: string, hhmm: string, timeZone: string) {
	const wall = Date.parse(`${date}T${hhmm}:00Z`);
	let t = wall - (wallClock(new Date(wall), timeZone) - wall);
	t += wall - wallClock(new Date(t), timeZone);
	return new Date(t);
}

function addDays(date: string, days: number) {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

/** Opening and closing instants of a date, or null when the office is closed. */
function officeDay(cal: WorkingCalendar, date: string) {
	if (cal.closedDates.has(date)) return null;
	// getUTCDay: 0 = Sunday; weekdays starts at Monday.
	const day = new Date(`${date}T00:00:00Z`).getUTCDay();
	const hours = cal.officeHours[weekdays[(day + 6) % 7] ?? "mon"];
	if (!hours) return null;
	return {
		open: zonedTime(date, hours.open, cal.timeZone),
		close: zonedTime(date, hours.close, cal.timeZone),
	};
}

/** Office hours of the day the working clock is in at `t` (now, or the next opening). */
function currentOrNextOfficeDay(cal: WorkingCalendar, t: Date) {
	const today = localDate(t, cal.timeZone);
	for (let i = 0; i < MAX_DAYS; i++) {
		const day = officeDay(cal, addDays(today, i));
		if (day && t < day.close) {
			return { start: t < day.open ? day.open : t, ...day };
		}
	}
	return null;
}

/** `t` if the office is open then, else the next opening; null if it never opens. */
export function nextOpening(cal: WorkingCalendar, t: Date) {
	return currentOrNextOfficeDay(cal, t)?.start ?? null;
}

/**
 * Contact deadline (brief §6): office close on the working day the clock
 * starts (after hours = next opening). With fewer than `rollHours` left that
 * day, it rolls to the next working day's close. Null if the office never opens.
 */
export function contactDeadline(
	cal: WorkingCalendar,
	t: Date,
	rollHours: number,
) {
	const day = currentOrNextOfficeDay(cal, t);
	if (!day) return null;
	if (day.close.getTime() - day.start.getTime() >= rollHours * HOUR) {
		return day.close;
	}
	return currentOrNextOfficeDay(cal, day.close)?.close ?? null;
}
