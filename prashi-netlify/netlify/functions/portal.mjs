import { legacyDownload, legacyName } from '../../lib/legacy-files.mjs';
import { requestPasswordReset, resetPassword, sendResetEmail } from '../../lib/recovery.mjs';
import { publicationWindow } from '../../lib/published.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { allowedMethods, databaseErrorStatus, jsonResponder } from '../../lib/http-status.mjs';
import { statusPage } from '../../lib/page-status.mjs';
import { tutorialRoute } from '../../lib/tutorial.mjs';
import { adminOps } from '../../lib/export.mjs';
import { siteAdmin } from '../../lib/site-admin.mjs';
import { publicContent, receiveEnquiry, inboxRoute, publicForms, receiveCustomForm, publicDetail, sitemap } from '../../lib/public-content.mjs';
import { recordsRoute } from '../../lib/records.mjs';
import { peopleRoute } from '../../lib/people.mjs';
import { questionBankRoute } from '../../lib/question-bank.mjs';
import { fileRoute } from '../../lib/documents.mjs';
import { examsRoute } from '../../lib/exams.mjs';
import { database } from '../../lib/database.mjs';
import { hashPassword, sha256, verifyPassword } from '../../lib/security.mjs';

const cookieName = 'prashi_session';
const sessionLength = 8 * 60 * 60;
const ignoreCase = { locale: 'en', strength: 2 };
const accountProjection = { _id: 0, id: 1, name: 1, role: 1, must_change_password: 1, password_hash: 1 };
let dummyHash;

function cookie(value, age, url) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age + secure;
}

function cookieToken(request) {
  const match = request.headers.get('cookie')?.match(/(?:^|;\s*)prashi_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1];
}

function headersForUser(user) {
  return { id: user.id, name: user.name, role: user.role, mustChangePassword: Boolean(user.must_change_password) };
}

async function sessionUser(db, request) {
  const token = cookieToken(request);
  if (!token) return null;
  const entry = await db.collection('sessions').findOne({ _id: sha256(token), expires_at: { $gt: new Date() } });
  if (!entry) return null;
  return db.collection('users').findOne({
    id: entry.uid, active: 1, password_hash: { $exists: true },
  }, { projection: accountProjection }).then(user => user && sha256(user.password_hash) === entry.credential ? user : null);
}

async function newSession(db, user, url, previousToken, json) {
  const token = randomBytes(32).toString('hex');
  await db.collection('sessions').insertOne({
    _id: sha256(token), uid: user.id, credential: sha256(user.password_hash),
    expires_at: new Date(Date.now() + sessionLength * 1000),
  });
  if (previousToken) await db.collection('sessions').deleteOne({ _id: sha256(previousToken) });
  return json(headersForUser(user), 200, { 'Set-Cookie': cookie(token, sessionLength, url) });
}

async function limited(db, label, identifier, period, max) {
  const expired = { $lte: [{ $ifNull: ['$reset_at', '$$NOW'] }, '$$NOW'] };
  const row = await db.collection('rate_limits').findOneAndUpdate({
    _id: 'netlify:' + label + ':' + sha256(identifier),
  }, [{ $set: {
    hits: { $cond: [expired, 1, { $add: ['$hits', 1] }] },
    reset_at: { $cond: [expired, { $add: ['$$NOW', period] }, '$reset_at'] },
  } }], { upsert: true, returnDocument: 'after' });
  return row.hits > max;
}

async function login(db, request, context, url, { identifier, password }, json) {
  if (typeof identifier !== 'string' || typeof password !== 'string') return json({ message: 'Enter your username and password.' }, 400);
  const key = identifier.trim().toLowerCase().slice(0, 200);
  if (!key || !password || password.length > 300) return json({ message: 'Enter your username and password.' }, 400);
  if (await limited(db, 'login-ip', context.ip || 'local', 900000, 30) ||
      await limited(db, 'login-account', key, 900000, 10)) return json({ message: 'Too many attempts. Try again in 15 minutes.' }, 429);
  const user = await db.collection('users').findOne({
    active: 1, $or: [{ email: key }, { username: key }],
  }, { collation: ignoreCase, projection: accountProjection });
  if (!user) dummyHash ??= hashPassword('unavailable account', randomBytes(16));
  const verified = await verifyPassword(user?.password_hash || await dummyHash, password);
  if (!user || !verified) return json({ message: 'Incorrect username or password.' }, 401);
  await db.collection('rate_limits').deleteOne({ _id: 'netlify:login-account:' + sha256(key) });
  return newSession(db, user, url, cookieToken(request), json);
}

