// services/campaigns.js
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');
const ContactListEntry = require('../models/contactListEntry');
const contactListsService = require('./contactLists');
const templatesService = require('./templates');
const optOutsService = require('./optOuts');

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

async function createCampaign(tenantId, authHeader, payload, userId) {
  const {
    name,
    contactListId,
    queue,
    extension,
    flowId,
    templateId,
    variableMapping,
    mediaMode,
    sharedMediaUrl,
    rateLimitPerMinute,
    startAt,
    endAt,
    saveAsDraft,
  } = payload;

  if (!name?.trim() || !contactListId || !queue || !extension || !templateId || !rateLimitPerMinute || !startAt || !endAt) {
    const err = new Error(
      'name, contactListId, queue, extension, templateId, rateLimitPerMinute, startAt and endAt are all required'
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
  if (!['APPROVED'].includes(template.status)) {
    const err = new Error(`Only APPROVED templates can be used in a campaign (this one is ${template.status})`);
    err.statusCode = 422;
    throw err;
  }

  const resolvedMediaMode = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(template.components?.header?.type)
    ? mediaMode || 'shared'
    : 'none';

  if (resolvedMediaMode === 'shared' && !sharedMediaUrl) {
    const err = new Error('sharedMediaUrl is required when mediaMode is "shared"');
    err.statusCode = 422;
    throw err;
  }

  const campaign = await Campaign.create({
    tenantId,
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
      footer: { text: template.components?.footer?.text || '' },
      buttons: template.components?.buttons || [],
    },
    variableMapping: variableMapping || {},
    mediaMode: resolvedMediaMode,
    sharedMediaUrl: resolvedMediaMode === 'shared' ? sharedMediaUrl : null,
    rateLimitPerMinute,
    startAt,
    endAt,
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
async function materializeRecipients(campaign) {
  const entries = await ContactListEntry.find({ listId: campaign.contactListId, tenantId: campaign.tenantId }).lean();

  if (!entries.length) {
    const err = new Error('This contact list has no contacts');
    err.statusCode = 422;
    throw err;
  }

  const optedOut = await optOutsService.getOptedOutSet(
    campaign.tenantId,
    entries.map((e) => e.phone)
  );

  const rows = entries.map((entry) => ({
    campaignId: campaign._id,
    tenantId: campaign.tenantId,
    phone: entry.phone,
    variables: entry.variables || {},
    mediaUrl: entry.mediaUrl || null,
    status: optedOut.has(entry.phone) ? 'SKIPPED_OPTOUT' : 'PENDING',
  }));

  await CampaignRecipient.insertMany(rows, { ordered: false });

  const skipped = rows.filter((r) => r.status === 'SKIPPED_OPTOUT').length;

  await Campaign.updateOne(
    { _id: campaign._id },
    { 'stats.total': rows.length, 'stats.skipped': skipped }
  );
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

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateStatus,
  deleteCampaign,
  scheduleCampaign,
  listRecipients,
};
