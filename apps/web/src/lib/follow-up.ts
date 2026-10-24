const pad = (n: number) => String(n).padStart(2, "0");

/** A date as a datetime-local input value, in the browser's time zone. */
export function toDateTimeLocal(d: Date) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 10:00 local time, `days` from today. */
export function daysAtTen(days: number) {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(10, 0, 0, 0);
	return toDateTimeLocal(d);
}

/** `hours` from now, rounded up to the next quarter hour. */
export function hoursFromNow(hours: number) {
	const d = new Date(Date.now() + hours * 3_600_000);
	d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
	return toDateTimeLocal(d);
}

/** Tomorrow 10:00 local time, as a datetime-local value. */
export const defaultFollowUp = () => daysAtTen(1);