async function changePassword(db, user, request, url, { current, replacement }, json) {
  if (typeof current !== 'string' || typeof replacement !== 'string' || replacement.length < 10 || replacement.length > 200 || replacement === current) {
    return json({ message: 'Choose a different password with 10 to 200 characters.' }, 400);
  }
  if (await limited(db, 'change', String(user.id), 900000, 5)) return json({ message: 'Too many attempts. Try again in 15 minutes.' }, 429);
  if (!await verifyPassword(user.password_hash, current)) return json({ message: 'Your current password is incorrect.' }, 400);
  const password_hash = await hashPassword(replacement, randomBytes(16));
  const result = await db.collection('users').updateOne(
    { id: user.id, password_hash: user.password_hash }, { $set: { password_hash, must_change_password: 0 }, $unset: { password_reset: '' } },
  );
  if (!result.matchedCount) return json({ message: 'Your password has already changed. Sign in again.' }, 409);
  return newSession(db, { ...user, password_hash, must_change_password: 0 }, url, cookieToken(request), json);
}

async function studentOverview(db, uid) {
  const [profile, attendance, enrollments, scores, batches] = await Promise.all([
    db.collection('students').findOne({ user_id: uid }, { projection: { _id: 0, admission_no: 1, class_level: 1, school: 1, photo: 1 } }),
    db.collection('attendance').find({ student_id: uid }, { projection: { _id: 0, day: 1, status: 1 } }).sort('day', -1).limit(30).toArray(),
    db.collection('enrollments').aggregate([
      { $match: { student_id: uid } },
      { $lookup: { from: 'batches', localField: 'batch_id', foreignField: 'id', as: 'batch' } },
      { $lookup: { from: 'payments', localField: 'id', foreignField: 'enrollment_id', as: 'payments' } },
      { $project: { _id: 0, batch: { $first: '$batch.name' }, status: 1, payable: { $subtract: ['$fee_total', '$discount'] }, paid: { $sum: '$payments.amount' } } },
    ]).toArray(),
    db.collection('records').find({ student_id: uid, type: 'mock_result', visible_to_student: 1 }, { projection: {
      _id: 0, title: 1, score: 1, max_score: 1, record_date: 1,
    } }).sort('id', -1).limit(50).toArray(),
    db.collection('enrollments').distinct('batch_id', { student_id: uid, status: { $ne: 'dropped' } }),
  ]);
  const records = await db.collection('records').find({ visible_to_student: 1,
    type: { $in: ['material', 'notes', 'test_paper', 'remark'] }, $or: [
      { student_id: uid }, { student_id: null, batch_id: { $in: batches } },
    ],
  }, { projection: { _id: 0, title: 1, body: 1, type: 1, file_path: 1 } }).sort('id', -1).limit(100).toArray();
  const notices = await db.collection('notices').find({
    visible: 1, audience: 'students', ...publicationWindow(), $or: [{ batch_id: null }, { batch_id: { $in: batches } }],
  }, { projection: { _id: 0, title: 1, body_html: 1 } }).sort({ pinned: -1, created_at: -1 }).limit(30).toArray();
  const activeEnrollments = await db.collection('enrollments').distinct('id', { student_id: uid });
  const payments = await db.collection('payments').find({ enrollment_id: { $in: activeEnrollments } }, {
    projection: { _id: 0, id: 1, receipt_no: 1, paid_on: 1, amount: 1 },
  }).sort('id', -1).limit(100).toArray();
  const photo = legacyName(profile?.photo);
  if (profile) {
    delete profile.photo;
    const uploaded = await db.collection('student_photos').findOne({ _id: uid }, { projection: { _id: 1 } });
    if (uploaded) profile.photoUrl = '/api/student/photo';
    else if (photo) profile.photoUrl = '/api/legacy/private/' + photo;
  }
  return { profile, attendance, enrollments, scores, payments, notices, records: records.map(({ file_path, ...item }) => {
    const name = legacyName(file_path);
    return { ...item, ...(name ? { fileUrl: '/api/legacy/private/' + name } : {}) };
  }) };
}

async function studentQuestions(db, uid) {
  const [student, batches] = await Promise.all([
    db.collection('students').findOne({ user_id: uid }, { projection: { class_level: 1 } }),
    db.collection('enrollments').distinct('batch_id', { student_id: uid, status: { $ne: 'dropped' } }),
  ]);
  if (!student) return [];
  const audience = [{ batch_id: { $in: batches } }];
  if (student.class_level) audience.push({ class_level: student.class_level, batch_id: null });
  const fields = ['class_level', 'subject', 'chapter', 'q_type'];
  const groups = await db.collection('chapter_access').find({ $or: audience }, {
    collation: ignoreCase, projection: { _id: 0, ...Object.fromEntries(fields.map(field => [field, 1])) },
  }).toArray();
  if (!groups.length) return [];
  return db.collection('questions').find({ $or: groups }, { collation: ignoreCase, projection: {
    _id: 0, class_level: 1, subject: 1, chapter: 1, q_type: 1, qid: 1, question_text: 1, answer_text: 1,
  } }).sort([['class_level', 1], ['subject', 1], ['chapter', 1], ['qid', 1]]).limit(1000).toArray();
}

