import { randomBytes } from 'node:crypto';
import { hashPassword, sha256 } from './security.mjs';

const ignoreCase = { locale: 'en', strength: 2 };
const tokenPattern = /^[a-f0-9]{64}$/;

export async function sendResetEmail(to, token) {
  const { RESEND_API_KEY, MAIL_FROM, SITE_URL, URL: netlifyUrl } = process.env;
  if (!RESEND_API_KEY || !MAIL_FROM || !(SITE_URL || netlifyUrl)) return false;
  const link = new URL('/reset', SITE_URL || netlifyUrl);
  if (link.protocol !== 'https:') return false;
  link.hash = token;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: 'Reset your Prashi Tutorial password',
      text: 'Choose a new password using this link within one hour:\n\n' + link.href + '\n\nIf you did not request this, ignore this email.' }),
  });
  return response.ok;
}

export async function requestPasswordReset(db, identifier, sendEmail) {
  if (typeof identifier !== 'string' || !(identifier = identifier.trim().toLowerCase().slice(0, 200))) return;
  const users = db.collection('users');
  const user = await users.findOne({ active: 1, $or: [{ email: identifier }, { username: identifier }] },
    { collation: ignoreCase, projection: { id: 1, email: 1, role: 1, password_hash: 1 } });
  if (!user) return;
  const student = !user.email && user.role === 'student'
    ? await db.collection('students').findOne({ user_id: user.id }, { projection: { parent_email: 1 } }) : null;
  const recipient = user.email || student?.parent_email;
  if (!recipient) return;
  const token = randomBytes(32).toString('hex');
  const entry = { token_hash: sha256(token), expires_at: new Date(Date.now() + 3600000) };
  const changed = await users.updateOne({ _id: user._id, active: 1, password_hash: user.password_hash },
    { $set: { password_reset: entry } });
  if (!changed.matchedCount) return;
  let delivered = false;
  try { delivered = await sendEmail(recipient, token); }
  catch (error) { console.error('Prashi recovery email failed', error.name); }
  if (!delivered) await users.updateOne({ _id: user._id, 'password_reset.token_hash': entry.token_hash },
    { $unset: { password_reset: '' } });
}

export async function resetPassword(db, token, replacement) {
  if (typeof token !== 'string' || !tokenPattern.test(token) || typeof replacement !== 'string' ||
      replacement.length < 10 || replacement.length > 200) return false;
  const users = db.collection('users');
  const query = { active: 1, 'password_reset.token_hash': sha256(token), 'password_reset.expires_at': { $gt: new Date() } };
  if (!await users.findOne(query, { projection: { _id: 1 } })) return false;
  const password_hash = await hashPassword(replacement, randomBytes(16));
  const changed = await users.updateOne({ ...query, 'password_reset.expires_at': { $gt: new Date() } }, {
    $set: { password_hash, must_change_password: 0, failed_logins: 0, locked_until: null },
    $unset: { password_reset: '' },
  });
  return Boolean(changed.matchedCount);
}
