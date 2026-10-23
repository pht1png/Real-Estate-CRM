"use client";

import { isRoleName, type RoleName } from "@Real-Estate-CRM/auth/permissions";
import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@Real-Estate-CRM/ui/components/dialog";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
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
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { TextField } from "@/components/form/text-field";
import { RoleSelect } from "@/components/role-select";
import { useMe, useRoleLabel } from "@/hooks/use-me";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";

/** Unwraps a Better Auth client result, throwing on error for React Query. */
async function unwrap<T>(p: Promise<{ data: T | null; error: unknown }>) {
	const { data, error } = await p;
	if (error || data === null) throw error ?? new Error("No data");
	return data;
}

export function MembersSettings() {
	const t = useTranslations("members");
	const tc = useTranslations("common");
	const tv = useTranslations("validation");
	const format = useFormatter();
	const roleLabel = useRoleLabel();
	const { data: me } = useMe();
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const orgId = me?.organization?.id;

	const members = useQuery({
		queryKey: ["auth", "members", orgId],
		enabled: !!orgId,
		queryFn: () =>
			unwrap(authClient.organization.listMembers({ query: { limit: 500 } })),
	});
	const invitations = useQuery({
		queryKey: ["auth", "invitations", orgId],
		enabled: !!orgId,
		queryFn: () => unwrap(authClient.organization.listInvitations()),
	});
	const team = useQuery(trpc.team.listMembersInScope.queryOptions());
	const projects = useQuery(trpc.project.list.queryOptions());

	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["auth"] }),
			queryClient.invalidateQueries(trpc.team.pathFilter()),
		]);
	const onError = () => toast.error(tc("genericError"));

	const changeRole = useMutation({
		mutationFn: (v: { memberId: string; role: RoleName }) =>
			unwrap(authClient.organization.updateMemberRole(v)),
		onSuccess: async () => {
			toast.success(t("roleChanged"));
			await refresh();
		},
		onError,
	});
	const remove = useMutation({
		mutationFn: (memberId: string) =>
			unwrap(
				authClient.organization.removeMember({ memberIdOrEmail: memberId }),
			),
		onSuccess: async () => {
			toast.success(t("removed"));
			await refresh();
		},
		onError,
	});
	const cancelInvitation = useMutation({
		mutationFn: (invitationId: string) =>
			unwrap(authClient.organization.cancelInvitation({ invitationId })),
		onSuccess: refresh,
		onError,
	});

	const [inviteRole, setInviteRole] = useState<RoleName>("salesperson");
	const inviteForm = useForm({
		defaultValues: { email: "" },
		validators: { onSubmit: z.object({ email: z.email(tv("email")) }) },
		onSubmit: async ({ value, formApi }) => {
			const { error } = await authClient.organization.inviteMember({
				email: value.email,
				role: inviteRole,
			});
			if (error) {
				onError();
				return;
			}
			toast.success(t("invited", { email: value.email }));
			formApi.reset();
			await refresh();
		},
	});

	const projectNames = new Map(projects.data?.map((p) => [p.id, p.name]));
	const projectsOf = (memberId: string, role: string) => {
		if (!["sales_manager", "salesperson"].includes(role))
			return t("allProjects");
		const ids =
			team.data?.find((m) => m.memberId === memberId)?.projectIds ?? [];
		return ids.length
			? ids.map((id) => projectNames.get(id) ?? "").join(", ")
			: t("noProjects");
	};
	const pending = invitations.data?.filter((i) => i.status === "pending") ?? [];

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>
						<h2>{t("inviteTitle")}</h2>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						noValidate
						onSubmit={(e) => {
							e.preventDefault();
							inviteForm.handleSubmit();
						}}
					>
						<FieldGroup className="sm:flex-row sm:items-end">
							<inviteForm.Field name="email">
								{(field) => (
									<TextField
										field={field}
										label={t("email")}
										type="email"
										autoComplete="off"
									/>
								)}
							</inviteForm.Field>
							<Field className="sm:w-auto">
								<FieldLabel htmlFor="invite-role">{t("role")}</FieldLabel>
								<RoleSelect
									id="invite-role"
									value={inviteRole}
									onChange={setInviteRole}
								/>
							</Field>
							<Button type="submit" className="sm:w-auto">
								{t("invite")}
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
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("name")}</TableHead>
								<TableHead>{t("role")}</TableHead>
								<TableHead>{t("projects")}</TableHead>
								<TableHead className="text-right">{t("actions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{members.data?.members.map((m) => {
								const isSelf = m.id === me?.memberId;
								const locked =
									isSelf || (m.role === "owner" && me?.role !== "owner");
								return (
									<TableRow key={m.id}>
										<TableCell>
											<div className="flex flex-col">
												<span className="font-medium">
													{m.user.name}{" "}
													{isSelf && (
														<Badge variant="secondary">{tc("you")}</Badge>
													)}
												</span>
												<span className="text-muted-foreground text-xs">
													{m.user.email}
												</span>
											</div>
										</TableCell>
										<TableCell>
											{locked || !isRoleName(m.role) ? (
												roleLabel(m.role)
											) : (
												<RoleSelect
													aria-label={t("role")}
													value={m.role}
													disabled={changeRole.isPending}
													onChange={(role) =>
														changeRole.mutate({ memberId: m.id, role })
													}
												/>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{projectsOf(m.id, m.role)}
										</TableCell>
										<TableCell className="text-right">
											{!locked && (
												<Dialog>
													<DialogTrigger
														render={<Button variant="ghost" size="sm" />}
													>
														{tc("remove")}
													</DialogTrigger>
													<DialogContent>
														<DialogHeader>
															<DialogTitle>
																{t("removeTitle", { name: m.user.name })}
															</DialogTitle>
															<DialogDescription>
																{t("removeDescription")}
															</DialogDescription>
														</DialogHeader>
														<DialogFooter>
															<DialogClose
																render={<Button variant="outline" />}
															>
																{tc("cancel")}
															</DialogClose>
															<DialogClose
																render={<Button variant="destructive" />}
																onClick={() => remove.mutate(m.id)}
															>
																{tc("remove")}
															</DialogClose>
														</DialogFooter>
													</DialogContent>
												</Dialog>
											)}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						<h2>{t("pendingTitle")}</h2>
					</CardTitle>
				</CardHeader>
				<CardContent className="overflow-x-auto">
					{pending.length === 0 ? (
						<p className="text-muted-foreground text-sm">{t("noPending")}</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("email")}</TableHead>
									<TableHead>{t("role")}</TableHead>
									<TableHead>{t("expires")}</TableHead>
									<TableHead className="text-right">{t("actions")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pending.map((inv) => (
									<TableRow key={inv.id}>
										<TableCell>{inv.email}</TableCell>
										<TableCell>{roleLabel(inv.role ?? "")}</TableCell>
										<TableCell>
											{format.dateTime(new Date(inv.expiresAt), {
												dateStyle: "medium",
											})}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="sm"
												onClick={() => cancelInvitation.mutate(inv.id)}
											>
												{t("cancelInvitation")}
											</Button>
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
