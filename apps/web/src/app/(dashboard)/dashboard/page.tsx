import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/session";

import { Overview } from "./overview";

export default async function DashboardPage() {
	const session = await getServerSession();

	if (!session?.user) {
		redirect("/login");
	}

	return <Overview name={session.user.name} />;
}
