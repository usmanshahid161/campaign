const mongoose = require('mongoose');

const contactListEntrySchema = new mongoose.Schema(
  {
    listId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenantId: { type: String, required: true, index: true },
    phone: { type: String, required: true, trim: true },
    // Arbitrary key-value pairs from manual entry or CSV columns — e.g.
    // { name: "Ali Raza", order_id: "4821" } — mapped to template
    // variables ({{1}}, {{2}}...) at campaign-creation time via
    // Campaign.variableMapping, not baked in here, since the same list
    // could in principle be reused across campaigns with different
    // templates/mappings.
    variables: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Only meaningful when the owning campaign's mediaMode is
    // 'per_contact' (see campaign.js) — e.g. a medical lab's blood test
    // report, unique to this one person, as opposed to a shared
    // promotional image every recipient gets the same copy of.
    mediaUrl: { type: String, default: null },
  },
  { timestamps: true }
);

contactListEntrySchema.index({ listId: 1, phone: 1 }, { unique: true });

module.exports = mongoose.model('ContactListEntry', contactListEntrySchema);
