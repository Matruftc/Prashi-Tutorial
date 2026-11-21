import { randomUUID } from 'node:crypto';

const attendanceStatuses = new Set(['present', 'absent', 'late', 'excused']);
const enrollmentStatuses = new Set(['active', 'completed', 'dropped']);
const paymentModes = new Set(['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque', 'Other']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function amount(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum && value <= 100_000_000;
}

export async function nextId(db, name, count = 1) {
  const collection = db.collection(name);
  const highest = await collection.findOne({ id: { $type: 'number' } }, { projection: { id: 1 }, sort: { id: -1 } });
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: name }, { $max: { value: highest?.id || 0 } }, { returnDocument: 'after', upsert: true },
  );
  const ticket = await db.collection('counters').findOneAndUpdate(
    { _id: counter._id }, { $inc: { value: count } }, { returnDocument: 'after' },
  );
  return ticket.value - count + 1;
}

export async function recordsRoute(db, user, action, method, body, send) {
  const staff = ['admin', 'staff'].includes(user.role);
  if (action.startsWith('records/receipt/') && method === 'GET') {
    const id = Number(action.split('/')[2]);
    if (!Number.isSafeInteger(id)) return send({ message: 'Receipt not found.' }, 404);
    const payment = await db.collection('payments').findOne({ id });
    const enrollment = payment && await db.collection('enrollments').findOne({ id: payment.enrollment_id });
    if (!enrollment || (!staff && enrollment.student_id !== user.id)) return send({ message: 'Receipt not found.' }, 404);
    const [student, batch] = await Promise.all([
      db.collection('users').findOne({ id: enrollment.student_id }, { projection: { name: 1 } }),
      db.collection('batches').findOne({ id: enrollment.batch_id }, { projection: { name: 1 } }),
    ]);
    const rows = [['Receipt', payment.receipt_no], ['Student', student?.name], ['Batch', batch?.name],
      ['Date paid', payment.paid_on], ['Payment mode', payment.mode], ['Amount', '₹' + payment.amount]];
    const escape = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payment receipt</title><link rel="stylesheet" href="/assets/portal.css"><script type="module" src="/assets/motion.js"></script></head><body class="receipt-page">' +
      '<main class="frame"><article class="panel"><h1>Prashi Tutorial payment receipt</h1><dl>' + rows.map(([key, value]) => '<dt>' + key + '</dt><dd>' + escape(value) + '</dd>').join('') +
      '</dl><p>Use your browser’s Print command to print or save a PDF.</p></article><button type="button" class="motion-control quiet" data-motion-toggle hidden>Pause animation</button></main></body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'" },
    });
  }
  const doubts = db.collection('doubts');
  if (action === 'records/doubts' && method === 'GET') {
    return send({ rows: await doubts.find(staff ? {} : { student_id: user.id }).sort('created_at', -1).limit(100).toArray() });
  }
  if (action === 'records/doubts' && method === 'POST' && !staff) {
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 3000 ||
        typeof body.subject !== 'string' || body.subject.length > 150) return send({ message: 'Enter a valid subject and question.' }, 400);
    await doubts.insertOne({
      _id: randomUUID(), student_id: user.id, student_name: user.name, subject: body.subject.trim(), message: body.message.trim(),
      status: 'open', created_at: new Date().toISOString(),
    });
    return send({ ok: true }, 201);
  }
  if (!staff) return send({ message: 'Access denied.' }, 403);
  if (action.startsWith('records/doubts/') && method === 'POST') {
    const rawId = action.split('/')[2];
    const id = /^\d{1,15}$/.test(rawId) ? Number(rawId) : rawId;
    if (action.endsWith('/close')) {
      const result = await doubts.updateOne({ _id: id }, { $set: { status: 'closed' } });
      return result.matchedCount ? send({ ok: true }) : send({ message: 'Question not found.' }, 404);
    }
    if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 5000) return send({ message: 'Enter a reply.' }, 400);
    const result = await doubts.updateOne({ _id: id }, { $set: {
      reply: body.answer.trim(), status: 'answered', replied_by: user.id, replied_at: new Date().toISOString(),
    } });
    return result.matchedCount ? send({ ok: true }) : send({ message: 'Question not found.' }, 404);
  }
  const enrollments = db.collection('enrollments');
  const payments = db.collection('payments');
  if (action === 'records' && method === 'GET') {
    const batches = await db.collection('batches').find({}, { projection: { id: 1, name: 1 } }).sort('name', 1).limit(200).toArray();
    const rows = await enrollments.aggregate([
      { $lookup: { from: 'payments', localField: 'id', foreignField: 'enrollment_id', as: 'payments' } },
      { $project: { id: 1, student_id: 1, batch_id: 1, status: 1, fee_total: 1, discount: 1, paid: { $sum: '$payments.amount' } } },
      { $sort: { id: -1 } }, { $limit: 300 },
    ]).toArray();
    const transactions = await payments.find({ enrollment_id: { $in: rows.map(row => row.id) } }, {
      projection: { _id: 0, id: 1, enrollment_id: 1, amount: 1, paid_on: 1, receipt_no: 1 },
    }).sort('id', -1).limit(300).toArray();
    return send({ batches, rows, transactions });
  }
  if (method !== 'POST') return send({ message: 'Method not allowed.' }, 405);
  const enrollmentAction = /^records\/enrollment\/(\d+)\/(edit|delete)$/.exec(action);
  if (enrollmentAction) {
    const id = Number(enrollmentAction[1]);
    const editing = enrollmentAction[2] === 'edit';
    if (!editing && user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
    if (editing && (!amount(body.fee) || !amount(body.discount) || body.discount > body.fee || !enrollmentStatuses.has(body.status))) {
      return send({ message: 'Enter valid fee details and status.' }, 400);
    }
    const session = db.client.startSession();
    try {
      const status = await session.withTransaction(async () => {
        if (!editing) {
          const removed = await enrollments.deleteOne({ id }, { session });
          if (!removed.deletedCount) return 404;
          await payments.deleteMany({ enrollment_id: id }, { session });
          return 200;
        }
        const entry = await enrollments.findOneAndUpdate({ id }, { $inc: { payment_revision: 1 } }, { session });
        if (!entry) return 404;
        const [totals] = await payments.aggregate([{ $match: { enrollment_id: id } },
          { $group: { _id: null, total: { $sum: '$amount' } } }], { session }).toArray();
        if ((totals?.total || 0) > body.fee - body.discount) return 409;
        await enrollments.updateOne({ id }, { $set: { fee_total: body.fee, discount: body.discount, status: body.status } }, { session });
        return 200;
      });
      if (status === 404) return send({ message: 'Enrollment not found.' }, 404);
      if (status === 409) return send({ message: 'The fee cannot be lower than payments already recorded.' }, 409);
      return send({ ok: true });
    } finally { await session.endSession(); }
  }
  if (action.startsWith('records/payment/') && action.endsWith('/delete')) {
    if (user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
    const id = Number(action.split('/')[2]);
    if (!Number.isSafeInteger(id)) return send({ message: 'Payment not found.' }, 404);
    const session = db.client.startSession();
    try {
      const deleted = await session.withTransaction(async () => {
        const payment = await payments.findOne({ id }, { session });
        if (!payment) return false;
        await enrollments.updateOne({ id: payment.enrollment_id }, { $inc: { payment_revision: 1 } }, { session });
        return Boolean((await payments.deleteOne({ id }, { session })).deletedCount);
      });
      return deleted ? send({ ok: true }) : send({ message: 'Payment not found.' }, 404);
    } finally { await session.endSession(); }
  }
  if (action === 'records/attendance/batch') {
    const { batch, day, rows } = body;
    if (!Number.isSafeInteger(batch) || !validDate(day) || !Array.isArray(rows) || !rows.length || rows.length > 300 ||
        rows.some(row => !row || !Number.isSafeInteger(row.student) || !attendanceStatuses.has(row.status))) {
      return send({ message: 'Choose a batch, date, and valid student attendance.' }, 400);
    }
    const roster = new Set(await enrollments.distinct('student_id', { batch_id: batch, status: 'active' }));
    if (rows.some(row => !roster.has(row.student)) || new Set(rows.map(row => row.student)).size !== rows.length) {
      return send({ message: 'The roster changed. Reload before marking attendance.' }, 409);
    }
    await db.collection('attendance').bulkWrite(rows.map(row => {
      const filter = { student_id: row.student, batch_id: batch, day };
      return { updateOne: { filter, update: { $set: { status: row.status, marked_by: user.id }, $setOnInsert: filter }, upsert: true } };
    }));
    return send({ ok: true });
  }
  if (action === 'records/enrollment') {
    const { student, batch, fee, discount, status } = body;
    if (!Number.isSafeInteger(student) || !Number.isSafeInteger(batch) || !amount(fee) || !amount(discount) ||
        discount > fee || !enrollmentStatuses.has(status)) return send({ message: 'Enter a student, batch, and valid fee details.' }, 400);
    const exists = await db.collection('students').findOne({ user_id: student }, { projection: { _id: 1 } });
    const course = await db.collection('batches').findOne({ id: batch }, { projection: { _id: 1 } });
    if (!exists || !course) return send({ message: 'Student or batch not found.' }, 404);
    const id = await nextId(db, 'enrollments');
    try {
      await enrollments.insertOne({ _id: id, id, student_id: student, batch_id: batch, fee_total: fee, discount, status, enrolled_on: new Date().toISOString().slice(0, 10) });
      return send({ id }, 201);
    } catch (error) {
      if (error.code === 11000) return send({ message: 'This student is already enrolled in that batch.' }, 409);
      throw error;
    }
  }
  if (action === 'records/attendance') {
    const { enrollment, day, status } = body;
    if (!Number.isSafeInteger(enrollment) || !validDate(day) || !attendanceStatuses.has(status)) return send({ message: 'Choose an enrollment, date, and status.' }, 400);
    const entry = await enrollments.findOne({ id: enrollment });
    if (!entry) return send({ message: 'Enrollment not found.' }, 404);
    const key = { student_id: entry.student_id, batch_id: entry.batch_id, day };
    await db.collection('attendance').updateOne(key, { $set: { status, marked_by: user.id }, $setOnInsert: key }, { upsert: true });
    return send({ ok: true });
  }
  if (action === 'records/payment') {
    const { enrollment, amount: paid, day, mode } = body;
    if (!Number.isSafeInteger(enrollment) || !amount(paid, 1) || !validDate(day) || !paymentModes.has(mode)) return send({ message: 'Enter an enrollment, amount, date, and payment method.' }, 400);
    const id = await nextId(db, 'payments');
    const receipt = 'PT-R-' + String(id).padStart(5, '0');
    const session = db.client.startSession();
    try {
      const response = await session.withTransaction(async () => {
        const entry = await enrollments.findOneAndUpdate({ id: enrollment }, { $inc: { payment_revision: 1 } },
          { returnDocument: 'after', session });
        if (!entry) return 404;
        const [totals] = await payments.aggregate([
          { $match: { enrollment_id: enrollment } }, { $group: { _id: null, total: { $sum: '$amount' } } },
        ], { session }).toArray();
        if (paid > entry.fee_total - entry.discount - (totals?.total || 0)) return 409;
        await payments.insertOne({
          _id: id, id, enrollment_id: enrollment, amount: paid, paid_on: day, mode, receipt_no: receipt, recorded_by: user.id,
        }, { session });
        return 201;
      });
      if (response === 404) return send({ message: 'Enrollment not found.' }, 404);
      if (response === 409) return send({ message: 'This payment exceeds the current balance.' }, 409);
      return send({ receipt }, 201);
    } finally {
      await session.endSession();
    }
  }
  return send({ message: 'Record action not found.' }, 404);
}
