// services/sender.js
const axios = require('axios');
const configs = require('../config');
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');
const optOutsService = require('./optOuts');
const templateBuilder = require('./templateBuilder');

// Strips a leading + and any other non-digit characters — center-service
// (and Meta's API beneath it) wants a plain digit-only number here, not
// the E.164-with-+ format the rest of the system stores/matches on
// (ContactListEntry, CampaignRecipient, dedup checks all keep the +).
function toDigitsOnly(phone) {
  return (phone || '').replace(/\D/g, '');
}

async function sendToRecipient(campaign, recipient) {
  // Re-check opt-out at send time too, not just at materialization — a
  // long-running campaign could have someone opt out mid-flight, after
  // their row was already queued as PENDING.
  if (await optOutsService.isOptedOut(campaign.tenantId, recipient.phone)) {
    await CampaignRecipient.updateOne({ _id: recipient._id }, { status: 'SKIPPED_OPTOUT' });
    await Campaign.updateOne({ _id: campaign._id }, { $inc: { 'stats.skipped': 1 } });
    return;
  }

  let components, previewText, carouselCards;
  try {
    ({ components, previewText, carouselCards } = templateBuilder.buildForRecipient(campaign, recipient));
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
        phone: toDigitsOnly(recipient?.phone),
        channel: 'whatsapp',
        extension: campaign.extension,
        queue: campaign.queue,
        campaignId: String(campaign._id),
        previewText,
        // Display-only — see templateBuilder.js's buildCarouselDisplay.
        // Not part of `template`/`components` below (that's what
        // actually gets sent to Meta); center-service just stores this
        // as-is on the message for the inbox thread to render.
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