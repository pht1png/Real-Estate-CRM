"use client";

import { SidebarMenuBadge } from "@Real-Estate-CRM/ui/components/sidebar";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

/** Roles that work leads see the counts. */
const BADGE_ROLES = ["salesperson", "sales_manager"];

function useWorksLeads() {
	const { data: me } = useMe();
	return !!me && BADGE_ROLES.includes(me.role);
}

/** How many leads wait to be claimed; refreshed every minute. */
export function usePoolCount() {
	const trpc = useTRPC();
	const enabled = useWorksLeads();
	const { data } = useQuery(
		trpc.pool.count.queryOptions(undefined, {
			enabled,
			refetchInterval: 60_000,
		}),
	);
	return enabled ? (data?.count ?? 0) : 0;
}

/** Due today plus what slipped; refreshed every minute. */
export function useTodoCount() {
	const trpc = useTRPC();
	const enabled = useWorksLeads();
	const { data } = useQuery(
		trpc.todo.count.queryOptions(undefined, {
			enabled,
			refetchInterval: 60_000,
		}),
	);
	return enabled ? (data?.count ?? 0) : 0;
}

const label = (count: number) => (count > 99 ? "99+" : String(count));

const tones = {
	// Pool: the one red, notification-style badge.
	alert: "bg-destructive text-white",
	neutral: "bg-sidebar-accent text-sidebar-accent-foreground",
} as const;

/**
 * A count on a sidebar item: a pill when the sidebar is expanded, a small
 * badge on the icon when it's collapsed. Hidden at 0.
 */
export function CountBadge({
	count,
	tone,
}: {
	count: number;
	tone: keyof typeof tones;
}) {
	if (count === 0) return null;
	return (
		<>
			<SidebarMenuBadge
				aria-hidden
				className={cn(
					"rounded-full",
					tones[tone],
					tone === "alert" &&
						"peer-hover/menu-button:text-white peer-data-active/menu-button:text-white",
				)}
			>
				{label(count)}
			</SidebarMenuBadge>
			<span
				aria-hidden
				className={cn(
					"pointer-events-none absolute top-0.5 left-5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-semibold tabular-nums group-data-[collapsible=icon]:flex",
					tones[tone],
				)}
			>
				{label(count)}
			</span>
		</>
	);
}

/** Pool: red, notification-style. */
export const PoolBadge = ({ count }: { count: number }) => (
	<CountBadge count={count} tone="alert" />
);
