"use client";

import { SidebarMenuBadge } from "@Real-Estate-CRM/ui/components/sidebar";
import { useQuery } from "@tanstack/react-query";

import { useMe } from "@/hooks/use-me";
import { useTRPC } from "@/utils/trpc";

/** Roles that claim or watch the pool see the count. */
const BADGE_ROLES = ["salesperson", "sales_manager"];

/** How many leads wait to be claimed; refreshed every minute. */
export function usePoolCount() {
	const trpc = useTRPC();
	const { data: me } = useMe();
	const enabled = !!me && BADGE_ROLES.includes(me.role);
	const { data } = useQuery(
		trpc.pool.count.queryOptions(undefined, {
			enabled,
			refetchInterval: 60_000,
		}),
	);
	return enabled ? (data?.count ?? 0) : 0;
}

const label = (count: number) => (count > 99 ? "99+" : String(count));

/**
 * Notification-style red count on the Pool item: a pill when the sidebar is
 * expanded, a small badge on the icon when it's collapsed. Hidden at 0.
 */
export function PoolBadge({ count }: { count: number }) {
	if (count === 0) return null;
	return (
		<>
			<SidebarMenuBadge
				aria-hidden
				className="bg-destructive rounded-full text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white"
			>
				{label(count)}
			</SidebarMenuBadge>
			<span
				aria-hidden
				className="bg-destructive pointer-events-none absolute top-0.5 left-5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-semibold text-white tabular-nums group-data-[collapsible=icon]:flex"
			>
				{label(count)}
			</span>
		</>
	);
}
