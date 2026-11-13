const express = require('express');
const authRoutes = require('./routes/auth');
const documentRoutes = require('./routes/documents');
const jobRoutes = require('./routes/jobs');
const askRoutes = require('./routes/ask');
const auditRoutes = require('./routes/audit');
const userRoutes = require('./routes/users');
const authenticate = require('./middleware/authenticate');
const requireRole = require('./middleware/requireRole');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/documents', documentRoutes);
app.use('/jobs', jobRoutes);
app.use('/', askRoutes);
app.use('/audit', auditRoutes);
app.use('/users', userRoutes);

app.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

app.get('/admin-only', authenticate, requireRole('admin'), (req, res) => {
  res.json({ ok: true, message: 'You are an admin', tenantId: req.user.tenantId });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
