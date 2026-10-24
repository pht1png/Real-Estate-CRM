"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import {
	type Facing,
	facings,
	type UnitStatus,
	unitStatuses,
} from "@Real-Estate-CRM/db/constants";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "@Real-Estate-CRM/ui/components/empty";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { cn } from "@Real-Estate-CRM/ui/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter, useSearchParams } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";

import { bahtToSatang } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { statusClasses } from "./status";
import { UnitSheet } from "./unit-sheet";

export type GridUnit =
	inferRouterOutputs<AppRouter>["unit"]["grid"]["units"][number];
const ALL = "all";

/** Toggle buttons for a small set of options (status, tags). */
function ToggleChips<T extends string>({
	legend,
	options,
	selected,
	onChange,
	label,
	className,
}: {
	legend: string;
	options: readonly T[];
	selected: T[];
	onChange: (next: T[]) => void;
	label: (value: T) => string;
	className?: (value: T) => string;
}) {
	return (
		<FieldSet>
			<FieldLegend variant="label">{legend}</FieldLegend>
			<div className="flex flex-wrap gap-2">
				{options.map((o) => {
					const on = selected.includes(o);
					return (
						<Button
							key={o}
							type="button"
							size="sm"
							variant={on ? "default" : "outline"}
							aria-pressed={on}
							className={cn(on && className?.(o))}
							onClick={() =>
								onChange(
									on ? selected.filter((s) => s !== o) : [...selected, o],
								)
							}
						>
							{label(o)}
						</Button>
					);
				})}
			</div>
		</FieldSet>
	);
}

