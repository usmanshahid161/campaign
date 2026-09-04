const mongoose = require('mongoose');

// A named, reusable audience list — just phone numbers + whatever
// free-form profile data the business wants to track (name, city,
// invoice_no, anything). Deliberately NOT bound to any template — the
// same list gets reused across many different campaigns over time.
// Template-variable mapping happens at campaign-creation time instead
// (see campaign-service's services/campaigns.js), where each variable
// either pulls from a matching column already on this list's contacts,
// or gets a one-off shared value for that specific campaign.
const contactListSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Denormalized so the list page doesn't need a separate count query
    // per list — kept in sync by services/contactLists.js on every
    // add/remove.
    contactCount: { type: Number, default: 0 },
    createdBy: { type: String },
  },
  { timestamps: true }
);

contactListSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('ContactList', contactListSchema);
