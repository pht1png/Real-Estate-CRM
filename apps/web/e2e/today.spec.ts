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

test("pool lead on Today: salesperson claims it on a phone, logs a call with a follow-up", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(150_000);
	const ownerEmail = uniqueEmail("owner-m4");
	await setUpOwner(
		owner,
		createOrganization("Today Co", ownerEmail),
		ownerEmail,
	);
	await addProject(owner, "Riverside");
	const malee = await inviteSalesperson(owner, browser, "Malee Sales", {
		mobile: true,
	});
	await assignTeam(owner, "Riverside", ["Malee Sales"]);

	// The owner (acting as manager) sends a Facebook lead to the pool.
	await owner.reload();
	await openCapture(owner);
	await choose(owner, "โครงการ", "Riverside");
	await owner.getByLabel("เบอร์โทร").fill("089-111-2222");
	await owner.getByLabel("ชื่อลูกค้า").fill("Khun Nida");
	await choose(owner, "แหล่งที่มา", "Facebook");
	await owner.getByRole("button", { name: "บันทึกลูกค้า", exact: true }).click();
	await expect(owner.getByText("บันทึกลูกค้าใหม่แล้ว")).toBeVisible();

	// Malee's Today shows it in her pool; she claims it.
	const m = malee.page;
	await m.goto("/dashboard");
	const pool = m.getByRole("region", { name: /ลีดใหม่ในพูลของฉัน/ });
	const claims = m.getByRole("region", { name: /ต้องติดต่อวันนี้/ });
	await expect(pool.getByRole("link", { name: "Khun Nida" })).toBeVisible();
	await pool.getByRole("button", { name: "รับลีด" }).click();
	await expect(m.getByText("รับลีดแล้ว")).toBeVisible();
	await expect(pool.getByText("พูลว่าง")).toBeVisible();
	await expect(claims.getByRole("link", { name: "Khun Nida" })).toBeVisible();
	await expect(claims.getByText(/ติดต่อภายใน/)).toBeVisible();
	await expect(
		claims.getByRole("link", { name: "โทร", exact: true }),
	).toHaveAttribute("href", "tel:+66891112222");

	// She calls, notes it and books a follow-up for tomorrow: off today's lists.
	await claims.getByRole("button", { name: "โทรแล้ว" }).click();
	const dialog = m.getByRole("dialog", { name: "บันทึกการโทร" });
	await dialog.getByLabel("บันทึก", { exact: true }).fill("Wants a 2-bed");
	await dialog.getByRole("button", { name: "พรุ่งนี้ 10:00" }).click();
	await dialog.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(m.getByText("บันทึกแล้ว", { exact: true })).toBeVisible();
	await expect(claims.getByText("ไม่มีลีดที่รอติดต่อครั้งแรก")).toBeVisible();
	await expect(
		m
			.getByRole("region", { name: /นัดติดตามที่ถึงกำหนด/ })
			.getByText("วันนี้ไม่มีนัดติดตาม"),
	).toBeVisible();

	// The customer page shows her as owner and the call in the timeline.
	await m.goto("/customers");
	await m.getByRole("link", { name: "Khun Nida" }).click();
	await expect(m.getByText("ผู้ดูแล: Malee Sales")).toBeVisible();
	await expect(m.getByText("Wants a 2-bed")).toBeVisible();

	await malee.context.close();
});
