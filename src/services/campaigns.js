// services/campaigns.js
const axios = require('axios');
const configs = require('../config');
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');
const ContactListEntry = require('../models/contactListEntry');
const contactListsService = require('./contactLists');
const templatesService = require('./templates');
const optOutsService = require('./optOuts');
const templateBuilder = require('./templateBuilder');
const { extractTemplateVariables } = require('./templateVariables');

async function listCampaigns(tenantId) {
  return Campaign.find({ tenantId }).sort({ createdAt: -1 }).lean();
}

async function getCampaign(tenantId, id) {
  const campaign = await Campaign.findOne({ _id: id, tenantId }).lean();
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  return campaign;
}

// Validates a campaign's fields, fetches the template, and resolves
// every variable/media it needs — per_contact ones just note which
// list-column to read per recipient (see templateBuilder.js), shared
// ones need an actual value right here, decided fresh for *this*
// campaign (the same contact list can be reused for a different
// template/campaign later with completely different choices).
async function buildCampaignData(tenantId, authHeader, payload) {
  const {
    name,
    contactListId,
    templateId,
    queue,
    extension,
    flowId,
    variableConfig,
    mediaConfig,
    rateLimitPerMinute,
    startAt,
    endAt,
  } = payload;

  if (!name?.trim() || !contactListId || !templateId || !queue || !extension || !rateLimitPerMinute || !startAt || !endAt) {
    const err = new Error(
      'name, contactListId, templateId, queue, extension, rateLimitPerMinute, startAt and endAt are all required'
    );
    err.statusCode = 422;
    throw err;
  }

  if (new Date(endAt) <= new Date(startAt)) {
    const err = new Error('endAt must be after startAt');
    err.statusCode = 422;
    throw err;
  }

  await contactListsService.getContactList(tenantId, contactListId); // 404s if missing/wrong tenant

  const template = await templatesService.getTemplate(authHeader, templateId);
  if (template.status !== 'APPROVED') {
    const err = new Error(`Only APPROVED templates can be used in a campaign (this one is ${template.status})`);
    err.statusCode = 422;
    throw err;
  }

  const templateVars = extractTemplateVariables(template);
  // Only the main header's own media (component: 'media') gets special,
  // separate handling via mediaConfig below — that's the existing,
  // already-relied-on flow. Card media (component: 'card_media') flows
  // through the same variableConfig mechanism as every text variable
  // instead: same {name, mode, value} shape, `value` just happens to be
  // a URL for these instead of text. Simpler than inventing a second,
  // parallel media-config path just for carousel cards.
  const realVars = templateVars.filter((v) => v.component !== 'media');
  const mediaVar = templateVars.find((v) => v.component === 'media');

  const configByName = new Map((variableConfig || []).map((c) => [c.name, c]));
  const missing = realVars.filter((v) => !configByName.has(v.name));
  if (missing.length) {
    const err = new Error(`Missing configuration for: ${missing.map((v) => v.name).join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  const resolvedVariables = realVars.map((v) => {
    const submitted = configByName.get(v.name);
    const base = { component: v.component, position: v.position, name: v.name };
    // card_body/card_media entries carry cardIndex through so
    // templateBuilder.js (send time) knows which card each one belongs
    // to — plain header/body variables have no card, so this stays
    // undefined for them rather than a misleading 0.
    if (v.cardIndex !== undefined) base.cardIndex = v.cardIndex;
    // button/card_button entries carry which button (0-indexed, among
    // that scope's own buttons array) the resolved URL suffix belongs to
    // — templateBuilder.js needs this to build the right BUTTONS
    // component parameter at send time.
    if (v.buttonIndex !== undefined) base.buttonIndex = v.buttonIndex;

    if (submitted.mode === 'shared') {
      if (!submitted.value?.toString().trim()) {
        const err = new Error(`"${v.name}" is marked shared but has no value`);
        err.statusCode = 422;
        throw err;
      }
      return { ...base, mode: 'shared', value: String(submitted.value).trim() };
    }
    return { ...base, mode: 'per_contact', value: null };
  });

  let resolvedMedia = { mode: null, sharedUrl: null };
  if (mediaVar) {
    if (!mediaConfig?.mode) {
      const err = new Error('This template has a media header — mediaConfig.mode ("shared" or "per_contact") is required');
      err.statusCode = 422;
      throw err;
    }
    if (mediaConfig.mode === 'shared' && !mediaConfig.sharedUrl) {
      const err = new Error('sharedUrl is required when media mode is "shared"');
      err.statusCode = 422;
      throw err;
    }
    resolvedMedia = { mode: mediaConfig.mode, sharedUrl: mediaConfig.mode === 'shared' ? mediaConfig.sharedUrl : null };
  }

  return {
    name: name.trim(),
    contactListId,
    queue,
    extension,
    flowId: flowId || null,
    template: {
      templateId,
      name: template.name,
      language: template.language,
      category: template.category,
      header: template.components?.header || { type: 'NONE', text: '' },
      body: { text: template.components?.body?.text || '' },
      buttons: template.components?.buttons || [],
      carousel: template.carousel || null,
    },
    resolvedVariables,
    resolvedMedia,
    rateLimitPerMinute,
    startAt,
    endAt,
  };
}

async function createCampaign(tenantId, authHeader, payload, userId) {
  const { saveAsDraft } = payload;
  const data = await buildCampaignData(tenantId, authHeader, payload);

  const campaign = await Campaign.create({
    tenantId,
    ...data,
    status: saveAsDraft ? 'DRAFT' : 'SCHEDULED',
    createdBy: userId,
  });

  if (!saveAsDraft) {
    await materializeRecipients(campaign);
  }

  return Campaign.findById(campaign._id).lean();
}

// Copies the contact list's entries into this campaign's own recipient
// rows at creation time (not read live from the list on every worker
// tick) — so the audience is fixed the moment the campaign is scheduled,
// and someone editing the source list afterward doesn't change who a
// running campaign messages. Anyone already opted out is recorded as
// SKIPPED_OPTOUT immediately rather than PENDING, so they never get
// attempted and the dashboard shows accurately why they were skipped.
async function materializeRecipients(campaign, excludePhones = new Set()) {
  const entries = await ContactListEntry.find({ listId: campaign.contactListId, tenantId: campaign.tenantId }).lean();
  // excludePhones is only ever non-empty when re-materializing after an
  // edit (see rematerializeRecipients) — those phones already have a
  // real, irreversible CampaignRecipient (sent/delivered/read/opted
  // out) from before the edit, so they're skipped here rather than
  // getting a second, duplicate row.
  const eligibleEntries = entries.filter((e) => !excludePhones.has(e.phone));

  if (!eligibleEntries.length) {
    if (excludePhones.size > 0) return; // re-edit case — nothing new to add is fine
    const err = new Error('This contact list has no contacts');
    err.statusCode = 422;
    throw err;
  }

  // per_contact variables/media need to actually be present on every
  // entry — checked here (at materialization, not just at creation)
  // since this is the last point before real sends start.
  const perContactVarNames = campaign.resolvedVariables.filter((v) => v.mode === 'per_contact').map((v) => v.name);
  const needsPerContactMedia = campaign.resolvedMedia?.mode === 'per_contact';

  const optedOut = await optOutsService.getOptedOutSet(
    campaign.tenantId,
    eligibleEntries.map((e) => e.phone)
  );

  const rows = eligibleEntries.map((entry) => {
    if (optedOut.has(entry.phone)) {
      return { campaignId: campaign._id, tenantId: campaign.tenantId, phone: entry.phone, variables: entry.variables || {}, mediaUrl: entry.mediaUrl || null, status: 'SKIPPED_OPTOUT' };
    }

    const missing = perContactVarNames.filter((name) => !entry.variables?.[name]?.toString().trim());
    if (needsPerContactMedia && !entry.mediaUrl) missing.push('media');

    return {
      campaignId: campaign._id,
      tenantId: campaign.tenantId,
      phone: entry.phone,
      variables: entry.variables || {},
      mediaUrl: entry.mediaUrl || null,
      status: missing.length ? 'FAILED' : 'PENDING',
      error: missing.length ? `Missing: ${missing.join(', ')}` : null,
    };
  });

  await CampaignRecipient.insertMany(rows, { ordered: false });
  await recomputeStats(campaign._id);
}

// A full recount rather than incremental +1/-1 bookkeeping — simpler to
// reason about and always correct regardless of what changed underneath
// it (a fresh materialize, a re-materialize after an edit, individual
// status updates from sender.js, whatever). Called after anything that
// changes the CampaignRecipient rows for a campaign.
async function recomputeStats(campaignId) {
  const [total, sent, delivered, read, failed, skipped] = await Promise.all([
    CampaignRecipient.countDocuments({ campaignId }),
    CampaignRecipient.countDocuments({ campaignId, status: 'SENT' }),
    CampaignRecipient.countDocuments({ campaignId, status: 'DELIVERED' }),
    CampaignRecipient.countDocuments({ campaignId, status: 'READ' }),
    CampaignRecipient.countDocuments({ campaignId, status: 'FAILED' }),
    CampaignRecipient.countDocuments({ campaignId, status: 'SKIPPED_OPTOUT' }),
  ]);
  await Campaign.updateOne(
    { _id: campaignId },
    { 'stats.total': total, 'stats.sent': sent, 'stats.delivered': delivered, 'stats.read': read, 'stats.failed': failed, 'stats.skipped': skipped }
  );
}

// Used when editing a campaign that already has recipients (anything
// past DRAFT — see updateCampaign) rather than materializeRecipients
// directly: recipients that already went out (SENT/DELIVERED/READ) or
// were opted out are real, irreversible activity and must survive the
// edit untouched. Only PENDING/FAILED rows — which reflect the OLD
// configuration and haven't actually gone anywhere — get torn down and
// rebuilt from the new one.
async function rematerializeRecipients(campaign) {
  const processed = await CampaignRecipient.find({
    campaignId: campaign._id,
    status: { $in: ['SENT', 'DELIVERED', 'READ', 'SKIPPED_OPTOUT'] },
  })
    .select('phone')
    .lean();
  const processedPhones = new Set(processed.map((p) => p.phone));

  await CampaignRecipient.deleteMany({ campaignId: campaign._id, status: { $in: ['PENDING', 'FAILED'] } });

  await materializeRecipients(campaign, processedPhones);
}

// Anything except RUNNING can be edited — a live send in progress is the
// one state where changing the configuration underneath it would be
// genuinely dangerous (Meta already has messages going out matching
// what was configured a moment ago). SCHEDULED/PAUSED/COMPLETED/
// CANCELLED are all safe to edit; see rematerializeRecipients for how
// already-processed recipients survive an edit untouched.
async function updateCampaign(tenantId, id, authHeader, payload) {
  const existing = await Campaign.findOne({ _id: id, tenantId });
  if (!existing) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  if (existing.status === 'RUNNING') {
    const err = new Error('A running campaign can\'t be edited — pause it first');
    err.statusCode = 409;
    throw err;
  }

  const hadRecipients = existing.status !== 'DRAFT';

  const data = await buildCampaignData(tenantId, authHeader, payload);
  Object.assign(existing, data);
  await existing.save();

  if (hadRecipients) {
    await rematerializeRecipients(existing);

    // A COMPLETED/CANCELLED campaign that ends up with new PENDING
    // recipients after the edit (a changed contact list, newly added
    // contacts, whatever) needs to go back to SCHEDULED — the worker
    // only ever processes RUNNING campaigns, reached via
    // transitionStatuses' SCHEDULED→RUNNING check, so leaving the
    // status as COMPLETED/CANCELLED would mean those new recipients
    // just sit there forever, never actually sent.
    if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
      const stillPending = await CampaignRecipient.countDocuments({ campaignId: existing._id, status: 'PENDING' });
      if (stillPending > 0) {
        existing.status = 'SCHEDULED';
        await existing.save();
      }
    }
  }

  return existing.toObject();
}

async function updateStatus(tenantId, id, nextStatus) {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }

  const validPause = nextStatus === 'PAUSED' && campaign.status === 'RUNNING';
  const validResume = nextStatus === 'RUNNING' && campaign.status === 'PAUSED';
  const validCancel = nextStatus === 'CANCELLED' && ['SCHEDULED', 'RUNNING', 'PAUSED'].includes(campaign.status);

  if (!validPause && !validResume && !validCancel) {
    const err = new Error(`Cannot move campaign from ${campaign.status} to ${nextStatus}`);
    err.statusCode = 409;
    throw err;
  }

  campaign.status = nextStatus;
  await campaign.save();
  return campaign.toObject();
}

async function deleteCampaign(tenantId, id) {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  if (!['DRAFT', 'CANCELLED', 'COMPLETED'].includes(campaign.status)) {
    const err = new Error('Only draft, cancelled or completed campaigns can be deleted');
    err.statusCode = 409;
    throw err;
  }
  await CampaignRecipient.deleteMany({ campaignId: id });
  await Campaign.deleteOne({ _id: id, tenantId });
  return { deleted: true, id };
}

// A DRAFT campaign, ready to actually run — same as creating with
// saveAsDraft:false, just as a separate explicit step for someone who
// wants to review before committing.
async function scheduleCampaign(tenantId, id) {
  const campaign = await Campaign.findOne({ _id: id, tenantId });
  if (!campaign) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  if (campaign.status !== 'DRAFT') {
    const err = new Error('Only draft campaigns can be scheduled');
    err.statusCode = 409;
    throw err;
  }

  campaign.status = 'SCHEDULED';
  await campaign.save();
  await materializeRecipients(campaign);
  return Campaign.findById(id).lean();
}

async function listRecipients(tenantId, campaignId, { status, page = 1, limit = 50 } = {}) {
  await getCampaign(tenantId, campaignId);

  const filter = { campaignId, tenantId };
  if (status) filter.status = status;

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    CampaignRecipient.find(filter).sort({ createdAt: 1 }).skip(skip).limit(Number(limit)).lean(),
    CampaignRecipient.countDocuments(filter),
  ]);
  return { items, total, page: Number(page), limit: Number(limit) };
}

// A one-off send to a manually entered number, using this campaign's
// already-resolved template/variables/media — for checking the template
// renders correctly before actually scheduling it. Deliberately doesn't
// touch CampaignRecipient or Campaign.stats.
async function sendTest(tenantId, campaignId, { phone, testValues, testMediaUrl }) {
  const campaign = await getCampaign(tenantId, campaignId);
  const normalizedPhone = (phone || '').replace(/\D/g, '');

  const fakeRecipient = { phone: normalizedPhone, variables: testValues || {}, mediaUrl: testMediaUrl || null };
  const { components, previewText, carouselCards } = templateBuilder.buildForRecipient(campaign, fakeRecipient);

  const { data } = await axios.post(
    `${configs.CENTER_SERVICE_URL}/campaign-messages`,
    {
      tenantId,
      phone: normalizedPhone,
      channel: 'whatsapp',
      extension: campaign.extension,
      queue: campaign.queue,
      campaignId: String(campaign._id),
      previewText,
      carouselCards,
      template: {
        name: campaign.template.name,
        language: campaign.template.language,
        category: campaign.template.category,
        components,
      },
    },
    { headers: { 'x-internal-key': configs.INTERNAL_SERVICE_KEY } }
  );

  return data?.data;
}

// Standalone template test-send — not tied to any campaign at all, just
// "does this template render/send correctly". Everything is 'shared'
// mode since there's no contact list or per-recipient concept here, just
// one phone number and whatever values were typed into the test modal.
// Reuses the exact same templateBuilder.buildForRecipient used for real
// campaigns by assembling a minimal fake "campaign" shape around the
// fetched template — same reason sendTest above does the same thing,
// just without needing an actual saved Campaign document at all.
async function testSendTemplate(tenantId, authHeader, { templateId, phone, extension, queue, variableValues = {}, mediaUrls = {} }) {
  const template = await templatesService.getTemplate(authHeader, templateId);
  const templateVars = extractTemplateVariables(template);
  const normalizedPhone = (phone || '').replace(/\D/g, '');

  const realVars = templateVars.filter((v) => v.component !== 'media');
  const mediaVar = templateVars.find((v) => v.component === 'media');

  const resolvedVariables = realVars.map((v) => {
    const base = { component: v.component, position: v.position, name: v.name, mode: 'shared' };
    if (v.cardIndex !== undefined) base.cardIndex = v.cardIndex;
    if (v.buttonIndex !== undefined) base.buttonIndex = v.buttonIndex;
    // card_media's value is a URL, sourced from mediaUrls same as the
    // main header below — everything else is a plain typed value.
    const value = v.component === 'card_media' ? mediaUrls[v.name] : variableValues[v.name];
    return { ...base, value: value || '' };
  });

  const resolvedMedia = mediaVar
    ? { mode: 'shared', sharedUrl: mediaUrls[mediaVar.name] || null }
    : { mode: null, sharedUrl: null };

  const fakeCampaign = {
    tenantId,
    extension,
    queue,
    template: {
      name: template.name,
      language: template.language,
      category: template.category,
      header: template.components?.header || { type: 'NONE', text: '' },
      body: { text: template.components?.body?.text || '' },
      buttons: template.components?.buttons || [],
      carousel: template.carousel || null,
    },
    resolvedVariables,
    resolvedMedia,
  };

  const { components, previewText, carouselCards } = templateBuilder.buildForRecipient(fakeCampaign, {
    phone: normalizedPhone,
    variables: {},
    mediaUrl: null,
  });

  const { data } = await axios.post(
    `${configs.CENTER_SERVICE_URL}/campaign-messages`,
    {
      tenantId,
      phone: normalizedPhone,
      channel: 'whatsapp',
      extension,
      queue,
      previewText,
      carouselCards,
      template: {
        name: template.name,
        language: template.language,
        category: template.category,
        components,
      },
      // campaignId deliberately omitted — see center-service's
      // campaignMessage.js, where it's optional specifically for this.
    },
    { headers: { 'x-internal-key': configs.INTERNAL_SERVICE_KEY } }
  );

  return data?.data;
}

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  updateStatus,
  deleteCampaign,
  scheduleCampaign,
  listRecipients,
  sendTest,
  testSendTemplate,
};
