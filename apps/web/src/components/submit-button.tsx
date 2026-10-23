"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { type AnyFormApi, useStore } from "@tanstack/react-form";

/** Full-width submit button that disables itself while the form submits. */
export function SubmitButton({
	form,
	children,
}: {
	form: AnyFormApi;
	children: React.ReactNode;
}) {
	const canSubmit = useStore(form.store, (s) => s.canSubmit);
	const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
	return (
		<Button
			type="submit"
			className="w-full"
			disabled={!canSubmit || isSubmitting}
		>
			{isSubmitting && <Spinner data-icon="inline-start" />}
			{children}
		</Button>
	);
}
