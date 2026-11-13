const Chunk = require('../models/Chunk');
const config = require('../config');
const { buildAclFilter } = require('./aclFilter');
const { embedQuery } = require('./embeddings');
const { toObjectId } = require('../lib/ids');

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function buildVectorSearchPipeline({ queryVector, filter, limit = 8 }) {
  return [
    {
      $vectorSearch: {
        index: config.vectorIndexName,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(limit * 10, 40),
        limit,
        filter,
      },
    },
    { $addFields: { score: { $meta: 'vectorSearchScore' } } },
    { $match: { score: { $gte: config.similarityThreshold } } },
    {
      $project: {
        text: 1,
        documentId: 1,
        chunkIndex: 1,
        tenantId: 1,
        score: 1,
      },
    },
  ];
}

async function searchMemory(queryVector, filter, extra = {}) {
  const mongoFilter = { ...filter, ...extra };
  const chunks = await Chunk.find(mongoFilter).lean();
  return chunks
    .map((c) => ({ ...c, score: cosine(queryVector, c.embedding || []) }))
    .filter((c) => c.score >= config.similarityThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ embedding, ...rest }) => rest);
}

async function retrieve({ user, query, documentId }) {
  const filter = buildAclFilter(user);
  if (!filter) return { error: 'forbidden' };

  let scopedFilter = filter;
  if (documentId) {
    const oid = toObjectId(documentId);
    if (!oid) return { chunks: [], filter, excludedByAclCount: 0 };
    scopedFilter = { $and: [filter, { documentId: { $eq: oid } }] };
  }

  const queryVector = await embedQuery(String(user.tenantId), query);

  let chunks;
  if (config.vectorSearch === 'atlas') {
    const pipeline = buildVectorSearchPipeline({ queryVector, filter: scopedFilter });
    chunks = await Chunk.aggregate(pipeline);
  } else {
    chunks = await searchMemory(queryVector, scopedFilter);
  }

  const tenantId = filter.$and[0].tenantId.$eq;
  const excludedByAclCount = await Chunk.countDocuments({
    tenantId,
    ...(documentId && toObjectId(documentId) ? { documentId: toObjectId(documentId) } : {}),
    $nor: [filter],
  });

  return { chunks, filter: scopedFilter, excludedByAclCount };
}

module.exports = { retrieve, buildVectorSearchPipeline, cosine };
