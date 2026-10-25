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

test("salesperson on a phone: pool badge, claim, call results, unreachable → lost, Start mode", async ({
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

	// Nida: no answer first (try 1 of 3), then answered with a follow-up she picks.
	await logNoAnswer(m, nida);
	await expect(nida.getByText(/โทรครั้งที่ 1 จาก 3/)).toBeVisible();
	await tapCall(nida);
	await m.getByRole("button", { name: "รับสาย", exact: true }).click();
	const answered = m.getByRole("dialog", { name: "ลูกค้ารับสาย" });
	await answered.getByLabel("บันทึก", { exact: true }).fill("Wants a 2-bed");
	await answered.getByRole("button", { name: /วันทำการถัดไป/ }).click();
	await answered.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(answered).toBeHidden();
	await expect(nida).toHaveCount(0);
	await expect(m.getByRole("link", { name: /ติดต่อได้แล้ว\s*1/ })).toBeVisible();

	// Start mode walks the list one lead at a time.
	await todo.getByRole("button", { name: "เริ่มโทร" }).click();
	const callMode = m.getByRole("dialog", { name: "โหมดโทร" });
	await expect(callMode.getByText("ลีดที่ 1 จาก 1")).toBeVisible();
	await logNoAnswer(m, callMode);
	await expect(callMode.getByText("เรียบร้อยแล้ว")).toBeVisible();
	await callMode.getByRole("button", { name: "กลับไปหน้าภาพรวม" }).click();

	// Two more no-answers within 7 days: unreachable → she marks it lost.
	await logNoAnswer(m, mali);
	await logNoAnswer(m, mali);
	await expect(m.getByRole("button", { name: /ติดต่อไม่ได้\s*1/ })).toBeVisible();
	const prompt = mali.getByRole("region", { name: "ติดต่อไม่ได้ 3 ครั้ง" });
	await prompt.getByRole("button", { name: "ปิดเป็นไม่ซื้อ" }).click();
	await expect(mali).toHaveCount(0);
	await expect(m.getByText("เคลียร์หมดแล้ว")).toBeVisible();
	await expect(m.getByRole("link", { name: /ลีดที่ดูแลอยู่\s*1/ })).toBeVisible();

	await malee.context.close();
});
