import { database } from '../lib/database.mjs';

const db = await database();
try {
  const checks = [
    db.collection('users').createIndex({ 'password_reset.token_hash': 1 }, { sparse: true }),
    db.collection('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection('rate_limits').createIndex({ reset_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection('netlify_exams').createIndex({ class_level: 1, opens: -1 }),
    db.collection('netlify_attempts').createIndex({ student_id: 1, exam_id: 1 }),
    db.collection('netlify_attempts').createIndex({ last_violation: -1 }, { sparse: true }),
    db.collection('netlify_materials').createIndex({ class_level: 1, created_at: -1 }),
  ];
  const names = await Promise.all(checks);
  console.log('Verified ' + names.length + ' Netlify portal indexes.');
} catch (error) {
  console.error('Atlas index setup failed:', error.name);
  process.exitCode = 1;
} finally {
  await db.client.close();
}
