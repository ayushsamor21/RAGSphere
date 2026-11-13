const crypto = require('crypto');
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { identityFromUser } = require('../lib/ids');
const { retrieve } = require('../services/retrieval');
const { streamAnswer } = require('../services/generation');
const { writeAudit } = require('../services/audit');
const { appendChat, listChat } = require('../services/redis');

const router = express.Router();

router.get('/chat', authenticate, async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    if (!identity) return res.status(401).json({ error: 'Authentication required' });
    const items = await listChat(identity.tenantId, identity.userId);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.post('/ask', authenticate, async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    if (!identity) return res.status(401).json({ error: 'Authentication required' });

    const query = req.body && req.body.query;
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'query is required' });
    }

    // tenantId / role on the body are ignored; identity is JWT-only.
    const documentId = req.body.documentId;

    const retrieved = await retrieve({
      user: req.user,
      query: query.trim(),
      documentId,
    });
    if (retrieved.error === 'forbidden') {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const chunks = retrieved.chunks || [];
    const answerId = crypto.randomUUID();
    const retrievedChunkIds = chunks.map((c) => c._id);
    const retrievedDocIds = [...new Set(chunks.map((c) => String(c.documentId)))];

    await writeAudit({
      tenantId: identity.tenantId,
      userId: identity.userId,
      role: identity.role,
      query: query.trim(),
      retrievedChunkIds,
      retrievedDocIds,
      scores: chunks.map((c) => c.score),
      filterApplied: retrieved.filter,
      excludedByAclCount: retrieved.excludedByAclCount || 0,
      answerId,
      ip: req.ip || '',
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();

    const citations = chunks.map((c, i) => ({
      n: i + 1,
      chunkId: c._id,
      documentId: c.documentId,
      score: c.score,
    }));
    res.write(`data: ${JSON.stringify({ answerId, citations })}\n\n`);

    let answer = '';
    await streamAnswer({
      question: query.trim(),
      chunks,
      onToken: (token) => {
        answer += token;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      },
    });

    await appendChat(identity.tenantId, identity.userId, {
      ts: new Date().toISOString(),
      query: query.trim(),
      answerId,
      chunkIds: retrievedChunkIds,
    });

    res.write(`data: ${JSON.stringify({ done: true, answer })}\n\n`);
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
      return res.end();
    }
    next(err);
  }
});

module.exports = router;
