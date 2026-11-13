const mongoose = require('mongoose');
const config = require('./config');
const app = require('./app');
const { getClient } = require('./services/redis');

async function main() {
  await mongoose.connect(config.mongoUri);
  await getClient();
  console.log('MongoDB connected');
  app.listen(config.port, () => console.log(`Listening on :${config.port}`));
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
