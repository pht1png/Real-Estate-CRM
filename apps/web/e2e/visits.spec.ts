import { expect, test } from "@playwright/test";

import {
	addProject,
	assignTeam,
	bookAppointment,
	claimFromPool,
	createOrganization,
	inviteSalesperson,
	logAnswered,
	poolLead,
	qualifyInDialog,
	sameBangkokDay,
	setUpOwner,
	uniqueEmail,
} from "./support";

test("salesperson on a phone: book a tour, clash, arrived → qualify → opportunity, follow-up visit, cash → hot, cancel needs a reason", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(240_000);
	const ownerEmail = uniqueEmail("owner-m5");
	await setUpOwner(
		owner,
		createOrganization("Showroom Co", ownerEmail),
		ownerEmail,
	);
	await addProject(owner, "Riverside");
	const malee = await inviteSalesperson(owner, browser, "Malee Sales", {
		mobile: true,
	});
	await assignTeam(owner, "Riverside", ["Malee Sales"]);
	await owner.reload();
	await poolLead(owner, "Khun Ploy", "089-555-1111");

	// Malee claims Ploy and reaches her (Connected, not yet qualified).
	const m = malee.page;
	await claimFromPool(m, "Khun Ploy");
	await m.goto("/todo");
	await logAnswered(
		m,
		m
			.getByRole("region", { name: /ถึงกำหนดวันนี้/ })
			.getByRole("listitem")
			.filter({ hasText: "Khun Ploy" }),
	);

	// Book a first tour from the contact page.
	await m.goto("/contacts");
	await m.getByRole("link", { name: "Khun Ploy" }).click();
	const card = m
		.getByRole("heading", { name: "Riverside" })
		.locator("../../..");
	const more = card.getByRole("button", { name: "การทำงานอื่น" }).first();
	// Soon, so it is today's arrival (unless that crosses midnight in Bangkok).
	const soon = new Date(Date.now() + 15 * 60_000);
	const booked = await bookAppointment(m, more, soon);
	await expect(booked).toBeHidden();
	await expect(card.getByText("เข้าชมครั้งแรก")).toBeVisible();

	// The same salesperson can't be booked twice at once.
	const clash = await bookAppointment(m, more, soon);
	await expect(
		m.getByText("พนักงานขายมีนัดอื่นในเวลานี้แล้ว เลือกเวลาอื่น"),
	).toBeVisible();
	await clash.getByRole("button", { name: "ยกเลิก", exact: true }).click();
	await expect(clash).toBeHidden();

	// Arrived: unvetted, so she is qualified face to face, then the visit converts.
	let arrived = card;
	if (sameBangkokDay(soon, new Date())) {
		await m.goto("/todo");
		arrived = m.getByRole("region", { name: /ลูกค้าเข้าชมวันนี้ \(1\)/ });
		await expect(arrived.getByText(/ยังไม่คัดกรอง \(ติดต่อได้แล้ว\) 1/)).toBeVisible();
	}
	await arrived.getByRole("button", { name: "มาแล้ว", exact: true }).click();
	await qualifyInDialog(m);
	const visit = m.getByRole("dialog", { name: "Khun Ploy มาถึงแล้ว" });
	await visit.getByRole("button", { name: "ลูกค้าเข้าชมแล้ว" }).click();
	await expect(visit).toBeHidden();

	await m.goto("/contacts?pipeline=opportunities");
	await m.getByRole("link", { name: "Khun Ploy" }).click();
	const opportunity = card.locator('[data-kind="opportunity"]');
	await expect(opportunity).toBeVisible();
	await expect(opportunity.getByText("เยี่ยมชมแล้ว")).toBeVisible();
	// Visited + buying within 3 months: warm.
	await expect(opportunity.getByText("อุ่น", { exact: true })).toBeVisible();

	// A follow-up visit on the opportunity; they come back.
	const later = new Date(Date.now() + 26 * 3_600_000);
	const second = await bookAppointment(
		m,
		opportunity.getByRole("button", { name: "การทำงานอื่น" }),
		later,
	);
	await expect(second).toBeHidden();
	const followUp = card
		.getByRole("listitem")
		.filter({ hasText: "เข้าชมอีกครั้ง" })
		.filter({ hasText: "นัดไว้" });
	await followUp.getByRole("button", { name: "มาแล้ว", exact: true }).click();
	const again = m.getByRole("dialog", { name: "Khun Ploy มาถึงแล้ว" });
	await again.getByRole("button", { name: "ลูกค้าเข้าชมแล้ว" }).click();
	await expect(again).toBeHidden();
	await expect(opportunity.getByText(/เยี่ยมชม 2 ครั้ง/)).toBeVisible();

	// Funding: cash. Warm with a second visit is hot.
	await opportunity.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "การชำระเงิน" }).click();
	const funding = m.getByRole("dialog", { name: "Khun Ploy จะชำระเงินอย่างไร" });
	await funding.getByRole("button", { name: "เงินสด", exact: true }).click();
	await funding.getByRole("button", { name: "บันทึก", exact: true }).click();
	await expect(funding).toBeHidden();
	await expect(opportunity.getByText("เงินสด", { exact: true })).toBeVisible();
	await expect(opportunity.getByText("ร้อน", { exact: true })).toBeVisible();

	// Cancelling an appointment needs a reason.
	const third = await bookAppointment(
		m,
		opportunity.getByRole("button", { name: "การทำงานอื่น" }),
		new Date(Date.now() + 50 * 3_600_000),
	);
	await expect(third).toBeHidden();
	const scheduled = card
		.getByRole("listitem")
		.filter({ hasText: "นัดไว้" })
		.first();
	await scheduled.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ยกเลิกนัด" }).click();
	const cancel = m.getByRole("dialog", { name: "ยกเลิกนัด" });
	await cancel.getByRole("button", { name: "ยกเลิกนัด", exact: true }).click();
	await expect(cancel.getByText("เลือกเหตุผล")).toBeVisible();
	await cancel.getByRole("button", { name: "ลูกค้ายกเลิก" }).click();
	await cancel.getByRole("button", { name: "ยกเลิกนัด", exact: true }).click();
	await expect(cancel).toBeHidden();
	await expect(
		card.getByText(/ยกเลิก.*ลูกค้ายกเลิก|ลูกค้ายกเลิก/).first(),
	).toBeVisible();

	await malee.context.close();
});

