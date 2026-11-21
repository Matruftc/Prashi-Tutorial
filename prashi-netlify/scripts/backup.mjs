import { BSON } from 'mongodb';
import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { database } from '../lib/database.mjs';

const target = process.argv[2];
if (!target) {
  console.error('Provide a new directory for the Atlas backup.');
  process.exit(1);
}
const directory = resolve(target);
const db = await database();
const session = db.client.startSession({ snapshot: true });
try {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(row => row.name).filter(name => /^[a-zA-Z0-9_-]+$/.test(name) && !['sessions', 'rate_limits'].includes(name));
  await mkdir(directory, { mode: 0o700 });
  const totals = {};
  for (const name of names) {
    const file = await open(resolve(directory, name + '.ndjson'), 'wx', 0o600);
    let count = 0;
    try {
      for await (const row of db.collection(name).find({}, { session, projection: name === 'users' ? { password_reset: 0 } : {} })) {
        await file.writeFile(BSON.EJSON.stringify(row, { relaxed: false }) + '\n');
        count++;
      }
    } finally { await file.close(); }
    totals[name] = count;
  }
  const manifest = await open(resolve(directory, 'manifest.json'), 'wx', 0o600);
  try { await manifest.writeFile(JSON.stringify({ database: db.databaseName, created_at: new Date(), totals }, null, 2) + '\n'); }
  finally { await manifest.close(); }
  console.log('Verified snapshot export of ' + Object.keys(totals).length + ' collections.');
} catch (error) {
  console.error('Backup incomplete:', error.name);
  process.exitCode = 1;
} finally {
  await session.endSession();
  await db.client.close();
}
