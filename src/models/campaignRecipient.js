const mongoose = require('mongoose');

const campaignRecipientSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenantId: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    mediaUrl: { type: String, default: null },

    status: {
      type: String,
      // SENDING is a transient claim state — set the instant a worker
      // tick picks a recipient, *before* the actual (slower, async) send
      // happens. Without it, a recipient could still show PENDING when
      // the next tick's query runs, and get picked up and sent to a
      // second time — see workers/campaignWorker.js.
      enum: ['PENDING', 'SENDING', 'SENT', 'FAILED', 'DELIVERED', 'READ', 'SKIPPED_OPTOUT'],
      default: 'PENDING',
      index: true,
    },

    interactionId: { type: String, default: null },
    messageId: { type: String, default: null },
    // Meta's own message id — the same field campaign-service's status
    // webhook listener matches delivered/read receipts against (see
    // services/statusSync.js), same value center-service stores as
    // Message.channelMessageId for the same message.
    channelMessageId: { type: String, default: null },

    error: { type: String, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

campaignRecipientSchema.index({ campaignId: 1, phone: 1 }, { unique: true });
campaignRecipientSchema.index({ channelMessageId: 1 });

module.exports = mongoose.model('CampaignRecipient', campaignRecipientSchema);
