/**
 * Minimal RFC 4180 CSV reader: quoted cells (with "" escapes, commas and line
 * breaks inside), CRLF or LF, a leading BOM, and the delimiter Excel used
 * (comma, semicolon or tab — detected from the header line).
 */
export function parseCsv(text: string): string[][] {
	const input = text.replace(/^﻿/, "");
	const delimiter = detectDelimiter(input);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;

	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quoted) {
			if (ch === '"') {
				if (input[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				cell += ch;
			}
		} else if (ch === '"' && cell === "") {
			quoted = true;
		} else if (ch === delimiter) {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && input[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else {
			cell += ch;
		}
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

function detectDelimiter(input: string) {
	const counts = { ",": 0, ";": 0, "\t": 0 };
	let quoted = false;
	for (const ch of input) {
		if (ch === '"') quoted = !quoted;
		else if (!quoted && (ch === "\n" || ch === "\r")) break;
		else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
	}
	const [best] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return best && best[1] > 0 ? best[0] : ",";
}

/** Quotes a value for CSV output when needed. */
export function csvCell(value: string) {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
