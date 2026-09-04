// services/sender.js
const axios = require('axios');
const configs = require('../config');
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');
const optOutsService = require('./optOuts');
const templateBuilder = require('./templateBuilder');

async function sendToRecipient(campaign, recipient) {
  // Re-check opt-out at send time too, not just at materialization — a
  // long-running campaign could have someone opt out mid-flight, after
  // their row was already queued as PENDING.
  if (await optOutsService.isOptedOut(campaign.tenantId, recipient.phone)) {
    await CampaignRecipient.updateOne({ _id: recipient._id }, { status: 'SKIPPED_OPTOUT' });
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.skipped': 1 } });
    return;
  }

  let components, previewText;
  try {
    ({ components, previewText } = templateBuilder.buildForRecipient(campaign, recipient));
  } catch (err) {
    await CampaignRecipient.updateOne({ _id: recipient._id }, { status: 'FAILED', error: err.message });
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.failed': 1 } });
    return;
  }

  try {
    const { data } = await axios.post(
      `${configs.CENTER_SERVICE_URL}/campaign-messages`,
      {
        tenantId: campaign.tenantId,
        phone: recipient.phone,
        channel: 'whatsapp',
        extension: campaign.extension,
        queue: campaign.queue,
        campaignId: String(campaign._id),
        previewText,
        template: {
          name: campaign.template.name,
          language: campaign.template.language,
          category: campaign.template.category,
          components,
        },
      },
      { headers: { 'x-internal-key': configs.INTERNAL_SERVICE_KEY } }
    );

    await CampaignRecipient.updateOne(
      { _id: recipient._id },
      {
        status: 'SENT',
        interactionId: data?.data?.interactionId,
        messageId: data?.data?.messageId,
        sentAt: new Date(),
      }
    );
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.sent': 1 } });
  } catch (err) {
    const message = err.response?.data?.message || err.message;
    await CampaignRecipient.updateOne({ _id: recipient._id }, { status: 'FAILED', error: message });
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.failed': 1 } });
  }
}

module.exports = { sendToRecipient };
