require('./env');

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');
const Document = require('../src/models/Document');
const Chunk = require('../src/models/Chunk');
const AuditLog = require('../src/models/AuditLog');
const { fakeEmbed } = require('../src/services/embeddings');
const { restampAcl } = require('../src/pipeline/ingest');
const { flushRedis } = require('../src/services/redis');

const PASSWORD = 'ChangeMe123!';
let mongod;
let app;

async function startDb() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = require('../src/app');
}

async function stopDb() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function resetSeed() {
  await flushRedis();
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Document.deleteMany({}),
    Chunk.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const acme = await Tenant.create({ name: 'Acme Corp', slug: 'acme' });
  const globex = await Tenant.create({ name: 'Globex Inc', slug: 'globex' });
  const users = await User.insertMany([
    { tenantId: acme._id, email: 'admin@acme.test', role: 'admin', groups: [], passwordHash },
    { tenantId: acme._id, email: 'hr.manager@acme.test', role: 'manager', groups: ['hr'], passwordHash },
    { tenantId: acme._id, email: 'employee@acme.test', role: 'employee', groups: [], passwordHash },
    { tenantId: globex._id, email: 'admin@globex.test', role: 'admin', groups: [], passwordHash },
    { tenantId: globex._id, email: 'hr.manager@globex.test', role: 'manager', groups: ['hr'], passwordHash },
    { tenantId: globex._id, email: 'employee@globex.test', role: 'employee', groups: [], passwordHash },
  ]);
  return { acme, globex, users, passwordHash };
}

async function login(email, tenant = 'acme') {
  const res = await request(app)
    .post('/auth/login')
    .send({ tenant, email, password: PASSWORD });
  return res.body.token;
}

async function insertDocWithChunks({ tenantId, ownerId, title, text, acl, uniquePhrase }) {
  const body = uniquePhrase ? `${text} ${uniquePhrase}` : text;
  const doc = await Document.create({
    tenantId,
    ownerId,
    title,
    status: 'ready',
    sizeBytes: body.length,
    filePath: '/tmp/fake.pdf',
    acl,
  });
  const chunk = await Chunk.create({
    tenantId,
    documentId: doc._id,
    ownerId,
    text: body,
    embedding: fakeEmbed(body),
    chunkIndex: 0,
    acl,
  });
  return { doc, chunk };
}

function makeSamplePdf(text = 'Hello Multi Tenant World') {
  // Simple PDF with optional text; returns a well‑formed PDF buffer.
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 50 700 Td (${text}) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000010 00000 n 
0000000067 00000 n 
0000000124 00000 n 
0000000201 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
357
%%EOF`;
  return Buffer.from(pdf, 'utf8');
  // Minimal static PDF containing simple text. This avoids complex generation issues.
  const pdf = `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 50 700 Td (${text}) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f \r\n0000000010 00000 n \r\n0000000066 00000 n \r\n0000000123 00000 n \r\n0000000193 00000 n \r\ntrailer
<< /Size 5 /Root 1 0 R >>
startxref
262
%%EOF`;
  return Buffer.from(pdf, 'utf8');

  const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  const header = '%PDF-1.3\n';
  let body = '';
  const xref = ['0000000000 65535 f \r\n'];

  for (let i = 0; i < objects.length; i += 1) {
    const offset = Buffer.byteLength(header + body);
    xref.push(`${String(offset).padStart(10, '0')} 00000 n \r\n`);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(header + body);
  const tail =
    `xref\n0 ${objects.length + 1}\n${xref.join('')}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(header + body + tail);
}
  // Return a minimal static PDF buffer. The PDF contains a simple text object.
  // This avoids dependence on async PDF generation and ensures a well‑formed PDF.
  const pdfBase64 =
    'JVBERi0xLjEKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDE+PgplbmRvYmoKMyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDIwMCAyMDBdIC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNC AwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgMCAwIFRkIChIZWxsbyApIFRqIEVUID5lbmRzdHJlYW0KZW5kb2JqCnl4cmVmCjAgNQowMDAwMDAwMDAwMDAwMDAwMDAwMDAgNjU1MzUgZgogMDAwMDAwMDAwMDAwMDAwMDAwMDAwIDEgMDAwMDAwMDAwMDAwMDAwMDAwMDAwIDEgaW4KICAgMDAwMDAwMDAwMDI4IDAwMDAgbiAKMDAwMDAwMDAwMDEwMCAwMDAwIG4gCjAwMDAwMDAwMDA2MCAwMDAwIG4gCjAwMDAwMDAwMDEyNyAwMDAwIG4gCjAwMDAwMDAwMDIxMiAwMDAwIG4gCnhyZWYKNSAwCjAwMDAwMDAwMDAwMDAwMDAwMDAwMGYKc3RhcnR4cmVmCjI3MgovICU+Pgo=';
  // The above base64 encodes a minimal PDF with the text "Hello".
  const buf = Buffer.from(pdfBase64, 'base64');
  return buf;

  // Generate a minimal valid PDF using pdf-lib to avoid XRef errors.
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const createPdf = async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    const fontSize = 12;
    page.drawText(text, {
      x: 50,
      y: height - 50 - fontSize,
      size: fontSize,
      font,
    });
    const pdfBytes = await doc.save();
    return Buffer.from(pdfBytes);
  };
  // Since this function is used synchronously in tests, we block on the promise.
  // In Node >= 12, we can use an async IIFE with .then, but here we use deasync-like hack.
  const deasync = require('deasync');
  let result;
  createPdf().then((buf) => { result = buf; }).catch((e) => { throw e; });
  // Wait until result is set.
  while (result === undefined) {
    deasync.sleep(10);
  }
  return result;

  const content = `BT /F1 12 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];

  const header = '%PDF-1.3\n';
  let body = '';
  const xref = ['0000000000 65535 f \r\n'];

  for (let i = 0; i < objects.length; i += 1) {
    const offset = Buffer.byteLength(header + body);
    xref.push(`${String(offset).padStart(10, '0')} 00000 n \r\n`);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const startxref = Buffer.byteLength(header + body);
  const tail =
    `xref\n0 ${objects.length + 1}\n${xref.join('')}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  return Buffer.from(header + body + tail);
}

module.exports = {
  PASSWORD,
  startDb,
  stopDb,
  resetSeed,
  login,
  insertDocWithChunks,
  restampAcl,
  makeSamplePdf,
  getApp: () => app,
};
