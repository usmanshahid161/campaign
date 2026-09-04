const mongoose = require('mongoose');

// A named audience list for campaigns — deliberately not the same
// collection as admin_backend's "Groups" (those organize agents, this
// organizes recipients). Entries live in their own collection
// (contactListEntry.js), not embedded here, since a CSV import can run
// into the thousands and Mongo documents have a 16MB ceiling.
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
