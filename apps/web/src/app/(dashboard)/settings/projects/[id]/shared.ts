"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

export type ProjectDetail = inferRouterOutputs<AppRouter>["project"]["get"];

/** Refreshes everything derived from a project's settings and units. */
export function useInvalidateProject() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.project.pathFilter()),
			queryClient.invalidateQueries(trpc.section.pathFilter()),
			queryClient.invalidateQueries(trpc.unitType.pathFilter()),
			queryClient.invalidateQueries(trpc.unit.pathFilter()),
		]);
}

/** Toast for a failed mutation: server message for conflicts/validation, generic otherwise. */
export function useMutationError() {
	const tc = useTranslations("common");
	return (error: { message: string; data?: { code?: string } | null }) =>
		toast.error(
			error.data?.code === "CONFLICT" ? error.message : tc("genericError"),
		);
}
