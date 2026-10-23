"use client";

import type { RoleName } from "@Real-Estate-CRM/auth/permissions";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import { Card, CardContent } from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

export function RoleLabelsSettings() {
	const t = useTranslations("roleLabels");
	const tr = useTranslations("roles");
	const tc = useTranslations("common");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const labels = useQuery(trpc.roleLabel.list.queryOptions());
	const [edits, setEdits] = useState<Partial<Record<RoleName, string>>>({});
	const update = useMutation(trpc.roleLabel.update.mutationOptions());

	if (!labels.data) return <Spinner />;

	const changed = labels.data.filter(
		(r) => edits[r.role] !== undefined && edits[r.role] !== (r.label ?? ""),
	);

	async function save() {
		try {
			for (const r of changed) {
				await update.mutateAsync({ role: r.role, label: edits[r.role] ?? "" });
			}
			toast.success(t("saved"));
			setEdits({});
		} catch {
			toast.error(tc("genericError"));
		}
		await queryClient.invalidateQueries(trpc.roleLabel.pathFilter());
	}

	return (
		<Card>
			<CardContent>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<FieldGroup>
						{labels.data.map((r) => (
							<Field key={r.role}>
								<FieldLabel htmlFor={`role-${r.role}`}>{tr(r.role)}</FieldLabel>
								<Input
									id={`role-${r.role}`}
									placeholder={tr(r.role)}
									value={edits[r.role] ?? r.label ?? ""}
									maxLength={60}
									onChange={(e) =>
										setEdits((prev) => ({ ...prev, [r.role]: e.target.value }))
									}
								/>
							</Field>
						))}
						<Button
							type="submit"
							className="sm:w-auto sm:self-start"
							disabled={changed.length === 0 || update.isPending}
						>
							{update.isPending && <Spinner data-icon="inline-start" />}
							{tc("save")}
						</Button>
					</FieldGroup>
				</form>
			</CardContent>
		</Card>
	);
}
