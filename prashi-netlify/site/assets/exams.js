import { addDocumentImport } from './management.js';

const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const labels = { expired: 'Time expired', submitted: 'Submitted', terminated: 'Terminated after three violations', active: 'In progress' };

function node(tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function button(text, fn) {
  const element = node('button', text);
  element.type = 'button';
  element.addEventListener('click', fn);
  return element;
}

function field(form, title, name, type, props = {}) {
  const label = node('label', title);
  const input = document.createElement(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  input.name = name;
  if (type !== 'textarea' && type !== 'select') input.type = type;
  Object.assign(input, props);
  label.append(input);
  form.append(label);
  return input;
}

function splitQuestionInput(value) {
  const separator = /\n\s*\n/.test(value.trim()) ? /\n\s*\n/ : /\r?\n/;
  return value.split(separator).map(text => text.trim()).filter(Boolean);
}

function setup(section, api, refresh) {
  const details = node('details');
  details.append(node('summary', 'Schedule an exam'));
  const form = node('form');
  form.className = 'exam-form';
  field(form, 'Exam title', 'title', 'text', { required: true, maxLength: 140 });
  const classes = field(form, 'Class', 'classLevel', 'select');
  for (let number = 1; number <= 12; number++) classes.add(new Option('Class ' + number, 'Class ' + number, false, number === 10));
  const duration = field(form, 'Duration', 'duration', 'select');
  for (const minutes of [30, 60, 90]) duration.add(new Option(minutes + ' minutes', minutes));
  field(form, 'Opens (your local time)', 'opens', 'datetime-local', { required: true });
  field(form, 'Closes (your local time)', 'closes', 'datetime-local', { required: true });
  field(form, 'Number of sets', 'sets', 'number', { min: 1, max: 6, value: 1, required: true });
  const groups = node('div');
  groups.className = 'exam-form';
  function addGroup() {
    const group = node('fieldset');
    group.className = 'exam-form';
    group.append(node('legend', 'Marks group'));
    field(group, 'Marks per question', 'marks', 'number', { min: 1, max: 20, value: 2, required: true });
    field(group, 'Questions to draw', 'count', 'number', { min: 1, max: 30, value: 1, required: true });
    const questionText = field(group, 'Separate questions with a blank line', 'questions', 'textarea', { rows: 5, required: true, maxLength: 20000 });
    addDocumentImport(group, api, questions => { questionText.value = questions.join('\n\n'); });
    const bankStatus = node('p');
    bankStatus.setAttribute('role', 'status');
    const fromBank = button('Load saved questions for this class and marks', async () => {
      fromBank.disabled = true;
      try {
        const marks = Number(group.querySelector('[name=marks]').value);
        const { items } = await api('question-bank?' + new URLSearchParams({ class_level: classes.value }));
        const matches = items.filter(item => Number(/^\s*(\d+)/.exec(item.q_type)?.[1]) === marks);
        if (!matches.length) {
          bankStatus.textContent = 'No saved questions found for these marks.';
          return;
        }
        const combined = [...new Set([...splitQuestionInput(questionText.value), ...matches.map(item => item.question_text)])];
        questionText.value = combined.slice(0, 100).join('\n\n');
        bankStatus.textContent = 'Review the loaded questions and remove any that should not be used.';
      } catch (error) {
        bankStatus.textContent = error.message;
      } finally {
        fromBank.disabled = false;
      }
    });
    group.append(fromBank, bankStatus);
    group.append(button('Remove group', () => {
      if (groups.children.length > 1) group.remove();
    }));
    groups.append(group);
  }
  addGroup();
  form.append(groups, button('Add marks group', () => { if (groups.children.length < 6) addGroup(); }));
  const submit = node('button', 'Generate sets and schedule');
  const feedback = node('p');
  feedback.setAttribute('role', 'status');
  form.append(submit, feedback);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    const data = new FormData(form);
    try {
      await api('exams', {
        title: data.get('title'), classLevel: data.get('classLevel'), duration: Number(data.get('duration')),
        sets: Number(data.get('sets')), opens: new Date(data.get('opens')).getTime(), closes: new Date(data.get('closes')).getTime(),
        groups: [...groups.children].map(group => ({
          marks: Number(group.querySelector('[name=marks]').value), count: Number(group.querySelector('[name=count]').value),
          questions: splitQuestionInput(group.querySelector('[name=questions]').value),
        })),
      });
      await refresh();
    } catch (error) {
      feedback.textContent = error.message;
      submit.disabled = false;
    }
  });
  details.append(form);
  section.append(details);
}

