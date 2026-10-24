import { describe, expect, test } from "bun:test";

import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
	test.each([
		["081-234-5678", "+66812345678"],
		["0812345678", "+66812345678"],
		["+66 81 234 5678", "+66812345678"],
		["66812345678", "+66812345678"],
		["02 123 4567", "+6621234567"],
		["+86 138 0013 8000", "+8613800138000"],
		["+65 8123 4567", "+6581234567"],
	])("%s → %s", (input, expected) => {
		expect(normalizePhone(input)).toBe(expected);
	});

	test.each(["", "12", "hello", "081-234", "+1 555"])("rejects %p", (input) => {
		expect(normalizePhone(input)).toBeNull();
	});
});

describe("formatPhone", () => {
	test("Thai numbers use local format, foreign ones international", () => {
		expect(formatPhone("+66812345678")).toBe("081 234 5678");
		expect(formatPhone("+8613800138000")).toBe("+86 138 0013 8000");
	});
});
