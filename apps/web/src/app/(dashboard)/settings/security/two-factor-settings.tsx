"use client";

import { Badge } from "@Real-Estate-CRM/ui/components/badge";
import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@Real-Estate-CRM/ui/components/card";
import {
	Field,
	FieldGroup,
	FieldLabel,
} from "@Real-Estate-CRM/ui/components/field";
import { Input } from "@Real-Estate-CRM/ui/components/input";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { useTranslations } from "next-intl";
import { useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

type Setup = { totpURI: string; backupCodes: string[] };

/** Optional two-step login (brief §3): authenticator app plus backup codes. */
export function TwoFactorSettings() {
	const t = useTranslations("security");
	const tf = useTranslations("twoFactor");
	const tc = useTranslations("common");
	const { data: session, refetch } = authClient.useSession();
	const enabled = !!session?.user.twoFactorEnabled;

	const [step, setStep] = useState<"idle" | "password" | "verify">("idle");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [setup, setSetup] = useState<Setup | null>(null);
	const [busy, setBusy] = useState(false);

	function reset() {
		setStep("idle");
		setPassword("");
		setCode("");
		setSetup(null);
	}

	async function submitPassword() {
		setBusy(true);
		try {
			if (enabled) {
				const { error } = await authClient.twoFactor.disable({ password });
				if (error) return toast.error(t("wrongPassword"));
				toast.success(t("disabled"));
				reset();
				await refetch();
			} else {
				const { data, error } = await authClient.twoFactor.enable({ password });
				if (error || !data || !("totpURI" in data))
					return toast.error(t("wrongPassword"));
				setSetup(data);
				setStep("verify");
			}
		} finally {
			setBusy(false);
		}
	}

	async function verify() {
		setBusy(true);
		try {
			const { error } = await authClient.twoFactor.verifyTotp({
				code: code.trim(),
			});
			if (error) return toast.error(tf("invalid"));
			toast.success(t("enabled"));
			setStep("idle");
			setPassword("");
			setCode("");
			await refetch();
		} finally {
			setBusy(false);
		}
	}

	const secret = setup
		? new URL(setup.totpURI).searchParams.get("secret")
		: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("twoFactorTitle")}</h2>
				</CardTitle>
				<CardDescription>{t("twoFactorDescription")}</CardDescription>
				<CardAction>
					<Badge variant={enabled ? "default" : "secondary"}>
						{enabled ? t("on") : t("off")}
					</Badge>
				</CardAction>
			</CardHeader>
			<CardContent>
				{step === "idle" && (
					<Button
						variant={enabled ? "outline" : "default"}
						onClick={() => setStep("password")}
					>
						{enabled ? t("disable") : t("enable")}
					</Button>
				)}

				{step === "password" && (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							submitPassword();
						}}
					>
						<FieldGroup className="max-w-sm">
							<Field>
								<FieldLabel htmlFor="2fa-password">{t("password")}</FieldLabel>
								<Input
									id="2fa-password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									autoFocus
								/>
							</Field>
							<div className="flex gap-2">
								<Button type="submit" disabled={busy || !password}>
									{busy && <Spinner data-icon="inline-start" />}
									{enabled ? t("disable") : t("enable")}
								</Button>
								<Button type="button" variant="ghost" onClick={reset}>
									{tc("cancel")}
								</Button>
							</div>
						</FieldGroup>
					</form>
				)}

				{step === "verify" && setup && (
					<FieldGroup className="max-w-sm">
						<p className="text-sm">{t("scan")}</p>
						<div className="w-fit bg-white p-3">
							<QRCode value={setup.totpURI} size={168} />
						</div>
						{secret && (
							<p className="text-muted-foreground font-mono text-xs break-all">
								{t("manualKey", { key: secret })}
							</p>
						)}
						<div>
							<h3 className="text-sm font-medium">{t("backupTitle")}</h3>
							<p className="text-muted-foreground text-xs">{t("backupHint")}</p>
							<ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
								{setup.backupCodes.map((c) => (
									<li key={c}>{c}</li>
								))}
							</ul>
						</div>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								verify();
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="2fa-code">{tf("code")}</FieldLabel>
									<Input
										id="2fa-code"
										inputMode="numeric"
										autoComplete="one-time-code"
										value={code}
										onChange={(e) => setCode(e.target.value)}
									/>
								</Field>
								<Button
									type="submit"
									disabled={busy || code.trim().length !== 6}
								>
									{busy && <Spinner data-icon="inline-start" />}
									{t("verify")}
								</Button>
							</FieldGroup>
						</form>
					</FieldGroup>
				)}
			</CardContent>
		</Card>
	);
}
