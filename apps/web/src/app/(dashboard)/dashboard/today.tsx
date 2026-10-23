"use client";

import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@Real-Estate-CRM/ui/components/empty";
import { SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { useMe, useRoleLabel } from "@/hooks/use-me";

/** Placeholder until the Today screen (M4). */
export function Today({ name }: { name: string }) {
	const t = useTranslations("today");
	const { data: me } = useMe();
	const roleLabel = useRoleLabel();

	return (
		<>
			<div>
				<h1 className="text-2xl font-semibold">{t("welcome", { name })}</h1>
				{me && (
					<p className="text-muted-foreground">
						{t("summary", {
							role: roleLabel(me.role),
							organization: me.organization?.name ?? "",
						})}
					</p>
				)}
			</div>
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SunIcon />
					</EmptyMedia>
					<EmptyTitle>{t("title")}</EmptyTitle>
					<EmptyDescription>{t("comingSoon")}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</>
	);
}
