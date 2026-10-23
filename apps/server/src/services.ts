import {
	createAuth,
	createLogEmailSender,
	createResendEmailSender,
	type EmailSender,
} from "@Real-Estate-CRM/auth";
import { createDb } from "@Real-Estate-CRM/db";

import { ENV } from "./env.server";

function createEmailSender(): EmailSender {
	if (ENV.EMAIL_PROVIDER === "resend") {
		if (!ENV.RESEND_API_KEY) {
			throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
		}
		return createResendEmailSender({
			apiKey: ENV.RESEND_API_KEY,
			from: ENV.EMAIL_FROM,
		});
	}
	return logEmailSender;
}

/** Dev/test outbox; exposed at /__test/outbox only when NODE_ENV=test. */
export const logEmailSender = createLogEmailSender();

export const db = createDb(ENV);
export const email = createEmailSender();
export const auth = createAuth(ENV, db, email);
