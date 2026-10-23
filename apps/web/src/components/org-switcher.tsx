"use client";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@Real-Estate-CRM/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@Real-Estate-CRM/ui/components/sidebar";
import { Skeleton } from "@Real-Estate-CRM/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useMe, useRoleLabel } from "@/hooks/use-me";
import { authClient } from "@/lib/auth-client";

/** Shows the active company; members of several companies can switch. */
export function OrgSwitcher() {
	const t = useTranslations("nav");
	const { isMobile } = useSidebar();
	const { data: me } = useMe();
	const roleLabel = useRoleLabel();
	const { data: organizations } = authClient.useListOrganizations();
	const queryClient = useQueryClient();
	const router = useRouter();

	if (!me) {
		return <Skeleton className="h-12 w-full" />;
	}

	const header = (
		<>
			<div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md">
				<Building2Icon />
			</div>
			<div className="grid flex-1 text-left text-sm leading-tight">
				<span className="truncate font-medium">{me.organization?.name}</span>
				<span className="truncate text-xs">{roleLabel(me.role)}</span>
			</div>
		</>
	);

	if (!organizations || organizations.length < 2) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton size="lg">{header}</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
						}
					>
						{header}
						<ChevronsUpDownIcon className="ml-auto" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="min-w-56"
						align="start"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="text-muted-foreground text-xs">
								{t("organizations")}
							</DropdownMenuLabel>
							{organizations.map((org) => (
								<DropdownMenuItem
									key={org.id}
									onClick={async () => {
										if (org.id === me.organization?.id) return;
										await authClient.organization.setActive({
											organizationId: org.id,
										});
										await queryClient.invalidateQueries();
										router.refresh();
									}}
								>
									{org.name}
									{org.id === me.organization?.id && (
										<CheckIcon className="ml-auto" />
									)}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
