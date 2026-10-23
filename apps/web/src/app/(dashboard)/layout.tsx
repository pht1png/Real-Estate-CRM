import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@Real-Estate-CRM/ui/components/breadcrumb";
import { Separator } from "@Real-Estate-CRM/ui/components/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@Real-Estate-CRM/ui/components/sidebar";
import { TooltipProvider } from "@Real-Estate-CRM/ui/components/tooltip";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { authClient } from "@/lib/auth-client";

export default async function DashboardLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const session = await authClient.getSession({
		fetchOptions: {
			headers: await headers(),
			throw: true,
		},
	});

	if (!session?.user) {
		redirect("/login");
	}

	const { name, email, image } = session.user;

	return (
		<TooltipProvider>
			<SidebarProvider>
				<AppSidebar user={{ name, email, image: image ?? null }} />
				<SidebarInset>
					<header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
						<div className="flex items-center gap-2 px-4">
							<SidebarTrigger className="-ml-1" />
							<Separator
								orientation="vertical"
								className="mr-2 data-vertical:h-4 data-vertical:self-auto"
							/>
							<Breadcrumb>
								<BreadcrumbList>
									<BreadcrumbItem>
										<BreadcrumbPage>Dashboard</BreadcrumbPage>
									</BreadcrumbItem>
								</BreadcrumbList>
							</Breadcrumb>
						</div>
					</header>
					<div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
