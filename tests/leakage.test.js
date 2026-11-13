require('./env');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const {
  startDb,
  stopDb,
  resetSeed,
  login,
  insertDocWithChunks,
  restampAcl,
  getApp,
} = require('./helpers');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const { createJob } = require('../src/services/jobs');
const { getJob } = require('../src/services/redis');

let acme;
let globex;
let acmeAdmin;
let acmeHr;
let acmeEmployee;
let globexEmployee;
let globexHr;

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
  acmeHr = await User.findOne({ email: 'hr.manager@acme.test' });
  acmeEmployee = await User.findOne({ email: 'employee@acme.test' });
  globexEmployee = await User.findOne({ email: 'employee@globex.test' });
  globexHr = await User.findOne({ email: 'hr.manager@globex.test' });

  const tenantAcl = {
    visibility: 'tenant',
    allowedRoles: [],
    allowedGroups: [],
    allowedUsers: [],
  };
  const hrAcl = {
    visibility: 'restricted',
    allowedRoles: ['admin', 'manager'],
    allowedGroups: ['hr'],
    allowedUsers: [acmeHr._id],
  };

  await insertDocWithChunks({
    tenantId: acme._id,
    ownerId: acmeAdmin._id,
    title: 'Acme handbook',
    text: 'Acme payroll calendar and office map.',
    uniquePhrase: 'acme-secret-alpha',
    acl: tenantAcl,
  });
  await insertDocWithChunks({
    tenantId: globex._id,
    ownerId: globexEmployee._id,
    title: 'Globex handbook',
    text: 'Globex payroll calendar and office map.',
    uniquePhrase: 'globex-secret-zebra',
    acl: {
      visibility: 'tenant',
      allowedRoles: [],
      allowedGroups: [],
      allowedUsers: [],
    },
  });
  await insertDocWithChunks({
    tenantId: acme._id,
    ownerId: acmeHr._id,
    title: 'Acme HR policy',
    text: 'Headcount planning and compensation bands.',
    uniquePhrase: 'hr-only- kompensation',
    acl: hrAcl,
  });
});

async function ask(token, query, extra = {}) {
  const res = await request(getApp())
    .post('/ask')
    .set('Authorization', `Bearer ${token}`)
    .send({ query, tenantId: extra.tenantId, role: extra.role, documentId: extra.documentId });
  return res;
}

function bodyText(res) {
  return String(res.text || '');
}

test('1. tenant A never retrieves tenant B chunks', async () => {
  const token = await login('employee@acme.test', 'acme');
  const res = await ask(token, 'globex-secret-zebra payroll calendar');
  assert.equal(res.status, 200);
  assert.equal(bodyText(res).includes('globex-secret-zebra'), false);
  assert.equal(bodyText(res).includes('acme-secret-alpha') || bodyText(res).includes("I don't know"), true);
});

test('2. employee cannot retrieve hr-restricted chunks; hr manager can', async () => {
  const empToken = await login('employee@acme.test', 'acme');
  const hrToken = await login('hr.manager@acme.test', 'acme');
  const emp = await ask(empToken, 'hr-only- kompensation compensation bands');
  const hr = await ask(hrToken, 'hr-only- kompensation compensation bands');
  assert.equal(bodyText(emp).includes('hr-only- kompensation'), false);
  assert.equal(bodyText(hr).includes('hr-only- kompensation'), true);
});

test('3. forged tenantId or role in the body is ignored', async () => {
  const token = await login('employee@acme.test', 'acme');
  const res = await ask(token, 'globex-secret-zebra', {
    tenantId: String(globex._id),
    role: 'admin',
  });
  assert.equal(bodyText(res).includes('globex-secret-zebra'), false);
});

test('4. every query writes an audit record matching LLM chunk ids', async () => {
  const token = await login('employee@acme.test', 'acme');
  const res = await ask(token, 'acme-secret-alpha office map');
  assert.equal(res.status, 200);
  const logs = await AuditLog.find({ tenantId: acme._id });
  assert.equal(logs.length, 1);
  const cited = JSON.parse(res.text.split('\n').find((l) => l.includes('citations')).slice(6));
  const citedIds = cited.citations.map((c) => String(c.chunkId)).sort();
  const loggedIds = logs[0].retrievedChunkIds.map(String).sort();
  assert.deepEqual(citedIds, loggedIds);
});

test('5. changing a document ACL changes retrieval', async () => {
  const empToken = await login('employee@acme.test', 'acme');
  const before = await ask(empToken, 'acme-secret-alpha office map');
  assert.equal(bodyText(before).includes('acme-secret-alpha'), true);

  const { Document } = require('../src/models/Document');
  const doc = await Document.findOne({ title: 'Acme handbook' });
  const privateAcl = {
    visibility: 'private',
    allowedRoles: [],
    allowedGroups: [],
    allowedUsers: [acmeAdmin._id],
  };
  await restampAcl({ tenantId: acme._id, documentId: doc._id, acl: privateAcl });

  const after = await ask(empToken, 'acme-secret-alpha office map');
  assert.equal(bodyText(after).includes('acme-secret-alpha'), false);
});

test('6. job status is not visible across tenants', async () => {
  const jobId = await createJob(acme._id, acmeAdmin._id, { type: 'ingest', documentId: 'x' });
  const stored = await getJob(acme._id, jobId);
  assert.ok(stored);
  const globexToken = await login('admin@globex.test', 'globex');
  const res = await request(getApp())
    .get(`/jobs/${jobId}`)
    .set('Authorization', `Bearer ${globexToken}`);
  assert.equal(res.status, 404);
  const acmeToken = await login('admin@acme.test', 'acme');
  const mine = await request(getApp())
    .get(`/jobs/${jobId}`)
    .set('Authorization', `Bearer ${acmeToken}`);
  assert.equal(mine.status, 200);
});

test('7. expired, tampered, or missing token is 401 on protected routes', async () => {
  const app = getApp();
  const missing = await request(app).get('/me');
  assert.equal(missing.status, 401);

  const token = await login('employee@acme.test', 'acme');
  const tampered = token.slice(0, -2) + 'ab';
  const bad = await request(app).get('/me').set('Authorization', `Bearer ${tampered}`);
  assert.equal(bad.status, 401);

  const expired = jwt.sign(
    {
      tenantId: String(acme._id),
      role: 'admin',
      groups: [],
      exp: Math.floor(Date.now() / 1000) - 60,
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', subject: String(acmeAdmin._id) }
  );
  const exp = await request(app).post('/ask').set('Authorization', `Bearer ${expired}`).send({ query: 'hi' });
  assert.equal(exp.status, 401);
});
