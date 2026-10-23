"use client";

import {
	Field,
	FieldError,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import type { AnyFieldApi } from "@tanstack/react-form";

/** Labelled input bound to a TanStack Form field, with validation errors. */
export function TextField({
	field,
	label,
	...inputProps
}: {
	field: AnyFieldApi;
	label: string;
} & Omit<
	React.ComponentProps<typeof Input>,
	"id" | "name" | "value" | "onChange" | "onBlur"
>) {
	const errors = field.state.meta.isTouched ? field.state.meta.errors : [];
	const invalid = errors.length > 0;
	return (
		<Field data-invalid={invalid || undefined}>
			<FieldLabel htmlFor={field.name}>{label}</FieldLabel>
			<Input
				id={field.name}
				name={field.name}
				value={field.state.value ?? ""}
				onBlur={field.handleBlur}
				onChange={(e) => field.handleChange(e.target.value)}
				aria-invalid={invalid || undefined}
				{...inputProps}
			/>
			<FieldError errors={errors} />
		</Field>
	);
}
