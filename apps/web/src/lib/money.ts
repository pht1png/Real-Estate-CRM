"use client";

import { useFormatter } from "next-intl";

/** "3,250,000.50" → 325000050 satang; null if not a positive baht amount. */
export function bahtToSatang(input: string): number | null {
	const cleaned = input.replace(/[,\s฿]/g, "");
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
	if (!match) return null;
	const satang =
		Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	return satang > 0 && Number.isSafeInteger(satang) ? satang : null;
}

/** 325000050 → "3250000.50" for editable inputs. */
export function satangToBahtInput(satang: number) {
	const baht = Math.floor(satang / 100);
	const rest = satang % 100;
	return rest ? `${baht}.${String(rest).padStart(2, "0")}` : String(baht);
}

/** Formats satang as Thai baht in the current locale (decimals only when needed). */
export function useFormatBaht() {
	const format = useFormatter();
	return (satang: number) =>
		format.number(satang / 100, {
			style: "currency",
			currency: "THB",
			minimumFractionDigits: satang % 100 ? 2 : 0,
			maximumFractionDigits: 2,
		});
}
