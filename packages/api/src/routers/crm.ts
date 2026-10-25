import { orgProcedure, requirePermission, router } from "../index";
import {
	getFollowUpPicks,
	interestIdInput,
	logOutcome,
	logOutcomeInput,
	setFollowUp,
	setFollowUpInput,
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
import {
	addCustomerPhone,
	addNote,
	addNoteInput,
	consentInput,
	customerIdInput,
	customerPhoneInput,
	getCustomer,
	listLeads,
	listLeadsInput,
	lookupByPhone,
	phoneLookupInput,
	referrerInput,
	removeCustomerPhone,
	setConsent,
	setReferrer,
	updateCustomer,
	updateCustomerInput,
} from "../services/customer";
import { closeLead, closeLeadInput } from "../services/exit";
import {
	archiveSource,
	archiveSourceInput,
	createChannel,
	createChannelInput,
	createSource,
	createSourceInput,
	listLeadSources,
	renameChannel,
	renameChannelInput,
	renameSource,
	renameSourceInput,
} from "../services/lead-source";
import {
	claimInput,
	claimLead,
	listPool,
	listPoolInput,
	poolCount,
} from "../services/pool";
import {
	getRulesForTenant,
	updateRules,
	updateRulesInput,
} from "../services/rules";
import { getToday } from "../services/today";

const read = requirePermission({ lead: ["read"] });
const capture = requirePermission({ lead: ["capture"] });
const claim = requirePermission({ lead: ["claim"] });
const editCustomer = requirePermission({ customer: ["update"] });
const manageSources = requirePermission({ leadSource: ["manage"] });
const manageCampaigns = requirePermission({ campaign: ["manage"] });

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
	addNote: read
		.input(addNoteInput)
		.mutation(({ ctx, input }) => addNote(ctx.db, ctx.tenant, input)),
	claim: claim
		.input(claimInput)
		.mutation(({ ctx, input }) => claimLead(ctx.db, ctx.tenant, input)),
	logOutcome: read
		.input(logOutcomeInput)
		.mutation(({ ctx, input }) => logOutcome(ctx.db, ctx.tenant, input)),
	close: read
		.input(closeLeadInput)
		.mutation(({ ctx, input }) => closeLead(ctx.db, ctx.tenant, input)),
	followUpPicks: read
		.input(interestIdInput)
		.query(({ ctx, input }) => getFollowUpPicks(ctx.db, ctx.tenant, input)),
	setFollowUp: read
		.input(setFollowUpInput)
		.mutation(({ ctx, input }) => setFollowUp(ctx.db, ctx.tenant, input)),
});

export const poolRouter = router({
	list: read
		.input(listPoolInput)
		.query(({ ctx, input }) => listPool(ctx.db, ctx.tenant, input)),
	count: read.query(({ ctx }) => poolCount(ctx.db, ctx.tenant)),
});

export const todayRouter = router({
	get: read.query(({ ctx }) => getToday(ctx.db, ctx.tenant)),
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