test("nurture releases a lead to the Nurturing pool, where another salesperson claims it", async ({
	page: owner,
	browser,
}) => {
	test.setTimeout(240_000);
	const ownerEmail = uniqueEmail("owner-nurture");
	await setUpOwner(
		owner,
		createOrganization("Nurture Co", ownerEmail),
		ownerEmail,
	);
	await addProject(owner, "Riverside");
	const malee = await inviteSalesperson(owner, browser, "Malee Sales", {
		mobile: true,
	});
	const somchai = await inviteSalesperson(owner, browser, "Somchai Sales", {
		mobile: true,
	});
	await assignTeam(owner, "Riverside", ["Malee Sales", "Somchai Sales"]);
	await owner.reload();
	await poolLead(owner, "Khun Dao", "089-555-2222");

	const m = malee.page;
	await claimFromPool(m, "Khun Dao");
	await m.goto("/contacts");
	await m.getByRole("link", { name: "Khun Dao" }).click();
	const card = m
		.getByRole("heading", { name: "Riverside" })
		.locator("../../..");
	await card.getByRole("button", { name: "การทำงานอื่น" }).click();
	await m.getByRole("menuitem", { name: "ย้ายไปติดตามระยะยาว" }).click();
	const nurture = m.getByRole("dialog", { name: "ย้ายไปติดตามระยะยาว" });
	await nurture.getByLabel("บันทึก", { exact: true }).fill("Buying next year");
	await nurture
		.getByRole("button", { name: "ย้ายไปติดตามระยะยาว", exact: true })
		.click();
	await expect(nurture).toBeHidden();

	// Gone from Malee's list; not in the New tab either.
	await m.goto("/contacts?ownership=mine");
	await expect(m.getByRole("link", { name: "Khun Dao" })).toBeHidden();

	const s = somchai.page;
	await s.goto("/pool");
	await expect(s.getByText("Khun Dao")).toBeHidden();
	await s.getByRole("tab", { name: "ติดตามระยะยาว" }).click();
	await expect(s).toHaveURL(/tab=nurturing/);
	const nurturing = s.getByRole("list", { name: "ติดตามระยะยาว" });
	const dao = nurturing.getByRole("listitem").filter({ hasText: "Khun Dao" });
	await expect(dao.getByText(/เดิมคือ Malee Sales/)).toBeVisible();
	await expect(dao.getByText("Buying next year")).toBeVisible();
	await dao.getByRole("button", { name: "รับผู้สนใจ" }).click();
	await expect(dao).toHaveCount(0);

	// Somchai owns it now, reopened as Attempting.
	await s.goto("/contacts?ownership=mine");
	await s.getByRole("link", { name: "Khun Dao" }).click();
	await expect(s.getByText("กำลังติดต่อ").first()).toBeVisible();

	await malee.context.close();
	await somchai.context.close();
});
