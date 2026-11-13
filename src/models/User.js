const mongoose = require('mongoose');

const ROLES = ['admin', 'manager', 'employee'];
const KNOWN_GROUPS = ['hr', 'finance'];

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
    groups: { type: [String], default: [] },
  },
  { timestamps: true }
);

userSchema.index({ tenantId: 1, email: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.User = User;
module.exports.ROLES = ROLES;
module.exports.KNOWN_GROUPS = KNOWN_GROUPS;
