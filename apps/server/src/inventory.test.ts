import {
	auditLog,
	unit,
	unitPriceHistory,
} from "@Real-Estate-CRM/db/schema/index";
import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import app from "./index";
import { db } from "./services";
import {
	addMember,
	callerAs,
	createOrg,
	signIn,
	webOrigin,
} from "./test-support";

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "OK";
	} catch (error) {
		return error instanceof TRPCError ? error.code : String(error);
	}
}

const CSV = [
	"section,floor,unit_number,unit_type,land_size_sqwah,usable_area_sqm,facing,tags,list_price",
	'Building A,8,A-801,1 Bedroom,,32.5,NE,"corner, pool view","3,250,000"',
	"Building A,8,A-802,1 Bedroom,,,N,,3100000",
	"Building A,2,A-201,2 Bedroom,,55,S,corner,5200000.50",
	"Building A,9,A-901,1 Bedroom,,,UP,,3300000",
	"Building B,,B-101,,,,,,",
	"Building A,8,A-801,1 Bedroom,,,NE,,3250000",
].join("\n");

/** Admin with a condo project and units imported from CSV. */
async function setup() {
	const org = await createOrg();
	const admin = await callerAs(org.id, "admin");
	const { id: projectId } = await admin.caller.project.create({
		name: "Baan Suan Condo",
		type: "condo",
	});
	await admin.caller.unit.importCommit({ projectId, csv: CSV });
	const grid = await admin.caller.unit.grid({ projectId });
	const byNumber = (n: string) => {
		const found = grid.units.find((u) => u.unitNumber === n);
		if (!found) throw new Error(`no unit ${n}`);
		return found;
	};
	return { org, admin: admin.caller, projectId, grid, byNumber };
}

