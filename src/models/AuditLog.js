const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, default: Date.now, immutable: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
    query: { type: String, required: true },
    retrievedChunkIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    retrievedDocIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    scores: { type: [Number], default: [] },
    filterApplied: { type: mongoose.Schema.Types.Mixed, required: true },
    excludedByAclCount: { type: Number, default: 0 },
    answerId: { type: String, required: true },
    ip: { type: String, default: '' },
  },
  { timestamps: false }
);

auditLogSchema.index({ tenantId: 1, ts: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// Append-only: no update/delete helpers are exported from the service layer.
module.exports = AuditLog;
module.exports.AuditLog = AuditLog;
