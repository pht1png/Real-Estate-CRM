export type Email = {
	to: string;
	subject: string;
	text: string;
	html: string;
};

export interface EmailSender {
	send(email: Email): Promise<void>;
}

/** Dev and tests: log the email and keep it in memory so tests can follow links. */
export function createLogEmailSender(): EmailSender & {
	outbox: Email[];
} {
	const outbox: Email[] = [];
	return {
		outbox,
		async send(email) {
			outbox.push(email);
			console.info(`[email] to=${email.to} subject="${email.subject}"`);
			console.info(email.text);
		},
	};
}

/** Production: Resend HTTP API (no SDK dependency). */
export function createResendEmailSender(options: {
	apiKey: string;
	from: string;
}): EmailSender {
	return {
		async send(email) {
			const res = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ from: options.from, ...email }),
			});
			if (!res.ok) {
				throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
			}
		},
	};
}

const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			] ?? c,
	);

/** Bilingual (Thai first) email with one call-to-action link. */
function bilingualEmail(
	to: string,
	subject: string,
	lines: { th: string; en: string },
	action: { th: string; en: string; url: string },
): Email {
	return {
		to,
		subject,
		text: `${lines.th}\n${action.th}: ${action.url}\n\n${lines.en}\n${action.en}: ${action.url}\n`,
		html: `<p>${escapeHtml(lines.th)}</p><p><a href="${escapeHtml(action.url)}">${escapeHtml(action.th)}</a></p><hr><p>${escapeHtml(lines.en)}</p><p><a href="${escapeHtml(action.url)}">${escapeHtml(action.en)}</a></p>`,
	};
}

export function invitationEmail(
	to: string,
	organizationName: string,
	url: string,
) {
	return bilingualEmail(
		to,
		`คำเชิญเข้าร่วม ${organizationName} / Invitation to ${organizationName}`,
		{
			th: `คุณได้รับเชิญให้เข้าร่วม ${organizationName} ลิงก์นี้ใช้ได้ 7 วัน`,
			en: `You have been invited to join ${organizationName}. This link is valid for 7 days.`,
		},
		{ th: "ตอบรับคำเชิญ", en: "Accept invitation", url },
	);
}

/** First login for an owner created by the operator script: they choose a password. */
export function accountSetupEmail(to: string, url: string) {
	return bilingualEmail(
		to,
		"ตั้งค่าบัญชีของคุณ / Set up your account",
		{
			th: "บัญชีผู้ดูแลบริษัทของคุณพร้อมแล้ว กรุณาตั้งรหัสผ่านเพื่อเข้าสู่ระบบ ลิงก์นี้ใช้ได้ 1 ชั่วโมง",
			en: "Your company admin account is ready. Choose a password to sign in. This link is valid for 1 hour.",
		},
		{ th: "ตั้งรหัสผ่าน", en: "Choose password", url },
	);
}

export function resetPasswordEmail(to: string, url: string) {
	return bilingualEmail(
		to,
		"ตั้งรหัสผ่านใหม่ / Reset your password",
		{
			th: "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ หากคุณไม่ได้ขอ ให้เพิกเฉยอีเมลนี้",
			en: "Someone asked to reset the password for your account. If it wasn't you, ignore this email.",
		},
		{ th: "ตั้งรหัสผ่านใหม่", en: "Reset password", url },
	);
}

/**
 * Work that must not delay the HTTP response (sending email), so response
 * timing can't reveal whether an account exists. Scripts call `flush()` before
 * exiting; failures are logged, never thrown at the caller.
 */
export function createBackgroundTasks() {
	const pending = new Set<Promise<unknown>>();
	return {
		run(task: () => Promise<unknown>) {
			const promise: Promise<unknown> = task()
				.catch((error) => console.error("[background] task failed", error))
				.finally(() => pending.delete(promise));
			pending.add(promise);
		},
		async flush() {
			await Promise.all([...pending]);
		},
	};
}

export type BackgroundTasks = ReturnType<typeof createBackgroundTasks>;
