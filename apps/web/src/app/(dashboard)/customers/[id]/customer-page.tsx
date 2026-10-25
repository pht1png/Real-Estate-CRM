"use client";

import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { useTRPC } from "@/utils/trpc";

import { InterestCard } from "./interest-card";
import { ProfileCard } from "./profile-card";

export function CustomerPage({ customerId }: { customerId: string }) {
	const t = useTranslations("customer");
	const ts = useTranslations("stages");
	const tn = useTranslations("nav");
	const trpc = useTRPC();
	const customer = useQuery(trpc.customer.get.queryOptions({ customerId }));

	if (!customer.data) return <Spinner />;
	const c = customer.data;
	const visible = c.interests.filter((i) => i.visible);
	const hidden = c.interests.filter((i) => !i.visible);

	return (
		<>
			<Link
				href="/customers"
				className="text-muted-foreground flex w-fit items-center gap-1 text-sm hover:underline"
			>
				<ChevronLeftIcon className="size-4" />
				{tn("customers")}
			</Link>
			<PageHeader title={c.name} />
			<div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
				{/* Remount when the server data changes so edits start from saved values. */}
				<ProfileCard key={`${c.name}|${c.lineId}|${c.email}`} customer={c} />
				<section className="flex flex-col gap-4">
					<h2 className="text-lg font-semibold">{t("interests")}</h2>
					{visible.map((i) =>
						i.visible ? (
							<InterestCard
								key={i.id}
								interest={i}
								customerName={c.name}
								phoneE164={c.phones[0]?.phoneE164 ?? null}
							/>
						) : null,
					)}
					{hidden.length > 0 && (
						<div className="flex flex-col gap-1">
							<h3 className="text-sm font-medium">{t("otherProjects")}</h3>
							<ul className="text-muted-foreground text-sm">
								{hidden.map((i) => (
									<li key={i.id}>
										{t("summaryLine", {
											project: i.projectName,
											stage: ts(i.stage),
											owner: i.ownerName ?? t("pool"),
										})}
									</li>
								))}
							</ul>
						</div>
					)}
				</section>
			</div>
		</>
	);
}
