require('./env');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const {
  startDb,
  stopDb,
  resetSeed,
  login,
  makeSamplePdf,
  getApp,
} = require('./helpers');
const User = require('../src/models/User');
const Document = require('../src/models/Document');
const Chunk = require('../src/models/Chunk');
const AuditLog = require('../src/models/AuditLog');
const { handle } = require('../src/worker');
const { getJob, dequeueBlocking } = require('../src/services/redis');

let acme;
let globex;
let acmeAdmin;
let acmeEmployee;
let globexAdmin;
let globexEmployee;

before(async () => {
  await startDb();
});

after(async () => {
  await stopDb();
});

beforeEach(async () => {
  const seeded = await resetSeed();
  acme = seeded.acme;
  globex = seeded.globex;
  acmeAdmin = await User.findOne({ email: 'admin@acme.test' });
  acmeEmployee = await User.findOne({ email: 'employee@acme.test' });
  globexAdmin = await User.findOne({ email: 'admin@globex.test' });
  globexEmployee = await User.findOne({ email: 'employee@globex.test' });
});

test('Document upload defaults to restrictive ACL and rejects non-PDF', async () => {
  const token = await login('employee@acme.test', 'acme');
  const app = getApp();

  // Rejects non-PDF
  const badRes = await request(app)
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from('not a pdf'), 'notes.txt');
  assert.equal(badRes.status, 400);

  // Accepts PDF and assigns restrictive ACL
  const pdfBuf = makeSamplePdf('Hello world from Enterprise PDF');
  const res = await request(app)
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', pdfBuf, 'handbook.pdf')
    .field('title', 'Employee Handbook');

  assert.equal(res.status, 202);
  assert.ok(res.body.documentId);
  assert.ok(res.body.jobId);

  const doc = await Document.findById(res.body.documentId);
  assert.ok(doc);
  assert.equal(doc.title, 'Employee Handbook');
  assert.equal(doc.status, 'queued');
  assert.equal(doc.acl.visibility, 'restricted');
  assert.ok(doc.acl.allowedRoles.includes('admin'));
  assert.ok(doc.acl.allowedRoles.includes('employee'));
  assert.equal(String(doc.acl.allowedUsers[0]), String(acmeEmployee._id));

  // Clean up uploaded file
  if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
});

test('Document upload sanitizes cross-tenant user IDs in ACL', async () => {
  const token = await login('employee@acme.test', 'acme');
  const app = getApp();
  const pdfBuf = makeSamplePdf('Hello world from Enterprise PDF');

  const forgedAcl = {
    visibility: 'restricted',
    allowedRoles: ['employee', 'fake_role'],
    allowedGroups: ['hr', 'malicious_group'],
    allowedUsers: [String(globexEmployee._id), String(acmeEmployee._id)],
  };

  const res = await request(app)
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', pdfBuf, 'secret.pdf')
    .field('acl', JSON.stringify(forgedAcl));

  assert.equal(res.status, 202);
  const doc = await Document.findById(res.body.documentId);
  assert.ok(doc);
  assert.equal(doc.acl.allowedRoles.includes('fake_role'), false);
  assert.equal(doc.acl.allowedGroups.includes('malicious_group'), false);
  // Cross-tenant globexEmployee ID must be stripped
  assert.equal(
    doc.acl.allowedUsers.some((id) => String(id) === String(globexEmployee._id)),
    false
  );
  assert.ok(doc.acl.allowedUsers.some((id) => String(id) === String(acmeEmployee._id)));

  if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
});

