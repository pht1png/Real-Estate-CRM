"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import { Checkbox } from "@Real-Estate-CRM/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@Real-Estate-CRM/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "@Real-Estate-CRM/ui/components/empty";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@Real-Estate-CRM/ui/components/table";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import { useMe, useRoleLabel } from "@/hooks/use-me";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

type Project = { id: string; name: string };

export function ProjectsSettings() {
	const t = useTranslations("projects");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const projects = useQuery(trpc.project.list.queryOptions());

	const create = useMutation(
		trpc.project.create.mutationOptions({
			onSuccess: async () => {
				toast.success(t("created"));
				await queryClient.invalidateQueries(trpc.project.list.pathFilter());
			},
			onError: (e) =>
				toast.error(
					e.data?.code === "CONFLICT" ? e.message : tc("genericError"),
				),
		}),
	);

	const form = useForm({
		defaultValues: { name: "" },
		validators: { onSubmit: z.object({ name: z.string().trim().min(1) }) },
		onSubmit: async ({ value, formApi }) => {
			await create.mutateAsync({ name: value.name.trim() });
			formApi.reset();
		},
	});

	return (
		<>
			<Card>
				<CardContent>
					<form
						noValidate
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
					>
						<FieldGroup className="sm:flex-row sm:items-end">
							<form.Field name="name">
								{(field) => <TextField field={field} label={t("name")} />}
							</form.Field>
							<Button type="submit" className="sm:w-auto">
								{t("create")}
							</Button>
						</FieldGroup>
					</form>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						<h2>{t("title")}</h2>
					</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					{projects.data?.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyDescription>{t("empty")}</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("name")}</TableHead>
									<TableHead className="text-right" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{projects.data?.map((p) => (
									<TableRow key={p.id}>
										<TableCell className="font-medium">{p.name}</TableCell>
										<TableCell className="flex justify-end gap-2">
											<RenameProjectDialog project={p} />
											<ProjectTeamDialog project={p} />
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</>
	);
}

function RenameProjectDialog({ project }: { project: Project }) {
	const t = useTranslations("projects");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(project.name);
	const rename = useMutation(
		trpc.project.rename.mutationOptions({
			onSuccess: async () => {
				toast.success(t("renamed"));
				setOpen(false);
				await queryClient.invalidateQueries(trpc.project.list.pathFilter());
			},
			onError: (e) =>
				toast.error(
					e.data?.code === "CONFLICT" ? e.message : tc("genericError"),
				),
		}),
	);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button variant="ghost" size="sm" />}>
				{tc("rename")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{tc("rename")}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim()) {
							rename.mutate({ projectId: project.id, name: name.trim() });
						}
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={`rename-${project.id}`}>
								{t("name")}
							</FieldLabel>
							<Input
								id={`rename-${project.id}`}
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</Field>
						<Button type="submit" disabled={rename.isPending}>
							{tc("save")}
						</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Assign which sales managers and salespeople cover this project. */
function ProjectTeamDialog({ project }: { project: Project }) {
	const t = useTranslations("projects");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const roleLabel = useRoleLabel();
	const { data: me } = useMe();
	const [open, setOpen] = useState(false);

	const members = useQuery({
		queryKey: ["auth", "members", me?.organization?.id],
		enabled: open,
		queryFn: async () => {
			const { data, error } = await authClient.organization.listMembers({
				query: { limit: 500 },
			});
			if (error || !data) throw error ?? new Error("No data");
			return data;
		},
	});
	const scope = useQuery(
		trpc.projectScope.list.queryOptions(
			{ projectId: project.id },
			{ enabled: open },
		),
	);
	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries(trpc.projectScope.pathFilter()),
			queryClient.invalidateQueries(trpc.team.pathFilter()),
		]);
	const onError = () => toast.error(tc("genericError"));
	const assign = useMutation(
		trpc.projectScope.assign.mutationOptions({
			onSuccess: invalidate,
			onError,
		}),
	);
	const unassign = useMutation(
		trpc.projectScope.unassign.mutationOptions({
			onSuccess: invalidate,
			onError,
		}),
	);

	const scoped =
		members.data?.members.filter((m) =>
			["sales_manager", "salesperson"].includes(m.role),
		) ?? [];
	const assigned = new Set(scope.data?.map((m) => m.memberId));

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button variant="outline" size="sm" />}>
				{t("members")}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{t("membersTitle", { project: project.name })}
					</DialogTitle>
					<DialogDescription>{t("membersDescription")}</DialogDescription>
				</DialogHeader>
				{members.isSuccess && scoped.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("noScopedMembers")}
					</p>
				) : (
					<FieldGroup className="gap-3">
						{scoped.map((m) => {
							const id = `scope-${project.id}-${m.id}`;
							return (
								<Field key={m.id} orientation="horizontal">
									<Checkbox
										id={id}
										checked={assigned.has(m.id)}
										disabled={
											!scope.isSuccess || assign.isPending || unassign.isPending
										}
										onCheckedChange={(checked) => {
											const input = { projectId: project.id, memberId: m.id };
											if (checked) assign.mutate(input);
											else unassign.mutate(input);
										}}
									/>
									<FieldLabel htmlFor={id} className="font-normal">
										{m.user.name}
										<span className="text-muted-foreground">
											· {roleLabel(m.role)}
										</span>
									</FieldLabel>
								</Field>
							);
						})}
					</FieldGroup>
				)}
			</DialogContent>
		</Dialog>
	);
}
