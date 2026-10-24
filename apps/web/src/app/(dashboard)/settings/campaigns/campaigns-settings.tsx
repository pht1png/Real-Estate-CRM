"use client";

import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import { Field, FieldLabel } from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Label } from "@Real-Estate-CRM/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@Real-Estate-CRM/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

function PickOne({
	id,
	label,
	value,
	onChange,
	items,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (v: string) => void;
	items: { value: string; label: string }[];
}) {
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={items}
				value={value}
				onValueChange={(v) => v && onChange(v)}
			>
				<SelectTrigger id={id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((i) => (
							<SelectItem key={i.value} value={i.value}>
								{i.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		</Field>
	);
}

export function CampaignsSettings() {
	const t = useTranslations("campaigns");
	const tc = useTranslations("common");
	const format = useFormatter();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [showArchived, setShowArchived] = useState(false);
	const projects = useQuery(trpc.project.list.queryOptions());
	const sources = useQuery(trpc.leadSource.list.queryOptions());
	const campaigns = useQuery(
		trpc.campaign.list.queryOptions({ includeArchived: showArchived }),
	);

	const [projectId, setProjectId] = useState("");
	const [channelId, setChannelId] = useState("");
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [startsOn, setStartsOn] = useState("");
	const [endsOn, setEndsOn] = useState("");
	useEffect(() => {
		if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
	}, [projects.data, projectId]);
	useEffect(() => {
		if (!channelId && sources.data?.channels[0])
			setChannelId(sources.data.channels[0].id);
	}, [sources.data, channelId]);

	const options = {
		onSuccess: () => queryClient.invalidateQueries(trpc.campaign.pathFilter()),
		onError: (e: { message: string }) => toast.error(e.message),
	};
	const create = useMutation(trpc.campaign.create.mutationOptions(options));
	const update = useMutation(trpc.campaign.update.mutationOptions(options));
	const date = (d: string) =>
		format.dateTime(new Date(`${d}T00:00:00`), { dateStyle: "medium" });
	const valid =
		projectId && channelId && name.trim() && code.trim() && startsOn;

	return (
		<>
			<Card>
				<CardContent>
					<form
						className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
						onSubmit={(e) => {
							e.preventDefault();
							if (!valid) return;
							create.mutate(
								{
									projectId,
									channelId,
									name: name.trim(),
									code: code.trim(),
									startsOn,
									endsOn: endsOn || undefined,
								},
								{
									onSuccess: () => {
										setName("");
										setCode("");
										setStartsOn("");
										setEndsOn("");
									},
								},
							);
						}}
					>
						<PickOne
							id="camp-project"
							label={t("project")}
							value={projectId}
							onChange={setProjectId}
							items={(projects.data ?? []).map((p) => ({
								value: p.id,
								label: p.name,
							}))}
						/>
						<PickOne
							id="camp-channel"
							label={t("channel")}
							value={channelId}
							onChange={setChannelId}
							items={(sources.data?.channels ?? []).map((c) => ({
								value: c.id,
								label: c.name,
							}))}
						/>
						<Field>
							<FieldLabel htmlFor="camp-name">{t("name")}</FieldLabel>
							<Input
								id="camp-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="camp-code">{t("code")}</FieldLabel>
							<Input
								id="camp-code"
								value={code}
								placeholder="BSN-FB-LEADFORM-2026-11"
								onChange={(e) => setCode(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="camp-start">{t("startsOn")}</FieldLabel>
							<Input
								id="camp-start"
								type="date"
								value={startsOn}
								onChange={(e) => setStartsOn(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="camp-end">{t("endsOn")}</FieldLabel>
							<Input
								id="camp-end"
								type="date"
								value={endsOn}
								onChange={(e) => setEndsOn(e.target.value)}
							/>
						</Field>
						<Button
							type="submit"
							className="sm:w-auto sm:self-end"
							disabled={!valid || create.isPending}
						>
							{t("new")}
						</Button>
					</form>
				</CardContent>
			</Card>
			<div className="flex items-center gap-2">
				<Checkbox
					id="camp-archived"
					checked={showArchived}
					onCheckedChange={(c) => setShowArchived(!!c)}
				/>
				<Label htmlFor="camp-archived">{t("showArchived")}</Label>
			</div>
			{campaigns.data?.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("empty")}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("name")}</TableHead>
								<TableHead>{t("code")}</TableHead>
								<TableHead>{t("project")}</TableHead>
								<TableHead>{t("channel")}</TableHead>
								<TableHead>{t("startsOn")}</TableHead>
								<TableHead>{t("endsOn")}</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{campaigns.data?.map((c) => (
								<TableRow key={c.id}>
									<TableCell className="font-medium">
										{c.name}
										{c.archived && (
											<Badge className="ml-2" variant="secondary">
												{t("archived")}
											</Badge>
										)}
									</TableCell>
									<TableCell className="font-mono text-xs">{c.code}</TableCell>
									<TableCell>{c.projectName}</TableCell>
									<TableCell>{c.channelName}</TableCell>
									<TableCell>{date(c.startsOn)}</TableCell>
									<TableCell>
										{c.endsOn ? date(c.endsOn) : tc("none")}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												update.mutate({
													campaignId: c.id,
													archived: !c.archived,
												})
											}
										>
											{c.archived ? t("unarchive") : t("archive")}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</>
	);
}
