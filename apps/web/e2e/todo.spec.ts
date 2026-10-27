import { expect, test } from "@playwright/test";

import {
	addProject,
	assignTeam,
	choose,
	createOrganization,
	dateTimeLocal,
	fillWalkInDetails,
	inviteSalesperson,
	logNoAnswer,
	openCapture,
	poolLead,
	setUpOwner,
	tapCall,
	uniqueEmail,
} from "./support";

test("salesperson on a phone: pool, To do sections, qualify, confirmed visit → opportunity → lost, unreachable → disqualified, walk-in", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(240_000);
	const ownerEmail = uniqueEmail("owner-m4");
	await setUpOwner(
		owner,
		createOrganization("Overview Co", ownerEmail),
		ownerEmail,
	);
	await addProject(owner, "Riverside");
	const malee = await inviteSalesperson(owner, browser, "Malee Sales", {
		mobile: true,
	});
	await assignTeam(owner, "Riverside", ["Malee Sales"]);
	await owner.reload();
	await poolLead(owner, "Khun Nida", "089-111-2222");
	await poolLead(owner, "Khun Mali", "089-333-4444");

	// The sidebar's Pool item carries a red count of leads waiting.
	const m = malee.page;
	await m.goto("/dashboard");
	await m.getByRole("button", { name: "Toggle Sidebar" }).click();
	await expect(
		m.getByRole("link", { name: /พูลผู้สนใจ.*มีผู้สนใจ 2 รายรอรับ/ }),
	).toBeVisible();
	await m.getByRole("link", { name: /พูลผู้สนใจ/ }).click();
	await expect(m).toHaveURL(/\/pool$/);
	await m.keyboard.press("Escape");

	// Claim both from the Pool page.
	const pool = m.getByRole("list", { name: "พูลผู้สนใจ" });
	for (const name of ["Khun Nida", "Khun Mali"]) {
		await pool
			.getByRole("listitem")
			.filter({ hasText: name })
			.getByRole("button", { name: "รับผู้สนใจ" })
			.click();
		await expect(pool.getByText(name)).toBeHidden();
	}

	// Overview: the Leads section counts both as New.
	await m.goto("/dashboard");
	const leadsSection = m.getByRole("region", { name: "ผู้สนใจ", exact: true });
	await expect(
		leadsSection.getByRole("link", { name: /ใหม่\s*2/ }),
	).toBeVisible();

	// To do: both are blue lead cards due today, with aligned attributes.
	await m.goto("/todo");
	const due = m.getByRole("region", { name: /ถึงกำหนดวันนี้/ });
	const stale = m.getByRole("region", { name: /ค้าง \/ เกินกำหนด/ });
	const nida = due.getByRole("listitem").filter({ hasText: "Khun Nida" });
	await expect(nida.getByText("ผู้สนใจ", { exact: true })).toBeVisible();
	await expect(
		nida.getByRole("definition").filter({ hasText: "ใหม่" }),
	).toBeVisible();
	await expect(nida.getByText(/ติดต่อภายใน/)).toBeVisible();

	// No answer → Attempting, try 1 of 3.
	await logNoAnswer(m, nida);
	await expect(nida.getByText("กำลังติดต่อ", { exact: true })).toBeVisible();
	await expect(nida.getByText("1 จาก 3 ครั้ง")).toBeVisible();

	// Answered → Save & qualify (reaching her isn't qualifying her).
	await tapCall(nida);
	await m.getByRole("button", { name: "รับสาย", exact: true }).click();
	const answered = m.getByRole("dialog", { name: "ลูกค้ารับสาย" });
	await answered.getByLabel("บันทึก", { exact: true }).fill("Wants a 2-bed");
	await answered.getByRole("button", { name: /วันทำการถัดไป/ }).click();
	await answered.getByRole("button", { name: "บันทึกและคัดกรอง" }).click();
	const qualify = m.getByRole("dialog", { name: "ผ่านการคัดกรอง" });
	await qualify.getByLabel("ตั้งแต่").fill("3000000");
	await qualify.getByLabel("ถึง", { exact: true }).fill("5000000");
	await qualify.getByRole("button", { name: "1–3 เดือน" }).click();
	await qualify.getByRole("button", { name: "อยู่เอง" }).click();
	await qualify
		.getByRole("button", { name: "ผ่านการคัดกรอง", exact: true })
		.click();
	await expect(qualify).toBeHidden();
	await expect(nida).toHaveCount(0);

	// Start mode walks what's left (Mali).
	await m.getByRole("button", { name: "เริ่มโทร" }).click();
	const callMode = m.getByRole("dialog", { name: "โหมดโทร" });
	await expect(callMode.getByText("รายที่ 1 จาก 1")).toBeVisible();
	await logNoAnswer(m, callMode);
	await expect(callMode.getByText("เรียบร้อยแล้ว")).toBeVisible();
	await callMode.getByRole("button", { name: "กลับไปหน้าภาพรวม" }).click();

	// Two more no-answers: Mali slips into Stale with the unreachable prompt.
	const maliDue = due.getByRole("listitem").filter({ hasText: "Khun Mali" });
	await logNoAnswer(m, maliDue);
	await logNoAnswer(m, maliDue);
	const mali = stale.getByRole("listitem").filter({ hasText: "Khun Mali" });
	const prompt = mali.getByRole("region", { name: "ติดต่อไม่ได้ 3 ครั้ง" });
	await prompt.getByRole("button", { name: "ไม่ผ่าน (ติดต่อไม่ได้)" }).click();
	await expect(mali).toHaveCount(0);

	// Nida comes to the showroom (already qualified): Confirm visit → green opportunity.
	await m.goto("/contacts");
	await m.getByRole("link", { name: "Khun Nida" }).click();
	const card = m
		.getByRole("heading", { name: "Riverside" })
		.locator("../../..");
	await card.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ยืนยันลูกค้าเข้าชมแล้ว" }).click();
	const visit = m.getByRole("dialog", { name: "ยืนยันลูกค้าเข้าชมแล้ว" });
	await visit.getByRole("button", { name: "ลูกค้าเข้าชมแล้ว" }).click();
	await expect(visit).toBeHidden();
	await expect(card.locator('[data-kind="opportunity"]')).toBeVisible();
	await expect(card.getByText("เยี่ยมชมแล้ว").first()).toBeVisible();

	// Negotiating, then Lost: a reason is required (Other needs your own words).
	await card.getByRole("button", { name: "การทำงานอื่น" }).first().click();
	await m.getByRole("menuitem", { name: "กำลังต่อรอง" }).click();
	await expect(card.getByText("กำลังต่อรอง").first()).toBeVisible();
	await card.getByRole("button", { name: "การทำงานอื่น" }).first().click();
	await m.getByRole("menuitem", { name: "ปิดเป็นไม่ซื้อ" }).click();
	const lost = m.getByRole("dialog", { name: "ปิดเป็นไม่ซื้อ" });
	await lost.getByRole("button", { name: "ปิดเป็นไม่ซื้อ", exact: true }).click();
	await expect(lost.getByText("เลือกเหตุผล")).toBeVisible();
	await lost.getByRole("button", { name: "อื่นๆ" }).click();
	await lost.getByRole("button", { name: "ปิดเป็นไม่ซื้อ", exact: true }).click();
	await expect(lost.getByText("กรอกบันทึกสำหรับเหตุผล อื่นๆ")).toBeVisible();
	await lost.getByRole("button", { name: "ซื้อโครงการอื่น" }).click();
	await lost.getByRole("button", { name: "ปิดเป็นไม่ซื้อ", exact: true }).click();
	await expect(lost).toBeHidden();
	await expect(card.getByText("ไม่ซื้อ · ซื้อโครงการอื่น").first()).toBeVisible();

	// A walk-in logged late: details are required, then Confirm visit qualifies first.
	await openCapture(m);
	await choose(m, "โครงการ", "Riverside");
	await m.getByLabel("เบอร์โทร", { exact: true }).fill("086-555-1234");
	await m.getByLabel("ชื่อ-นามสกุล").fill("Khun Arun");
	await choose(m, "แหล่งที่มา", "Walk-in");
	await m.getByRole("button", { name: "บันทึกลูกค้า", exact: true }).click();
	await expect(
		m.getByRole("alert").filter({ hasText: "กรุณากรอก" }),
	).toContainText("งบประมาณ");
	await fillWalkInDetails(m);
	const received = new Date(Date.now() - 20 * 60_000);
	await m.getByLabel("เวลาที่ลูกค้าติดต่อ").fill(dateTimeLocal(received));
	await m.getByRole("button", { name: "บันทึกลูกค้า", exact: true }).click();
	await expect(m.getByRole("heading", { name: "Khun Arun" })).toBeVisible();
	const arun = m
		.getByRole("heading", { name: "Riverside" })
		.locator("../../..");
	await arun.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ยืนยันลูกค้าเข้าชมแล้ว" }).click();
	// Not qualified yet: the qualify form comes first, pre-filled from capture.
	const qualifyArun = m.getByRole("dialog", { name: "ผ่านการคัดกรอง" });
	await expect(qualifyArun.getByLabel("ตั้งแต่")).toHaveValue("3000000");
	await qualifyArun
		.getByRole("button", { name: "ผ่านการคัดกรอง", exact: true })
		.click();
	const visitArun = m.getByRole("dialog", { name: "ยืนยันลูกค้าเข้าชมแล้ว" });
	await visitArun.getByRole("button", { name: "ลูกค้าเข้าชมแล้ว" }).click();
	await expect(visitArun).toBeHidden();
	await expect(arun.locator('[data-kind="opportunity"]')).toBeVisible();

	// Overview: the Opportunities section counts the new opportunity; lost this month 1.
	await m.goto("/dashboard");
	const opportunities = m.getByRole("region", {
		name: "โอกาสการขาย",
		exact: true,
	});
	await expect(
		opportunities.getByRole("link", { name: /เยี่ยมชมแล้ว\s*1/ }),
	).toBeVisible();
	await expect(opportunities.getByText(/ไม่ซื้อ 1/)).toBeVisible();

	await malee.context.close();
});
