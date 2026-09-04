// controllers/campaignRouting.js
const Campaign = require('../models/campaign');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Internal-only — center-service calls this when a customer replies to
// a closed campaign interaction, to find out which queue/flow that
// specific campaign uses (independent of the WhatsApp number's own
// default flow). Reached via x-internal-key, never by the UI.
exports.getRouting = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).select('queue flowId tenantId').lean();

  if (!campaign) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  res.status(200).json({
    success: true,
    data: { queue: campaign.queue, flowId: campaign.flowId },
  });
});
