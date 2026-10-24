"use client";

import { Button } from "@Real-Estate-CRM/ui/components/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@Real-Estate-CRM/ui/components/sheet";
import { Spinner } from "@Real-Estate-CRM/ui/components/spinner";
import { PlusIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useCan } from "@/hooks/use-me";

// The form (and the phone-number library) loads only when the sheet first
// opens, so the button stays light on every dashboard page.
const QuickCaptureForm = dynamic(
	() => import("./quick-capture-form").then((m) => m.QuickCaptureForm),
	{ loading: () => <Spinner className="mx-4" /> },
);

/** Header button that opens quick capture (brief §6). */
export function QuickCapture() {
	const t = useTranslations("capture");
	const can = useCan();
	const [open, setOpen] = useState(false);

	if (!can({ lead: ["capture"] })) return null;

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger render={<Button size="sm" />}>
				<PlusIcon data-icon="inline-start" />
				<span className="hidden sm:inline">{t("title")}</span>
				<span className="sr-only sm:hidden">{t("title")}</span>
			</SheetTrigger>
			<SheetContent
				side="right"
				className="w-full overflow-y-auto overscroll-contain sm:max-w-md"
			>
				<SheetHeader>
					<SheetTitle>{t("title")}</SheetTitle>
					<SheetDescription>{t("description")}</SheetDescription>
				</SheetHeader>
				{open && <QuickCaptureForm onDone={() => setOpen(false)} />}
			</SheetContent>
		</Sheet>
	);
}
