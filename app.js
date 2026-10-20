const express = require('express');
const authRoutes = require('./routes/auth');
const authenticate = require('./middleware/authenticate');
const requireRole = require('./middleware/requireRole');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.use('/auth', authRoutes);

// Echoes the identity the server verified. Used to test Layer 1.
app.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Proves the role guard works. Safe to delete later.
app.get('/admin-only', authenticate, requireRole('admin'), (req, res) => {
  res.json({ ok: true, message: 'You are an admin', tenantId: req.user.tenantId });
});

// Minimal error handler: never leak internals to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
