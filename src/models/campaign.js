const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },

    contactListId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Mandatory — makes replies easy to target/route to the right team,
    // even when there's no flow attached (see flowId below).
    queue: { type: String, required: true },
    // Which WhatsApp number this campaign sends from — needed so
    // center-service can find/create the right interaction per recipient
    // (matches by channel+extension+caller.id, same as any inbound
    // message would). Not inferred from queue, since a queue isn't
    // guaranteed to map to exactly one number.
    extension: { type: String, required: true },
    // Optional — if set, a reply runs through this flow (bot triage)
    // same as any first-time inbound message would. If not set, a reply
    // skips the bot entirely and goes straight to the queue above for an
    // agent to pick up.
    flowId: { type: String, default: null },

    // Snapshotted at creation time (fetched from admin_backend), not a
    // live reference — if the underlying Template is edited/deleted
    // later, a running or completed campaign should still show exactly
    // what was actually configured. Mirrors admin_backend's own
    // Template.components shape (literal header/body/footer text with
    // {{n}} placeholders still in place) rather than Meta's sparse
    // send-time parameter format — that gets built per-recipient at
    // send time (see services/templateBuilder.js), filling in each
    // recipient's own variable values and media.
    template: {
      templateId: { type: String, required: true },
      name: { type: String, required: true },
      language: { type: String, required: true },
      category: { type: String, required: true },
      header: {
        type: { type: String, default: 'NONE' }, // NONE | TEXT | IMAGE | VIDEO | DOCUMENT
        text: { type: String, default: '' },
      },
      body: { text: { type: String, required: true } },
      footer: { text: { type: String, default: '' } },
      buttons: { type: Array, default: [] },
    },

    // Maps a template variable's position to a column name in the
    // contact list's `variables` — e.g. { "1": "name", "2": "order_id" }.
    variableMapping: { type: mongoose.Schema.Types.Mixed, default: {} },

    // 'none' — template has no media header.
    // 'shared' — every recipient gets the same file (e.g. a promotion).
    // 'per_contact' — each recipient's own file, from their
    //   ContactListEntry.mediaUrl (e.g. a lab report unique to them).
    mediaMode: { type: String, enum: ['none', 'shared', 'per_contact'], default: 'none' },
    sharedMediaUrl: { type: String, default: null },

    rateLimitPerMinute: { type: Number, required: true, min: 1 },

    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },

    status: {
      type: String,
      enum: ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED'],
      default: 'DRAFT',
    },

    // Denormalized running totals — updated as recipients are processed
    // (services/campaignStats.js), so the dashboard doesn't need a full
    // aggregation on every page load. CampaignRecipient remains the
    // source of truth for the per-recipient breakdown.
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 }, // opted-out contacts, not attempted
    },

    createdBy: { type: String },
  },
  { timestamps: true }
);

campaignSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
