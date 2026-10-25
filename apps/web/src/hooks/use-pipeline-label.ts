"use client";

import type {
	LeadStatus,
	OpportunityStage,
} from "@Real-Estate-CRM/db/constants";
import { useTranslations } from "next-intl";

/**
 * Where a customer stands in a project: the deal stage once a visit converted
 * the lead, otherwise the lead status.
 */
export function usePipelineLabel() {
	const tl = useTranslations("leadStatuses");
	const to = useTranslations("opportunityStages");
	return (status: LeadStatus | null, stage: OpportunityStage | null) =>
		stage ? to(stage) : status ? tl(status) : "";
}
