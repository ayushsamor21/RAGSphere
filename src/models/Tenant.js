const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
  },
  { timestamps: true }
);

const Tenant = mongoose.model('Tenant', tenantSchema);

module.exports = Tenant;
module.exports.Tenant = Tenant;