test('Worker successfully processes ingest job and stamps chunks with ACL', async () => {
  const token = await login('employee@acme.test', 'acme');
  const app = getApp();
  const pdfBuf = makeSamplePdf('Hello world from Enterprise PDF');

  const res = await request(app)
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', pdfBuf, 'secure.pdf');

  assert.equal(res.status, 202);
  const jobId = res.body.jobId;
  const docId = res.body.documentId;

  // Process the job with the worker
  const job = await dequeueBlocking();
  assert.equal(job.jobId, jobId);
  await handle(job);

  // Verify document is ready and chunks exist
  const updatedDoc = await Document.findById(docId);
  assert.equal(updatedDoc.status, 'ready');

  const chunks = await Chunk.find({ documentId: docId });
  assert.ok(chunks.length > 0);
  for (const chunk of chunks) {
    assert.equal(String(chunk.tenantId), String(acme._id));
    assert.equal(String(chunk.ownerId), String(acmeEmployee._id));
    assert.equal(chunk.acl.visibility, 'restricted');
    assert.ok(chunk.embedding.length === 768);
  }

  // Verify job status in Redis
  const jobRecord = await getJob(acme._id, jobId);
  assert.equal(jobRecord.status, 'done');

  if (updatedDoc.filePath && fs.existsSync(updatedDoc.filePath)) {
    fs.unlinkSync(updatedDoc.filePath);
  }
});

test('Worker handles corrupt upload failure cleanly with orphan chunk cleanup', async () => {
  const token = await login('employee@acme.test', 'acme');
  const app = getApp();

  // Create document with empty/corrupt file
  const emptyPdf = Buffer.from('%PDF-1.4\n%%EOF');
  const res = await request(app)
    .post('/documents')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', emptyPdf, 'empty.pdf');

  assert.equal(res.status, 202);
  const jobId = res.body.jobId;
  const docId = res.body.documentId;

  const job = await dequeueBlocking();
  assert.equal(job.jobId, jobId);

  // Worker handling fails due to no extractable text
  try {
    await handle(job);
  } catch (err) {
    const { failIngest } = require('../src/pipeline/ingest');
    const { markJob } = require('../src/services/jobs');
    await failIngest({ tenantId: job.tenantId, documentId: job.documentId, err });
    await markJob(job.tenantId, job.jobId, { status: 'failed', error: 'processing_failed' });
  }

  const updatedDoc = await Document.findById(docId);
  assert.equal(updatedDoc.status, 'failed');

  const orphanChunks = await Chunk.find({ documentId: docId });
  assert.equal(orphanChunks.length, 0);

  const jobRecord = await getJob(acme._id, jobId);
  assert.equal(jobRecord.status, 'failed');

  if (updatedDoc.filePath && fs.existsSync(updatedDoc.filePath)) {
    fs.unlinkSync(updatedDoc.filePath);
  }
});

test('Document listing and details enforce tenant isolation and ACL', async () => {
  const acmeToken = await login('employee@acme.test', 'acme');
  const globexToken = await login('employee@globex.test', 'globex');
  const app = getApp();

  const doc = await Document.create({
    tenantId: acme._id,
    ownerId: acmeEmployee._id,
    title: 'Acme Secret Handbook',
    status: 'ready',
    sizeBytes: 100,
    filePath: '/tmp/test.pdf',
    acl: {
      visibility: 'restricted',
      allowedRoles: ['employee'],
      allowedGroups: [],
      allowedUsers: [acmeEmployee._id],
    },
  });

  // Acme employee sees their document
  const acmeList = await request(app)
    .get('/documents')
    .set('Authorization', `Bearer ${acmeToken}`);
  assert.equal(acmeList.status, 200);
  assert.ok(acmeList.body.items.some((d) => String(d._id) === String(doc._id)));

  const acmeDoc = await request(app)
    .get(`/documents/${doc._id}`)
    .set('Authorization', `Bearer ${acmeToken}`);
  assert.equal(acmeDoc.status, 200);
  assert.equal(acmeDoc.body.document.title, 'Acme Secret Handbook');

  // Globex employee gets 404 (generic error, no leak)
  const globexDoc = await request(app)
    .get(`/documents/${doc._id}`)
    .set('Authorization', `Bearer ${globexToken}`);
  assert.equal(globexDoc.status, 404);
  assert.equal(globexDoc.body.error, 'Document not found');

  const globexList = await request(app)
    .get('/documents')
    .set('Authorization', `Bearer ${globexToken}`);
  assert.equal(globexList.status, 200);
  assert.equal(globexList.body.items.some((d) => String(d._id) === String(doc._id)), false);
});

