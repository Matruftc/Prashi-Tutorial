import { randomInt, randomUUID } from 'node:crypto';

const durations = new Set([30, 60, 90]);
const reasons = new Set(['hidden', 'blur', 'fullscreen', 'navigation']);
const idPattern = /^[0-9a-f-]{36}$/;

function shuffle(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function makePapers(groups, sets) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 6 || !Number.isInteger(sets) || sets < 1 || sets > 6) throw new Error('Choose one to six marks groups and paper sets.');
  const pools = groups.map(({ marks, count, questions }) => {
    if (!Array.isArray(questions) || !Number.isInteger(marks) || marks < 1 || marks > 20 ||
        !Number.isInteger(count) || count < 1 || questions.length > 100) throw new Error('Check marks and question counts.');
    const texts = new Map();
    for (const item of questions) {
      if (typeof item !== 'string' || !item.trim() || item.length > 2000) throw new Error('Questions must contain 1 to 2000 characters.');
      texts.set(item.trim().replace(/\s+/g, ' ').toLowerCase(), item.trim());
    }
    if (count > texts.size) throw new Error('Add more distinct questions for each marks group.');
    return { marks, count, texts: [...texts.values()] };
  });
  if (new Set(pools.map(pool => pool.marks)).size !== pools.length) throw new Error('Use each marks value once.');
  if (pools.reduce((sum, item) => sum + item.count, 0) > 30) throw new Error('Each set can include up to 30 questions.');
  const papers = new Map();
  for (let attempt = 0; attempt < 150 && papers.size < sets; attempt++) {
    const paper = shuffle(pools.flatMap(({ marks, count, texts }) =>
      shuffle(texts).slice(0, count).map(text => ({ marks, text }))));
    papers.set(JSON.stringify(paper), paper);
  }
  if (papers.size !== sets) throw new Error('Add questions or request fewer paper sets.');
  return [...papers.values()];
}

function state(attempt, now = Date.now()) {
  return attempt.state === 'active' && attempt.deadline <= now ? 'expired' : attempt.state;
}

