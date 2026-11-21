import { Binary } from 'mongodb';
import { readFile } from 'node:fs/promises';
import { database } from '../lib/database.mjs';
import { legacyName, publicSources, privateSources } from '../lib/legacy-files.mjs';
import { sha256 } from '../lib/security.mjs';

const apply = process.argv.includes('--apply');
const db = await database();
const target = db.collection('legacy_uploads');
const candidates = [];
const imageTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

try {
  for (const [visibility, sources, directory] of [
    ['public', publicSources, '../../prashi-tutorial-py/uploads/public/'],
    ['private', privateSources, '../../prashi-tutorial-py/storage/private/'],
  ]) {
    const filenames = new Set();
    for (const [table, field] of sources) {
      const values = await db.collection(table).distinct(field);
      for (const value of values) {
        const name = legacyName(value);
        if (name) filenames.add(name);
      }
    }
    for (const name of filenames) {
      const bytes = await readFile(new URL(directory + name, import.meta.url));
      if (bytes.length > 3 * 1024 * 1024) throw new Error('A legacy file exceeds the 3 MiB download limit.');
      const type = imageTypes[name.split('.').at(-1).toLowerCase()] || 'application/octet-stream';
      candidates.push({ _id: visibility + ':' + name, type, bytes: new Binary(bytes), checksum: sha256(bytes) });
    }
  }
  for (const candidate of candidates) {
    const existing = await target.findOne({ _id: candidate._id }, { projection: { checksum: 1 } });
    if (existing && existing.checksum !== candidate.checksum) throw new Error('An Atlas file has a different checksum.');
    if (apply && !existing) await target.updateOne({ _id: candidate._id }, { $setOnInsert: candidate }, { upsert: true });
    if (apply) {
      const saved = await target.findOne({ _id: candidate._id });
      if (!saved || sha256(saved.bytes.value()) !== candidate.checksum) throw new Error('Atlas file verification failed.');
    }
  }
  const publicCount = candidates.filter(row => row._id.startsWith('public:')).length;
  console.log((apply ? 'Verified in Atlas' : 'Ready to copy') + ': ' + publicCount + ' public files and ' +
    (candidates.length - publicCount) + ' private files.');
} catch (error) {
  console.error('Legacy upload migration stopped:', error.code === 'ENOENT' ? 'A referenced source file is missing.' : error.message);
  process.exitCode = 1;
} finally {
  await db.client.close();
}
