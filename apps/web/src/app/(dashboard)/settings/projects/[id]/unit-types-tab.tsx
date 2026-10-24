"use client";

import type { AppRouter } from "@Real-Estate-CRM/api/routers/index";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@Real-Estate-CRM/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { Trash2Icon } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { useInvalidateProject, useMutationError } from "./shared";

type UnitTypeRow = inferRouterOutputs<AppRouter>["unitType"]["list"][number];

/** Uploads an image to the API's floor plan endpoint (cookie session). */
async function uploadFloorPlan(file: File) {
	const form = new FormData();
	form.set("file", file);
	const res = await fetch(
		`${process.env.NEXT_PUBLIC_SERVER_URL?.replace(/\/$/, "")}/files/floor-plans`,
		{ method: "POST", body: form, credentials: "include" },
	);
	if (!res.ok) throw new Error(`upload failed: ${res.status}`);
	return (await res.json()) as { key: string; url: string };
}

const optionalInt = (v: string) =>
	v.trim() === "" ? null : Number.parseInt(v, 10);
const optionalArea = (v: string) => (v.trim() === "" ? null : Number(v));

function UnitTypeDialog({
	projectId,
	existing,
	trigger,
}: {
	projectId: string;
	existing?: UnitTypeRow;
	trigger: React.ReactElement;
}) {
	const t = useTranslations("projectSettings");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(existing?.name ?? "");
	const [bedrooms, setBedrooms] = useState(
		existing?.bedrooms?.toString() ?? "",
	);
	const [bathrooms, setBathrooms] = useState(
		existing?.bathrooms?.toString() ?? "",
	);
	const [area, setArea] = useState(existing?.usableAreaSqm?.toString() ?? "");
	const [plan, setPlan] = useState<{ key: string | null; url: string | null }>({
		key: existing?.floorPlanKey ?? null,
		url: existing?.floorPlanUrl ?? null,
	});
	const [uploading, setUploading] = useState(false);

	const options = {
		onSuccess: async () => {
			setOpen(false);
			await invalidate();
		},
		onError,
	};
	const create = useMutation(trpc.unitType.create.mutationOptions(options));
	const update = useMutation(trpc.unitType.update.mutationOptions(options));

	const values = {
		name: name.trim(),
		bedrooms: optionalInt(bedrooms),
		bathrooms: optionalInt(bathrooms),
		usableAreaSqm: optionalArea(area),
		floorPlanKey: plan.key,
	};
	const valid =
		values.name !== "" &&
		[values.bedrooms, values.bathrooms].every(
			(n) => n === null || (n >= 0 && n <= 20),
		) &&
		(values.usableAreaSqm === null ||
			(values.usableAreaSqm > 0 && /^\d+(\.\d{1,2})?$/.test(area.trim())));

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{existing ? t("editUnitType") : t("newUnitType")}
					</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!valid) return;
						if (existing) update.mutate({ unitTypeId: existing.id, ...values });
						else create.mutate({ projectId, ...values });
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="ut-name">{t("unitTypeName")}</FieldLabel>
							<Input
								id="ut-name"
								value={name}
								maxLength={80}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<div className="grid grid-cols-3 gap-3">
							<Field>
								<FieldLabel htmlFor="ut-bed">{t("bedrooms")}</FieldLabel>
								<Input
									id="ut-bed"
									inputMode="numeric"
									value={bedrooms}
									onChange={(e) => setBedrooms(e.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="ut-bath">{t("bathrooms")}</FieldLabel>
								<Input
									id="ut-bath"
									inputMode="numeric"
									value={bathrooms}
									onChange={(e) => setBathrooms(e.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="ut-area">{t("usableArea")}</FieldLabel>
								<Input
									id="ut-area"
									inputMode="decimal"
									value={area}
									onChange={(e) => setArea(e.target.value)}
								/>
							</Field>
						</div>
						<Field>
							<FieldLabel htmlFor="ut-plan">{t("floorPlan")}</FieldLabel>
							{plan.url && (
								// Signed, expiring URL: skip Next's optimiser (it would cache past expiry).
								<Image
									src={plan.url}
									alt={t("floorPlan")}
									width={320}
									height={192}
									unoptimized
									className="h-48 w-auto rounded border object-contain"
								/>
							)}
							<Input
								id="ut-plan"
								type="file"
								accept="image/jpeg,image/png,image/webp"
								disabled={uploading}
								onChange={async (e) => {
									const file = e.target.files?.[0];
									if (!file) return;
									setUploading(true);
									try {
										setPlan(await uploadFloorPlan(file));
									} catch {
										toast.error(t("uploadFailed"));
									} finally {
										setUploading(false);
										e.target.value = "";
									}
								}}
							/>
							<FieldDescription>{t("floorPlanHint")}</FieldDescription>
							{plan.key && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="w-fit"
									onClick={() => setPlan({ key: null, url: null })}
								>
									{t("removeFloorPlan")}
								</Button>
							)}
						</Field>
						<Button
							type="submit"
							disabled={
								!valid || uploading || create.isPending || update.isPending
							}
						>
							{uploading && <Spinner data-icon="inline-start" />}
							{tc("save")}
						</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function UnitTypesTab({ projectId }: { projectId: string }) {
	const t = useTranslations("projectSettings");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const formatBaht = useFormatBaht();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();
	const types = useQuery(trpc.unitType.list.queryOptions({ projectId }));
	const remove = useMutation(
		trpc.unitType.delete.mutationOptions({ onSuccess: invalidate, onError }),
	);
	const rows = types.data ?? [];

	return (
		<Card>
			<CardContent className="flex flex-col gap-4">
				<UnitTypeDialog
					projectId={projectId}
					trigger={<Button className="w-fit">{t("newUnitType")}</Button>}
				/>
				{rows.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t("noUnitTypes")}</p>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("unitTypeName")}</TableHead>
									<TableHead>{t("bedrooms")}</TableHead>
									<TableHead>{t("bathrooms")}</TableHead>
									<TableHead>{t("usableArea")}</TableHead>
									<TableHead>{t("priceRangeShort")}</TableHead>
									<TableHead>{t("units")}</TableHead>
									<TableHead>{t("floorPlan")}</TableHead>
									<TableHead />
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((ut) => (
									<TableRow key={ut.id}>
										<TableCell className="font-medium">{ut.name}</TableCell>
										<TableCell>{ut.bedrooms ?? tc("none")}</TableCell>
										<TableCell>{ut.bathrooms ?? tc("none")}</TableCell>
										<TableCell>{ut.usableAreaSqm ?? tc("none")}</TableCell>
										<TableCell>
											{ut.minPriceSatang !== null && ut.maxPriceSatang !== null
												? `${formatBaht(ut.minPriceSatang)} – ${formatBaht(ut.maxPriceSatang)}`
												: tc("none")}
										</TableCell>
										<TableCell>{ut.unitCount}</TableCell>
										<TableCell>
											{ut.floorPlanUrl ? (
												<a
													href={ut.floorPlanUrl}
													target="_blank"
													rel="noreferrer"
													className="underline-offset-4 hover:underline"
												>
													{t("floorPlan")}
												</a>
											) : (
												tc("none")
											)}
										</TableCell>
										<TableCell className="flex justify-end gap-1">
											<UnitTypeDialog
												projectId={projectId}
												existing={ut}
												trigger={
													<Button variant="ghost" size="sm">
														{tc("edit")}
													</Button>
												}
											/>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`${tc("delete")} ${ut.name}`}
												disabled={ut.unitCount > 0 || remove.isPending}
												onClick={() => remove.mutate({ unitTypeId: ut.id })}
											>
												<Trash2Icon />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
