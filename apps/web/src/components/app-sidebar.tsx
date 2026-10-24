"use client";

import type { Permissions } from "@Real-Estate-CRM/auth/permissions";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarRail,
} from "@Real-Estate-CRM/ui/components/sidebar";
import {
	Building2Icon,
	ContactIcon,
	FolderKanbanIcon,
	MegaphoneIcon,
	SignpostIcon,
	SlidersHorizontalIcon,
	SunIcon,
	TagsIcon,
	UsersIcon,
} from "lucide-react";
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

	// Each entry shows only for roles with its permission (the server enforces it too).
	const visible = (items: (NavItem & { permission?: Permissions })[]) =>
		items.filter((i) => !i.permission || can(i.permission));

	const main = visible([
		{ title: t("today"), href: "/dashboard", icon: <SunIcon /> },
		{
			title: t("customers"),
			href: "/customers",
			icon: <ContactIcon />,
			permission: { lead: ["read"] },
		},
		{
			title: t("units"),
			href: "/units",
			icon: <Building2Icon />,
			permission: { unit: ["read"] },
		},
	]);
	const settings = visible([
		{
			title: t("members"),
			href: "/settings/members",
			icon: <UsersIcon />,
			permission: { member: ["create"] },
		},
		{
			title: t("projects"),
			href: "/settings/projects",
			icon: <FolderKanbanIcon />,
			permission: { project: ["create"] },
		},
		{
			title: t("sources"),
			href: "/settings/sources",
			icon: <SignpostIcon />,
			permission: { leadSource: ["manage"] },
		},
		{
			title: t("campaigns"),
			href: "/settings/campaigns",
			icon: <MegaphoneIcon />,
			permission: { campaign: ["manage"] },
		},
		{
			title: t("rules"),
			href: "/settings/rules",
			icon: <SlidersHorizontalIcon />,
			permission: { rules: ["update"] },
		},
		{
			title: t("roles"),
			href: "/settings/roles",
			icon: <TagsIcon />,
			permission: { roleLabel: ["update"] },
		},
	]);

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
