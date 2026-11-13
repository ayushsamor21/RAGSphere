const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const { cachedEmbeddingGet, cachedEmbeddingSet } = require('./redis');

const DIMS = 768;

function fakeEmbed(text) {
  const vector = new Array(DIMS).fill(0);
  const tokens = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const token of tokens) {
    let h = 0;
    for (let i = 0; i < token.length; i += 1) h = (h * 31 + token.charCodeAt(i)) >>> 0;
    vector[h % DIMS] += 1;
  }
  let norm = 0;
  for (const n of vector) norm += n * n;
  norm = Math.sqrt(norm) || 1;
  return vector.map((n) => n / norm);
}

let genAI;

function model() {
  if (!config.geminiApiKey || config.geminiApiKey === 'test') return null;
  if (!genAI) genAI = new GoogleGenerativeAI(config.geminiApiKey);
  return genAI.getGenerativeModel({ model: 'text-embedding-004' });
}

async function embedOne(text) {
  const embedder = model();
  if (!embedder) return fakeEmbed(text);
  const result = await embedder.embedContent(text);
  const values = result.embedding && result.embedding.values;
  if (!values || values.length !== DIMS) {
    throw new Error('Unexpected embedding size');
  }
  return values;
}

async function embedQuery(tenantId, text) {
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  const cached = await cachedEmbeddingGet(tenantId, digest);
  if (cached) return cached;
  const vector = await embedOne(text);
  await cachedEmbeddingSet(tenantId, digest, vector);
  return vector;
}

async function embedTexts(texts) {
  const out = [];
  for (const text of texts) out.push(await embedOne(text));
  return out;
}

module.exports = { embedOne, embedQuery, embedTexts, fakeEmbed, DIMS };
