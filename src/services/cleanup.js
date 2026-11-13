const fs = require('fs/promises');
const Chunk = require('../models/Chunk');
const Document = require('../models/Document');
const User = require('../models/User');
const { clearChat } = require('./redis');

async function deleteChunksForDocument(documentId, tenantId) {
  // Always require both IDs so a forged documentId cannot wipe another tenant.
  return Chunk.deleteMany({ documentId, tenantId });
}

async function deleteDocumentAndChunks(documentId, tenantId) {
  const doc = await Document.findOne({ _id: documentId, tenantId });
  if (!doc) return false;
  await deleteChunksForDocument(documentId, tenantId);
  await Document.deleteOne({ _id: documentId, tenantId });
  if (doc.filePath) {
    try {
      await fs.unlink(doc.filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return true;
}

async function deleteUserInTenant(userId, tenantId) {
  const user = await User.findOne({ _id: userId, tenantId });
  if (!user) return false;
  const docs = await Document.find({ ownerId: userId, tenantId }).select('_id');
  for (const doc of docs) {
    await deleteDocumentAndChunks(doc._id, tenantId);
  }
  // Strip deleted user from any remaining documents' ACLs
  await Document.updateMany({ tenantId }, { $pull: { 'acl.allowedUsers': userId } });
  await Chunk.updateMany({ tenantId }, { $pull: { 'acl.allowedUsers': userId } });
  // Clean up user-scoped Redis chat history
  await clearChat(tenantId, userId);
  await User.deleteOne({ _id: userId, tenantId });
  return true;
}

module.exports = { deleteChunksForDocument, deleteDocumentAndChunks, deleteUserInTenant };
