import ExcelJS from 'exceljs';
import { checkZipSize } from './documents.mjs';
import { download, excelMime, spreadsheet } from './export.mjs';
import { nextId } from './records.mjs';

const types = new Set(['material', 'notes', 'test_paper', 'mock_result', 'remark']);

async function roster(db, batch) {
  const ids = await db.collection('enrollments').distinct('student_id', { batch_id: batch, status: 'active' });
  const profiles = await db.collection('students').find({ user_id: { $in: ids } }, { projection: { user_id: 1, admission_no: 1 } }).toArray();
  return new Map(profiles.map(row => [row.admission_no.toLowerCase(), row.user_id]));
}

async function marksheet(file, students) {
  if (typeof file !== 'string' || file.length > 2_800_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file)) throw new Error('Select an Excel marksheet under 2 MiB.');
  const bytes = Buffer.from(file, 'base64');
  await checkZipSize(bytes);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 501) throw new Error('Use the template with 1 to 500 student rows.');
  const header = sheet.getRow(1).values.map(value => String(value).trim().toLowerCase());
  const columns = ['student id', 'marks', 'out of'].map(key => header.indexOf(key));
  if (columns.includes(-1)) throw new Error('Include Student ID, Marks, and Out of columns.');
  const seen = new Set();
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    if (!row.hasValues) continue;
    const [admission, score, max_score] = columns.map(column => row.getCell(column).value);
    const uid = students.get(String(admission).trim().toLowerCase());
    if (!uid || seen.has(uid) || typeof score !== 'number' || typeof max_score !== 'number' ||
        !Number.isFinite(score) || !Number.isFinite(max_score) || score < 0 || max_score <= 0 || score > max_score) {
      throw new Error('Check the student and numeric marks on row ' + index + '.');
    }
    seen.add(uid);
    rows.push({ student_id: uid, score, max_score });
  }
  if (!rows.length) throw new Error('The marksheet has no results.');
  return rows;
}

export async function tutorialRoute(db, user, action, method, body, url, send) {
  if (!['admin', 'staff'].includes(user.role)) return send({ message: 'Access denied.' }, 403);
  const records = db.collection('records');
  if (action === 'tutorial' && method === 'GET') return send({ rows: await records.find({}, { projection: { _id: 0 } }).sort('id', -1).limit(250).toArray() });
  if (action === 'tutorial/template.xlsx' && method === 'GET') {
    const batch = Number(url.searchParams.get('batch'));
    const students = await roster(db, batch);
    if (!students.size) return send({ message: 'No active students in this batch.' }, 404);
    const rows = [...students.keys()].map(name => ({ 'Student ID': name, Marks: '', 'Out of': '' }));
    return download(await spreadsheet('Results', rows), 'marksheet.xlsx', excelMime);
  }
  if (method !== 'POST') return send({ message: 'Method not allowed.' }, 405);
  if (action === 'tutorial/release') {
    const ids = Array.isArray(body.ids) && body.ids.length <= 250 && body.ids.every(Number.isSafeInteger) ? body.ids : null;
    if (typeof body.visible !== 'boolean' || (!ids?.length && !Number.isSafeInteger(body.batch))) return send({ message: 'Choose records or a batch.' }, 400);
    const selection = ids?.length ? { id: { $in: ids } } : { batch_id: body.batch };
    const result = await records.updateMany(selection, { $set: {
      visible_to_student: Number(body.visible), released_at: body.visible ? new Date().toISOString() : null,
    } });
    return send({ changed: result.modifiedCount });
  }
  const editing = /^tutorial\/(\d+)\/(edit|delete)$/.exec(action);
  if (editing?.[2] === 'delete') {
    if (user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
    const result = await records.deleteOne({ id: Number(editing[1]) });
    return result.deletedCount ? send({ ok: true }) : send({ message: 'Record not found.' }, 404);
  }
  if (action !== 'tutorial' && !editing) return send({ message: 'Unknown record action.' }, 404);
  if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 200 || !types.has(body.type) ||
      (body.text != null && (typeof body.text !== 'string' || body.text.length > 5000)) ||
      (body.date && (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)))) {
    return send({ message: 'Enter a record type, title, date and valid text.' }, 400);
  }
  const data = { title: body.title.trim(), body: body.text?.trim() || null, record_date: body.date || null,
    visible_to_student: Number(body.visible === true), released_at: body.visible === true ? new Date().toISOString() : null };
  if (editing) {
    const old = await records.findOne({ id: Number(editing[1]) });
    if (!old) return send({ message: 'Record not found.' }, 404);
    if (old.type !== body.type) return send({ message: 'The type of an existing record cannot change.' }, 400);
    await records.updateOne({ _id: old._id }, { $set: data });
    return send({ ok: true });
  }
  if (!Number.isSafeInteger(body.batch) || !await db.collection('batches').findOne({ id: body.batch })) return send({ message: 'Choose a batch.' }, 400);
  if (body.type !== 'mock_result' && !data.body) return send({ message: 'Write the record text.' }, 400);
  let content;
  if (body.type === 'mock_result') {
    try { content = await marksheet(body.file, await roster(db, body.batch)); }
    catch (error) {
      return send({ message: /^Check |^Use |^Include |^Select |^The marksheet/.test(error.message) ? error.message : 'The Excel file could not be read.' }, 400);
    }
  } else content = [{ student_id: null, score: null, max_score: null }];
  const first = await nextId(db, 'records', content.length);
  await records.insertMany(content.map((item, index) => ({
    _id: first + index, id: first + index, ...item, ...data, type: body.type, batch_id: body.batch,
    created_by: user.id, created_at: new Date().toISOString(),
  })));
  return send({ added: content.length }, 201);
}
