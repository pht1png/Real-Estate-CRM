import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Normalises a phone number to E.164 (brief §3) for storing and matching.
 * Thai numbers may be typed locally ("081-234-5678", "02 123 4567");
 * foreign numbers need their "+" country code. Returns null if invalid.
 * Shared by the server and the capture form, so both agree exactly.
 */
export function normalizePhone(input: string): string | null {
	const phone = parsePhoneNumberFromString(input.trim(), "TH");
	return phone?.isValid() ? phone.number : null;
}

/** Display format: Thai numbers in local style, others international. */
export function formatPhone(e164: string): string {
	const phone = parsePhoneNumberFromString(e164);
	if (!phone) return e164;
	return phone.country === "TH"
		? phone.formatNational()
		: phone.formatInternational();
}