function review(section, api, exam) {
  const detail = node('details');
  detail.append(node('summary', exam.title + ' · ' + exam.class_level));
  detail.addEventListener('toggle', async () => {
    if (!detail.open || detail.children.length > 1) return;
    const content = node('div');
    detail.append(content);
    try {
      const result = await api('exams/' + exam._id);
      result.exam.papers.forEach((paper, index) => {
        const set = node('details');
        set.append(node('summary', 'Paper set ' + (index + 1)));
        for (const item of paper) set.append(node('p', item.text + ' (' + item.marks + ' marks)'));
        content.append(set);
      });
      if (!result.attempts.length) content.append(node('p', 'No attempts yet.'));
      for (const attempt of result.attempts) {
        const entry = node('details');
        entry.append(node('summary', attempt.student_name + ' · ' + labels[attempt.state]));
        attempt.paper.forEach((item, index) => entry.append(node('h3', item.text), node('p', attempt.answers[index] || 'No answer saved.')));
        content.append(entry);
      }
    } catch (error) {
      content.textContent = error.message;
    }
  });
  section.append(detail);
}

export async function showExams(section, role, api) {
  const content = node('div');
  content.className = 'exam-form';
  section.append(content);
  const refresh = async () => {
    const data = await api('exams');
    content.replaceChildren();
    if (role !== 'student') {
      setup(content, api, refresh);
      if (data.alerts.length) content.append(node('h3', 'Violation alerts'));
      for (const alert of data.alerts) {
        const last = alert.violations.at(-1);
        content.append(node('p', alert.student_name + ' · ' + alert.title + ' · ' + alert.violations.length +
          '/3 violations · ' + date.format(new Date(last.at)) + ' · ' + labels[alert.state]));
      }
      for (const exam of data.exams) review(content, api, exam);
    } else {
      for (const exam of data.exams) {
        const attempt = data.attempts.find(row => row.exam_id === exam._id);
        const card = node('article');
        card.append(node('h3', exam.title), node('p', exam.duration + ' minutes · Latest start ' + date.format(exam.closes - exam.duration * 60000)));
        if (attempt) card.append(node('p', labels[attempt.state]));
        if (attempt?.state === 'active' || (!attempt && Date.now() >= exam.opens && Date.now() + exam.duration * 60000 <= exam.closes)) {
          const message = node('p');
          const start = button(attempt ? 'Resume exam' : 'Start exam', async () => {
            start.disabled = true;
            try {
              const path = 'exams/' + exam._id;
              const state = await (attempt ? api(path) : api(path + '/start', {}));
              if (state.state === 'active') openAttempt(content, state, path, api, refresh);
              else await refresh();
            } catch (error) {
              message.textContent = error.message;
              start.disabled = false;
            }
          });
          card.append(start, message);
        }
        content.append(card);
      }
    }
    if (!data.exams.length) content.append(node('p', 'No exams scheduled.'));
  };
  await refresh();
}

