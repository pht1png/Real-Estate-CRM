import { orgProcedure, requirePermission, router } from "../index";
import {
	addNote,
	addNoteInput,
	getFollowUpPicks,
	leadFollowUpInput,
	leadIdInput,
	leadOutcomeInput,
	logLeadOutcome,
	logOpportunityOutcome,
	opportunityFollowUpInput,
	opportunityIdInput,
	opportunityOutcomeInput,
	setLeadFollowUp,
	setOpportunityFollowUp,
} from "../services/activity";
import {
	createCampaign,
	createCampaignInput,
	listCampaigns,
	listCampaignsInput,
	updateCampaign,
	updateCampaignInput,
} from "../services/campaign";
import { captureEnquiry, captureEnquiryInput } from "../services/capture";
import { convertLead, convertLeadInput } from "../services/conversion";
import {
	addCustomerPhone,
	consentInput,
	customerIdInput,
	customerPhoneInput,
	getCustomer,
	listLeads,
	listLeadsInput,
	listOpportunities,
	listOpportunitiesInput,
	lookupByPhone,
	phoneLookupInput,
	referrerInput,
	removeCustomerPhone,
	setConsent,
	setReferrer,
	updateCustomer,
	updateCustomerInput,
} from "../services/customer";
import {
	disqualifyLead,
	disqualifyLeadInput,
	markLost,
	markLostInput,
	nurtureLead,
	nurtureLeadInput,
	setOpportunityStage,
	setOpportunityStageInput,
} from "../services/exit";
import {
	archiveSource,
	archiveSourceInput,
	channelInPersonInput,
	createChannel,
	createChannelInput,
	createSource,
	createSourceInput,
	listLeadSources,
	renameChannel,
	renameChannelInput,
	renameSource,
	renameSourceInput,
	setChannelInPerson,
} from "../services/lead-source";
import { getOverview } from "../services/overview";
import {
	claimInput,
	claimLead,
	listPool,
	listPoolInput,
	poolCount,
} from "../services/pool";
import { qualifyLead, qualifyLeadInput } from "../services/qualify";
import {
	getRulesForTenant,
	updateRules,
	updateRulesInput,
} from "../services/rules";
import { getTodo, todoCount } from "../services/todo";

const read = requirePermission({ lead: ["read"] });
const capture = requirePermission({ lead: ["capture"] });
const claim = requirePermission({ lead: ["claim"] });
const editCustomer = requirePermission({ customer: ["update"] });
const manageSources = requirePermission({ leadSource: ["manage"] });
const manageCampaigns = requirePermission({ campaign: ["manage"] });

/** Lead pipeline (vetting queue). Services check owner / manager per lead. */
export const leadRouter = router({
	capture: capture
		.input(captureEnquiryInput)
		.mutation(({ ctx, input }) => captureEnquiry(ctx.db, ctx.tenant, input)),
	lookupPhone: capture
		.input(phoneLookupInput)
		.query(({ ctx, input }) => lookupByPhone(ctx.db, ctx.tenant, input)),
	list: read
		.input(listLeadsInput)
		.query(({ ctx, input }) => listLeads(ctx.db, ctx.tenant, input)),
	claim: claim
		.input(claimInput)
		.mutation(({ ctx, input }) => claimLead(ctx.db, ctx.tenant, input)),
	logOutcome: read
		.input(leadOutcomeInput)
		.mutation(({ ctx, input }) => logLeadOutcome(ctx.db, ctx.tenant, input)),
	qualify: read
		.input(qualifyLeadInput)
		.mutation(({ ctx, input }) => qualifyLead(ctx.db, ctx.tenant, input)),
	convert: read
		.input(convertLeadInput)
		.mutation(({ ctx, input }) => convertLead(ctx.db, ctx.tenant, input)),
	disqualify: read
		.input(disqualifyLeadInput)
		.mutation(({ ctx, input }) => disqualifyLead(ctx.db, ctx.tenant, input)),
	nurture: read
		.input(nurtureLeadInput)
		.mutation(({ ctx, input }) => nurtureLead(ctx.db, ctx.tenant, input)),
	setFollowUp: read
		.input(leadFollowUpInput)
		.mutation(({ ctx, input }) => setLeadFollowUp(ctx.db, ctx.tenant, input)),
	followUpPicks: read
		.input(leadIdInput)
		.query(({ ctx, input }) => getFollowUpPicks(ctx.db, ctx.tenant, input)),
	addNote: read
		.input(addNoteInput)
		.mutation(({ ctx, input }) => addNote(ctx.db, ctx.tenant, input)),
});

