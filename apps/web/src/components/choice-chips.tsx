"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	FieldError,
	FieldLegend,
	FieldSet,
} from "@Real-Estate-CRM/ui/components/field";

/** Toggle buttons for one choice out of a short list (mobile friendly). */
export function ChoiceChips<T extends string>({
	legend,
	options,
	value,
	onChange,
	invalid,
	error,
	multiple,
}: {
	legend: string;
	options: { value: T; label: string }[];
	value: T[];
	onChange: (v: T[]) => void;
	invalid?: boolean;
	error?: string;
	multiple?: boolean;
}) {
	return (
		<FieldSet data-invalid={invalid || undefined}>
			<FieldLegend variant="label">{legend}</FieldLegend>
			<div className="grid grid-cols-2 gap-2">
				{options.map((o) => {
					const on = value.includes(o.value);
					return (
						<Button
							key={o.value}
							type="button"
							size="sm"
							variant={on ? "default" : "outline"}
							aria-pressed={on}
							className="h-auto justify-start py-2 text-left whitespace-normal"
							onClick={() =>
								onChange(
									multiple
										? on
											? value.filter((v) => v !== o.value)
											: [...value, o.value]
										: [o.value],
								)
							}
						>
							{o.label}
						</Button>
					);
				})}
			</div>
			{invalid && error && <FieldError>{error}</FieldError>}
		</FieldSet>
	);
}
