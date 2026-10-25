"use client";

import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@Real-Estate-CRM/ui/components/sidebar";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = {
	title: string;
	href: Route;
	icon: React.ReactNode;
	/** Extra text for screen readers, e.g. a badge count. */
	srLabel?: string;
	badge?: React.ReactNode;
};

/** A labelled sidebar group of links; the current page is highlighted. */
export function NavGroup({
	label,
	items,
}: {
	label: string;
	items: NavItem[];
}) {
	const pathname = usePathname();
	return (
		<SidebarGroup>
			<SidebarGroupLabel>{label}</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.href}>
						<SidebarMenuButton
							tooltip={item.title}
							isActive={pathname === item.href}
							render={<Link href={item.href} />}
						>
							{item.icon}
							<span>{item.title}</span>
							{item.srLabel && <span className="sr-only">{item.srLabel}</span>}
						</SidebarMenuButton>
						{item.badge}
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
