const mongoose = require('mongoose');

// Meta's own account tier already caps daily business-initiated
// conversations (1K/10K/100K/unlimited depending on tier) — this is a
// separate, tighter per-*minute* ceiling on top of that, since a burst
// across several concurrent campaigns could otherwise spike well past
// what's sensible even within a generous daily tier. Defaults
// conservatively; raise it once you know your account's actual sustained
// throughput is safe.
const tenantRateLimitSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    maxPerMinute: { type: Number, default: 60 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TenantRateLimit', tenantRateLimitSchema);
