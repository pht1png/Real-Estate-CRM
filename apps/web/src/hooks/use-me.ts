"use client";

import { type RoleName, roleCan } from "@Real-Estate-CRM/auth/permissions";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { useTRPC } from "@/utils/trpc";

/** The signed-in member: organization, role and project scope (from the server). */
export function useMe() {
	const trpc = useTRPC();
	return useQuery(trpc.me.queryOptions(undefined, { retry: false }));
}

/** Role display name: the company's custom label, else the translated default. */
export function useRoleLabel() {
	const t = useTranslations("roles");
	const trpc = useTRPC();
	const { data } = useQuery(trpc.roleLabel.list.queryOptions());
	return (role: string) =>
		data?.find((r) => r.role === role)?.label ??
		(role in
		{ owner: 1, admin: 1, executive: 1, sales_manager: 1, salesperson: 1 }
			? t(role as RoleName)
			: role);
}

/** UI hint only — the server enforces every permission. */
export function useCan() {
	const { data } = useMe();
	return (permissions: Parameters<typeof roleCan>[1]) =>
		!!data && roleCan(data.role, permissions);
}
