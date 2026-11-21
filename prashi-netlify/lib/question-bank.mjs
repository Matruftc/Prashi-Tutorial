const ignoreCase = { locale: 'en', strength: 2 };
const groupFields = ['class_level', 'subject', 'chapter', 'q_type'];

function short(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function key(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function questionBankRoute(db, user, action, method, body, url, send) {
  if (!['staff', 'admin'].includes(user.role)) return send({ message: 'Access denied.' }, 403);
  const questions = db.collection('questions');
  const access = db.collection('chapter_access');
  if (action === 'question-bank' && method === 'GET') {
    const filter = Object.fromEntries(groupFields.map(field => [field, short(url.searchParams.get(field))]).filter(([, value]) => value));
    const [items, groups, batches, uploads] = await Promise.all([
      questions.find(filter, { projection: { _id: 0 }, collation: ignoreCase }).sort('id', -1).limit(250).toArray(),
      questions.aggregate([{ $group: { _id: Object.fromEntries(groupFields.map(field => [field, '$' + field])), count: { $sum: 1 } } },
        { $project: { _id: 0, count: 1, ...Object.fromEntries(groupFields.map(field => [field, '$_id.' + field])) } },
        { $sort: { class_level: 1, subject: 1, chapter: 1, q_type: 1 } }, { $limit: 250 }], { collation: ignoreCase }).toArray(),
      db.collection('batches').find({}, { projection: { _id: 0, id: 1, name: 1 } }).sort('name', 1).limit(200).toArray(),
      db.collection('qb_uploads').find({}, { projection: { _id: 0 } }).sort('created_at', -1).limit(25).toArray(),
    ]);
    return send({ items, groups, batches, uploads });
  }
  if (method !== 'POST') return send({ message: 'Method not allowed.' }, 405);
  if (action === 'question-bank/save') {
    const group = Object.fromEntries(groupFields.map(field => [field, short(body[field])]));
    if (Object.values(group).some(value => !value) || !/^Class (?:[1-9]|1[0-2])$/.test(group.class_level) ||
        !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 100 ||
        body.rows.some(row => !row || typeof row.question !== 'string' || !row.question.trim() || row.question.length > 2000 ||
          (row.answer != null && (typeof row.answer !== 'string' || row.answer.length > 2000)))) {
      return send({ message: 'Choose a class, subject, chapter and question type. Add up to 100 valid questions.' }, 400);
    }
    const counters = db.collection('counters');
    const highest = await questions.findOne({ id: { $type: 'number' } }, { projection: { id: 1 }, sort: { id: -1 } });
    await counters.updateOne({ _id: 'questions' }, { $max: { value: highest?.id ?? 0 } }, { upsert: true });
    const session = db.client.startSession();
    try {
      const added = await session.withTransaction(async () => {
        const ticket = await counters.findOneAndUpdate({ _id: 'questions' }, { $inc: { value: body.rows.length } }, { session, returnDocument: 'after' });
        const existing = await questions.find(group, { session, collation: ignoreCase, projection: { text_key: 1, qid: 1 } }).toArray();
        const seen = new Set(existing.map(row => row.text_key));
        const countStore = db.collection('qb_counters');
        const latest = Math.max(0, ...existing.map(row => row.qid));
        const count = await countStore.findOneAndUpdate(group, { $max: { last_qid: latest } }, { session, collation: ignoreCase, upsert: true, returnDocument: 'after' });
        let qid = count.last_qid;
        const rows = [];
        for (const [index, row] of body.rows.entries()) {
          const text = row.question.trim();
          const text_key = key(text);
          if (seen.has(text_key)) continue;
          seen.add(text_key);
          const id = ticket.value - body.rows.length + index + 1;
          rows.push({ _id: id, id, ...group, qid: ++qid, question_text: text, answer_text: row.answer?.trim() || null,
            text_key, batch_id: null, created_by: user.id, created_by_name: user.name, created_at: new Date().toISOString() });
        }
        if (rows.length) {
          await questions.insertMany(rows, { session });
          await countStore.updateOne(group, { $max: { last_qid: qid } }, { session, collation: ignoreCase });
        }
        await db.collection('qb_uploads').insertOne({
          ...group, file_name: typeof body.file_name === 'string' ? body.file_name.slice(0, 120) : null,
          question_count: rows.length, skipped_count: body.rows.length - rows.length,
          uploaded_by: user.id, uploaded_by_name: user.name, uploaded_by_role: user.role, created_at: new Date().toISOString(),
        }, { session });
        return rows.length;
      });
      return send({ added, skipped: body.rows.length - added });
    } finally {
      await session.endSession();
    }
  }
  if (action === 'question-bank/share') {
    const group = Object.fromEntries(groupFields.map(field => [field, short(body[field])]));
    if (Object.values(group).some(value => !value) || typeof body.publish !== 'boolean' ||
        !await questions.findOne(group, { collation: ignoreCase, projection: { _id: 1 } })) {
      return send({ message: 'Choose an existing question group.' }, 400);
    }
    const batch = body.batch ?? null;
    if (batch !== null && (!Number.isSafeInteger(batch) || !await db.collection('batches').findOne({ id: batch }))) {
      return send({ message: 'Choose a valid batch.' }, 400);
    }
    const filter = { ...group, batch_id: batch };
    if (body.publish) await access.updateOne(filter, { $setOnInsert: {
      ...filter, enabled_by: user.id, enabled_by_name: user.name, created_at: new Date().toISOString(),
    } }, { collation: ignoreCase, upsert: true });
    else await access.deleteOne(filter, { collation: ignoreCase });
    return send({ ok: true });
  }
  const match = /^question-bank\/(\d+)\/(answer|delete)$/.exec(action);
  if (!match) return send({ message: 'Question action not found.' }, 404);
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id)) return send({ message: 'Question not found.' }, 404);
  if (match[2] === 'delete') {
    if (user.role !== 'admin') return send({ message: 'Only admins can delete questions.' }, 403);
    const result = await questions.deleteOne({ id });
    return result.deletedCount ? send({ ok: true }) : send({ message: 'Question not found.' }, 404);
  }
  if (typeof body.answer !== 'string' || body.answer.length > 2000) return send({ message: 'Answers can contain up to 2000 characters.' }, 400);
  const result = await questions.updateOne({ id }, { $set: { answer_text: body.answer.trim() || null } });
  return result.matchedCount ? send({ ok: true }) : send({ message: 'Question not found.' }, 404);
}
