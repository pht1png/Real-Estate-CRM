"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@Real-Estate-CRM/ui/components/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@Real-Estate-CRM/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@Real-Estate-CRM/ui/components/sidebar";
import {
	ChevronsUpDownIcon,
	LanguagesIcon,
	LogOutIcon,
	ShieldCheckIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { setLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";

function initials(name: string) {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("");
}

export function NavUser({
	user,
}: {
	user: {
		name: string;
		email: string;
		image: string | null;
	};
}) {
	const { isMobile } = useSidebar();
	const router = useRouter();
	const t = useTranslations("nav");
	const tl = useTranslations("language");
	const locale = useLocale();
	const otherLocale = locales.find((l) => l !== locale) ?? "th";
	const [, startTransition] = useTransition();
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
						}
					>
						<Avatar>
							{user.image && <AvatarImage src={user.image} alt={user.name} />}
							<AvatarFallback>{initials(user.name)}</AvatarFallback>
						</Avatar>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-medium">{user.name}</span>
							<span className="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto size-4" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-fit"
						side={isMobile ? "bottom" : "right"}
						align="end"
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="p-0 font-normal">
								<div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
									<Avatar>
										{user.image && (
											<AvatarImage src={user.image} alt={user.name} />
										)}
										<AvatarFallback>{initials(user.name)}</AvatarFallback>
									</Avatar>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">{user.name}</span>
										<span className="truncate text-xs">{user.email}</span>
									</div>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem render={<Link href="/settings/security" />}>
								<ShieldCheckIcon />
								{t("security")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() =>
									startTransition(async () => {
										await setLocale(otherLocale);
										router.refresh();
									})
								}
							>
								<LanguagesIcon />
								{tl(otherLocale)}
							</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={() => {
								authClient.signOut({
									fetchOptions: {
										onSuccess: () => {
											router.push("/login");
										},
									},
								});
							}}
						>
							<LogOutIcon />
							{t("signOut")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
