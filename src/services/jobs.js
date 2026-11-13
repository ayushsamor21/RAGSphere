const crypto = require('crypto');
const { enqueue, setJob, getJob } = require('./redis');

async function createJob(tenantId, userId, fields) {
  const jobId = crypto.randomUUID();
  const payload = {
    jobId,
    tenantId: String(tenantId),
    userId: String(userId),
    status: 'queued',
    ...fields,
  };
  await setJob(tenantId, jobId, payload);
  await enqueue(payload);
  return jobId;
}

async function readJobForUser(user, jobId) {
  const record = await getJob(user.tenantId, jobId);
  if (!record) return null;
  // Admins of this tenant may see any job; others only their own.
  if (user.role !== 'admin' && record.userId !== String(user.userId)) return null;
  return record;
}

async function markJob(tenantId, jobId, fields) {
  await setJob(tenantId, jobId, { ...fields, updatedAt: new Date().toISOString() });
}

module.exports = { createJob, readJobForUser, markJob };