describe("project settings", () => {
	test("admin updates settings; invalid office hours and time zones are rejected", async () => {
		const { admin, projectId } = await setup();
		const hours = {
			mon: { open: "10:00", close: "19:00" },
			tue: { open: "10:00", close: "19:00" },
			wed: null,
			thu: { open: "10:00", close: "19:00" },
			fri: { open: "10:00", close: "19:00" },
			sat: { open: "09:00", close: "18:00" },
			sun: { open: "09:00", close: "18:00" },
		};
		await admin.project.update({
			projectId,
			type: "mixed",
			timeZone: "Asia/Bangkok",
			officeHours: hours,
			commissionBps: 150,
			unitTags: ["corner", "pool view", "garden"],
		});
		const p = await admin.project.get({ projectId });
		expect(p).toMatchObject({
			type: "mixed",
			officeHours: hours,
			commissionBps: 150,
		});

		expect(
			await codeOf(
				admin.project.update({
					projectId,
					officeHours: { ...hours, mon: { open: "19:00", close: "10:00" } },
				}),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(
				admin.project.update({ projectId, timeZone: "Mars/Olympus" }),
			),
		).toBe("BAD_REQUEST");
		expect(
			await codeOf(admin.project.update({ projectId, commissionBps: 10_001 })),
		).toBe("BAD_REQUEST");
	});

	test("a tag in use cannot be removed from the project's list", async () => {
		const { admin, projectId } = await setup();
		expect(
			await codeOf(admin.project.update({ projectId, unitTags: ["corner"] })),
		).toBe("CONFLICT");
	});

	test("closed dates can be added, updated and removed", async () => {
		const { admin, projectId } = await setup();
		await admin.project.addClosedDate({
			projectId,
			date: "2026-12-31",
			note: "NYE",
		});
		await admin.project.addClosedDate({
			projectId,
			date: "2026-04-13",
			note: "สงกรานต์",
		});
		expect((await admin.project.get({ projectId })).closedDates).toEqual([
			{ date: "2026-04-13", note: "สงกรานต์" },
			{ date: "2026-12-31", note: "NYE" },
		]);
		await admin.project.removeClosedDate({ projectId, date: "2026-12-31" });
		expect(
			await codeOf(
				admin.project.removeClosedDate({ projectId, date: "2026-12-31" }),
			),
		).toBe("NOT_FOUND");
	});

	test("salespeople and sales managers cannot change project settings", async () => {
		const { org, projectId } = await setup();
		for (const role of ["salesperson", "sales_manager"] as const) {
			const { caller } = await callerAs(org.id, role, [projectId]);
			expect(
				await codeOf(caller.project.update({ projectId, commissionBps: 1 })),
			).toBe("FORBIDDEN");
		}
	});
});

describe("unit import", () => {
	test("preview reports each row's errors and what will be created", async () => {
		const org = await createOrg();
		const { caller } = await callerAs(org.id, "admin");
		const { id: projectId } = await caller.project.create({
			name: "P",
			type: "condo",
		});
		const preview = await caller.unit.importPreview({ projectId, csv: CSV });

		expect(preview.missingColumns).toEqual([]);
		expect(preview.validCount).toBe(3);
		expect(preview.errorCount).toBe(3);
		const errorsOf = (line: number) =>
			preview.rows
				.find((r) => r.line === line)
				?.errors.map((e) => `${e.field}:${e.code}`);
		expect(errorsOf(5)).toEqual(["facing:invalid_facing"]);
		expect(errorsOf(6)).toEqual(
			expect.arrayContaining(["unitType:required", "listPrice:required"]),
		);
		expect(errorsOf(7)).toEqual(["row:duplicate_in_file"]);
		expect(preview.newSections).toEqual(["Building A"]);
		expect(preview.newUnitTypes.sort()).toEqual(["1 Bedroom", "2 Bedroom"]);
		expect(preview.newTags.sort()).toEqual(["corner", "pool view"]);

		const a801 = preview.rows.find((r) => r.line === 2);
		expect(a801).toMatchObject({
			floor: 8,
			usableAreaSqm: 32.5,
			facing: "NE",
			tags: ["corner", "pool view"],
			listPriceSatang: 325_000_000,
		});
		expect(preview.rows.find((r) => r.line === 4)?.listPriceSatang).toBe(
			520_000_050,
		);
	});

	test("commit imports valid rows, creates sections/types/tags, and skips existing units on re-import", async () => {
		const { admin, projectId, grid } = await setup();
		expect(grid.units.map((u) => u.unitNumber).sort()).toEqual([
			"A-201",
			"A-801",
			"A-802",
		]);
		expect(grid.sections).toMatchObject([
			{ name: "Building A", kind: "building" },
		]);
		expect((await admin.project.get({ projectId })).unitTags.sort()).toEqual([
			"corner",
			"pool view",
		]);

		const again = await admin.unit.importPreview({ projectId, csv: CSV });
		expect(again.validCount).toBe(0);
		expect(
			again.rows.find((r) => r.line === 2)?.errors.map((e) => e.code),
		).toContain("already_exists");
		expect(await codeOf(admin.unit.importCommit({ projectId, csv: CSV }))).toBe(
			"BAD_REQUEST",
		);

		const [entry] = await db
			.select({ after: auditLog.after })
			.from(auditLog)
			.where(eq(auditLog.action, "unit.import"));
		expect(entry?.after).toMatchObject({ imported: 3, skipped: 3 });
	});

	test("Thai headers, a BOM, semicolons and Thai facing names are understood", async () => {
		const org = await createOrg();
		const { caller } = await callerAs(org.id, "admin");
		const { id: projectId } = await caller.project.create({
			name: "บ้านสวน",
			type: "low_rise",
		});
		const csv =
			"﻿เฟส;แปลง;แบบบ้าน;ที่ดิน (ตร.ว.);ทิศ;ราคา (บาท)\r\n" +
			"เฟส 1;12/3;แบบ A;52.5;ตะวันออก;4,590,000\r\n";
		const result = await caller.unit.importCommit({ projectId, csv });
		expect(result).toEqual({ imported: 1, skipped: 0 });
		const grid = await caller.unit.grid({ projectId });
		expect(grid.sections).toMatchObject([{ name: "เฟส 1", kind: "phase" }]);
		expect(grid.units[0]).toMatchObject({
			unitNumber: "12/3",
			unitTypeName: "แบบ A",
			landSizeSqwah: 52.5,
			facing: "E",
			listPriceSatang: 459_000_000,
			floor: null,
		});
	});

	test("a file without the required columns is refused", async () => {
		const { admin, projectId } = await setup();
		const csv = "unit_number,list_price\nX-1,100\n";
		const preview = await admin.unit.importPreview({ projectId, csv });
		expect(preview.missingColumns.sort()).toEqual(["section", "unitType"]);
		expect(await codeOf(admin.unit.importCommit({ projectId, csv }))).toBe(
			"BAD_REQUEST",
		);
	});

	test("only admins import", async () => {
		const { org, projectId } = await setup();
		const { caller } = await callerAs(org.id, "sales_manager", [projectId]);
		expect(
			await codeOf(caller.unit.importCommit({ projectId, csv: CSV })),
		).toBe("FORBIDDEN");
	});
});

describe("units", () => {
	test("price edits need a reason, keep history and audit; same price is refused", async () => {
		const { org, projectId, byNumber } = await setup();
		const manager = await callerAs(org.id, "sales_manager", [projectId]);
		const a801 = byNumber("A-801");

		expect(
			await codeOf(
				manager.caller.unit.updatePrice({
					unitId: a801.id,
					newPriceSatang: 1,
					reason: "",
				}),
			),
		).toBe("BAD_REQUEST");
		await manager.caller.unit.updatePrice({
			unitId: a801.id,
			newPriceSatang: 339_000_000,
			reason: "Phase 2 price list",
		});
		expect(
			await codeOf(
				manager.caller.unit.updatePrice({
					unitId: a801.id,
					newPriceSatang: 339_000_000,
					reason: "again",
				}),
			),
		).toBe("BAD_REQUEST");

		const history = await manager.caller.unit.priceHistory({ unitId: a801.id });
		expect(history).toMatchObject([
			{
				oldPriceSatang: 325_000_000,
				newPriceSatang: 339_000_000,
				reason: "Phase 2 price list",
				changedBy: manager.user.name,
			},
		]);
		const [audited] = await db
			.select()
			.from(auditLog)
			.where(eq(auditLog.action, "unit.price_change"));
		expect(audited?.actorUserId).toBe(manager.user.id);
	});

	test("concurrent price edits are serialised: every change is in the history", async () => {
		const { admin, byNumber } = await setup();
		const a802 = byNumber("A-802");
		await Promise.all(
			[1, 2, 3, 4, 5].map((i) =>
				admin.unit.updatePrice({
					unitId: a802.id,
					newPriceSatang: 310_000_000 + i * 100_000,
					reason: `change ${i}`,
				}),
			),
		);
		const history = (
			await admin.unit.priceHistory({ unitId: a802.id })
		).reverse();
		expect(history.length).toBe(5);
		// Each change starts from the price the previous one set.
		expect(history[0]?.oldPriceSatang).toBe(310_000_000);
		for (let i = 1; i < history.length; i++) {
			expect(history[i]?.oldPriceSatang).toBe(history[i - 1]?.newPriceSatang);
		}
	});

	test("block and unblock follow the unit's status", async () => {
		const { admin, byNumber } = await setup();
		const { id } = byNumber("A-201");
		await admin.unit.block({ unitId: id });
		expect(await codeOf(admin.unit.block({ unitId: id }))).toBe("CONFLICT");
		await admin.unit.unblock({ unitId: id });
		expect(await codeOf(admin.unit.unblock({ unitId: id }))).toBe("CONFLICT");
	});

	test("price ranges only count available units", async () => {
		const { admin, projectId, byNumber } = await setup();
		await admin.unit.block({ unitId: byNumber("A-201").id });
		const p = await admin.project.get({ projectId });
		expect([p.minPriceSatang, p.maxPriceSatang]).toEqual([
			310_000_000, 325_000_000,
		]);
		const types = await admin.unitType.list({ projectId });
		expect(types.find((t) => t.name === "2 Bedroom")).toMatchObject({
			unitCount: 1,
			minPriceSatang: null,
			maxPriceSatang: null,
		});
	});

	test("grid filters combine", async () => {
		const { admin, projectId } = await setup();
		const tagged = await admin.unit.grid({ projectId, tags: ["corner"] });
		expect(tagged.units.map((u) => u.unitNumber).sort()).toEqual([
			"A-201",
			"A-801",
		]);
		const cheap = await admin.unit.grid({
			projectId,
			tags: ["corner"],
			maxPriceSatang: 400_000_000,
		});
		expect(cheap.units.map((u) => u.unitNumber)).toEqual(["A-801"]);
		const north = await admin.unit.grid({ projectId, facings: ["N"] });
		expect(north.units.map((u) => u.unitNumber)).toEqual(["A-802"]);
	});

	test("salespeople read their projects' grid but cannot edit; other projects are invisible", async () => {
		const { org, projectId, admin, byNumber } = await setup();
		const { id: otherId } = await admin.project.create({
			name: "Other project",
		});
		const sales = await callerAs(org.id, "salesperson", [projectId]);
		expect((await sales.caller.unit.grid({ projectId })).units.length).toBe(3);
		expect(await codeOf(sales.caller.unit.grid({ projectId: otherId }))).toBe(
			"NOT_FOUND",
		);
		const unitId = byNumber("A-801").id;
		expect(
			await codeOf(
				sales.caller.unit.updatePrice({
					unitId,
					newPriceSatang: 1,
					reason: "cheap",
				}),
			),
		).toBe("FORBIDDEN");
		expect(await codeOf(sales.caller.unit.block({ unitId }))).toBe("FORBIDDEN");
	});

	test("a sales manager cannot edit units in projects they don't cover", async () => {
		const { org, byNumber, admin } = await setup();
		const { id: otherId } = await admin.project.create({ name: "Elsewhere" });
		const manager = await callerAs(org.id, "sales_manager", [otherId]);
		expect(
			await codeOf(
				manager.caller.unit.updatePrice({
					unitId: byNumber("A-801").id,
					newPriceSatang: 1_000_00,
					reason: "nope",
				}),
			),
		).toBe("NOT_FOUND");
	});

	test("price history is append-only in the database", async () => {
		const { admin, byNumber } = await setup();
		const unitId = byNumber("A-801").id;
		await admin.unit.updatePrice({
			unitId,
			newPriceSatang: 330_000_000,
			reason: "Promotion ended",
		});
		// Catch manually: Bun 1.4.3 crashes formatting this pg error in rejects.toThrow().
		let message = "no error";
		try {
			await db.execute(sql`update unit_price_history set reason = 'edited'`);
		} catch (error) {
			message = String((error as { cause?: Error }).cause?.message ?? error);
		}
		expect(message).toContain("append-only");
		const rows = await db
			.select()
			.from(unitPriceHistory)
			.where(eq(unitPriceHistory.unitId, unitId));
		expect(rows[0]?.reason).toBe("Promotion ended");
	});

	test("the database rejects a unit pointing at another project's section", async () => {
		const { org, admin, grid } = await setup();
		const { id: otherId } = await admin.project.create({ name: "Second" });
		const [sectionA] = grid.sections;
		const typeId = grid.units[0]?.unitTypeId ?? "";
		let failed = false;
		try {
			await db.insert(unit).values({
				organizationId: org.id,
				projectId: otherId,
				sectionId: sectionA?.id ?? "",
				unitTypeId: typeId,
				unitNumber: "X",
				listPriceSatang: 100,
			});
		} catch {
			failed = true;
		}
		expect(failed).toBe(true);
	});
});

describe("sections and unit types", () => {
	test("sections reorder, names are unique per project, and used sections can't be deleted", async () => {
		const { admin, projectId, grid } = await setup();
		const b = await admin.section.create({
			projectId,
			kind: "building",
			name: "Building B",
		});
		expect(
			await codeOf(
				admin.section.create({
					projectId,
					kind: "building",
					name: "Building B",
				}),
			),
		).toBe("CONFLICT");
		await admin.section.move({ sectionId: b.id, direction: "up" });
		expect(
			(await admin.section.list({ projectId })).map((s) => s.name),
		).toEqual(["Building B", "Building A"]);
		expect(
			await codeOf(
				admin.section.delete({ sectionId: grid.sections[0]?.id ?? "" }),
			),
		).toBe("CONFLICT");
		await admin.section.delete({ sectionId: b.id });
	});

	test("unit types reject another organization's floor plan key", async () => {
		const { admin, projectId } = await setup();
		const other = await createOrg();
		expect(
			await codeOf(
				admin.unitType.create({
					projectId,
					name: "Penthouse",
					floorPlanKey: `orgs/${other.id}/floor-plans/x.png`,
				}),
			),
		).toBe("BAD_REQUEST");
	});
});

describe("cross-tenant isolation (org B cannot read or change org A)", () => {
	test("every M2 procedure returns NOT_FOUND for another company's ids", async () => {
		const a = await setup();
		const b = await createOrg();
		const { caller: adminB } = await callerAs(b.id, "admin");
		const unitId = a.byNumber("A-801").id;
		const sectionId = a.grid.sections[0]?.id ?? "";
		const unitTypeId = a.grid.units[0]?.unitTypeId ?? "";
		const projectId = a.projectId;

		const attempts: Record<string, () => Promise<unknown>> = {
			"project.get": () => adminB.project.get({ projectId }),
			"project.update": () =>
				adminB.project.update({ projectId, commissionBps: 1 }),
			"project.addClosedDate": () =>
				adminB.project.addClosedDate({ projectId, date: "2026-01-01" }),
			"section.list": () => adminB.section.list({ projectId }),
			"section.create": () =>
				adminB.section.create({ projectId, kind: "zone", name: "Z" }),
			"section.update": () =>
				adminB.section.update({ sectionId, name: "Hijacked" }),
			"section.delete": () => adminB.section.delete({ sectionId }),
			"unitType.list": () => adminB.unitType.list({ projectId }),
			"unitType.update": () =>
				adminB.unitType.update({ unitTypeId, name: "Hijacked" }),
			"unit.grid": () => adminB.unit.grid({ projectId }),
			"unit.priceHistory": () => adminB.unit.priceHistory({ unitId }),
			"unit.updatePrice": () =>
				adminB.unit.updatePrice({
					unitId,
					newPriceSatang: 100,
					reason: "hijack",
				}),
			"unit.block": () => adminB.unit.block({ unitId }),
			"unit.importPreview": () =>
				adminB.unit.importPreview({ projectId, csv: CSV }),
		};
		const results: Record<string, string> = {};
		for (const [name, attempt] of Object.entries(attempts)) {
			results[name] = await codeOf(attempt());
		}
		expect(results).toEqual(
			Object.fromEntries(Object.keys(results).map((k) => [k, "NOT_FOUND"])),
		);

		const [untouched] = await db
			.select()
			.from(unit)
			.where(and(eq(unit.id, unitId)));
		expect(untouched).toMatchObject({
			listPriceSatang: 325_000_000,
			status: "available",
		});
	});
});

describe("floor plan uploads", () => {
	const png = new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48,
		0x44, 0x52,
	]);

	async function upload(cookie: string, file: File, origin = webOrigin) {
		const form = new FormData();
		form.set("file", file);
		return app.request("/files/floor-plans", {
			method: "POST",
			headers: { Cookie: cookie, Origin: origin },
			body: form,
		});
	}

	test("admins upload images; the signed URL serves them and rejects tampering", async () => {
		const org = await createOrg();
		const { user } = await addMember(org.id, "admin");
		const cookie = await signIn(user.email);

		const res = await upload(
			cookie,
			new File([png], "plan.png", { type: "image/png" }),
		);
		expect(res.status).toBe(200);
		const { key, url } = (await res.json()) as { key: string; url: string };
		expect(key.startsWith(`orgs/${org.id}/floor-plans/`)).toBe(true);

		const path = new URL(url).pathname + new URL(url).search;
		const ok = await app.request(path);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("Content-Type")).toContain("image/png");
		expect(new Uint8Array(await ok.arrayBuffer())).toEqual(png);

		const tampered = await app.request(path.replace(/sig=[^&]+/, "sig=forged"));
		expect(tampered.status).toBe(404);
		const expired = await app.request(path.replace(/exp=\d+/, "exp=1"));
		expect(expired.status).toBe(404);
	});

	test("non-images, oversized files, other roles and other origins are refused", async () => {
		const org = await createOrg();
		const { user: adminUser } = await addMember(org.id, "admin");
		const { user: salesUser } = await addMember(org.id, "salesperson");
		const admin = await signIn(adminUser.email);
		const sales = await signIn(salesUser.email);

		const script = new File(["<script>alert(1)</script>"], "plan.png", {
			type: "image/png",
		});
		expect((await upload(admin, script)).status).toBe(415);
		const huge = new File([png, new Uint8Array(6 * 1024 * 1024)], "big.png", {
			type: "image/png",
		});
		expect((await upload(admin, huge)).status).toBe(413);
		const image = new File([png], "plan.png", { type: "image/png" });
		expect((await upload(sales, image)).status).toBe(403);
		expect((await upload(admin, image, "https://evil.example")).status).toBe(
			403,
		);
	});
});