function openAttempt(content, initial, path, api, onFinish) {
  const screen = node('dialog');
  screen.className = 'exam-screen';
  const heading = node('h2', initial.title + ' · Set ' + initial.set);
  const timer = node('p');
  const feedback = node('p', 'Keep this exam screen open. Three exits end the attempt.');
  feedback.setAttribute('role', 'status');
  const form = node('form');
  form.className = 'exam-form';
  const fields = initial.paper.map((item, index) => field(form, item.text + ' (' + item.marks + ' marks)', 'answer', 'textarea',
    { rows: 4, maxLength: 1500, value: initial.answers[index] }));
  const submit = node('button', 'Submit exam');
  form.append(submit);
  const resume = button('Open exam screen', resumeExam);
  const finish = button('Back to exams', async () => { screen.close(); screen.remove(); await onFinish(); });
  finish.hidden = true;
  form.hidden = true;
  screen.append(heading, timer, feedback, resume, form, finish);
  document.body.append(screen);
  screen.showModal();
  const deadline = performance.now() + initial.remaining;
  const pendingKey = 'prashi-exam-violations:' + path;
  let pending = [];
  try { pending = JSON.parse(sessionStorage.getItem(pendingKey)) || []; } catch {}
  let revision = initial.revision;
  let violations = initial.violations;
  const fullscreenTarget = document.documentElement;
  let stale = false;
  let active = false;
  let ended = false;
  let fullscreen = false;
  let dirty = false;
  let edits = 0;
  let debounce;
  let queue = Promise.resolve();
  const events = new AbortController();

  function remember() {
    try {
      if (pending.length) sessionStorage.setItem(pendingKey, JSON.stringify(pending));
      else sessionStorage.removeItem(pendingKey);
    } catch {}
  }

  function lock(message) {
    active = false;
    feedback.textContent = message;
    form.hidden = true;
    resume.hidden = false;
  }

  function stop(state) {
    if (ended) return;
    ended = true;
    lock(labels[state]);
    resume.hidden = true;
    finish.hidden = false;
    pending = [];
    remember();
    events.abort();
    clearInterval(ticker);
    clearTimeout(debounce);
    if (document.fullscreenElement === fullscreenTarget) document.exitFullscreen().catch(() => {});
    finish.focus();
  }

  function sync(result) {
    revision = result.revision;
    violations = result.violations;
    if (result.state !== 'active') stop(result.state);
  }

  function send(action = 'status') {
    queue = queue.catch(() => {}).then(async () => {
      if (ended) return;
      while (pending.length) {
        const result = await api(path + '/update', { action: 'violation', ...pending[0] });
        pending.shift();
        remember();
        sync(result);
        if (ended) return;
      }
      const snapshot = edits;
      const saves = action !== 'status';
      const result = await api(path + '/update', saves
        ? { action, revision: revision + 1, answers: fields.map(field => field.value) }
        : { action });
      if (!saves && result.state === 'active' && result.revision !== revision) {
        lock('This attempt was updated from another screen. Reload before continuing.');
        stale = true;
        resume.disabled = true;
        return;
      }
      sync(result);
      if (saves && snapshot === edits) dirty = false;
      if (saves && active) feedback.textContent = 'Answers saved.';
    }).catch(error => {
      feedback.textContent = error.message + ' The timer continues.';
      throw error;
    });
    return queue;
  }

  async function resumeExam() {
    if (active || ended || stale || document.hidden || performance.now() >= deadline) return;
    resume.disabled = true;
    if (!document.fullscreenElement) {
      try { await fullscreenTarget.requestFullscreen?.(); } catch {}
    }
    fullscreen = document.fullscreenElement === fullscreenTarget;
    try {
      await send();
      if (!ended && !stale && !document.hidden && document.hasFocus()) {
        active = true;
        resume.hidden = true;
        form.hidden = false;
        feedback.textContent = 'Keep the exam screen open.';
        fields[0]?.focus();
      }
    } catch {}
    resume.disabled = stale;
  }

  function exit(reason) {
    if (!active || ended) return;
    lock('Exam screen left. Return to resume.');
    pending.push({ event: crypto.randomUUID(), reason });
    remember();
    const payload = JSON.stringify({ action: 'violation', ...pending.at(-1) });
    navigator.sendBeacon?.('/api/' + path + '/update', new Blob([payload], { type: 'application/json' }));
    send().catch(() => {});
  }

  form.addEventListener('input', () => {
    dirty = true;
    edits++;
    clearTimeout(debounce);
    debounce = setTimeout(() => { if (dirty) send('save').catch(() => {}); }, 700);
  }, { signal: events.signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!active) return;
    submit.disabled = true;
    try { await send('submit'); } catch {}
    submit.disabled = false;
  }, { signal: events.signal });
  screen.addEventListener('cancel', event => { event.preventDefault(); exit('fullscreen'); }, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) exit('hidden'); }, { signal: events.signal });
  document.addEventListener('fullscreenchange', () => { if (fullscreen && document.fullscreenElement !== fullscreenTarget) exit('fullscreen'); }, { signal: events.signal });
  window.addEventListener('blur', () => exit('blur'), { signal: events.signal });
  window.addEventListener('pagehide', () => exit('navigation'), { signal: events.signal });
  let tick = 0;
  const ticker = setInterval(() => {
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    timer.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' remaining · ' + violations + '/3 violations';
    if (!seconds) {
      lock('Time is up. Checking the exam status…');
      resume.hidden = true;
      if (tick % 4 === 0) send().catch(() => {});
    } else if (tick % 10 === 0) send(dirty && active ? 'save' : 'status').catch(() => {});
    tick++;
  }, 500);
  send().catch(() => {});
}
