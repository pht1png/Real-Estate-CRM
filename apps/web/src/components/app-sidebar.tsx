"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
} from "@Real-Estate-CRM/ui/components/sidebar";
import { FolderKanbanIcon, SunIcon, TagsIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";

import { useCan } from "@/hooks/use-me";

import { NavGroup, type NavItem } from "./nav-main";
import { NavUser } from "./nav-user";
import { OrgSwitcher } from "./org-switcher";

export function AppSidebar({
	user,
	...props
}: React.ComponentProps<typeof Sidebar> & {
	user: React.ComponentProps<typeof NavUser>["user"];
}) {
	const t = useTranslations("nav");
	const can = useCan();

	const main: NavItem[] = [
		{ title: t("today"), href: "/dashboard", icon: <SunIcon /> },
	];
	const settings: NavItem[] = [
		...(can({ member: ["create"] })
			? [
					{
						title: t("members"),
						href: "/settings/members",
						icon: <UsersIcon />,
					} as const,
				]
			: []),
		...(can({ project: ["create"] })
			? [
					{
						title: t("projects"),
						href: "/settings/projects",
						icon: <FolderKanbanIcon />,
					} as const,
				]
			: []),
		...(can({ roleLabel: ["update"] })
			? [
					{
						title: t("roles"),
						href: "/settings/roles",
						icon: <TagsIcon />,
					} as const,
				]
			: []),
	];

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<OrgSwitcher />
			</SidebarHeader>
			<SidebarContent>
				<NavGroup label={t("main")} items={main} />
				{settings.length > 0 && (
					<NavGroup label={t("settings")} items={settings} />
				)}
			</SidebarContent>
			<SidebarFooter>
				<NavUser user={user} />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
