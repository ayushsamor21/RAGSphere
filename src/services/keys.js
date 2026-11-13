function jobKey(tenantId, jobId) {
  return `t:${tenantId}:job:${jobId}`;
}

function chatKey(tenantId, userId) {
  return `t:${tenantId}:u:${userId}:chat`;
}

function embedCacheKey(tenantId, digest) {
  return `t:${tenantId}:embed:${digest}`;
}

const INGEST_QUEUE = 'queue:ingest';

module.exports = { jobKey, chatKey, embedCacheKey, INGEST_QUEUE };
