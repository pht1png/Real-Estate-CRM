"use client";

import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export type Pipeline = "lead" | "opportunity";

const edge = {
	lead: "border-l-4 border-l-lead bg-lead-muted/60",
	opportunity: "border-l-4 border-l-deal bg-deal-muted/60",
} as const;

/** A lead (blue) or deal (green) card; type and stage are never one badge. */
export function PipelineCard({
	kind,
	className,
	children,
}: {
	kind: Pipeline;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Card size="sm" data-kind={kind} className={cn(edge[kind], className)}>
			<CardContent className="flex flex-col gap-3">{children}</CardContent>
		</Card>
	);
}

/** "Lead" / "Deal" in the pipeline colour, top left of a card. */
export function TypeBadge({ kind }: { kind: Pipeline }) {
	const t = useTranslations("pipeline");
	return (
		<span
			className={cn(
				"inline-flex w-fit items-center px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
				kind === "lead" ? "bg-lead text-white" : "bg-deal text-white",
			)}
		>
			{t(kind)}
		</span>
	);
}

/** Label / value rows aligned like a table. */
export function AttributeList({
	items,
}: {
	items: { label: string; value: ReactNode; tone?: "danger" }[];
}) {
	return (
		<dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
			{items.map((item) => (
				<div key={item.label} className="contents">
					<dt className="text-muted-foreground">{item.label}</dt>
					<dd
						className={cn(
							"min-w-0 tabular-nums",
							item.tone === "danger" && "text-destructive font-medium",
						)}
					>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