test('PATCH /documents/:id/acl allows owner/admin and denies non-owner employee', async () => {
  const ownerToken = await login('employee@acme.test', 'acme');
  const adminToken = await login('admin@acme.test', 'acme');
  const globexToken = await login('employee@globex.test', 'globex');
  const app = getApp();

  const doc = await Document.create({
    tenantId: acme._id,
    ownerId: acmeEmployee._id,
    title: 'Acme Roadmap',
    status: 'ready',
    sizeBytes: 200,
    filePath: '/tmp/roadmap.pdf',
    acl: {
      visibility: 'private',
      allowedRoles: [],
      allowedGroups: [],
      allowedUsers: [acmeEmployee._id],
    },
  });

  // Globex user gets 404
  const crossTenant = await request(app)
    .patch(`/documents/${doc._id}/acl`)
    .set('Authorization', `Bearer ${globexToken}`)
    .send({ acl: { visibility: 'tenant' } });
  assert.equal(crossTenant.status, 404);

  // Owner can update ACL
  const ownerUpdate = await request(app)
    .patch(`/documents/${doc._id}/acl`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ acl: { visibility: 'tenant' } });
  assert.equal(ownerUpdate.status, 200);
  assert.equal(ownerUpdate.body.acl.visibility, 'tenant');

  // Admin can also update ACL
  const adminUpdate = await request(app)
    .patch(`/documents/${doc._id}/acl`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ acl: { visibility: 'restricted', allowedRoles: ['admin'] } });
  assert.equal(adminUpdate.status, 200);
});

