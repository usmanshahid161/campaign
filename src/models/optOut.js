const mongoose = require('mongoose');

// A number here is never messaged by any campaign again, regardless of
// which list it's on — WhatsApp Business Policy requires honoring
// opt-outs, and ignoring them risks the account's quality rating (which
// can get the whole number rate-limited or disabled). See
// services/optOuts.js for where inbound STOP-like replies land here.
const optOutSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    phone: { type: String, required: true },
    reason: { type: String, default: 'customer_request' },
    optedOutAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

optOutSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('OptOut', optOutSchema);
