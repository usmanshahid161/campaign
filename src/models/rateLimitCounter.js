const mongoose = require('mongoose');

// One document per scope (e.g. "tenant:<id>" or "campaign:<id>") per
// calendar minute — atomically incremented as each send actually happens
// (services/rateLimiter.js). Being MongoDB-backed rather than in-memory
// means a worker restart doesn't reset or lose track of how much of this
// minute's allowance is already used, and multiple worker instances (if
// ever run) would stay consistent with each other too.
const rateLimitCounterSchema = new mongoose.Schema(
  {
    scopeKey: { type: String, required: true }, // "tenant:<tenantId>" | "campaign:<campaignId>"
    minuteBucket: { type: String, required: true }, // e.g. "2026-09-04T10:15"
    count: { type: Number, default: 0 },
  },
  { timestamps: true }
);

rateLimitCounterSchema.index({ scopeKey: 1, minuteBucket: 1 }, { unique: true });
// Old buckets are pure noise after a few minutes — TTL-cleaned so this
// collection doesn't grow unbounded over a long-running deployment.
rateLimitCounterSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('RateLimitCounter', rateLimitCounterSchema);