/** Opportunity (deal) pipeline, created by a confirmed visit. */
export const opportunityRouter = router({
	list: read
		.input(listOpportunitiesInput)
		.query(({ ctx, input }) => listOpportunities(ctx.db, ctx.tenant, input)),
	logOutcome: read
		.input(opportunityOutcomeInput)
		.mutation(({ ctx, input }) =>
			logOpportunityOutcome(ctx.db, ctx.tenant, input),
		),
	setStage: read
		.input(setOpportunityStageInput)
		.mutation(({ ctx, input }) =>
			setOpportunityStage(ctx.db, ctx.tenant, input),
		),
	markLost: read
		.input(markLostInput)
		.mutation(({ ctx, input }) => markLost(ctx.db, ctx.tenant, input)),
	setFollowUp: read
		.input(opportunityFollowUpInput)
		.mutation(({ ctx, input }) =>
			setOpportunityFollowUp(ctx.db, ctx.tenant, input),
		),
	followUpPicks: read
		.input(opportunityIdInput)
		.query(({ ctx, input }) => getFollowUpPicks(ctx.db, ctx.tenant, input)),
});

export const poolRouter = router({
	list: read
		.input(listPoolInput)
		.query(({ ctx, input }) => listPool(ctx.db, ctx.tenant, input)),
	count: read.query(({ ctx }) => poolCount(ctx.db, ctx.tenant)),
});

export const overviewRouter = router({
	get: read.query(({ ctx }) => getOverview(ctx.db, ctx.tenant)),
});

export const todoRouter = router({
	list: read.query(({ ctx }) => getTodo(ctx.db, ctx.tenant)),
	count: read.query(({ ctx }) => todoCount(ctx.db, ctx.tenant)),
});

export const customerRouter = router({
	get: read
		.input(customerIdInput)
		.query(({ ctx, input }) => getCustomer(ctx.db, ctx.tenant, input)),
	update: editCustomer
		.input(updateCustomerInput)
		.mutation(({ ctx, input }) => updateCustomer(ctx.db, ctx.tenant, input)),
	addPhone: editCustomer
		.input(customerPhoneInput)
		.mutation(({ ctx, input }) => addCustomerPhone(ctx.db, ctx.tenant, input)),
	removePhone: editCustomer
		.input(customerPhoneInput)
		.mutation(({ ctx, input }) =>
			removeCustomerPhone(ctx.db, ctx.tenant, input),
		),
	setConsent: editCustomer
		.input(consentInput)
		.mutation(({ ctx, input }) => setConsent(ctx.db, ctx.tenant, input)),
	setReferrer: editCustomer
		.input(referrerInput)
		.mutation(({ ctx, input }) => setReferrer(ctx.db, ctx.tenant, input)),
});

export const leadSourceRouter = router({
	/** Everyone who captures needs the list; managing it is admin-only. */
	list: orgProcedure.query(({ ctx }) => listLeadSources(ctx.db, ctx.tenant)),
	createChannel: manageSources
		.input(createChannelInput)
		.mutation(({ ctx, input }) => createChannel(ctx.db, ctx.tenant, input)),
	renameChannel: manageSources
		.input(renameChannelInput)
		.mutation(({ ctx, input }) => renameChannel(ctx.db, ctx.tenant, input)),
	setChannelInPerson: manageSources
		.input(channelInPersonInput)
		.mutation(({ ctx, input }) =>
			setChannelInPerson(ctx.db, ctx.tenant, input),
		),
	createSource: manageSources
		.input(createSourceInput)
		.mutation(({ ctx, input }) => createSource(ctx.db, ctx.tenant, input)),
	renameSource: manageSources
		.input(renameSourceInput)
		.mutation(({ ctx, input }) => renameSource(ctx.db, ctx.tenant, input)),
	archiveSource: manageSources
		.input(archiveSourceInput)
		.mutation(({ ctx, input }) => archiveSource(ctx.db, ctx.tenant, input)),
});

export const campaignRouter = router({
	list: orgProcedure
		.input(listCampaignsInput)
		.query(({ ctx, input }) => listCampaigns(ctx.db, ctx.tenant, input)),
	create: manageCampaigns
		.input(createCampaignInput)
		.mutation(({ ctx, input }) => createCampaign(ctx.db, ctx.tenant, input)),
	update: manageCampaigns
		.input(updateCampaignInput)
		.mutation(({ ctx, input }) => updateCampaign(ctx.db, ctx.tenant, input)),
});

export const rulesRouter = router({
	get: orgProcedure.query(({ ctx }) => getRulesForTenant(ctx.db, ctx.tenant)),
	update: requirePermission({ rules: ["update"] })
		.input(updateRulesInput)
		.mutation(({ ctx, input }) => updateRules(ctx.db, ctx.tenant, input)),
});
