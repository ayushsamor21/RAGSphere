require('./env');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildAclFilter } = require('../src/services/aclFilter');
const { buildVectorSearchPipeline } = require('../src/services/retrieval');

test('acl filter is built from JWT identity only and fails closed', () => {
  assert.equal(buildAclFilter(null), null);
  assert.equal(buildAclFilter({ tenantId: 'nope', userId: 'nope', role: 'admin' }), null);

  const tenantId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const filter = buildAclFilter({
    tenantId: String(tenantId),
    userId: String(userId),
    role: 'employee',
    groups: [],
  });
  assert.ok(filter.$and);
  const or = filter.$and[1].$or;
  assert.equal(
    or.some((c) => c['acl.allowedGroups']),
    false,
    'empty groups must not add a matching clause'
  );
  assert.ok(or.some((c) => c['acl.allowedRoles'] && c['acl.allowedRoles'].$in.includes('employee')));
});

test('vector search pipeline puts ACL inside $vectorSearch.filter', () => {
  const filter = { tenantId: { $eq: 'x' } };
  const pipeline = buildVectorSearchPipeline({
    queryVector: new Array(768).fill(0),
    filter,
  });
  assert.deepEqual(pipeline[0].$vectorSearch.filter, filter);
  assert.ok(pipeline[2].$match.score.$gte >= 0.7);
});
