"use client";

import type {
	LeadStatus,
	OpportunityStatus,
} from "@Real-Estate-CRM/db/constants";
import { useTranslations } from "next-intl";

/**
 * Where a customer stands in a project: the opportunity status once a visit
 * converted the lead, otherwise the lead status.
 */
export function usePipelineLabel() {
	const tl = useTranslations("leadStatuses");
	const to = useTranslations("opportunityStatuses");
	return (
		leadStatus: LeadStatus | null,
		opportunityStatus: OpportunityStatus | null,
	) =>
		opportunityStatus
			? to(opportunityStatus)
			: leadStatus
				? tl(leadStatus)
				: "";
}
