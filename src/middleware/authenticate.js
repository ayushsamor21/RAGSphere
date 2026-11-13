const jwt = require('jsonwebtoken');
const config = require('../config');

// Fail closed: anything unexpected is a 401. After this middleware runs,
// req.user is the ONLY trusted source of identity for the rest of the app.
module.exports = function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });

    if (!payload.sub || !payload.tenantId || !payload.role) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      groups: Array.isArray(payload.groups) ? payload.groups : [],
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
