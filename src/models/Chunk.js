const mongoose = require('mongoose');
const { aclSchema } = require('./Document');

const chunkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    chunkIndex: { type: Number, required: true },
    // Denormalized so $vectorSearch can filter without a document join.
    acl: { type: aclSchema, required: true },
  },
  { timestamps: false }
);

chunkSchema.index({ tenantId: 1, documentId: 1 });

const Chunk = mongoose.model('Chunk', chunkSchema);

module.exports = Chunk;
module.exports.Chunk = Chunk;
