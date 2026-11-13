const fs = require('fs/promises');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const { parsePdf } = require('./parsePdf');
const { chunkText } = require('./chunkText');
const { embedTexts } = require('../services/embeddings');
const { deleteChunksForDocument } = require('../services/cleanup');
const { toObjectId } = require('../lib/ids');

async function ingestDocument({ tenantId, documentId, ownerId, acl, filePath }) {
  const tId = toObjectId(tenantId);
  const dId = toObjectId(documentId);
  const oId = toObjectId(ownerId);
  const buf = await fs.readFile(filePath);
  const { text } = await parsePdf(buf);
  const pieces = chunkText(text);
  if (!pieces.length) throw new Error('No extractable text');

  const embeddings = await embedTexts(pieces);
  const docs = pieces.map((chunk, i) => ({
    tenantId: tId,
    documentId: dId,
    ownerId: oId,
    text: chunk,
    embedding: embeddings[i],
    chunkIndex: i,
    acl,
  }));

  await deleteChunksForDocument(dId, tId);
  await Chunk.insertMany(docs);
  await Document.updateOne({ _id: dId, tenantId: tId }, { status: 'ready' });
}

async function restampAcl({ tenantId, documentId, acl }) {
  const tId = toObjectId(tenantId);
  const dId = toObjectId(documentId);
  await Chunk.updateMany({ documentId: dId, tenantId: tId }, { $set: { acl } });
  await Document.updateOne({ _id: dId, tenantId: tId }, { status: 'ready', acl });
}

async function failIngest({ tenantId, documentId, err }) {
  const tId = toObjectId(tenantId);
  const dId = toObjectId(documentId);
  await deleteChunksForDocument(dId, tId);
  await Document.updateOne(
    { _id: dId, tenantId: tId },
    { status: 'failed' }
  );
  return err;
}

module.exports = { ingestDocument, restampAcl, failIngest };
