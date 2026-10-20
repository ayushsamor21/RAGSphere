const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Short, URL-safe identifier used at login (e.g. "acme").
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

module.exports = mongoose.model('Tenant', tenantSchema);