async function staffOverview(db, role) {
  const [students, faculty, teachers, questions] = await Promise.all([
    db.collection('students').aggregate([
      { $lookup: { from: 'users', localField: 'user_id', foreignField: 'id', as: 'account' } },
      { $project: { _id: 0, admission_no: 1, class_level: 1, school: 1, name: { $first: '$account.name' } } },
      { $sort: { name: 1 } }, { $limit: 250 },
    ]).toArray(),
    db.collection('faculty').find({}, { projection: { _id: 0, name: 1, subject: 1, qualifications: 1 } }).sort('sort_order', 1).limit(100).toArray(),
    role === 'admin' ? db.collection('users').find({ role: { $in: ['admin', 'staff'] } }, { projection: {
      _id: 0, name: 1, email: 1, role: 1, active: 1,
    } }).sort('name', 1).limit(100).toArray() : [],
    db.collection('questions').find({}, { projection: {
      _id: 0, class_level: 1, subject: 1, chapter: 1, q_type: 1, question_text: 1,
    } }).sort('id', -1).limit(100).toArray(),
  ]);
  return { students, faculty, teachers, questions };
}

export function makePortalHandler(getDatabase, { sendRecovery = sendResetEmail } = {}) {
  return async (request, context = {}) => {
    const requestId = randomUUID();
    const json = jsonResponder(requestId);
    const headOnly = request.method === 'HEAD';
    async function respond() {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/$/, '');
      const action = /^\/(courses|resources)\//.test(path) ? 'page' + path
        : path.replace(/^\/(?:api|\.netlify\/functions\/portal)\/?/, '').replace(/^\//, '');
      const isPage = action.startsWith('page/');
      const method = headOnly ? 'GET' : request.method;
      const allowed = allowedMethods(action);
      if (!allowed.length) return isPage ? statusPage(404) : json({ message: 'API route not found.' }, 404);
      if (!allowed.includes(request.method)) return json({ message: 'Method not allowed.' }, 405, { Allow: allowed.join(', ') });
      if (action === 'healthz') return json({ status: 'ok' });
      try {
        let payload;
        if (method === 'POST') {
          if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
            return json({ message: 'Request origin is invalid.' }, 403);
          }
          if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json({ message: 'Expected a JSON request.' }, 415);
          const sizeLimit = action === 'documents/extract' || action === 'materials' || action === 'student/photo' || action === 'tutorial' ? 4_200_000 :
            action.startsWith('exams') || action.startsWith('question-bank') || action === 'records/attendance/batch' || action === 'people/students/import' || action.startsWith('forms/') || action.startsWith('site-admin/') ? 512_000 : 4096;
          const expectedSize = Number(request.headers.get('content-length'));
          if (expectedSize > sizeLimit) return json({ message: 'Request is too large.' }, 413);
          const reader = request.body?.getReader();
          const decoder = new TextDecoder();
          let size = 0;
          let text = '';
          if (reader) {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > sizeLimit) {
                reader.cancel().catch(() => {});
                return json({ message: 'Request is too large.' }, 413);
              }
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
          }
          try { payload = JSON.parse(text); } catch { return json({ message: 'Invalid JSON.' }, 400); }
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ message: 'Invalid request.' }, 400);
        }
        const db = await getDatabase();
        if (action === 'readyz') {
          await db.command({ ping: 1 });
          return json({ status: 'ready', database: 'available' });
        }
        if (isPage) {
          const [, section, slug] = action.split('/');
          const record = await publicDetail(db, section, slug, json);
          if (record.status === 404) return statusPage(404);
          const html = await readFile(new URL('../../site/index.html', import.meta.url));
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
        }
        if (action.startsWith('forms/')) {
          const kind = action.split('/')[1];
          if (method === 'GET') return await publicForms(db, kind, json);
          if (method === 'POST') {
            if (await limited(db, 'enquiry', context.ip || 'local', 3600000, 8)) return json({ message: 'Too many requests. Try again later.' }, 429, { 'Retry-After': '3600' });
            return await receiveCustomForm(db, kind, payload, json);
          }
        }
        if (action === 'sitemap.xml' && method === 'GET') return await sitemap(db, url);
        if (action.startsWith('website/') && method === 'GET') {
          const [, section, slug] = action.split('/');
          return await publicDetail(db, section, slug, json);
        }
        if (action === 'website' && method === 'GET') return json(await publicContent(db));
        if (action === 'enquiry' && method === 'POST') {
          if (await limited(db, 'enquiry', context.ip || 'local', 3600000, 8)) return json({ message: 'Too many requests. Try again later.' }, 429, { 'Retry-After': '3600' });
          return await receiveEnquiry(db, payload, json);
        }
        if (action === 'forgot' && method === 'POST') {
          if (!await limited(db, 'forgot', context.ip || 'local', 900000, 5)) {
            const identifier = typeof payload.identifier === 'string' ? payload.identifier.trim().toLowerCase().slice(0, 200) : '';
            if (identifier && !await limited(db, 'forgot-account', identifier, 900000, 3)) await requestPasswordReset(db, identifier, sendRecovery);
          }
          return json({ message: 'If that account can receive email, a reset link will be sent.' });
        }
        if (action === 'reset' && method === 'POST') {
          if (await limited(db, 'reset', context.ip || 'local', 900000, 10)) return json({ message: 'Try again in 15 minutes.' }, 429);
          if (!await resetPassword(db, payload.token, payload.replacement)) return json({ message: 'The link is invalid or expired, or the password is too short.' }, 400);
          return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, url) });
        }
        if (action === 'login' && method === 'POST') return await login(db, request, context, url, payload, json);
        if (action.startsWith('legacy/public/') && method === 'GET') return await legacyDownload(db, action, null, json);
        const user = await sessionUser(db, request);
        if (action === 'session' && method === 'GET') return json({ user: user && headersForUser(user) });
        if (action === 'logout' && method === 'POST') {
          const token = cookieToken(request);
          if (token) await db.collection('sessions').deleteOne({ _id: sha256(token) });
          return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, url) });
        }
        if (!user) return json({ message: 'Sign in to continue.' }, 401);
        if (action === 'password' && method === 'POST') return await changePassword(db, user, request, url, payload, json);
        if (user.must_change_password) return json({ message: 'Change your temporary password before continuing.' }, 403);
        if (action.startsWith('legacy/private/') && method === 'GET') return await legacyDownload(db, action, user, json);
        if (action === 'activity' || action === 'exports' || action.startsWith('exports/')) return await adminOps(db, user, action, method, json);
        const mutatingRoute = async () => {
          if (action === 'site-admin' || action.startsWith('site-admin/')) return siteAdmin(db, user, action, method, payload, json);
          if (action === 'tutorial' || action.startsWith('tutorial/')) return tutorialRoute(db, user, action, method, payload, url, json);
          if (action === 'inbox' || action.startsWith('inbox/')) return inboxRoute(db, user, action, method, payload, json);
          if (action === 'records' || action.startsWith('records/')) return recordsRoute(db, user, action, method, payload, json);
          if (action.startsWith('people/')) return peopleRoute(db, user, action, method, payload, json);
          if (action === 'question-bank' || action.startsWith('question-bank/')) {
            return questionBankRoute(db, user, action, method, payload, url, json);
          }
          if (action === 'documents/extract' || action === 'materials' || action === 'student/photo' || action.startsWith('materials/')) {
            return fileRoute(db, user, action, method, payload, json);
          }
          if (action === 'exams' || action.startsWith('exams/')) return examsRoute(db, user, action, method, payload, json);
          return null;
        };
        const response = await mutatingRoute();
        if (response) {
          if (method === 'POST' && response.ok && action !== 'documents/extract' &&
              !action.startsWith('student/photo') && !action.startsWith('exams/') &&
              !action.startsWith('records/doubts')) {
            await db.collection('audit_log').insertOne({ user_id: user.id, user_name: user.name,
              action: 'update', entity: action.split('/')[0], summary: action, created_at: new Date().toISOString() })
              .catch(error => console.error('Prashi audit write failed', error.name));
          }
          return response;
        }
        if (method !== 'GET') return json({ message: 'Method not allowed.' }, 405);
        if (action === 'student' && user.role === 'student') return json(await studentOverview(db, user.id));
        if (action === 'student/questions' && user.role === 'student') return json({ questions: await studentQuestions(db, user.id) });
        if (action === 'staff' && ['admin', 'staff'].includes(user.role)) return json(await staffOverview(db, user.role));
        if (['student', 'student/questions', 'staff'].includes(action)) return json({ message: 'Access denied.' }, 403);
        return json({ message: 'API route not found.' }, 404);
      } catch (error) {
        const status = action === 'readyz' ? 503 : databaseErrorStatus(error);
        console.error('Prashi portal request failed', requestId, error.name);
        if (isPage) return statusPage(status);
        if (status === 409) return json({ message: 'That record already exists.' }, 409);
        if (status === 503) return json({ message: 'The database is temporarily unavailable.' }, 503, { 'Retry-After': '30' });
        return json({ message: 'The portal couldn’t complete this request.' }, 500);
      }
    }

    const response = await respond();
    response.headers.set('X-Request-ID', requestId);
    if (!headOnly) return response;
    if (response.body) await response.body.cancel();
    return new Response(null, { status: response.status, headers: response.headers });
  };
}

export default makePortalHandler(database);