export async function examsRoute(db, user, action, method, body, send) {
  const examCollection = db.collection('netlify_exams');
  const attempts = db.collection('netlify_attempts');
  const staff = ['admin', 'staff'].includes(user.role);
  const now = Date.now();
  if (action === 'exams' && method === 'GET') {
    if (staff) {
      const [exams, alerts] = await Promise.all([
        examCollection.find({}, { projection: { papers: 0 } }).sort('opens', -1).limit(100).toArray(),
        attempts.find({ 'violations.0': { $exists: true } }, { projection: { student_name: 1, title: 1, state: 1, deadline: 1, violations: 1 } })
          .sort('last_violation', -1).limit(30).toArray(),
      ]);
      return send({ exams, alerts: alerts.map(item => ({ ...item, state: state(item, now) })) });
    }
    const student = await db.collection('students').findOne({ user_id: user.id });
    if (!student?.class_level) return send({ exams: [], attempts: [] });
    const [exams, history] = await Promise.all([
      examCollection.find({ class_level: student.class_level }, { projection: { papers: 0 } }).sort('opens', -1).limit(100).toArray(),
      attempts.find({ student_id: user.id }, { projection: { exam_id: 1, state: 1, deadline: 1 } }).limit(100).toArray(),
    ]);
    return send({ exams, attempts: history.map(item => ({ ...item, state: state(item, now) })) });
  }
  if (action === 'exams' && method === 'POST') {
    if (!staff) return send({ message: 'Access denied.' }, 403);
    const { title, classLevel, duration, opens, closes, groups, sets } = body;
    if (typeof title !== 'string' || !title.trim() || title.length > 140 || typeof classLevel !== 'string' ||
        !/^Class (?:[1-9]|1[0-2])$/.test(classLevel) || !durations.has(duration) ||
        !Number.isSafeInteger(opens) || !Number.isSafeInteger(closes) || closes < Math.max(opens, now) + duration * 60000) {
      return send({ message: 'Enter a title, class, and a window that fits the exam duration.' }, 400);
    }
    let papers;
    try { papers = makePapers(groups, sets); }
    catch (error) { return send({ message: error.message }, 400); }
    const id = randomUUID();
    await examCollection.insertOne({ _id: id, title: title.trim(), class_level: classLevel, duration, opens, closes, papers, created_by: user.id });
    return send({ id }, 201);
  }
  const [, examId, mode] = action.split('/');
  if (!idPattern.test(examId || '')) return send({ message: 'Exam not found.' }, 404);
  if (staff) {
    if (mode || method !== 'GET') return send({ message: 'Access denied.' }, 403);
    const exam = await examCollection.findOne({ _id: examId });
    if (!exam) return send({ message: 'Exam not found.' }, 404);
    const rows = await attempts.find({ exam_id: examId }).sort('student_name', 1).limit(250).toArray();
    return send({ exam, attempts: rows.map(item => ({ ...item, state: state(item, now) })) });
  }
  const key = { _id: examId + ':' + user.id };
  let attempt = await attempts.findOne(key);
  if (!attempt && mode === 'start' && method === 'POST') {
    const student = await db.collection('students').findOne({ user_id: user.id });
    const exam = await examCollection.findOne({ _id: examId, class_level: student?.class_level ?? '' });
    if (!exam) return send({ message: 'Exam not found.' }, 404);
    const started = Date.now();
    if (started < exam.opens || started + exam.duration * 60000 > exam.closes) return send({ message: 'This exam is outside its starting window.' }, 409);
    const set = randomInt(exam.papers.length);
    const initial = { ...key, exam_id: examId, student_id: user.id, student_name: user.name, title: exam.title, set: set + 1,
      paper: exam.papers[set], state: 'active', deadline: started + exam.duration * 60000, started_at: started,
      answers: exam.papers[set].map(() => ''), violations: [], revision: 0 };
    try { await attempts.insertOne(initial); attempt = initial; }
    catch (error) {
      if (error.code !== 11000) throw error;
      attempt = await attempts.findOne(key);
    }
  }
  if (!attempt) return send({ message: 'Start the exam first.' }, 404);
  if (mode === 'update' && method === 'POST') {
    const { action: update, revision, answers, event, reason } = body;
    const live = { ...key, state: 'active', $expr: { $gt: ['$deadline', { $toLong: '$$NOW' }] } };
    if (update === 'violation') {
      if (typeof event !== 'string' || !idPattern.test(event) || !reasons.has(reason)) return send({ message: 'Invalid violation event.' }, 400);
      await attempts.updateOne({ ...live, 'violations.event': { $ne: event } }, [
        { $set: { violations: { $concatArrays: ['$violations', [{ event, reason, at: { $toLong: '$$NOW' } }]] }, last_violation: { $toLong: '$$NOW' } } },
        { $set: { state: { $cond: [{ $gte: [{ $size: '$violations' }, 3] }, 'terminated', 'active'] } } },
      ]);
    } else if (['save', 'submit'].includes(update)) {
      if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(answers) || answers.length !== attempt.paper.length ||
          answers.some(value => typeof value !== 'string' || value.length > 1500)) return send({ message: 'Invalid answers.' }, 400);
      const outcome = await attempts.updateOne({ ...live, revision: revision - 1 },
        { $set: { answers, revision, ...(update === 'submit' ? { state: 'submitted' } : {}) } });
      if (!outcome.matchedCount) {
        attempt = await attempts.findOne(key);
        if (state(attempt) === 'active' && !(attempt.revision === revision && JSON.stringify(attempt.answers) === JSON.stringify(answers))) {
          return send({ message: 'This attempt changed. Reload before continuing.' }, 409);
        }
      }
    } else if (update !== 'status') return send({ message: 'Invalid exam action.' }, 400);
    attempt = await attempts.findOne(key);
  } else if (!(mode === 'start' && method === 'POST') && !(!mode && method === 'GET')) return send({ message: 'Method not allowed.' }, 405);
  const status = state(attempt);
  const view = { title: attempt.title, state: status, deadline: attempt.deadline, remaining: Math.max(0, attempt.deadline - Date.now()),
    revision: attempt.revision, violations: attempt.violations.length };
  if (status === 'active' && mode !== 'update') Object.assign(view, { paper: attempt.paper, set: attempt.set, answers: attempt.answers });
  return send(view);
}
