"use client";

import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@Real-Estate-CRM/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/page-header";
import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { ClosedDatesTab } from "./closed-dates-tab";
import { GeneralTab } from "./general-tab";
import { HoursTab } from "./hours-tab";
import { ImportTab } from "./import-tab";
import { QualificationTab } from "./qualification-tab";
import { SectionsTab } from "./sections-tab";
import { UnitTypesTab } from "./unit-types-tab";

const tabs = [
	"general",
	"hours",
	"closed",
	"qualification",
	"sections",
	"unitTypes",
	"import",
] as const;

export function ProjectSettings({ projectId }: { projectId: string }) {
	const t = useTranslations("projectSettings");
	const tt = useTranslations("projectTypes");
	const trpc = useTRPC();
	const formatBaht = useFormatBaht();
	const project = useQuery(trpc.project.get.queryOptions({ projectId }));

	if (!project.data) return <Spinner />;
	const p = project.data;
	const range =
		p.minPriceSatang !== null && p.maxPriceSatang !== null
			? t("priceRange", {
					min: formatBaht(p.minPriceSatang),
					max: formatBaht(p.maxPriceSatang),
				})
			: t("noAvailable");

	return (
		<>
			<Link
				href="/settings/projects"
				className="text-muted-foreground flex w-fit items-center gap-1 text-sm hover:underline"
			>
				<ChevronLeftIcon className="size-4" />
				{t("back")}
			</Link>
			<PageHeader title={p.name} description={`${tt(p.type)} · ${range}`} />
			<Tabs defaultValue="general">
				<TabsList className="max-w-full flex-wrap justify-start">
					{tabs.map((tab) => (
						<TabsTrigger key={tab} value={tab}>
							{t(`tabs.${tab}`)}
						</TabsTrigger>
					))}
				</TabsList>
				<TabsContent value="general">
					<GeneralTab project={p} />
				</TabsContent>
				<TabsContent value="hours">
					<HoursTab project={p} />
				</TabsContent>
				<TabsContent value="closed">
					<ClosedDatesTab project={p} />
				</TabsContent>
				<TabsContent value="qualification">
					<QualificationTab project={p} />
				</TabsContent>
				<TabsContent value="sections">
					<SectionsTab projectId={p.id} />
				</TabsContent>
				<TabsContent value="unitTypes">
					<UnitTypesTab projectId={p.id} />
				</TabsContent>
				<TabsContent value="import">
					<ImportTab projectId={p.id} />
				</TabsContent>
			</Tabs>
		</>
	);
}
