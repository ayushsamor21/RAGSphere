const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const Document = require('../models/Document');
const authenticate = require('../middleware/authenticate');
const { identityFromUser, toObjectId } = require('../lib/ids');
const { sanitizeAcl } = require('../services/sanitizeAcl');
const { buildDocumentAclQuery } = require('../services/aclFilter');
const { createJob } = require('../services/jobs');
const { deleteDocumentAndChunks } = require('../services/cleanup');

const router = express.Router();
const NOT_FOUND = { error: 'Document not found' };

function ensureUploadDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(config.uploadDir, String(req.user.tenantId));
    ensureUploadDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^\w.\-]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxPdfBytes },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

function parseAclField(body) {
  if (!body || body.acl == null) return undefined;
  if (typeof body.acl === 'string') {
    try {
      return JSON.parse(body.acl);
    } catch {
      return { __invalid: true };
    }
  }
  if (typeof body.acl === 'object') return body.acl;
  return { __invalid: true };
}

router.post('/', authenticate, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Invalid upload' });
    next();
  });
}, async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    if (!identity) return res.status(401).json({ error: 'Authentication required' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const rawAcl = parseAclField(req.body);
    if (rawAcl && rawAcl.__invalid) return res.status(400).json({ error: 'Invalid acl' });

    const acl = await sanitizeAcl(rawAcl, req.user);
    const title = (req.body && req.body.title) || req.file.originalname;

    const doc = await Document.create({
      tenantId: identity.tenantId,
      ownerId: identity.userId,
      title,
      status: 'queued',
      sizeBytes: req.file.size,
      filePath: req.file.path,
      acl,
    });

    const jobId = await createJob(identity.tenantId, identity.userId, {
      type: 'ingest',
      documentId: String(doc._id),
      ownerId: String(identity.userId),
      acl,
      filePath: req.file.path,
    });

    res.status(202).json({ documentId: doc._id, jobId, status: 'queued' });
  } catch (err) {
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }
    next(err);
  }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const filter = buildDocumentAclQuery(req.user);
    if (!filter) return res.status(401).json({ error: 'Authentication required' });
    const items = await Document.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const filter = buildDocumentAclQuery(req.user);
    const id = toObjectId(req.params.id);
    if (!filter || !id) return res.status(404).json(NOT_FOUND);
    const doc = await Document.findOne({ $and: [filter, { _id: id }] }).lean();
    if (!doc) return res.status(404).json(NOT_FOUND);
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/acl', authenticate, async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    const id = toObjectId(req.params.id);
    if (!identity || !id) return res.status(404).json(NOT_FOUND);

    const doc = await Document.findOne({ _id: id, tenantId: identity.tenantId });
    if (!doc) return res.status(404).json(NOT_FOUND);

    const isOwner = String(doc.ownerId) === String(identity.userId);
    if (identity.role !== 'admin' && !isOwner) return res.status(404).json(NOT_FOUND);

    const acl = await sanitizeAcl(req.body && req.body.acl, req.user);
    doc.acl = acl;
    doc.status = 'restamping';
    await doc.save();

    const jobId = await createJob(identity.tenantId, identity.userId, {
      type: 'restamp_acl',
      documentId: String(doc._id),
      acl,
    });

    res.json({ documentId: doc._id, jobId, acl, status: 'restamping' });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const identity = identityFromUser(req.user);
    const id = toObjectId(req.params.id);
    if (!identity || !id) return res.status(404).json(NOT_FOUND);
    const doc = await Document.findOne({ _id: id, tenantId: identity.tenantId });
    if (!doc) return res.status(404).json(NOT_FOUND);
    const isOwner = String(doc.ownerId) === String(identity.userId);
    if (identity.role !== 'admin' && !isOwner) return res.status(404).json(NOT_FOUND);
    await deleteDocumentAndChunks(id, identity.tenantId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
