const mongoose = require('mongoose');

const ROLES = ['admin', 'manager', 'employee'];

const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, default: 'employee' },
    // Cross-cutting access labels, e.g. "hr", "finance".
    groups: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Email is unique PER TENANT, not globally.
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
