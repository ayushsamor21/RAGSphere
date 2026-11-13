const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const config = require('../config');

const router = express.Router();

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const INVALID = { error: 'Invalid credentials' };

router.post('/login', async (req, res, next) => {
  try {
    const { tenant: slug, email, password } = req.body || {};
    if (
      typeof slug !== 'string' ||
      typeof email !== 'string' ||
      typeof password !== 'string'
    ) {
      return res.status(400).json({ error: 'tenant, email and password are required' });
    }

    const tenant = await Tenant.findOne({ slug: slug.toLowerCase() });
    const user = tenant
      ? await User.findOne({ tenantId: tenant._id, email: email.toLowerCase() }).select(
          '+passwordHash'
        )
      : null;

    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json(INVALID);

    const token = jwt.sign(
      {
        tenantId: String(user.tenantId),
        role: user.role,
        groups: user.groups,
      },
      config.jwtSecret,
      {
        algorithm: 'HS256',
        subject: String(user._id),
        expiresIn: config.jwtExpiresIn,
      }
    );

    res.json({ token, tokenType: 'Bearer', expiresIn: config.jwtExpiresIn });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
