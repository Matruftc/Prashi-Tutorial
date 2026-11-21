import { contactSettings, normalizeContactSetting } from './contact-links.mjs';
import { nextId } from './records.mjs';

const flag = ['visible', 'published', 'approved', 'show_fee', 'pinned', 'active', 'required'];
const integers = ['sort_order', 'fee_amount', 'course_id', 'faculty_id', 'batch_id', 'seats_total', 'year', 'rating'];
const models = {
  courses: ['name', 'slug', 'class_level', 'exam', 'course_type', 'duration', 'fee_amount', 'show_fee', 'subjects',
    'highlights', 'description_html', 'schedule_text', 'faculty_id', 'sort_order', 'visible'],
  faculty: ['name', 'subject', 'qualifications', 'experience', 'focus', 'bio', 'sort_order', 'visible'],
  batches: ['name', 'course_id', 'start_date', 'timing', 'seats_total', 'status', 'visible'],
  notices: ['title', 'body_html', 'audience', 'batch_id', 'pinned', 'publish_at', 'expires_at', 'visible'],
  faqs: ['question', 'answer_html', 'course_id', 'sort_order', 'visible'],
  articles: ['title', 'slug', 'category', 'summary', 'body_html', 'published', 'publish_at'],
  results: ['student_name', 'exam', 'rank_or_score', 'year', 'label', 'kind', 'sort_order', 'approved'],
  testimonials: ['student_name', 'exam', 'result_text', 'quote', 'rating', 'sort_order', 'approved'],
  holidays: ['label', 'start_date', 'end_date'],
  form_fields: ['form', 'name', 'label', 'type', 'options', 'help_text', 'required', 'sort_order', 'active'],
};
const required = {
  courses: ['name', 'slug'], faculty: ['name'], batches: ['name', 'course_id'], notices: ['title', 'body_html'],
  faqs: ['question', 'answer_html'], articles: ['title', 'slug'], results: ['kind'], testimonials: ['student_name', 'quote'],
  holidays: ['label', 'start_date', 'end_date'], form_fields: ['form', 'name', 'label', 'type'],
};
const forms = ['admission', 'enquiry', 'counselling', 'contact'];
const types = ['text', 'tel', 'email', 'textarea', 'select', 'date', 'number', 'checkbox'];

export async function siteAdmin(db, user, action, method, body, send) {
  if (user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
  if (action === 'site-admin' && method === 'GET') return send({ models, flag, integers });
  const [, name, rawId, operation] = action.split('/');
  if (name === 'settings') {
    const settings = db.collection('settings');
    if (method === 'GET') {
      const stored = await settings.find({}, { projection: { _id: 0, key: 1, value: 1, help: 1 } }).sort('key', 1).toArray();
      const rows = new Map(stored.map(row => [row.key, row]));
      for (const [key, help] of Object.entries(contactSettings)) {
        rows.set(key, { key, value: rows.get(key)?.value || '', help });
      }
      return send({ rows: [...rows.values()] });
    }
    if (method !== 'POST' || !/^[a-z][a-z0-9_]{1,80}$/.test(body.key || '') || typeof body.value !== 'string' || body.value.length > 5000) {
      return send({ message: 'Enter a valid setting.' }, 400);
    }
    if (Object.hasOwn(contactSettings, body.key)) {
      let value;
      try { value = normalizeContactSetting(body.key, body.value); }
      catch (error) { return send({ message: error.message }, 400); }
      await settings.updateOne({ key: body.key }, {
        $set: { value }, $setOnInsert: { help: contactSettings[body.key] },
      }, { upsert: true });
      return send({ ok: true });
    }
    const result = await settings.updateOne({ key: body.key }, { $set: { value: body.value.trim() } });
    return result.matchedCount ? send({ ok: true }) : send({ message: 'Setting not found.' }, 404);
  }
  if (!Object.hasOwn(models, name)) return send({ message: 'Section not found.' }, 404);
  const collection = db.collection(name);
  if (method === 'GET' && !rawId) return send({ rows: await collection.find({}, { projection: { _id: 0 } }).sort({ sort_order: 1, id: 1 }).limit(200).toArray() });
  if (method !== 'POST') return send({ message: 'Method not allowed.' }, 405);
  const id = rawId == null ? null : Number(rawId);
  if (id !== null && !Number.isSafeInteger(id)) return send({ message: 'Record not found.' }, 404);
  const existing = id === null ? null : await collection.findOne({ id });
  if (id !== null && !existing) return send({ message: 'Record not found.' }, 404);
  if (operation === 'delete') {
    if (existing.locked || ['courses', 'batches'].includes(name)) {
      return send({ message: 'Hide this record instead. It may be linked to student or payment records.' }, 409);
    }
    await collection.deleteOne({ id });
    return send({ ok: true });
  }
  const values = {};
  for (const key of models[name]) {
    const value = body[key];
    if (value === undefined) continue;
    if (flag.includes(key)) values[key] = value === true ? 1 : 0;
    else if (integers.includes(key)) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000)) {
        return send({ message: 'Enter a valid number for ' + key + '.' }, 400);
      }
      values[key] = value;
    } else {
      if (typeof value !== 'string' || value.length > 10000) return send({ message: 'Enter valid text for ' + key + '.' }, 400);
      values[key] = value.trim();
    }
  }
  const check = { ...existing, ...values };
  if (required[name].some(key => !check[key])) return send({ message: 'Fill in ' + required[name].join(', ') + '.' }, 400);
  if (check.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(check.slug)) return send({ message: 'Use a lowercase URL slug.' }, 400);
  if (name === 'batches' && (!['open', 'full', 'closed'].includes(check.status) || !await db.collection('courses').findOne({ id: check.course_id }))) {
    return send({ message: 'Choose an existing course and a valid batch status.' }, 400);
  }
  if (name === 'notices' && !['public', 'students'].includes(check.audience)) return send({ message: 'Use public or students as the audience.' }, 400);
  if (name === 'form_fields' && (!forms.includes(check.form) || !types.includes(check.type) || !/^[a-z][a-z0-9_]{1,60}$/.test(check.name))) {
    return send({ message: 'Enter a valid form, field identifier and field type.' }, 400);
  }
  if (existing?.locked) {
    delete values.name;
    delete values.form;
    delete values.type;
    delete values.required;
    delete values.active;
  }
  try {
    if (existing) await collection.updateOne({ id }, { $set: values });
    else {
      const next = await nextId(db, name);
      await collection.insertOne({ _id: next, id: next, ...values, created_at: new Date().toISOString() });
    }
  } catch (error) {
    if (error.code === 11000) return send({ message: 'The same identifier already exists.' }, 409);
    throw error;
  }
  return send({ ok: true });
}

export async function formFields(db, kind) {
  if (!forms.includes(kind)) return [];
  const fields = await db.collection('form_fields').find({ form: kind, active: 1 }, {
    projection: { _id: 0, name: 1, label: 1, type: 1, options: 1, required: 1, help_text: 1 },
  }).sort('sort_order', 1).limit(40).toArray();
  const needsCourse = fields.find(field => field.type === 'select' && !field.options && field.name === 'course');
  if (needsCourse) {
    const courses = await db.collection('courses').find({ visible: 1 }, { projection: { name: 1 } }).sort('sort_order', 1).limit(100).toArray();
    needsCourse.options = courses.map(course => course.name).join('\n');
  }
  return fields;
}
