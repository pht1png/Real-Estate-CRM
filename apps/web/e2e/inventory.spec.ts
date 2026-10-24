import { expect, test } from "@playwright/test";

import {
	createOrganization,
	linkFromOutbox,
	PASSWORD,
	setUpOwner,
	uniqueEmail,
} from "./support";

// Minimal PNG header: enough for the server's image check.
const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
	0x44, 0x52,
]);

const CSV = [
	"section,floor,unit_number,unit_type,usable_area_sqm,facing,tags,list_price",
	'Building A,8,A-801,1 Bedroom,32.5,NE,"corner, pool view","3,250,000"',
	"Building A,8,A-802,1 Bedroom,,N,,3100000",
	"Building A,2,A-201,1 Bedroom,,S,corner,5200000",
	"Building A,9,A-901,1 Bedroom,,UP,,3300000",
].join("\n");

test("admin sets up a project and imports units; price change and block; salesperson read-only", async ({
	page,
	browser,
}) => {
	test.setTimeout(120_000);
	const ownerEmail = uniqueEmail("owner-m2");
	const salesEmail = uniqueEmail("sales-m2");
	await setUpOwner(
		page,
		createOrganization("Inventory Co", ownerEmail),
		ownerEmail,
	);
	await expect(page).toHaveURL(/\/dashboard$/);

	// Create the project and open its settings.
	await page.getByRole("link", { name: "โครงการ" }).click();
	await page.getByLabel("ชื่อโครงการ").fill("Baan Suan Condo");
	await page.getByRole("button", { name: "เพิ่มโครงการ" }).click();
	await page.getByRole("link", { name: "Baan Suan Condo" }).click();
	await expect(
		page.getByRole("heading", { name: "Baan Suan Condo" }),
	).toBeVisible();

	// General: commission.
	await page.getByLabel("ค่าคอมมิชชั่น (% ของราคาสุทธิ)").fill("1.5");
	await page.getByRole("button", { name: "บันทึก" }).click();
	await expect(page.getByText("บันทึกแล้ว").first()).toBeVisible();

	// Office hours: closed on Wednesdays.
	await page.getByRole("tab", { name: "เวลาทำการ" }).click();
	await page.getByRole("checkbox", { name: "วันพุธ" }).click();
	await expect(page.getByText("ปิดทำการ")).toBeVisible();
	await page.getByRole("button", { name: "บันทึก" }).click();
	await expect(page.getByText("บันทึกแล้ว").first()).toBeVisible();

	// Closed date, shown in the Buddhist era (2026 → 2569).
	await page.getByRole("tab", { name: "วันหยุด" }).click();
	await page.getByLabel("วันที่").fill("2026-04-13");
	await page.getByLabel("หมายเหตุ").fill("สงกรานต์");
	await page.getByRole("button", { name: "เพิ่ม", exact: true }).click();
	await expect(page.getByRole("cell", { name: /2569/ })).toBeVisible();

	// Unit type with a floor plan image.
	await page.getByRole("tab", { name: "แบบยูนิต" }).click();
	await page.getByRole("button", { name: "เพิ่มแบบยูนิต" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("ชื่อแบบ").fill("1 Bedroom");
	await dialog.getByLabel("แปลนห้อง").setInputFiles({
		name: "plan.png",
		mimeType: "image/png",
		buffer: PNG,
	});
	await expect(dialog.getByRole("img", { name: "แปลนห้อง" })).toBeVisible();
	await dialog.getByRole("button", { name: "บันทึก" }).click();
	await expect(
		page.getByRole("cell", { name: "1 Bedroom", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "แปลนห้อง" })).toBeVisible();

	// Import: one bad row is reported and skipped.
	await page.getByRole("tab", { name: "นำเข้ายูนิต" }).click();
	await page.getByLabel("เลือกไฟล์ CSV").setInputFiles({
		name: "units.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(CSV),
	});
	await page.getByRole("button", { name: "ตรวจสอบก่อนนำเข้า" }).click();
	await expect(page.getByText("พร้อมนำเข้า 3 แถว · มีปัญหา 1 แถว")).toBeVisible();
	await expect(page.getByText(/ไม่ใช่ทิศที่รู้จัก/)).toBeVisible();
	await page.getByRole("button", { name: "นำเข้า 3 ยูนิต" }).click();
	await expect(page.getByText("นำเข้าแล้ว 3 ยูนิต (ข้าม 1 แถว)")).toBeVisible();

	// Units grid: change a price with a reason, then block another unit.
	await page.getByRole("link", { name: "ยูนิต", exact: true }).click();
	await page.getByRole("button", { name: "A-801 · ว่าง" }).click();
	const sheet = page.getByRole("dialog");
	await sheet.getByLabel("ราคาใหม่ (บาท)").fill("3,390,000");
	await sheet.getByLabel("เหตุผล").fill("ราคาชุดใหม่");
	await sheet.getByRole("button", { name: "เปลี่ยนราคา" }).click();
	await expect(page.getByText("เปลี่ยนราคาแล้ว")).toBeVisible();
	await page.getByRole("button", { name: "A-801 · ว่าง" }).click();
	await expect(sheet.getByText("ราคาชุดใหม่").first()).toBeVisible();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "A-802 · ว่าง" }).click();
	await sheet.getByRole("button", { name: "ระงับการขายยูนิต" }).click();
	await expect(
		page.getByRole("button", { name: "A-802 · ระงับขาย" }),
	).toBeVisible();

	// A salesperson on the project sees the grid but no edit controls.
	await page.getByRole("link", { name: "สมาชิก" }).click();
	await page.getByLabel("อีเมล").fill(salesEmail);
	await page.getByRole("button", { name: "ส่งคำเชิญ" }).click();
	await expect(page.getByRole("cell", { name: salesEmail })).toBeVisible();
	const invitation = await linkFromOutbox(
		page,
		salesEmail,
		/http\S+\/accept-invitation\/\S+/,
	);

	const salesContext = await browser.newContext();
	const sales = await salesContext.newPage();
	await sales.goto(invitation);
	await sales.waitForLoadState("networkidle");
	await sales.getByLabel("ชื่อของคุณ").fill("Somsak Sales");
	await sales.getByLabel("อีเมล").fill(salesEmail);
	await sales.getByLabel("รหัสผ่าน").fill(PASSWORD);
	await sales.getByRole("button", { name: "สร้างบัญชีและเข้าร่วม" }).click();
	await expect(sales).toHaveURL(/\/dashboard$/);

	await page.getByRole("link", { name: "โครงการ" }).click();
	await page.getByRole("button", { name: "ทีม" }).click();
	await page.getByRole("checkbox", { name: /Somsak Sales/ }).click();
	await expect(
		page.getByRole("checkbox", { name: /Somsak Sales/ }),
	).toBeChecked();

	await sales.goto("/units");
	await sales.getByRole("button", { name: "A-801 · ว่าง" }).click();
	const salesSheet = sales.getByRole("dialog");
	await expect(salesSheet.getByText("ราคาชุดใหม่").first()).toBeVisible();
	await expect(
		salesSheet.getByRole("button", { name: "เปลี่ยนราคา" }),
	).toHaveCount(0);
	await expect(
		salesSheet.getByRole("button", { name: "ระงับการขายยูนิต" }),
	).toHaveCount(0);
	await salesContext.close();
});
