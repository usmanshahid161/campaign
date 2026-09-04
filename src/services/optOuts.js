// services/optOuts.js
const OptOut = require('../models/optOut');

async function isOptedOut(tenantId, phone) {
  const record = await OptOut.findOne({ tenantId, phone }).lean();
  return Boolean(record);
}

async function getOptedOutSet(tenantId, phones) {
  const records = await OptOut.find({ tenantId, phone: { $in: phones } }).lean();
  return new Set(records.map((r) => r.phone));
}

async function addOptOut(tenantId, phone, reason = 'customer_request') {
  return OptOut.findOneAndUpdate(
    { tenantId, phone },
    { $setOnInsert: { optedOutAt: new Date(), reason } },
    { upsert: true, new: true }
  );
}

async function removeOptOut(tenantId, phone) {
  return OptOut.deleteOne({ tenantId, phone });
}

async function listOptOuts(tenantId) {
  return OptOut.find({ tenantId }).sort({ optedOutAt: -1 }).lean();
}

module.exports = { isOptedOut, getOptedOutSet, addOptOut, removeOptOut, listOptOuts };
