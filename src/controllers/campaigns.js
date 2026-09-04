// controllers/campaigns.js
const campaignsService = require('../services/campaigns');
const optOutsService = require('../services/optOuts');
const statusSyncService = require('../services/statusSync');
const Campaign = require('../models/campaign');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

exports.list = asyncHandler(async (req, res) => {
  const campaigns = await campaignsService.listCampaigns(req.user.tenantId);
  res.status(200).json({ success: true, data: campaigns });
});

exports.getOne = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.getCampaign(req.user.tenantId, req.params.id);
  res.status(200).json({ success: true, data: campaign });
});

exports.create = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.createCampaign(
    req.user.tenantId,
    req.headers.authorization,
    req.body,
    req.user?.userId
  );
  res.status(201).json({ success: true, data: campaign });
});

exports.schedule = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.scheduleCampaign(req.user.tenantId, req.params.id);
  res.status(200).json({ success: true, data: campaign });
});

exports.pause = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.updateStatus(req.user.tenantId, req.params.id, 'PAUSED');
  res.status(200).json({ success: true, data: campaign });
});

exports.resume = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.updateStatus(req.user.tenantId, req.params.id, 'RUNNING');
  res.status(200).json({ success: true, data: campaign });
});

exports.cancel = asyncHandler(async (req, res) => {
  const campaign = await campaignsService.updateStatus(req.user.tenantId, req.params.id, 'CANCELLED');
  res.status(200).json({ success: true, data: campaign });
});

exports.remove = asyncHandler(async (req, res) => {
  const result = await campaignsService.deleteCampaign(req.user.tenantId, req.params.id);
  res.status(200).json({ success: true, data: result });
});

exports.listRecipients = asyncHandler(async (req, res) => {
  const { status, page, limit } = req.query;
  const result = await campaignsService.listRecipients(req.user.tenantId, req.params.id, { status, page, limit });
  res.status(200).json({ success: true, data: result });
});

// Owner-facing stats card set — total/sent/failed/delivered/read/skipped,
// straight off the campaign's own denormalized counters (kept up to date
// by services/sender.js and services/statusSync.js).
exports.getStats = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findOne({ _id: req.params.id, tenantId: req.user.tenantId })
    .select('stats status name')
    .lean();
  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }
  res.status(200).json({ success: true, data: { name: campaign.name, status: campaign.status, ...campaign.stats } });
});

// Internal-only — center-service calls this whenever a campaign
// message's delivery status changes (delivered/read). Reached via
// x-internal-key, never by the UI.
exports.statusSync = asyncHandler(async (req, res) => {
  const recipient = await statusSyncService.syncStatus(req.body);
  res.status(200).json({ success: true, data: recipient });
});

// ---- Opt-outs ----

exports.listOptOuts = asyncHandler(async (req, res) => {
  const optOuts = await optOutsService.listOptOuts(req.user.tenantId);
  res.status(200).json({ success: true, data: optOuts });
});

exports.addOptOut = asyncHandler(async (req, res) => {
  // A normal JWT call (someone manually adding a number) is always
  // scoped to their own tenant, req.user.tenantId. An internal-key call
  // (center-service, when a customer replies STOP) has no JWT at all —
  // req.user carries no tenantId then, so the tenant has to come from
  // the body instead. See controllers/message.js's notifyOptOut.
  const tenantId = req.user.tenantId || req.body.tenantId;
  const record = await optOutsService.addOptOut(tenantId, req.body.phone, req.body.reason);
  res.status(201).json({ success: true, data: record });
});

exports.removeOptOut = asyncHandler(async (req, res) => {
  await optOutsService.removeOptOut(req.user.tenantId, req.params.phone);
  res.status(200).json({ success: true, data: { removed: true } });
});
