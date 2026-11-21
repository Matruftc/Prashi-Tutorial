import { argon2, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(argon2);
const FORMAT = /^\$argon2id\$v=19\$m=(\d{1,8}),t=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]{11,344})\$([A-Za-z0-9+/]{6,344})$/;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function verifyPassword(encoded, password) {
  const match = typeof encoded === 'string' && FORMAT.exec(encoded);
  if (!match || typeof password !== 'string' || password.length > 300) return false;
  const [, m, t, p, salt, digest] = match;
  const [memory, passes, parallelism] = [Number(m), Number(t), Number(p)];
  if (parallelism < 1 || parallelism > 16 || passes < 1 || passes > 12 || memory < 8 * parallelism || memory > 262144) return false;
  const expected = Buffer.from(digest, 'base64');
  if (expected.length < 4) return false;
  const actual = await derive('argon2id', {
    message: Buffer.from(password), nonce: Buffer.from(salt, 'base64'),
    memory, passes, parallelism, tagLength: expected.length,
  });
  return timingSafeEqual(expected, actual);
}

export async function hashPassword(password, salt) {
  const settings = { message: Buffer.from(password), nonce: salt, memory: 65536, passes: 3, parallelism: 4, tagLength: 32 };
  const digest = await derive('argon2id', settings);
  const base64 = bytes => bytes.toString('base64').replace(/=+$/, '');
  return '$argon2id$v=19$m=65536,t=3,p=4$' + base64(salt) + '$' + base64(digest);
}
