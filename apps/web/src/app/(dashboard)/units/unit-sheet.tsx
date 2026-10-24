"use client";

import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Separator } from "@Real-Estate-CRM/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@Real-Estate-CRM/ui/components/sheet";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { Textarea } from "@Real-Estate-CRM/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useCan } from "@/hooks/use-me";
import { bahtToSatang, useFormatBaht } from "@/lib/money";
import { useTRPC } from "@/utils/trpc";

import { statusClasses } from "./status";
import type { GridUnit } from "./units-browser";

/** Unit details and price history; price edit and block/unblock for managers. */
export function UnitSheet({
	unit,
	onClose,
}: {
	unit: GridUnit | null;
	onClose: () => void;
}) {
	const t = useTranslations("units");
	const ts = useTranslations("unitStatuses");
	const tf = useTranslations("facings");
	const tc = useTranslations("common");
	const format = useFormatter();
	const formatBaht = useFormatBaht();
	const can = useCan();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [newPrice, setNewPrice] = useState("");
	const [reason, setReason] = useState("");
	const [current, setCurrent] = useState(unit);

	// Keep showing the unit while the sheet animates closed.
	useEffect(() => {
		if (unit) setCurrent(unit);
		setNewPrice("");
		setReason("");
	}, [unit]);

	const history = useQuery(
		trpc.unit.priceHistory.queryOptions(
			{ unitId: current?.id ?? "" },
			{ enabled: !!unit },
		),
	);
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.unit.pathFilter()),
			queryClient.invalidateQueries(trpc.project.get.pathFilter()),
			queryClient.invalidateQueries(trpc.unitType.pathFilter()),
		]);
	const onError = (e: { message: string; data?: { code?: string } | null }) =>
		toast.error(e.data?.code === "CONFLICT" ? e.message : tc("genericError"));

	const updatePrice = useMutation(
		trpc.unit.updatePrice.mutationOptions({
			onSuccess: async () => {
				toast.success(t("priceSaved"));
				onClose();
				await refresh();
			},
			onError,
		}),
	);
	const block = useMutation(
		trpc.unit.block.mutationOptions({
			onSuccess: async () => {
				toast.success(t("blocked"));
				onClose();
				await refresh();
			},
			onError,
		}),
	);
	const unblock = useMutation(
		trpc.unit.unblock.mutationOptions({
			onSuccess: async () => {
				toast.success(t("unblocked"));
				onClose();
				await refresh();
			},
			onError,
		}),
	);

	const u = current;
	const editable = u?.status === "available" || u?.status === "blocked";
	const priceSatang = bahtToSatang(newPrice);
	const canSavePrice =
		priceSatang !== null &&
		priceSatang !== u?.listPriceSatang &&
		reason.trim().length >= 3;

	return (
		<Sheet open={!!unit} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-full overflow-y-auto sm:max-w-md">
				{u && (
					<>
						<SheetHeader>
							<SheetTitle>{u.unitNumber}</SheetTitle>
							<SheetDescription>
								<Badge className={statusClasses[u.status]}>
									{ts(u.status)}
								</Badge>
							</SheetDescription>
						</SheetHeader>
						<div className="flex flex-col gap-6 px-4 pb-6">
							<dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
								<dt className="text-muted-foreground">{t("listPrice")}</dt>
								<dd className="font-semibold">
									{formatBaht(u.listPriceSatang)}
								</dd>
								<dt className="text-muted-foreground">{t("unitType")}</dt>
								<dd>{u.unitTypeName}</dd>
								{u.usableAreaSqm !== null && (
									<>
										<dt className="text-muted-foreground">{t("area")}</dt>
										<dd>
											{t("sqm", { value: format.number(u.usableAreaSqm) })}
										</dd>
									</>
								)}
								{u.landSizeSqwah !== null && (
									<>
										<dt className="text-muted-foreground">{t("land")}</dt>
										<dd>
											{t("sqwah", { value: format.number(u.landSizeSqwah) })}
										</dd>
									</>
								)}
								{u.facing && (
									<>
										<dt className="text-muted-foreground">{t("facing")}</dt>
										<dd>{tf(u.facing)}</dd>
									</>
								)}
								{u.tags.length > 0 && (
									<>
										<dt className="text-muted-foreground">{t("tags")}</dt>
										<dd className="flex flex-wrap gap-1">
											{u.tags.map((tag) => (
												<Badge key={tag} variant="secondary">
													{tag}
												</Badge>
											))}
										</dd>
									</>
								)}
							</dl>

							{can({ unit: ["price"] }) && (
								<>
									<Separator />
									{editable ? (
										<form
											onSubmit={(e) => {
												e.preventDefault();
												if (canSavePrice && priceSatang !== null) {
													updatePrice.mutate({
														unitId: u.id,
														newPriceSatang: priceSatang,
														reason: reason.trim(),
													});
												}
											}}
										>
											<FieldGroup>
												<Field>
													<FieldLabel htmlFor="new-price">
														{t("newPrice")}
													</FieldLabel>
													<Input
														id="new-price"
														inputMode="decimal"
														value={newPrice}
														onChange={(e) => setNewPrice(e.target.value)}
													/>
												</Field>
												<Field>
													<FieldLabel htmlFor="price-reason">
														{t("reason")}
													</FieldLabel>
													<Textarea
														id="price-reason"
														value={reason}
														maxLength={300}
														onChange={(e) => setReason(e.target.value)}
													/>
													<FieldDescription>{t("reasonHint")}</FieldDescription>
												</Field>
												<Button
													type="submit"
													disabled={!canSavePrice || updatePrice.isPending}
												>
													{updatePrice.isPending && (
														<Spinner data-icon="inline-start" />
													)}
													{t("savePrice")}
												</Button>
											</FieldGroup>
										</form>
									) : (
										<p className="text-muted-foreground text-sm">
											{t("priceLocked")}
										</p>
									)}
								</>
							)}

							{can({ unit: ["block"] }) && editable && (
								<Button
									variant="outline"
									disabled={block.isPending || unblock.isPending}
									onClick={() =>
										u.status === "available"
											? block.mutate({ unitId: u.id })
											: unblock.mutate({ unitId: u.id })
									}
								>
									{u.status === "available" ? t("block") : t("unblock")}
								</Button>
							)}

							<Separator />
							<section className="flex flex-col gap-2">
								<h3 className="font-medium">{t("priceHistory")}</h3>
								{history.data?.length === 0 && (
									<p className="text-muted-foreground text-sm">
										{t("noHistory")}
									</p>
								)}
								<ol className="flex flex-col gap-3">
									{history.data?.map((h) => (
										<li key={h.id} className="text-sm">
											<p>
												{formatBaht(h.oldPriceSatang)} →{" "}
												<span className="font-medium">
													{formatBaht(h.newPriceSatang)}
												</span>
											</p>
											<p className="text-muted-foreground">{h.reason}</p>
											<p className="text-muted-foreground text-xs">
												{t("changedBy", {
													name: h.changedBy ?? "",
													date: format.dateTime(new Date(h.changedAt), {
														dateStyle: "medium",
														timeStyle: "short",
													}),
												})}
											</p>
										</li>
									))}
								</ol>
							</section>
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
