"use client";

import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

/** Inline name editor: saves on Enter or blur when changed. */
function NameInput({
	value,
	label,
	onSave,
}: {
	value: string;
	label: string;
	onSave: (name: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const save = () => {
		const name = draft.trim();
		if (name && name !== value) onSave(name);
		else setDraft(value);
	};
	return (
		<Input
			aria-label={label}
			value={draft}
			maxLength={60}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={save}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					save();
				}
			}}
		/>
	);
}

export function SourcesSettings() {
	const t = useTranslations("sources");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const sources = useQuery(trpc.leadSource.list.queryOptions());
	const [newChannel, setNewChannel] = useState("");
	const [newSource, setNewSource] = useState<Record<string, string>>({});

	const options = {
		onSuccess: () =>
			queryClient.invalidateQueries(trpc.leadSource.pathFilter()),
		onError: (e: { message: string }) => toast.error(e.message),
	};
	const createChannel = useMutation(
		trpc.leadSource.createChannel.mutationOptions(options),
	);
	const renameChannel = useMutation(
		trpc.leadSource.renameChannel.mutationOptions(options),
	);
	const createSource = useMutation(
		trpc.leadSource.createSource.mutationOptions(options),
	);
	const renameSource = useMutation(
		trpc.leadSource.renameSource.mutationOptions(options),
	);
	const archiveSource = useMutation(
		trpc.leadSource.archiveSource.mutationOptions(options),
	);

	if (!sources.data) return <Spinner />;

	return (
		<>
			{sources.data.channels.map((channel) => (
				<Card key={channel.id}>
					<CardHeader>
						<CardTitle>
							<NameInput
								value={channel.name}
								label={channel.name}
								onSave={(name) =>
									renameChannel.mutate({ channelId: channel.id, name })
								}
							/>
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<ul className="flex flex-col gap-2">
							{channel.sources.map((s) => (
								<li key={s.id} className="flex items-center gap-2">
									<NameInput
										value={s.name}
										label={s.name}
										onSave={(name) =>
											renameSource.mutate({ sourceId: s.id, name })
										}
									/>
									{s.archived && (
										<Badge variant="secondary">{t("archived")}</Badge>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											archiveSource.mutate({
												sourceId: s.id,
												archived: !s.archived,
											})
										}
									>
										{s.archived ? t("unarchive") : t("archive")}
									</Button>
								</li>
							))}
						</ul>
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								const name = newSource[channel.id]?.trim();
								if (!name) return;
								createSource.mutate(
									{ channelId: channel.id, name },
									{
										onSuccess: () =>
											setNewSource((v) => ({ ...v, [channel.id]: "" })),
									},
								);
							}}
						>
							<Input
								aria-label={`${t("newSource")} · ${channel.name}`}
								placeholder={t("newSource")}
								value={newSource[channel.id] ?? ""}
								maxLength={60}
								onChange={(e) =>
									setNewSource((v) => ({ ...v, [channel.id]: e.target.value }))
								}
							/>
							<Button type="submit" variant="outline">
								{tc("add")}
							</Button>
						</form>
					</CardContent>
				</Card>
			))}
			<Card>
				<CardHeader>
					<CardTitle>
						<h2>{t("unknown")}</h2>
					</CardTitle>
					<CardDescription>{t("unknownHint")}</CardDescription>
				</CardHeader>
			</Card>
			<form
				className="flex max-w-md gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (newChannel.trim()) {
						createChannel.mutate(
							{ name: newChannel.trim() },
							{ onSuccess: () => setNewChannel("") },
						);
					}
				}}
			>
				<Input
					aria-label={t("newChannel")}
					placeholder={t("newChannel")}
					value={newChannel}
					maxLength={60}
					onChange={(e) => setNewChannel(e.target.value)}
				/>
				<Button type="submit">{t("newChannel")}</Button>
			</form>
		</>
	);
}
