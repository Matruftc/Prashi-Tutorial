import { contactSettings, publicContactLinks } from './contact-links.mjs';
import { publicationWindow } from './published.mjs';
import { formFields } from './site-admin.mjs';
import { csvCell, download } from './export.mjs';
import { legacyPublicUrl } from './legacy-files.mjs';
import { randomUUID } from 'node:crypto';

const contactKeys = ['site_name', 'tagline', 'phone', 'email', 'address', 'office_hours', 'banner_text'];
const inboxStatuses = ['new', 'contacted', 'demo_booked', 'enrolled', 'closed'];

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export async function publicContent(db) {
  const [settings, courses, faculty, resources, results, testimonials, faqs, notices] = await Promise.all([
    db.collection('settings').find({ key: { $in: [...contactKeys, ...Object.keys(contactSettings)] } }, { projection: { key: 1, value: 1 } }).toArray(),
    db.collection('courses').find({ visible: 1 }, { projection: {
      _id: 0, name: 1, slug: 1, class_level: 1, course_type: 1, duration: 1, subjects: 1, highlights: 1, show_fee: 1, fee_amount: 1, image: 1,
    } }).sort('sort_order', 1).limit(100).toArray(),
    db.collection('faculty').find({ visible: 1 }, { projection: {
      _id: 0, name: 1, subject: 1, qualifications: 1, bio: 1,
    } }).sort('sort_order', 1).limit(100).toArray(),
    db.collection('articles').find({ published: 1, ...publicationWindow() }, { projection: { _id: 0, title: 1, slug: 1, category: 1, summary: 1 } })
      .sort('created_at', -1).limit(30).toArray(),
    db.collection('results').find({ approved: 1, kind: 'rank' }, { projection: { _id: 0, student_name: 1, exam: 1, rank_or_score: 1, year: 1, photo: 1 } })
      .sort('sort_order', 1).limit(30).toArray(),
    db.collection('testimonials').find({ approved: 1 }, { projection: { _id: 0, student_name: 1, quote: 1 } })
      .sort('sort_order', 1).limit(30).toArray(),
    db.collection('faqs').find({ visible: 1, course_id: null, ...publicationWindow() },
      { projection: { question: 1, answer_html: 1 } }).sort('sort_order', 1).limit(30).toArray(),
    db.collection('notices').find({ visible: 1, audience: 'public', ...publicationWindow() },
      { projection: { title: 1, body_html: 1 } }).sort({ pinned: -1, created_at: -1 }).limit(20).toArray(),
  ]);
  return {
    contact: Object.fromEntries(settings.filter(item => contactKeys.includes(item.key)).map(item => [item.key, item.value])),
    contactLinks: publicContactLinks(settings), faculty, resources, testimonials, faqs, notices,
    results: results.map(({ photo, ...result }) => ({ ...result, photo: legacyPublicUrl(photo) })),
    courses: courses.map(({ fee_amount, show_fee, image, ...course }) => ({
      ...course, ...(show_fee === 1 ? { fee: fee_amount } : {}), image: legacyPublicUrl(image),
    })),
  };
}

export async function publicForms(db, kind, send) {
  return send({ fields: await formFields(db, kind) });
}

export async function receiveCustomForm(db, kind, body, send) {
  const fields = await formFields(db, kind);
  if (!fields.length || body.consent !== true || !body.fields || typeof body.fields !== 'object') {
    return send({ message: 'Complete the form and consent to be contacted.' }, 400);
  }
  const data = {};
  for (const field of fields) {
    const value = text(body.fields[field.name], 2000);
    if (field.required && !value) return send({ message: 'Enter ' + field.label + '.' }, 400);
    if (value && ((field.type === 'email' && !/^\S+@\S+\.\S+$/.test(value)) ||
        (field.type === 'tel' && !/^\+?[0-9() -]{7,30}$/.test(value)) ||
        (field.type === 'select' && !String(field.options || '').split(/\r?\n/).map(item => item.trim()).includes(value)))) {
      return send({ message: 'Check ' + field.label + '.' }, 400);
    }
    data[field.name] = value;
  }
  await db.collection('submissions').insertOne({
    _id: randomUUID(), form: kind, data_json: JSON.stringify(data), status: 'new',
    created_at: new Date().toISOString(), consent_at: new Date().toISOString(),
  });
  return send({ ok: true }, 201);
}

export async function receiveEnquiry(db, body, send) {
  const name = text(body.name, 120);
  const email = text(body.email, 200);
  const phone = text(body.phone, 30);
  const message = text(body.message, 1500);
  if (!name || !message || (email && !/^\S+@\S+\.\S+$/.test(email)) || (phone && !/^\+?[0-9() -]{7,30}$/.test(phone)) ||
      (!email && !phone) || body.consent !== true || !['enquiry', 'admission'].includes(body.kind)) {
    return send({ message: 'Enter your name, email or phone, a message, and consent.' }, 400);
  }
  await db.collection('submissions').insertOne({
    _id: randomUUID(), form: body.kind, data_json: JSON.stringify({ name, email, phone, message }),
    status: 'new', created_at: new Date().toISOString(), consent_at: new Date().toISOString(),
  });
  return send({ ok: true }, 201);
}

