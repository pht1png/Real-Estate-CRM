"use client";

import { type RoleName, roleNames } from "@Real-Estate-CRM/auth/permissions";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";

import { useMe, useRoleLabel } from "@/hooks/use-me";

/** Roles the current member may hand out (only owners can make owners). */
export function useAssignableRoles(): RoleName[] {
	const { data: me } = useMe();
	return roleNames.filter((r) => r !== "owner" || me?.role === "owner");
}

export function RoleSelect({
	id,
	value,
	onChange,
	disabled,
	"aria-label": ariaLabel,
}: {
	id?: string;
	value: RoleName;
	onChange: (role: RoleName) => void;
	disabled?: boolean;
	"aria-label"?: string;
}) {
	const roleLabel = useRoleLabel();
	const roles = useAssignableRoles();
	const items = roles.map((role) => ({ value: role, label: roleLabel(role) }));

	return (
		<Select
			items={items}
			value={value}
			onValueChange={(v) => v && onChange(v as RoleName)}
			disabled={disabled}
		>
			<SelectTrigger id={id} aria-label={ariaLabel} className="min-w-44">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{items.map((item) => (
						<SelectItem key={item.value} value={item.value}>
							{item.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
