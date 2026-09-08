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

    // Snapshotted at creation time (copied from the contact list's own
    // templateSnapshot, which is itself frozen at list-creation/edit
    // time), not a live reference — if the list's template later
    // changes, or the underlying Template is edited, a running or
    // completed campaign should still show exactly what was actually
    // configured. Mirrors admin_backend's own Template.components shape.
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
      // Present only for carousel templates — mongoose.Schema.Types.Mixed
      // rather than fully modeled out, since each card's literal
      // header/body text (with {{n}} placeholders still in place) is
      // only ever read back by templateBuilder.js at send time, never
      // queried on its own.
      carousel: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    // Copied from the contact list's own variableConfig at creation time
    // — per_contact entries carry no value here (looked up by `name` on
    // each recipient at send time); shared entries always have a final
    // `value` by the time the campaign is saved, whether that value came
    // from the list itself or was filled in just now (deferredValues
    // below, at campaign-creation).
    resolvedVariables: [
      {
        _id: false,
        component: { type: String, enum: ['header', 'body', 'card_body', 'card_media'] },
        position: String,
        // Which carousel card this belongs to (0-indexed) — only set for
        // card_body/card_media entries. header/body variables aren't
        // part of any card, so this stays unset for them rather than a
        // misleading 0.
        cardIndex: { type: Number, default: undefined },
        name: String,
        mode: { type: String, enum: ['per_contact', 'shared'] },
        // shared only — a plain value for card_body, a media URL for
        // card_media (and for the historical plain 'media' case too,
        // though that one's actually tracked separately in
        // resolvedMedia below, not through this array).
        value: { type: String, default: null },
      },
    ],

    // Same idea as resolvedVariables, for the header's media if any.
    resolvedMedia: {
      mode: { type: String, enum: ['shared', 'per_contact', null], default: null },
      sharedUrl: { type: String, default: null },
    },

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
