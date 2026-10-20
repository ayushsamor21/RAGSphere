// DEV ONLY: wipes tenants and users, then creates two tenants with mixed roles.
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const Tenant = require('../src/models/Tenant');
const User = require('../src/models/User');

const PASSWORD = 'ChangeMe123!'; // dev-only password for all seeded users

const data = [
  {
    tenant: { name: 'Acme Corp', slug: 'acme' },
    users: [
      { email: 'admin@acme.test', role: 'admin', groups: [] },
      { email: 'hr.manager@acme.test', role: 'manager', groups: ['hr'] },
      { email: 'fin.manager@acme.test', role: 'manager', groups: ['finance'] },
      { email: 'employee@acme.test', role: 'employee', groups: [] },
    ],
  },
  {
    tenant: { name: 'Globex Inc', slug: 'globex' },
    users: [
      { email: 'admin@globex.test', role: 'admin', groups: [] },
      { email: 'hr.manager@globex.test', role: 'manager', groups: ['hr'] },
      { email: 'employee@globex.test', role: 'employee', groups: [] },
    ],
  },
];

async function main() {
  await mongoose.connect(config.mongoUri);
  await Promise.all([Tenant.deleteMany({}), User.deleteMany({})]);
  await User.syncIndexes();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (const { tenant, users } of data) {
    const t = await Tenant.create(tenant);
    await User.insertMany(users.map((u) => ({ ...u, tenantId: t._id, passwordHash })));
    console.log(`Seeded tenant "${t.slug}" with ${users.length} users`);
  }

  console.log(`\nAll seeded users share the password: ${PASSWORD}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
