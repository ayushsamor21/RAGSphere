const { createClient } = require('redis');
const config = require('../config');
const { jobKey, chatKey, embedCacheKey, INGEST_QUEUE } = require('./keys');

let client;

function createMemoryRedis() {
  const hashes = new Map();
  const lists = new Map();
  const strings = new Map();
  const waiters = new Map();

  function takeWaiter(key) {
    const q = waiters.get(key);
    if (!q || !q.length) return null;
    return q.shift();
  }

  return {
    isMemory: true,
    async connect() {},
    async quit() {},
    async hSet(key, fieldOrObj, value) {
      if (!hashes.has(key)) hashes.set(key, {});
      const h = hashes.get(key);
      if (typeof fieldOrObj === 'object') Object.assign(h, fieldOrObj);
      else h[fieldOrObj] = String(value);
    },
    async hGetAll(key) {
      return { ...(hashes.get(key) || {}) };
    },
    async rPush(key, ...values) {
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push(...values);
      const waiter = takeWaiter(key);
      if (waiter) waiter(lists.get(key).pop());
    },
    async lPush(key, ...values) {
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).unshift(...values);
    },
    async lRange(key, start, stop) {
      const list = lists.get(key) || [];
      const end = stop < 0 ? list.length : stop + 1;
      return list.slice(start, end);
    },
    async brPop(key, _timeout) {
      const list = lists.get(key) || [];
      if (list.length) return { key, element: list.pop() };
      const element = await new Promise((resolve) => {
        if (!waiters.has(key)) waiters.set(key, []);
        waiters.get(key).push(resolve);
      });
      return { key, element };
    },
    async get(key) {
      return strings.get(key) ?? null;
    },
    async set(key, value) {
      strings.set(key, String(value));
    },
    async del(key) {
      hashes.delete(key);
      lists.delete(key);
      strings.delete(key);
    },
    async flushDb() {
      hashes.clear();
      lists.clear();
      strings.clear();
      waiters.clear();
    },
  };
}

async function getClient() {
  if (client) return client;
  if (config.redisUrl === 'memory') {
    client = createMemoryRedis();
    await client.connect();
    return client;
  }
  client = createClient({ url: config.redisUrl });
  client.on('error', (err) => console.error('Redis error', err));
  await client.connect();
  return client;
}

async function setJob(tenantId, jobId, fields) {
  const redis = await getClient();
  const flat = {};
  for (const [k, v] of Object.entries(fields)) {
    flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  await redis.hSet(jobKey(tenantId, jobId), flat);
}

async function getJob(tenantId, jobId) {
  const redis = await getClient();
  const data = await redis.hGetAll(jobKey(tenantId, jobId));
  if (!data || Object.keys(data).length === 0) return null;
  return data;
}

async function enqueue(payload) {
  const redis = await getClient();
  await redis.rPush(INGEST_QUEUE, JSON.stringify(payload));
}

async function dequeueBlocking() {
  const redis = await getClient();
  const popped = await redis.brPop(INGEST_QUEUE, 0);
  if (!popped) return null;
  const raw = typeof popped === 'string' ? popped : popped.element;
  return JSON.parse(raw);
}

async function appendChat(tenantId, userId, entry) {
  const redis = await getClient();
  await redis.lPush(chatKey(tenantId, userId), JSON.stringify(entry));
}

async function listChat(tenantId, userId, limit = 50) {
  const redis = await getClient();
  const rows = await redis.lRange(chatKey(tenantId, userId), 0, limit - 1);
  return rows.map((r) => JSON.parse(r));
}

async function cachedEmbeddingGet(tenantId, digest) {
  const redis = await getClient();
  const raw = await redis.get(embedCacheKey(tenantId, digest));
  return raw ? JSON.parse(raw) : null;
}

async function cachedEmbeddingSet(tenantId, digest, vector) {
  const redis = await getClient();
  await redis.set(embedCacheKey(tenantId, digest), JSON.stringify(vector));
}

async function clearChat(tenantId, userId) {
  const redis = await getClient();
  await redis.del(chatKey(tenantId, userId));
}

async function flushRedis() {
  const redis = await getClient();
  if (typeof redis.flushDb === 'function') {
    await redis.flushDb();
  }
}

module.exports = {
  getClient,
  setJob,
  getJob,
  enqueue,
  dequeueBlocking,
  appendChat,
  listChat,
  clearChat,
  flushRedis,
  cachedEmbeddingGet,
  cachedEmbeddingSet,
};
