// workers/campaignWorker.js
const Campaign = require('../models/campaign');
const CampaignRecipient = require('../models/campaignRecipient');
const rateLimiter = require('../services/rateLimiter');
const sender = require('../services/sender');

const TICK_INTERVAL_MS = 10 * 1000;

async function transitionStatuses() {
  const now = new Date();

  await Campaign.updateMany({ status: 'SCHEDULED', startAt: { $lte: now } }, { status: 'RUNNING' });

  // Past its own end time — stop sending regardless of how many PENDING
  // recipients are left. Whoever didn't get reached stays PENDING,
  // visible on the dashboard as "not sent" rather than silently vanishing.
  await Campaign.updateMany({ status: 'RUNNING', endAt: { $lte: now } }, { status: 'COMPLETED' });

  // Nothing left to attempt — no reason to wait for endAt if the whole
  // list is already done.
  const running = await Campaign.find({ status: 'RUNNING' }).select('_id').lean();
  for (const { _id } of running) {
    const pendingLeft = await CampaignRecipient.countDocuments({ campaignId: _id, status: 'PENDING' });
    if (pendingLeft === 0) {
      await Campaign.updateOne({ _id }, { status: 'COMPLETED' });
    }
  }
}

async function processCampaign(campaign) {
  // ceil so a low rate (e.g. 1/min) still gets at least one attempt per
  // tick rather than rounding down to zero forever.
  const perTickBudget = Math.max(1, Math.ceil((campaign.rateLimitPerMinute * TICK_INTERVAL_MS) / 60000));

  const recipients = await CampaignRecipient.find({ campaignId: campaign._id, status: 'PENDING' })
    .sort({ createdAt: 1 })
    .limit(perTickBudget)
    .lean();

  if (!recipients.length) return;

  // Small stagger between individual sends within the tick — spreads
  // them across the interval instead of firing all at once, which reads
  // more like organic traffic and is gentler on the receiving end.
  const gapMs = Math.floor(TICK_INTERVAL_MS / (recipients.length + 1));

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const allowed = await rateLimiter.tryConsumeSlot(campaign.tenantId, String(campaign._id), campaign.rateLimitPerMinute);
    if (!allowed) break; // budget exhausted for this minute — rest stay PENDING, tried again next tick

    // Fire-and-forget with a stagger — the tick itself doesn't wait for
    // Meta's response before considering the next recipient, sender.js
    // updates status independently as each one resolves.
    setTimeout(() => {
      sender.sendToRecipient(campaign, recipient).catch((err) => {
        console.error(`Campaign ${campaign._id} send error for ${recipient.phone}:`, err);
      });
    }, gapMs * i);
  }
}

async function tick() {
  try {
    await transitionStatuses();

    const running = await Campaign.find({ status: 'RUNNING' }).lean();
    for (const campaign of running) {
      await processCampaign(campaign);
    }
  } catch (err) {
    console.error('Campaign worker tick error:', err);
  }
}

function start() {
  console.log('Campaign worker started');
  setInterval(tick, TICK_INTERVAL_MS);
  tick(); // run one immediately on boot, don't wait for the first interval
}

module.exports = { start };