export async function inboxRoute(db, user, action, method, body, send) {
  if (!['admin', 'staff'].includes(user.role)) return send({ message: 'Access denied.' }, 403);
  const submissions = db.collection('submissions');
  if (action === 'inbox/export.csv' && method === 'GET') {
    const rows = await submissions.find({}, { projection: { form: 1, status: 1, created_at: 1, data_json: 1 } }).sort('created_at', -1).limit(1001).toArray();
    if (rows.length > 1000) return send({ message: 'Too many enquiries for one export.' }, 413);
    const csv = [['Form', 'Status', 'Created', 'Name', 'Email', 'Phone', 'Message'], ...rows.map(row => {
      let details = {};
      try { details = JSON.parse(row.data_json) || {}; } catch {}
      return [row.form, row.status, row.created_at, details.name || details.student_name, details.email, details.phone, details.message];
    })].map(row => row.map(csvCell).join(',')).join('\r\n');
    return download('\uFEFF' + csv, 'prashi-enquiries.csv', 'text/csv; charset=utf-8');
  }
  if (action === 'inbox' && method === 'GET') {
    const rows = await submissions.find({}, { projection: { _id: 1, form: 1, data_json: 1, status: 1, assigned_to: 1, created_at: 1 } })
      .sort('created_at', -1).limit(200).toArray();
    const ids = rows.map(row => row._id);
    const notes = await db.collection('submission_notes').find({ submission_id: { $in: ids } }).sort('created_at', 1).limit(1000).toArray();
    const staff = await db.collection('users').find({ role: { $in: ['admin', 'staff'] }, active: 1 }, { projection: { _id: 0, id: 1, name: 1 } }).toArray();
    return send({ staff, rows: rows.map(({ data_json, ...row }) => {
      let details = {};
      try { details = JSON.parse(data_json); } catch {}
      return { ...row, details, notes: notes.filter(note => note.submission_id === row._id) };
    }) });
  }
  const rawId = action.split('/')[1];
  const id = /^\d{1,15}$/.test(rawId || '') ? Number(rawId) : rawId;
  if (method !== 'POST' || !rawId) return send({ message: 'Unknown inbox action.' }, 400);
  const operation = action.split('/')[2];
  if (operation === 'note') {
    const note = text(body.note, 5000);
    if (!note) return send({ message: 'Enter a note.' }, 400);
    if (!await submissions.findOne({ _id: id }, { projection: { _id: 1 } })) return send({ message: 'Submission not found.' }, 404);
    await db.collection('submission_notes').insertOne({ _id: randomUUID(), submission_id: id, author_id: user.id,
      author_name: user.name, note, created_at: new Date().toISOString() });
    return send({ ok: true });
  }
  if (operation === 'delete') {
    if (user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
    const session = db.client.startSession();
    try {
      const deleted = await session.withTransaction(async () => {
        const found = await submissions.deleteOne({ _id: id }, { session });
        if (!found.deletedCount) return false;
        await db.collection('submission_notes').deleteMany({ submission_id: id }, { session });
        return true;
      });
      return deleted ? send({ ok: true }) : send({ message: 'Submission not found.' }, 404);
    } finally { await session.endSession(); }
  }
  let change;
  if (operation === 'assign') {
    const staff = body.staff;
    if (staff !== null && (!Number.isSafeInteger(staff) || !await db.collection('users').findOne({
      id: staff, role: { $in: ['admin', 'staff'] }, active: 1,
    }, { projection: { id: 1 } }))) return send({ message: 'Select an active staff account.' }, 400);
    change = { assigned_to: staff };
  } else {
    if (!inboxStatuses.includes(body.status)) return send({ message: 'Choose a valid status.' }, 400);
    change = { status: body.status };
  }
  const result = await submissions.updateOne({ _id: id }, { $set: change });
  return result.matchedCount ? send({ ok: true }) : send({ message: 'Submission not found.' }, 404);
}

export async function publicDetail(db, section, slug, send) {
  if (!['courses', 'resources'].includes(section) || typeof slug !== 'string' || !/^[a-z0-9-]{1,120}$/.test(slug)) {
    return send({ message: 'Page not found.' }, 404);
  }
  const course = section === 'courses';
  const visible = course ? { visible: 1 } : { published: 1, ...publicationWindow() };
  const item = await db.collection(course ? 'courses' : 'articles').findOne({ slug, ...visible });
  if (!item) return send({ message: 'Page not found.' }, 404);
  return send({
    title: item.name || item.title,
    summary: item.summary || item.highlights,
    description: item.body_html || item.description_html,
    image: legacyPublicUrl(item.image || item.cover_image),
    details: [item.class_level, item.course_type, item.duration, item.subjects, item.schedule_text].filter(Boolean),
    ...(course ? {
      course: { level: item.class_level, mode: item.course_type, duration: item.duration, subjects: item.subjects,
        schedule: item.schedule_text, ...(item.show_fee === 1 && item.fee_amount != null ? { fee: item.fee_amount } : {}) },
    } : {}),
  });
}

export async function sitemap(db, requestUrl) {
  const origin = new URL(process.env.SITE_URL || requestUrl).origin;
  const [courses, articles] = await Promise.all([
    db.collection('courses').distinct('slug', { visible: 1 }),
    db.collection('articles').distinct('slug', { published: 1, ...publicationWindow() }),
  ]);
  const paths = ['/', '/privacy', '/terms'];
  for (const [section, slugs] of [['courses', courses], ['resources', articles]]) {
    for (const slug of slugs) if (/^[a-z0-9-]{1,120}$/.test(slug)) paths.push('/' + section + '/' + slug);
  }
  const body = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    paths.map(path => '<url><loc>' + origin + path + '</loc></url>').join('') + '</urlset>';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}
