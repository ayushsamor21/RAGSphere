const mongoose = require('mongoose');

const aclSchema = new mongoose.Schema(
  {
    visibility: {
      type: String,
      enum: ['tenant', 'restricted', 'private'],
      required: true,
      default: 'restricted',
    },
    allowedRoles: { type: [String], default: [] },
    allowedGroups: { type: [String], default: [] },
    allowedUsers: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['queued', 'processing', 'ready', 'failed', 'restamping'],
      default: 'queued',
    },
    sizeBytes: { type: Number, required: true },
    filePath: { type: String, required: true },
    acl: { type: aclSchema, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

documentSchema.index({ tenantId: 1, createdAt: -1 });

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;
module.exports.Document = Document;
module.exports.aclSchema = aclSchema;
