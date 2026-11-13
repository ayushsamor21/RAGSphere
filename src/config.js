require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

const vectorSearch = process.env.VECTOR_SEARCH || 'atlas';
if (!['atlas', 'memory'].includes(vectorSearch)) {
  throw new Error('VECTOR_SEARCH must be "atlas" or "memory"');
}

module.exports = {
  mongoUri: required('MONGODB_URI'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  port: Number(process.env.PORT) || 3000,
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  vectorSearch,
  vectorIndexName: process.env.VECTOR_INDEX_NAME || 'chunks_vector_index',
  similarityThreshold: Number(process.env.SIMILARITY_THRESHOLD) || 0.7,
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxPdfBytes: 20 * 1024 * 1024,
};
