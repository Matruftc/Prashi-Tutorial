import { randomBytes } from 'node:crypto';
import { previewStudents } from './import-students.mjs';
import { hashPassword } from './security.mjs';

const ignoreCase = { locale: 'en', strength: 2 };
const studentFields = {
  class_level: 40, school: 100, parent_name: 120, parent_phone: 30, parent_email: 200,
};

function fields(body, shape) {
  return Object.fromEntries(Object.entries(shape).filter(([key]) => typeof body[key] === 'string')
    .map(([key, size]) => [key, body[key].trim().slice(0, size) || null]));
}

export async function peopleRoute(db, user, action, method, body, send) {
  if (!['admin', 'staff'].includes(user.role)) return send({ message: 'Access denied.' }, 403);
  const users = db.collection('users');
  const students = db.collection('students');
  if (action === 'people/students' && method === 'GET') {
    const records = await students.aggregate([
      { $lookup: { from: 'users', localField: 'user_id', foreignField: 'id', as: 'account' } },
      { $project: { _id: 0, user_id: 1, admission_no: 1, class_level: 1, school: 1, parent_name: 1, parent_phone: 1, parent_email: 1,
        name: { $first: '$account.name' }, email: { $first: '$account.email' }, active: { $first: '$account.active' } } },
      { $sort: { admission_no: 1 } }, { $limit: 300 },
    ]).toArray();
    return send({ records });
  }
  if (action === 'people/teachers' && method === 'GET' && user.role === 'admin') {
    const records = await users.find({ role: { $in: ['staff', 'admin'] } },
      { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, active: 1, phone: 1 } }).sort('name', 1).limit(200).toArray();
    return send({ records });
  }
  if (action === 'people/students/template.csv' && method === 'GET') {
    return new Response('Name,Admission Number,Class,School,Student Email,Parent Name,Parent Phone,Parent Email\r\n', {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="student-import.csv"', 'Cache-Control': 'no-store' },
    });
  }
  if (action === 'people/students/import' && method === 'POST') {
    try { return send({ rows: previewStudents(body.csv) }); }
    catch (error) { return send({ message: error.code?.startsWith('CSV_') ? 'Check that each row has the same columns as the header.' : error.message }, 400); }
  }
  if (method !== 'POST') return send({ message: 'Access denied.' }, 403);
  const operation = /^people\/(students|teachers)\/(\d+)\/(reset|delete)$/.exec(action);
  if (operation) {
    const [, group, raw, operationType] = operation;
    const id = Number(raw);
    const role = group === 'students' ? 'student' : { $in: ['admin', 'staff'] };
    if (!Number.isSafeInteger(id) || id === user.id || (user.role !== 'admin' && (group === 'teachers' || operationType === 'delete'))) {
      return send({ message: 'Access denied.' }, 403);
    }
    if (operationType === 'reset') {
      const secret = randomBytes(12).toString('base64url');
      const password_hash = await hashPassword(secret, randomBytes(16));
      const changed = await users.findOneAndUpdate({ id, role }, {
        $set: { password_hash, must_change_password: 1, failed_logins: 0, locked_until: null },
        $unset: { password_reset: '' },
      });
      if (!changed) return send({ message: 'Account not found.' }, 404);
      await db.collection('sessions').deleteMany({ uid: id });
      return send({ login: changed.username || changed.email, password: secret });
    }
    if (group !== 'students') return send({ message: 'Only student accounts can be removed here.' }, 400);
    const session = db.client.startSession();
    try {
      const removed = await session.withTransaction(async () => {
        if (!(await users.deleteOne({ id, role: 'student' }, { session })).deletedCount) return false;
        const enrollmentIds = await db.collection('enrollments').distinct('id', { student_id: id }, { session });
        await db.collection('payments').deleteMany({ enrollment_id: { $in: enrollmentIds } }, { session });
        for (const collection of ['enrollments', 'attendance', 'records', 'doubts', 'netlify_attempts']) {
          await db.collection(collection).deleteMany({ student_id: id }, { session });
        }
        await students.deleteOne({ user_id: id }, { session });
        await db.collection('sessions').deleteMany({ uid: id }, { session });
        await db.collection('student_photos').deleteOne({ _id: id }, { session });
        return true;
      });
      return removed ? send({ ok: true }) : send({ message: 'Student not found.' }, 404);
    } finally { await session.endSession(); }
  }
  const creatingStudent = action === 'people/students';
  const creatingStaff = action === 'people/teachers' && user.role === 'admin';
  const match = /^people\/(students|teachers)\/(\d+)$/.exec(action);
  if (!creatingStudent && !creatingStaff && (!match || (match[1] === 'teachers' && user.role !== 'admin'))) return send({ message: 'Access denied.' }, 403);
  const account = fields(body, { name: 120, email: 200, phone: 30 });
  if ('name' in account && !account.name) return send({ message: 'Enter a name.' }, 400);
  if ((creatingStaff || match?.[1] === 'teachers') && 'email' in account && !account.email) return send({ message: 'Enter an email address.' }, 400);
  if (account.email) {
    account.email = account.email.toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(account.email)) return send({ message: 'Enter a valid email address.' }, 400);
  }
  const profile = fields(body, studentFields);
  if (profile.class_level && !/^Class (?:[1-9]|1[0-2])$|^Dropper \/ Other$/.test(profile.class_level)) return send({ message: 'Choose a valid class.' }, 400);
  const session = db.client.startSession();
  try {
    if (match) {
      const uid = Number(match[2]);
      const role = match[1] === 'students' ? 'student' : { $in: ['staff', 'admin'] };
      if (!Number.isSafeInteger(uid)) return send({ message: 'Account not found.' }, 404);
      if (typeof body.active === 'boolean' && uid !== user.id && user.role === 'admin') account.active = Number(body.active);
      const updated = await session.withTransaction(async () => {
        const filter = { id: uid, role };
        const result = Object.keys(account).length ? await users.updateOne(filter, { $set: account }, { session }) :
          await users.findOne(filter, { session });
        if (!result || ('matchedCount' in result && !result.matchedCount)) return false;
        if (role === 'student' && Object.keys(profile).length) await students.updateOne({ user_id: uid }, { $set: profile }, { session });
        return true;
      });
      return updated ? send({ ok: true }) : send({ message: 'Account not found.' }, 404);
    }
    const admission = typeof body.admission === 'string' ? body.admission.trim().toUpperCase() : '';
    if (!account.name || (creatingStaff && !account.email) || (creatingStudent && !/^[A-Z0-9-]{3,20}$/.test(admission))) {
      return send({ message: 'Enter a name and valid email or admission number.' }, 400);
    }
    const password = randomBytes(12).toString('base64url');
    const password_hash = await hashPassword(password, randomBytes(16));
    const newest = await users.findOne({ id: { $type: 'number' } }, { projection: { id: 1 }, sort: { id: -1 } });
    const counters = db.collection('counters');
    await counters.updateOne({ _id: 'users' }, { $max: { value: newest?.id ?? 0 } }, { upsert: true });
    const created = await session.withTransaction(async () => {
      const next = await counters.findOneAndUpdate({ _id: 'users' }, { $inc: { value: 1 } }, { returnDocument: 'after', session });
      const id = next.value;
      const username = creatingStudent ? admission.toLowerCase() : null;
      const email = account.email ?? null;
      const login = username || email;
      const duplicate = await users.findOne({ $or: [{ username: login }, { email: login }, ...(email && username ? [{ email }, { username: email }] : [])] },
        { collation: ignoreCase, session, projection: { _id: 1 } });
      if (duplicate) return null;
      await users.insertOne({
        _id: id, id, name: account.name, email, phone: account.phone ?? null, username, role: creatingStudent ? 'student' : 'staff',
        password_hash, must_change_password: 1, active: 1, failed_logins: 0, locked_until: null,
        created_at: new Date().toISOString(),
      }, { session });
      if (creatingStudent) await students.insertOne({ _id: id, user_id: id, admission_no: admission, ...profile }, { session });
      return { login, password };
    });
    return created ? send(created, 201) : send({ message: 'That login is already in use.' }, 409);
  } catch (error) {
    if (error.code === 11000) return send({ message: 'That email or admission number is already in use.' }, 409);
    throw error;
  } finally {
    await session.endSession();
  }
}
