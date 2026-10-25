import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/page-header";
import { getServerSession } from "@/lib/session";

import { TodoList } from "./todo-list";

export default async function TodoPage() {
	const session = await getServerSession();
	if (!session?.user) redirect("/login");
	const t = await getTranslations("todo");
	return (
		<>
			<PageHeader title={t("title")} description={t("description")} />
			<TodoList />
		</>
	);
}
