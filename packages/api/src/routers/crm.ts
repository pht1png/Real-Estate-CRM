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
	appointmentSlots,
	appointmentSlotsInput,
	arrivedInput,
	bookAppointment,
	bookAppointmentInput,
	cancelAppointment,
	cancelAppointmentInput,
	markArrived,
	markNoShow,
	noShowInput,
	rescheduleAppointment,
	rescheduleAppointmentInput,
} from "../services/appointments";
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
	addContactPhone,
	consentInput,
	contactIdInput,
	contactPhoneInput,
	getContact,
	listLeads,
	listLeadsInput,
	listOpportunities,
	listOpportunitiesInput,
	lookupByPhone,
	phoneLookupInput,
	removeContactPhone,
	setConsent,
	updateContact,
	updateContactInput,
} from "../services/contact";
import {
	disqualifyLead,
	disqualifyLeadInput,
	markLost,
	markLostInput,
	nurtureLead,
	nurtureLeadInput,
	setOpportunityStatus,
	setOpportunityStatusInput,
} from "../services/exit";
import {
	archiveSource,
	archiveSourceInput,
	channelFlagsInput,
	createChannel,
	createChannelInput,
	createSource,
	createSourceInput,
	listLeadSources,
	renameChannel,
	renameChannelInput,
	renameSource,
	renameSourceInput,
	setChannelFlags,
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
import { setLeadReferrer, setReferrerInput } from "../services/referrer";
import {
	getRulesForTenant,
	updateRules,
	updateRulesInput,
} from "../services/rules";
import { getTodo, todoCount } from "../services/todo";
import {
	confirmVisit,
	confirmVisitInput,
	recordOpportunityVisit,
	recordVisitInput,
	setFunding,
	setFundingInput,
} from "../services/visits";

const read = requirePermission({ lead: ["read"] });
const capture = requirePermission({ lead: ["capture"] });
const claim = requirePermission({ lead: ["claim"] });
const editContact = requirePermission({ contact: ["update"] });
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
	/** Confirm visit: the first visit converts a qualified lead. */
	convert: read
		.input(confirmVisitInput)
		.mutation(({ ctx, input }) => confirmVisit(ctx.db, ctx.tenant, input)),
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
	setReferrer: read
		.input(setReferrerInput)
		.mutation(({ ctx, input }) => setLeadReferrer(ctx.db, ctx.tenant, input)),
});

/** Opportunity pipeline, created by a confirmed visit. */
export const opportunityRouter = router({
	list: read
		.input(listOpportunitiesInput)
		.query(({ ctx, input }) => listOpportunities(ctx.db, ctx.tenant, input)),
	logOutcome: read
		.input(opportunityOutcomeInput)
		.mutation(({ ctx, input }) =>
			logOpportunityOutcome(ctx.db, ctx.tenant, input),
		),
	setStatus: read
		.input(setOpportunityStatusInput)
		.mutation(({ ctx, input }) =>
			setOpportunityStatus(ctx.db, ctx.tenant, input),
		),
	setFunding: read
		.input(setFundingInput)
		.mutation(({ ctx, input }) => setFunding(ctx.db, ctx.tenant, input)),
	recordVisit: read
		.input(recordVisitInput)
		.mutation(({ ctx, input }) =>
			recordOpportunityVisit(ctx.db, ctx.tenant, input),
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

/** Showroom appointments; services check the host (owner) or a manager. */
export const appointmentRouter = router({
	book: read
		.input(bookAppointmentInput)
		.mutation(({ ctx, input }) => bookAppointment(ctx.db, ctx.tenant, input)),
	reschedule: read
		.input(rescheduleAppointmentInput)
		.mutation(({ ctx, input }) =>
			rescheduleAppointment(ctx.db, ctx.tenant, input),
		),
	cancel: read
		.input(cancelAppointmentInput)
		.mutation(({ ctx, input }) => cancelAppointment(ctx.db, ctx.tenant, input)),
	arrived: read
		.input(arrivedInput)
		.mutation(({ ctx, input }) => markArrived(ctx.db, ctx.tenant, input)),
	noShow: read
		.input(noShowInput)
		.mutation(({ ctx, input }) => markNoShow(ctx.db, ctx.tenant, input)),
	slots: read
		.input(appointmentSlotsInput)
		.query(({ ctx, input }) => appointmentSlots(ctx.db, ctx.tenant, input)),
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

export const contactRouter = router({
	get: read
		.input(contactIdInput)
		.query(({ ctx, input }) => getContact(ctx.db, ctx.tenant, input)),
	update: editContact
		.input(updateContactInput)
		.mutation(({ ctx, input }) => updateContact(ctx.db, ctx.tenant, input)),
	addPhone: editContact
		.input(contactPhoneInput)
		.mutation(({ ctx, input }) => addContactPhone(ctx.db, ctx.tenant, input)),
	removePhone: editContact
		.input(contactPhoneInput)
		.mutation(({ ctx, input }) =>
			removeContactPhone(ctx.db, ctx.tenant, input),
		),
	setConsent: editContact
		.input(consentInput)
		.mutation(({ ctx, input }) => setConsent(ctx.db, ctx.tenant, input)),
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
	setChannelFlags: manageSources
		.input(channelFlagsInput)
		.mutation(({ ctx, input }) => setChannelFlags(ctx.db, ctx.tenant, input)),
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
