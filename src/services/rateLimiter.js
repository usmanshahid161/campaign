// services/rateLimiter.js
const RateLimitCounter = require('../models/rateLimitCounter');
const TenantRateLimit = require('../models/tenantRateLimit');

function currentMinuteBucket() {
  return new Date().toISOString().slice(0, 16); // "2026-09-04T10:15"
}

async function getTenantMaxPerMinute(tenantId) {
  const setting = await TenantRateLimit.findOne({ tenantId }).lean();
  return setting?.maxPerMinute || 60; // conservative default if never configured
}

// Generic atomic "reserve one slot in this key's current-minute budget"
// — used for both the tenant-wide cap (key = tenantId) and each
// campaign's own individual rate (key = campaignId), sharing the same
// counter collection since the mechanics are identical either way.
async function tryConsumeSlotFor(key, maxPerMinute) {
  const minuteBucket = currentMinuteBucket();

  // $inc first, then check — atomic at the document level, so two
  // concurrent sends can't both read "59 of 60" and both proceed.
  const counter = await RateLimitCounter.findOneAndUpdate(
    { scopeKey: key, minuteBucket },
    { $inc: { count: 1 } },
    { upsert: true, new: true }
  );

  if (counter.count > maxPerMinute) {
    // Over budget — give the slot back so it doesn't permanently skew
    // this minute's count for whoever checks next.
    await RateLimitCounter.updateOne({ scopeKey: key, minuteBucket }, { $inc: { count: -1 } });
    return false;
  }

  return true;
}

// Both must allow the send — the campaign's own pace AND the tenant's
// combined ceiling across every campaign running at once. Checked
// campaign first (cheaper to fail fast on the more commonly-hit limit
// with only one campaign active), tenant second.
async function tryConsumeSlot(tenantId, campaignId, campaignMaxPerMinute) {
  const campaignOk = await tryConsumeSlotFor(`campaign:${campaignId}`, campaignMaxPerMinute);
  if (!campaignOk) return false;

  const tenantMax = await getTenantMaxPerMinute(tenantId);
  const tenantOk = await tryConsumeSlotFor(`tenant:${tenantId}`, tenantMax);
  if (!tenantOk) {
    // Give back the campaign-level slot too — it didn't actually send.
    const minuteBucket = currentMinuteBucket();
    await RateLimitCounter.updateOne({ scopeKey: `campaign:${campaignId}`, minuteBucket }, { $inc: { count: -1 } });
    return false;
  }

  return true;
}

async function getRemainingThisMinute(tenantId) {
  const maxPerMinute = await getTenantMaxPerMinute(tenantId);
  const counter = await RateLimitCounter.findOne({ scopeKey: `tenant:${tenantId}`, minuteBucket: currentMinuteBucket() }).lean();
  return Math.max(0, maxPerMinute - (counter?.count || 0));
}

module.exports = { tryConsumeSlot, getRemainingThisMinute, getTenantMaxPerMinute };
