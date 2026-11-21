import { Binary } from 'mongodb';
import { randomUUID } from 'node:crypto';

const maxBytes = 3 * 1024 * 1024;
const types = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function fileType(name, bytes) {
  const kind = String(name).split('.').pop().toLowerCase();
  if (kind === 'pdf' && bytes.subarray(0, 5).toString() === '%PDF-') return kind;
  if (kind === 'docx' && bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))) return kind;
  if (kind === 'png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return kind;
  if (['jpg', 'jpeg'].includes(kind) && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return kind;
  return null;
}

export function decodeUpload(file) {
  if (!file || typeof file.name !== 'string' || typeof file.data !== 'string') throw new Error('Choose a file.');
  if (file.data.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error('Upload a file up to 3 MiB.');
  const bytes = Buffer.from(file.data, 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Upload a file up to 3 MiB.');
  const name = file.name.split(/[\\/]/).pop().slice(-120);
  const kind = fileType(name, bytes);
  if (!kind) throw new Error('Choose a valid PDF, Word, PNG, or JPEG file.');
  return { bytes, name, kind };
}

export async function checkZipSize(bytes) {
  const zip = (await import('yauzl')).default;
  await new Promise((resolve, reject) => {
    zip.fromBuffer(bytes, { lazyEntries: true }, (error, archive) => {
      if (error) return reject(error);
      let size = 0;
      let count = 0;
      archive.on('error', reject);
      archive.on('end', resolve);
      archive.on('entry', entry => {
        size += entry.uncompressedSize;
        if (size > 16 * 1024 * 1024 || ++count > 500) {
          archive.close();
          reject(new Error('The Word file is too large after extraction.'));
        } else archive.readEntry();
      });
      archive.readEntry();
    });
  });
}

export function splitQuestions(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim())
    .filter(line => !/^\s*(?:page\s+\d+|\d+\s*\/\s*\d+|--\s*\d+\s+of\s+\d+\s*--)\s*$/i.test(line));
  const numbered = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\-:]\s+(.+)$/i;
  const groups = [];
  let current = [];
  let previous = null;
  for (const line of lines) {
    const match = numbered.exec(line);
    const number = match && Number(match[1]);
    if (match && (previous === null || number === previous + 1)) {
      if (current.length) groups.push(current.join('\n'));
      current = [match[2]];
      previous = number;
    } else if (line && previous !== null) current.push(line);
  }
  if (current.length) groups.push(current.join('\n'));
  const questions = (groups.length ? groups : lines.filter(Boolean)).filter(line => line.length >= 5);
  if (!questions.length) throw new Error('No text questions were found. Use a text PDF or Word document.');
  if (questions.length > 100 || questions.some(value => value.length > 2000)) throw new Error('Split the document into up to 100 questions of up to 2000 characters each.');
  return questions;
}

export async function readQuestions(file) {
  const { bytes, kind } = decodeUpload(file);
  if (kind === 'docx') {
    await checkZipSize(bytes);
    const mammoth = (await import('mammoth')).default;
    return splitQuestions((await mammoth.extractRawText({ buffer: bytes })).value);
  }
  if (kind === 'pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
    try {
      const info = await parser.getInfo();
      if (info.total > 100) throw new Error('Upload at most 100 pages.');
      return splitQuestions((await parser.getText()).text);
    } finally {
      await parser.destroy();
    }
  }
  throw new Error('Choose a PDF or Word (.docx) document.');
}

export async function fileRoute(db, user, action, method, body, send) {
  if (action === 'student/photo') {
    if (user.role !== 'student') return send({ message: 'Access denied.' }, 403);
    const photos = db.collection('student_photos');
    if (method === 'GET') {
      const photo = await photos.findOne({ _id: user.id });
      if (!photo) return send({ message: 'Photo not found.' }, 404);
      return new Response(photo.bytes.value(), { headers: {
        'Content-Type': photo.type, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (method === 'POST') {
      if (body.remove === true) {
        await photos.deleteOne({ _id: user.id });
        await db.collection('students').updateOne({ user_id: user.id }, { $unset: { photo: '' } });
        return send({ ok: true });
      }
      let file;
      try { file = decodeUpload(body.file); }
      catch (error) { return send({ message: error.message }, 400); }
      if (!['jpg', 'jpeg', 'png'].includes(file.kind)) return send({ message: 'Use a JPEG or PNG photo.' }, 400);
      await photos.updateOne({ _id: user.id }, { $set: { type: types[file.kind], bytes: new Binary(file.bytes) } }, { upsert: true });
      return send({ ok: true });
    }
    return send({ message: 'Method not allowed.' }, 405);
  }
  const materials = db.collection('netlify_materials');
  const staff = ['admin', 'staff'].includes(user.role);
  if (action === 'documents/extract' && method === 'POST' && staff) {
    try {
      return send({ questions: await readQuestions(body.file) });
    } catch (error) {
      return send({ message: /^Choose|^Upload|^Split|^No text|^The Word/.test(error.message)
        ? error.message : 'This document could not be read. Try a text PDF or a Word (.docx) export.' }, 400);
    }
  }
  if (action === 'materials' && method === 'POST' && staff) {
    const { title, classLevel } = body;
    if (typeof title !== 'string' || !title.trim() || title.length > 140 || typeof classLevel !== 'string' || !/^Class (?:[1-9]|1[0-2])$/.test(classLevel)) {
      return send({ message: 'Enter a title and class.' }, 400);
    }
    let file;
    try { file = decodeUpload(body.file); }
    catch (error) { return send({ message: error.message }, 400); }
    const _id = randomUUID();
    await materials.insertOne({
      _id, title: title.trim(), class_level: classLevel, name: file.name, type: types[file.kind],
      bytes: new Binary(file.bytes), created_by: user.id, created_at: new Date(),
    });
    return send({ id: _id }, 201);
  }
  if (action !== 'materials' && !action.startsWith('materials/')) return send({ message: 'Access denied.' }, 403);
  const student = !staff && await db.collection('students').findOne({ user_id: user.id }, { projection: { class_level: 1 } });
  const scope = staff ? {} : { class_level: student?.class_level || '__none__' };
  if (action === 'materials' && method === 'GET') {
    const files = await materials.find(scope, { projection: { bytes: 0, created_by: 0 } }).sort('created_at', -1).limit(250).toArray();
    return send({ files });
  }
  const id = action.split('/')[1];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return send({ message: 'File unavailable.' }, 404);
  if (method === 'POST') {
    if (!staff) return send({ message: 'Access denied.' }, 403);
    const result = await materials.deleteOne({ _id: id, ...(user.role === 'admin' ? {} : { created_by: user.id }) });
    return result.deletedCount ? send({ ok: true }) : send({ message: 'File unavailable.' }, 404);
  }
  if (method !== 'GET') return send({ message: 'Method not allowed.' }, 405);
  const file = await materials.findOne({ _id: id, ...scope });
  if (!file) return send({ message: 'File unavailable.' }, 404);
  return new Response(file.bytes.value(), { headers: {
    'Content-Type': file.type,
    'Content-Disposition': 'attachment; filename="' + file.name.replace(/[^a-zA-Z0-9._ -]/g, '_') + '"',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  } });
}
