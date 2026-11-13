const mongoose = require('mongoose');
const config = require('./config');
const { dequeueBlocking } = require('./services/redis');
const { markJob } = require('./services/jobs');
const { ingestDocument, restampAcl, failIngest } = require('./pipeline/ingest');
const { toObjectId } = require('./lib/ids');
const Document = require('./models/Document');

async function handle(job) {
  const tenantId = job.tenantId;
  const jobId = job.jobId;
  await markJob(tenantId, jobId, { status: 'processing' });

  const tId = toObjectId(tenantId);
  const dId = toObjectId(job.documentId);
  if (!tId || !dId) throw new Error('Invalid job identity');

  if (job.type === 'restamp_acl') {
    await Document.updateOne({ _id: dId, tenantId: tId }, { status: 'restamping' });
    await restampAcl({ tenantId, documentId: job.documentId, acl: job.acl });
    await markJob(tenantId, jobId, { status: 'done' });
    return;
  }

  if (job.type === 'ingest') {
    await Document.updateOne({ _id: dId, tenantId: tId }, { status: 'processing' });
    await ingestDocument(job);
    await markJob(tenantId, jobId, { status: 'done' });
    return;
  }

  throw new Error(`Unknown job type: ${job.type}`);
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('Worker connected to MongoDB');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const job = await dequeueBlocking();
    if (!job) continue;
    try {
      await handle(job);
    } catch (err) {
      console.error('Job failed', job.jobId, err);
      try {
        await failIngest({ tenantId: job.tenantId, documentId: job.documentId, err });
        await markJob(job.tenantId, job.jobId, { status: 'failed', error: 'processing_failed' });
      } catch (inner) {
        console.error('Cleanup failed', inner);
      }
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Worker startup failed:', err);
    process.exit(1);
  });
}

module.exports = { handle };