export function UnitsBrowser() {
	const t = useTranslations("units");
	const ts = useTranslations("unitStatuses");
	const tf = useTranslations("facings");
	const tk = useTranslations("sectionKinds");
	const tc = useTranslations("common");
	const format = useFormatter();
	const trpc = useTRPC();
	const router = useRouter();
	const params = useSearchParams();

	const projects = useQuery(trpc.project.list.queryOptions());
	const projectId = params.get("project") ?? projects.data?.[0]?.id ?? null;

	const [statuses, setStatuses] = useState<UnitStatus[]>([]);
	const [unitTypeId, setUnitTypeId] = useState<string>(ALL);
	const [facing, setFacing] = useState<string>(ALL);
	const [tags, setTags] = useState<string[]>([]);
	const [minPrice, setMinPrice] = useState("");
	const [maxPrice, setMaxPrice] = useState("");
	const [selected, setSelected] = useState<GridUnit | null>(null);

	const filters = useDeferredValue({
		statuses: statuses.length ? statuses : undefined,
		unitTypeIds: unitTypeId === ALL ? undefined : [unitTypeId],
		facings: facing === ALL ? undefined : [facing as Facing],
		tags: tags.length ? tags : undefined,
		minPriceSatang: bahtToSatang(minPrice) ?? undefined,
		maxPriceSatang: bahtToSatang(maxPrice) ?? undefined,
	});

	const project = useQuery(
		trpc.project.get.queryOptions(
			{ projectId: projectId ?? "" },
			{ enabled: !!projectId },
		),
	);
	const unitTypes = useQuery(
		trpc.unitType.list.queryOptions(
			{ projectId: projectId ?? "" },
			{ enabled: !!projectId },
		),
	);
	const grid = useQuery(
		trpc.unit.grid.queryOptions(
			{ projectId: projectId ?? "", ...filters },
			{ enabled: !!projectId, placeholderData: keepPreviousData },
		),
	);

	if (projects.data?.length === 0) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyDescription>{t("noProjects")}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	if (!projectId) return <Spinner />;

	const projectItems = (projects.data ?? []).map((p) => ({
		value: p.id,
		label: p.name,
	}));
	const typeItems = [
		{ value: ALL, label: tc("all") },
		...(unitTypes.data ?? []).map((u) => ({ value: u.id, label: u.name })),
	];
	const facingItems = [
		{ value: ALL, label: tc("all") },
		...facings.map((f) => ({ value: f, label: tf(f) })),
	];
	const units = grid.data?.units ?? [];
	const counts = Object.fromEntries(
		unitStatuses.map((s) => [s, units.filter((u) => u.status === s).length]),
	);
	const compactPrice = (satang: number) =>
		format.number(satang / 100, {
			notation: "compact",
			maximumFractionDigits: 2,
		});

	return (
		<>
			<FieldGroup className="gap-4 rounded-lg border p-4">
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<Field>
						<FieldLabel htmlFor="unit-project">{t("project")}</FieldLabel>
						<Select
							items={projectItems}
							value={projectId}
							onValueChange={(v) => {
								if (!v) return;
								setUnitTypeId(ALL);
								setTags([]);
								router.replace(`/units?project=${v}`);
							}}
						>
							<SelectTrigger id="unit-project">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{projectItems.map((i) => (
										<SelectItem key={i.value} value={i.value}>
											{i.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="unit-type">{t("unitType")}</FieldLabel>
						<Select
							items={typeItems}
							value={unitTypeId}
							onValueChange={(v) => v && setUnitTypeId(v)}
						>
							<SelectTrigger id="unit-type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{typeItems.map((i) => (
										<SelectItem key={i.value} value={i.value}>
											{i.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="unit-facing">{t("facing")}</FieldLabel>
						<Select
							items={facingItems}
							value={facing}
							onValueChange={(v) => v && setFacing(v)}
						>
							<SelectTrigger id="unit-facing">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{facingItems.map((i) => (
										<SelectItem key={i.value} value={i.value}>
											{i.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field>
							<FieldLabel htmlFor="min-price">{t("minPrice")}</FieldLabel>
							<Input
								id="min-price"
								inputMode="decimal"
								value={minPrice}
								onChange={(e) => setMinPrice(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="max-price">{t("maxPrice")}</FieldLabel>
							<Input
								id="max-price"
								inputMode="decimal"
								value={maxPrice}
								onChange={(e) => setMaxPrice(e.target.value)}
							/>
						</Field>
					</div>
				</div>
				<ToggleChips
					legend={t("status")}
					options={unitStatuses}
					selected={statuses}
					onChange={setStatuses}
					label={(s) => `${ts(s)} (${counts[s] ?? 0})`}
				/>
				{(project.data?.unitTags.length ?? 0) > 0 && (
					<ToggleChips
						legend={t("tags")}
						options={project.data?.unitTags ?? []}
						selected={tags}
						onChange={setTags}
						label={(tag) => tag}
					/>
				)}
			</FieldGroup>

			<p className="text-muted-foreground text-sm" aria-live="polite">
				{t("count", { count: units.length })}
			</p>

			{grid.isSuccess && units.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyDescription>{t("empty")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<div className="flex flex-col gap-6">
					{grid.data?.sections.map((section) => {
						const inSection = units.filter((u) => u.sectionId === section.id);
						if (inSection.length === 0) return null;
						const floors = [...new Set(inSection.map((u) => u.floor))];
						return (
							<section key={section.id} className="flex flex-col gap-3">
								<h2 className="text-lg font-semibold">
									{section.name}{" "}
									<span className="text-muted-foreground text-sm font-normal">
										{tk(section.kind)}
									</span>
								</h2>
								{floors.map((floor) => (
									<div
										key={floor ?? "none"}
										className="flex flex-col gap-2 sm:flex-row sm:items-start"
									>
										{floor !== null && (
											<span className="text-muted-foreground w-16 shrink-0 pt-2 text-sm">
												{t("floor", { floor })}
											</span>
										)}
										<div className="flex flex-wrap gap-2">
											{inSection
												.filter((u) => u.floor === floor)
												.map((u) => (
													<button
														key={u.id}
														type="button"
														onClick={() => setSelected(u)}
														aria-label={`${u.unitNumber} · ${ts(u.status)}`}
														className={cn(
															"focus-visible:ring-ring flex min-w-20 flex-col items-start rounded-md px-3 py-2 text-left text-sm transition outline-none focus-visible:ring-2",
															statusClasses[u.status],
														)}
													>
														<span className="font-semibold">
															{u.unitNumber}
														</span>
														<span className="text-xs opacity-90">
															{compactPrice(u.listPriceSatang)}
														</span>
													</button>
												))}
										</div>
									</div>
								))}
							</section>
						);
					})}
				</div>
			)}

			<UnitSheet unit={selected} onClose={() => setSelected(null)} />
		</>
	);
}
