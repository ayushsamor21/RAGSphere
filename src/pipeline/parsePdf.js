const pdfParse = require('pdf-parse');

async function parsePdf(buffer) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const result = await pdfParse(data);
  return { text: result.text || '', pages: result.numpages || 0 };
}

module.exports = { parsePdf };
