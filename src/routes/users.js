const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireRole = require('../middleware/requireRole');
const { identityFromUser, toObjectId } = require('../lib/ids');
const { deleteUserInTenant } = require('../services/cleanup');

const router = express.Router();
const NOT_FOUND = { error: 'User not found' };

router.delete('/:userId', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    const userId = toObjectId(req.params.userId);
    if (!identity || !userId) return res.status(404).json(NOT_FOUND);
    const ok = await deleteUserInTenant(userId, identity.tenantId);
    if (!ok) return res.status(404).json(NOT_FOUND);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
