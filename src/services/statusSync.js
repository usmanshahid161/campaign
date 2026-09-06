// services/statusSync.js
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');

// Called from controllers/campaigns.js's statusSync endpoint, which
// center-service hits whenever a campaign message's delivery status
// changes. Matched by our own messageId first (set at send time — see
// services/sender.js), falling back to Meta's channelMessageId if that's
// all the caller has.
async function syncStatus({ messageId, channelMessageId, status }) {
  if (!['DELIVERED', 'READ', 'FAILED'].includes(status)) return null;
  if (!messageId && !channelMessageId) return null;

  const filter = messageId ? { messageId } : { channelMessageId };

  if (status === 'DELIVERED') {
    // Only counts if this is actually new — a redelivered webhook for
    // something already marked DELIVERED (or since progressed to READ)
    // shouldn't double-increment the dashboard's delivered count.
    const recipient = await CampaignRecipient.findOneAndUpdate(
      { ...filter, status: 'SENT' },
      { status: 'DELIVERED', deliveredAt: new Date() },
      { new: true }
    );
    if (recipient) {
      await Campaign.updateOne({ _id: recipient.campaignId }, { $inc: { 'stats.delivered': 1 } });
    }
    return recipient;
  }

  if (status === 'FAILED') {
    // Only a SENT recipient can actually fail here — once something's
    // DELIVERED or READ, a later "failed" status from Meta doesn't mean
    // the message itself failed (that ship's sailed), so it's left
    // alone rather than overwriting a real delivery outcome.
    const recipient = await CampaignRecipient.findOneAndUpdate(
      { ...filter, status: 'SENT' },
      { status: 'FAILED', error: 'Delivery failed' },
      { new: true }
    );
    if (recipient) {
      await Campaign.updateOne({ _id: recipient.campaignId }, { $inc: { 'stats.failed': 1 } });
    }
    return recipient;
  }

  // READ — Meta doesn't always send a separate DELIVERED webhook first
  // (they can arrive out of order or get coalesced), so a read receipt
  // on a still-SENT recipient counts as both delivered *and* read for
  // the dashboard; one already at DELIVERED only picks up the read count.
  const wasOnlySent = await CampaignRecipient.exists({ ...filter, status: 'SENT' });

  const recipient = await CampaignRecipient.findOneAndUpdate(
    { ...filter, status: { $in: ['SENT', 'DELIVERED'] } },
    { status: 'READ', readAt: new Date() },
    { new: true }
  );

  if (recipient) {
    await Campaign.updateOne(
      { _id: recipient.campaignId },
      { $inc: { 'stats.read': 1, ...(wasOnlySent ? { 'stats.delivered': 1 } : {}) } }
    );
  }

  return recipient;
}

module.exports = { syncStatus };