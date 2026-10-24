import {
	createAuth,
	createLogEmailSender,
	createResendEmailSender,
	type EmailSender,
} from "@Real-Estate-CRM/auth";
import { createDb } from "@Real-Estate-CRM/db";

import { ENV } from "./env.server";
import {
	createLocalStorage,
	createS3Storage,
	type FileStorage,
} from "./storage";

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

/** Local folder storage, also used to verify signed /files/local URLs. */
export const localStorage = createLocalStorage({
	dir: ENV.STORAGE_LOCAL_DIR,
	publicUrl: ENV.BETTER_AUTH_URL,
	secret: ENV.BETTER_AUTH_SECRET,
});

function createFileStorage(): FileStorage {
	if (ENV.STORAGE_DRIVER === "s3") {
		const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } =
			ENV;
		if (
			!S3_ENDPOINT ||
			!S3_BUCKET ||
			!S3_ACCESS_KEY_ID ||
			!S3_SECRET_ACCESS_KEY
		) {
			throw new Error("S3_* settings are required when STORAGE_DRIVER=s3");
		}
		return createS3Storage({
			endpoint: S3_ENDPOINT,
			bucket: S3_BUCKET,
			accessKeyId: S3_ACCESS_KEY_ID,
			secretAccessKey: S3_SECRET_ACCESS_KEY,
		});
	}
	return localStorage;
}

export const storage = createFileStorage();
