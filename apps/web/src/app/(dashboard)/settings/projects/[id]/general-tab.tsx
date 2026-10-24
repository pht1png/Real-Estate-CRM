"use client";

import type { ProjectType } from "@Real-Estate-CRM/db/constants";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
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
import { useMutation } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

import {
	type ProjectDetail,
	useInvalidateProject,
	useMutationError,
} from "./shared";

const projectTypes: ProjectType[] = ["condo", "low_rise", "mixed"];

export function GeneralTab({ project }: { project: ProjectDetail }) {
	const t = useTranslations("projectSettings");
	const tt = useTranslations("projectTypes");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const invalidate = useInvalidateProject();
	const onError = useMutationError();

	const [type, setType] = useState<ProjectType>(project.type);
	const [timeZone, setTimeZone] = useState(project.timeZone);
	const [commission, setCommission] = useState(
		(project.commissionBps / 100).toString(),
	);
	const [tags, setTags] = useState(project.unitTags);
	const [newTag, setNewTag] = useState("");

	const update = useMutation(
		trpc.project.update.mutationOptions({
			onSuccess: async () => {
				toast.success(t("saved"));
				await invalidate();
			},
			onError,
		}),
	);

	const commissionBps = Math.round(Number(commission) * 100);
	const commissionValid =
		/^\d{1,3}(\.\d{1,2})?$/.test(commission) && commissionBps <= 10_000;
	const typeItems = projectTypes.map((v) => ({ value: v, label: tt(v) }));

	function addTag() {
		const tag = newTag.trim();
		if (tag && !tags.includes(tag)) setTags([...tags, tag]);
		setNewTag("");
	}

	return (
		<Card>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!commissionValid) return;
						update.mutate({
							projectId: project.id,
							type,
							timeZone: timeZone.trim(),
							commissionBps,
							unitTags: tags,
						});
					}}
				>
					<FieldGroup className="max-w-lg">
						<Field>
							<FieldLabel htmlFor="project-type">{t("type")}</FieldLabel>
							<Select
								items={typeItems}
								value={type}
								onValueChange={(v) => v && setType(v as ProjectType)}
							>
								<SelectTrigger id="project-type">
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
							<FieldLabel htmlFor="time-zone">{t("timeZone")}</FieldLabel>
							<Input
								id="time-zone"
								value={timeZone}
								onChange={(e) => setTimeZone(e.target.value)}
							/>
						</Field>
						<Field data-invalid={!commissionValid || undefined}>
							<FieldLabel htmlFor="commission">{t("commission")}</FieldLabel>
							<Input
								id="commission"
								inputMode="decimal"
								value={commission}
								aria-invalid={!commissionValid || undefined}
								onChange={(e) => setCommission(e.target.value)}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="new-tag">{t("unitTags")}</FieldLabel>
							<FieldDescription>{t("unitTagsHint")}</FieldDescription>
							<div className="flex flex-wrap gap-2">
								{tags.map((tag) => (
									<Badge key={tag} variant="secondary" className="gap-1">
										{tag}
										<button
											type="button"
											aria-label={`${tc("remove")} ${tag}`}
											onClick={() => setTags(tags.filter((x) => x !== tag))}
										>
											<XIcon className="size-3" />
										</button>
									</Badge>
								))}
							</div>
							<div className="flex gap-2">
								<Input
									id="new-tag"
									value={newTag}
									maxLength={40}
									onChange={(e) => setNewTag(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addTag();
										}
									}}
								/>
								<Button type="button" variant="outline" onClick={addTag}>
									{t("addTag")}
								</Button>
							</div>
						</Field>
						<Button
							type="submit"
							className="sm:w-auto sm:self-start"
							disabled={update.isPending || !commissionValid}
						>
							{tc("save")}
						</Button>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
