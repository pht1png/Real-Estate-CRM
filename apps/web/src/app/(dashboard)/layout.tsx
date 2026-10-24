import { Separator } from "@Real-Estate-CRM/ui/components/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@Real-Estate-CRM/ui/components/sidebar";
import { TooltipProvider } from "@Real-Estate-CRM/ui/components/tooltip";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppSidebar } from "@/components/app-sidebar";
import { AuthCard } from "@/components/auth-card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { QuickCapture } from "@/components/quick-capture";
import { getServerSession } from "@/lib/session";

export default async function DashboardLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const session = await getServerSession();

	if (!session?.user) {
		redirect("/login");
	}

	if (!session.session.activeOrganizationId) {
		const t = await getTranslations("noOrganization");
		return (
			<div className="flex min-h-svh flex-col">
				<div className="flex justify-end p-2">
					<LanguageSwitcher />
				</div>
				<AuthCard title={t("title")} description={t("description")}>
					{null}
				</AuthCard>
			</div>
		);
	}

	const { name, email, image } = session.user;

	return (
		<TooltipProvider>
			<SidebarProvider>
				<AppSidebar user={{ name, email, image: image ?? null }} />
				<SidebarInset>
					<header className="flex h-14 shrink-0 items-center gap-2 px-4">
						<SidebarTrigger className="-ml-1" />
						<Separator
							orientation="vertical"
							className="mr-2 data-vertical:h-4 data-vertical:self-auto"
						/>
						<div className="ml-auto">
							<QuickCapture />
						</div>
					</header>
					<main className="flex flex-1 flex-col gap-6 p-4 pt-0">
						{children}
					</main>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
