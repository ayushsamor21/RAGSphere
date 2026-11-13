const express = require('express');
const authenticate = require('../middleware/authenticate');
const { readJobForUser } = require('../services/jobs');

const router = express.Router();
const NOT_FOUND = { error: 'Job not found' };

router.get('/:jobId', authenticate, async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const job = await readJobForUser(req.user, req.params.jobId);
    if (!job) return res.status(404).json(NOT_FOUND);
    res.json({ job });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
