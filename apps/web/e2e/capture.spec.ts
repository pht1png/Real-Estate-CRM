import { expect, test } from "@playwright/test";

import {
	addProject,
	assignTeam,
	choose,
	createOrganization,
	inviteSalesperson,
	openCapture,
	setUpOwner,
	uniqueEmail,
} from "./support";

test("walk-in on a phone: duplicate check, owned at once; manager pools a lead; colleagues see summaries only", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(150_000);
	const ownerEmail = uniqueEmail("owner-m3");
	await setUpOwner(
		owner,
		createOrganization("Capture Co", ownerEmail),
		ownerEmail,
	);
	await addProject(owner, "Hillside");
	await addProject(owner, "Riverside");

	const malee = await inviteSalesperson(owner, browser, "Malee Sales");
	const somsak = await inviteSalesperson(owner, browser, "Somsak Sales", {
		mobile: true,
	});
	await assignTeam(owner, "Hillside", ["Malee Sales", "Somsak Sales"]);
	await assignTeam(owner, "Riverside", ["Malee Sales", "Somsak Sales"]);

	// Malee logs the customer for Hillside first.
	const m = malee.page;
	await m.reload();
	await openCapture(m);
	await choose(m, "โครงการ", "Hillside");
	await m.getByLabel("เบอร์โทร").fill("081-234-5678");
	await m.getByLabel("ชื่อลูกค้า").fill("Khun Somchai");
	await choose(m, "แหล่งที่มา", "Walk-in");
	await m.getByRole("checkbox", { name: /ยินยอมรับข้อมูลการตลาด/ }).click();
	await m.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(m.getByText("บันทึกลูกค้าใหม่แล้ว")).toBeVisible();
	await expect(m.getByRole("heading", { name: "Khun Somchai" })).toBeVisible();

	// Somsak, on a phone, logs a walk-in for Riverside: the duplicate check finds Khun Somchai.
	const s = somsak.page;
	await s.reload();
	await openCapture(s);
	await choose(s, "โครงการ", "Riverside");
	await s.getByLabel("เบอร์โทร").fill("0812345678");
	await expect(s.getByText("ลูกค้าเดิม: Khun Somchai")).toBeVisible();
	await expect(s.getByText("Hillside · ใหม่ · Malee Sales")).toBeVisible();
	await expect(s.getByLabel("ชื่อลูกค้า")).toHaveValue("Khun Somchai");
	await choose(s, "แหล่งที่มา", "Walk-in");
	await s.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(s.getByText("เพิ่มความสนใจให้ลูกค้าเดิมแล้ว")).toBeVisible();

	// His own interest in full; Malee's only as a summary line.
	await expect(s.getByRole("heading", { name: "Riverside" })).toBeVisible();
	await expect(s.getByText("ผู้ดูแล: Somsak Sales")).toBeVisible();
	await expect(s.getByText("Hillside · ใหม่ · Malee Sales")).toBeVisible();
	await expect(s.getByRole("heading", { name: "Hillside" })).toHaveCount(0);

	// The owner (acting as manager) sends a Facebook lead to the Riverside pool.
	await owner.reload();
	await openCapture(owner);
	await choose(owner, "โครงการ", "Riverside");
	await owner.getByLabel("เบอร์โทร").fill("089-999-9999");
	await owner.getByLabel("ชื่อลูกค้า").fill("Khun Nida");
	await choose(owner, "แหล่งที่มา", "Facebook");
	await expect(owner.getByLabel("ผู้ดูแล", { exact: true })).toContainText(
		"พูลของโครงการ",
	);
	await owner.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(owner.getByText("บันทึกลูกค้าใหม่แล้ว")).toBeVisible();

	// Malee sees the pool lead in her customer list.
	await m.goto("/customers");
	await choose(m, "ผู้ดูแล", "พูล");
	await expect(m.getByRole("link", { name: "Khun Nida" })).toBeVisible();

	await malee.context.close();
	await somsak.context.close();
});
