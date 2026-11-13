const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { identityFromUser, toObjectId } = require('../lib/ids');
const { listAudit } = require('../services/audit');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    if (!identity) return res.status(401).json({ error: 'Authentication required' });

    const userId = req.query.userId ? toObjectId(req.query.userId) : undefined;
    if (req.query.userId && !userId) return res.status(400).json({ error: 'Invalid userId' });

    const result = await listAudit(identity.tenantId, {
      userId,
      from: req.query.from,
      to: req.query.to,
      page: Number(req.query.page) || 1,
      limit: Math.min(Number(req.query.limit) || 20, 100),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
