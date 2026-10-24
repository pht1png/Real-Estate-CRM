import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/session";

import { Today } from "./today";

export default async function DashboardPage() {
	const session = await getServerSession();

	if (!session?.user) {
		redirect("/login");
	}

	return <Today name={session.user.name} />;
}