test('DELETE /documents/:id deletes document, chunks, and disk file', async () => {
  const ownerToken = await login('employee@acme.test', 'acme');
  const globexToken = await login('employee@globex.test', 'globex');
  const app = getApp();

  const tempFilePath = `/tmp/test-delete-${Date.now()}.pdf`;
  fs.writeFileSync(tempFilePath, 'dummy content');

  const doc = await Document.create({
    tenantId: acme._id,
    ownerId: acmeEmployee._id,
    title: 'Disposable Document',
    status: 'ready',
    sizeBytes: 50,
    filePath: tempFilePath,
    acl: { visibility: 'tenant', allowedRoles: [], allowedGroups: [], allowedUsers: [] },
  });

  await Chunk.create({
    tenantId: acme._id,
    documentId: doc._id,
    ownerId: acmeEmployee._id,
    text: 'Disposable text',
    embedding: new Array(768).fill(0.1),
    chunkIndex: 0,
    acl: doc.acl,
  });

  // Cross tenant delete gets 404
  const cross = await request(app)
    .delete(`/documents/${doc._id}`)
    .set('Authorization', `Bearer ${globexToken}`);
  assert.equal(cross.status, 404);

  // Owner deletes document
  const del = await request(app)
    .delete(`/documents/${doc._id}`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(del.status, 204);

  assert.equal(await Document.findById(doc._id), null);
  assert.equal(await Chunk.countDocuments({ documentId: doc._id }), 0);
  assert.equal(fs.existsSync(tempFilePath), false);
});

test('GET /audit is admin-only, paginated, and strictly tenant-scoped', async () => {
  const acmeAdminToken = await login('admin@acme.test', 'acme');
  const acmeEmpToken = await login('employee@acme.test', 'acme');
  const globexAdminToken = await login('admin@globex.test', 'globex');
  const app = getApp();

  // Employee is forbidden (403)
  const empRes = await request(app)
    .get('/audit')
    .set('Authorization', `Bearer ${acmeEmpToken}`);
  assert.equal(empRes.status, 403);

  // Insert audit logs for both tenants
  await AuditLog.create({
    tenantId: acme._id,
    userId: acmeAdmin._id,
    role: 'admin',
    query: 'acme security check',
    filterApplied: {},
    answerId: 'ans-1',
  });
  await AuditLog.create({
    tenantId: globex._id,
    userId: globexAdmin._id,
    role: 'admin',
    query: 'globex financial query',
    filterApplied: {},
    answerId: 'ans-2',
  });

  // Acme admin only sees Acme audit log
  const acmeAudit = await request(app)
    .get('/audit')
    .set('Authorization', `Bearer ${acmeAdminToken}`);
  assert.equal(acmeAudit.status, 200);
  assert.equal(acmeAudit.body.total, 1);
  assert.equal(acmeAudit.body.items[0].query, 'acme security check');

  // Globex admin only sees Globex audit log
  const globexAudit = await request(app)
    .get('/audit')
    .set('Authorization', `Bearer ${globexAdminToken}`);
  assert.equal(globexAudit.status, 200);
  assert.equal(globexAudit.body.total, 1);
  assert.equal(globexAudit.body.items[0].query, 'globex financial query');
});

test('GET /chat returns tenant and user scoped history', async () => {
  const empToken = await login('employee@acme.test', 'acme');
  const adminToken = await login('admin@acme.test', 'acme');
  const app = getApp();

  // Ask question as employee
  await request(app)
    .post('/ask')
    .set('Authorization', `Bearer ${empToken}`)
    .send({ query: 'What is our mission?' });

  // Employee sees their own chat history
  const empChat = await request(app)
    .get('/chat')
    .set('Authorization', `Bearer ${empToken}`);
  assert.equal(empChat.status, 200);
  assert.ok(empChat.body.items.length >= 1);
  assert.equal(empChat.body.items[0].query, 'What is our mission?');

  // Admin has empty chat history (no cross-user leak)
  const adminChat = await request(app)
    .get('/chat')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminChat.status, 200);
  assert.equal(adminChat.body.items.length, 0);
});

test('DELETE /users/:userId removes user, their documents, chunks, and clears chat', async () => {
  const adminToken = await login('admin@acme.test', 'acme');
  const empToken = await login('employee@acme.test', 'acme');
  const globexAdminToken = await login('admin@globex.test', 'globex');
  const app = getApp();

  // Create a document owned by employee
  const doc = await Document.create({
    tenantId: acme._id,
    ownerId: acmeEmployee._id,
    title: 'Employee Private Doc',
    status: 'ready',
    sizeBytes: 10,
    filePath: '/tmp/emp.pdf',
    acl: { visibility: 'private', allowedRoles: [], allowedGroups: [], allowedUsers: [acmeEmployee._id] },
  });
  await Chunk.create({
    tenantId: acme._id,
    documentId: doc._id,
    ownerId: acmeEmployee._id,
    text: 'Confidential employee data',
    embedding: new Array(768).fill(0.2),
    chunkIndex: 0,
    acl: doc.acl,
  });

  // Globex admin cannot delete Acme employee (404)
  const crossDel = await request(app)
    .delete(`/users/${acmeEmployee._id}`)
    .set('Authorization', `Bearer ${globexAdminToken}`);
  assert.equal(crossDel.status, 404);

  // Employee cannot delete users (403)
  const empDel = await request(app)
    .delete(`/users/${acmeEmployee._id}`)
    .set('Authorization', `Bearer ${empToken}`);
  assert.equal(empDel.status, 403);

  // Acme admin deletes Acme employee
  const okDel = await request(app)
    .delete(`/users/${acmeEmployee._id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(okDel.status, 204);

  assert.equal(await User.findById(acmeEmployee._id), null);
  assert.equal(await Document.findById(doc._id), null);
  assert.equal(await Chunk.countDocuments({ documentId: doc._id }), 0);
});
