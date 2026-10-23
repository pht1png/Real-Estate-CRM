import { getTranslations } from "next-intl/server";

import { AuthCard } from "@/components/auth-card";

import { AcceptInvitation } from "./accept-invitation";

export default async function AcceptInvitationPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const t = await getTranslations("invitation");
	return (
		<AuthCard title={t("title")}>
			<AcceptInvitation invitationId={id} />
		</AuthCard>
	);
}
