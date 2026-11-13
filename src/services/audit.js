const AuditLog = require('../models/AuditLog');

async function writeAudit(entry) {
  // Fail the request if this throws — callers must not return an answer without a log.
  return AuditLog.create(entry);
}

async function listAudit(tenantId, { userId, from, to, page = 1, limit = 20 }) {
  const q = { tenantId };
  if (userId) q.userId = userId;
  if (from || to) {
    q.ts = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) q.ts.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) q.ts.$lte = d;
    }
    if (Object.keys(q.ts).length === 0) delete q.ts;
  }
  const skip = (Math.max(page, 1) - 1) * limit;
  const [items, total] = await Promise.all([
    AuditLog.find(q).sort({ ts: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(q),
  ]);
  return { items, total, page: Math.max(page, 1), limit };
}

module.exports = { writeAudit, listAudit };
