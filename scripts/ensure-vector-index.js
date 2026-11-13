const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../src/config');
require('../src/models/Chunk');

async function main() {
  const spec = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'atlas-vector-index.json'), 'utf8')
  );
  await mongoose.connect(config.mongoUri);
  const col = mongoose.connection.collection('chunks');
  const existing = await col.listSearchIndexes().toArray();
  if (existing.some((idx) => idx.name === spec.name)) {
    console.log(`Search index "${spec.name}" already exists`);
  } else {
    await col.createSearchIndex({
      name: spec.name,
      type: spec.type,
      definition: spec.definition,
    });
    console.log(`Created search index "${spec.name}"`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
