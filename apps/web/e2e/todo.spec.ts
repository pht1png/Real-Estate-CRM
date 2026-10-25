import { expect, test } from "@playwright/test";

import {
	addProject,
	assignTeam,
	createOrganization,
	inviteSalesperson,
	logNoAnswer,
	poolLead,
	setUpOwner,
	tapCall,
	uniqueEmail,
} from "./support";

test("salesperson on a phone: pool badge, claim, call results, qualify, confirmed visit → deal → lost, unreachable → disqualified, Start mode", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(180_000);
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
	await expect(m.getByRole("link", { name: /พูลลีด.*มี 2 ลีดรอรับ/ })).toBeVisible();
	await m.getByRole("link", { name: /พูลลีด/ }).click();
	await expect(m).toHaveURL(/\/pool$/);
	await m.keyboard.press("Escape");

	// Claim both from the Pool page.
	const pool = m.getByRole("list", { name: "พูลลีด" });
	for (const name of ["Khun Nida", "Khun Mali"]) {
		await pool
			.getByRole("listitem")
			.filter({ hasText: name })
			.getByRole("button", { name: "รับลีด" })
			.click();
		await expect(pool.getByText(name)).toBeHidden();
	}
	await expect(m.getByText("พูลว่าง")).toBeVisible();

	// Overview: cards count my leads; both wait for first contact in To do.
	await m.goto("/dashboard");
	await expect(m.getByRole("link", { name: /ลีดที่ดูแลอยู่\s*2/ })).toBeVisible();
	const todo = m.getByRole("region", { name: /สิ่งที่ต้องทำ/ });
	const nida = todo.getByRole("listitem").filter({ hasText: "Khun Nida" });
	const mali = todo.getByRole("listitem").filter({ hasText: "Khun Mali" });
	await expect(nida.getByText(/ลีดใหม่ · ติดต่อภายใน/)).toBeVisible();

	// Nida: no answer first (Attempting, try 1 of 3)…
	await logNoAnswer(m, nida);
	await expect(nida.getByText(/โทรครั้งที่ 1 จาก 3/)).toBeVisible();
	await expect(nida.getByText("กำลังติดต่อ", { exact: true })).toBeVisible();

	// …then answered: reaching her isn't qualifying her; she saves & qualifies herself.
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
	await expect(m.getByRole("link", { name: /ผ่านการคัดกรอง\s*1/ })).toBeVisible();

	// Start mode walks the list one lead at a time.
	await todo.getByRole("button", { name: "เริ่มโทร" }).click();
	const callMode = m.getByRole("dialog", { name: "โหมดโทร" });
	await expect(callMode.getByText("ลีดที่ 1 จาก 1")).toBeVisible();
	await logNoAnswer(m, callMode);
	await expect(callMode.getByText("เรียบร้อยแล้ว")).toBeVisible();
	await callMode.getByRole("button", { name: "กลับไปหน้าภาพรวม" }).click();

	// Two more no-answers within 7 days: unreachable → she disqualifies it.
	await logNoAnswer(m, mali);
	await logNoAnswer(m, mali);
	await expect(m.getByRole("button", { name: /ติดต่อไม่ได้\s*1/ })).toBeVisible();
	const prompt = mali.getByRole("region", { name: "ติดต่อไม่ได้ 3 ครั้ง" });
	await prompt.getByRole("button", { name: "ไม่ผ่าน (ติดต่อไม่ได้)" }).click();
	await expect(mali).toHaveCount(0);
	await expect(m.getByText("เคลียร์หมดแล้ว")).toBeVisible();

	// Nida comes to the showroom: confirming the visit turns the lead into a deal.
	await m.goto("/customers");
	await m.getByRole("link", { name: "Khun Nida" }).click();
	const card = m
		.getByRole("heading", { name: "Riverside" })
		.locator("../../..");
	await card.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ยืนยันลูกค้าเข้าชมแล้ว" }).click();
	const visit = m.getByRole("dialog", { name: "ยืนยันลูกค้าเข้าชมแล้ว" });
	await visit.getByRole("button", { name: "ลูกค้าเข้าชมแล้ว" }).click();
	await expect(visit).toBeHidden();
	await expect(card.getByText("เยี่ยมชมแล้ว").first()).toBeVisible();

	// The deal moves to negotiating, then is lost to a competitor.
	await card.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "กำลังต่อรอง" }).click();
	await expect(card.getByText("กำลังต่อรอง").first()).toBeVisible();
	await card.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ปิดเป็นไม่ซื้อ" }).click();
	const lost = m.getByRole("dialog", { name: "ปิดเป็นไม่ซื้อ" });
	await lost.getByRole("button", { name: "ซื้อโครงการอื่น" }).click();
	await lost.getByRole("button", { name: "ปิดเป็นไม่ซื้อ", exact: true }).click();
	await expect(lost).toBeHidden();
	await expect(card.getByText("ไม่ซื้อ · ซื้อโครงการอื่น").first()).toBeVisible();

	// The deals list has it under Lost.
	await m.goto("/customers?pipeline=deals&stage=lost");
	await expect(m.getByRole("link", { name: "Khun Nida" })).toBeVisible();

	await malee.context.close();
});
