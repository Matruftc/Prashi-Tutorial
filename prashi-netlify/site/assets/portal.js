import { preloadPage } from './preloader.js';
import { showExams } from './exams.js';
import { showMaterials, showPeople, showQuestionBank, showPublic, showInbox, showDoubts, showRecords, showProfilePhoto, showAdminOperations, showStudentImport, showTutorial, showSiteAdmin, showPublicDetail } from './management.js';

const login = document.getElementById('login');
const dashboard = document.getElementById('dashboard');
const password = document.getElementById('password-form');
const signOut = document.getElementById('sign-out');
const status = document.getElementById('status');
const views = document.getElementById('views');
const publicContent = document.getElementById('public-content');
const hero = document.getElementById('coaching-hero');
const navigation = document.getElementById('site-nav');
const portalLink = document.getElementById('portal-link');
const loginPage = ['/login', '/portal', '/admin'].includes(location.pathname);
const publicPage = location.pathname === '/';
hero.hidden = !publicPage;
let renderVersion = 0;
let adminNavigation;
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

async function api(path, payload) {
  const response = await fetch('/api/' + path, payload === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const failure = new Error(data.message || 'The portal couldn’t complete this request.');
    failure.status = response.status;
    failure.code = data.code;
    failure.requestId = response.headers.get('X-Request-ID');
    throw failure;
  }
  return response.json();
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text ?? '';
  if (className) node.className = className;
  return node;
}

function panel(title, id, parent = views) {
  const section = element('section', '', 'panel');
  if (id) {
    section.id = id;
    section.tabIndex = -1;
  }
  section.append(element('h2', title));
  parent.append(section);
  return section;
}

function showAdminGuide(section) {
  const guides = [
    ['Manage people', 'manage-people', [
      'Use Add student login or Add teacher login to create an account. Use the account controls to manage sign-in.',
      'For a whole class, open Student CSV import, download the template, and review the preview before confirming.',
    ]],
    ['Question bank', 'manage-question-bank', [
      'Choose a class, subject, chapter, and question type. Use a label like 2 Marks so the exam scheduler can find matching questions.',
      'Type the questions or upload a PDF or Word document (.docx) and select Extract questions. Check the blank lines between questions, then select Save questions.',
      'To share questions for practice, choose the whole class or a batch and select Publish.',
    ]],
    ['Schedule exams and review violations', 'manage-exams', [
      'Open Schedule an exam. Choose the class, opening and closing times, duration (30, 60, or 90 minutes), and number of sets.',
      'For each marks group, enter the marks per question and how many to draw. Import a document or load saved questions for the selected class and marks.',
      'Review the questions, then select Generate sets and schedule. Check Violation alerts for flagged attempts. The third recorded exit terminates the attempt.',
    ]],
    ['Tutorial records and marksheets', 'manage-tutorial', [
      'Select a batch and download its Excel marksheet. Fill it in, choose mock_result, and upload the file under Create a record or import marks.',
      'Leave Make visible to students unchecked while you review the import. Use Release or hide records for a batch when the records are ready.',
    ]],
    ['Website settings and social links', 'manage-website', [
      'Open Site settings to change the WhatsApp number, Instagram handle, or YouTube handle. Save each setting individually. Clear a field to hide its link.',
      'Open Courses, Batches, or another content section to update the public website. Use Form builder to edit public enquiry and admission fields.',
    ]],
    ['Enquiries and admissions', 'manage-inbox', [
      'Open the enquiries inbox to review submissions, assign follow-up, add internal notes, and update the status.',
    ]],
    ['Enrollments, attendance and fees', 'manage-records', [
      'Use Enroll a student to assign a student to a batch and set their fee and discount.',
      'Use Mark attendance for one student or Mark a full batch for a class. Use Record a payment to log a fee payment and review the receipt.',
    ]],
    ['Share study materials', 'manage-materials', [
      'Open Upload private material, choose the target class and file, then save it for students.',
    ]],
    ['Answer student questions', 'manage-doubts', [
      'Open a student’s question, enter your reply, and save it so the student can see it in their portal.',
    ]],
    ['Activity log and exports', 'manage-administration', [
      'Open Recent activity to review recorded changes. Open Download data for spreadsheets and the ZIP export.',
    ]],
  ];
  for (const [title, target, steps] of guides) {
    const details = element('details');
    details.append(element('summary', title));
    const list = element('ol');
    for (const step of steps) list.append(element('li', step));
    const link = element('a', 'Go to ' + (target === 'manage-exams' ? 'Exams' : title));
    link.href = '#' + target;
    details.append(list, link);
    section.append(details);
  }
}

function showAdmin() {
  const layout = element('div', '', 'admin-layout');
  const nav = element('nav', '', 'admin-menu');
  nav.setAttribute('aria-label', 'Admin sections');
  const content = element('div', '', 'admin-content');
  layout.append(nav, content);
  views.append(layout);

  const tasks = [
    ['People', [
      ['manage-people', 'Manage people', section => showPeople(section, 'admin', api)],
      ['student-import', 'Student CSV import', section => showStudentImport(section, api)],
    ]],
    ['Enrollment & fees', [
      ['manage-records', 'Enrollments, attendance and fees', section => showRecords(section, api, 'admin')],
    ]],
    ['Exams', [
      ['manage-exams', 'Exams', section => showExams(section, 'admin', api)],
      ['manage-question-bank', 'Manage question bank', section => showQuestionBank(section, 'admin', api)],
    ]],
    ['Learning', [
      ['manage-materials', 'Study materials', section => showMaterials(section, 'admin', api)],
      ['manage-tutorial', 'Tutorial records and marksheets', section => showTutorial(section, api, 'admin')],
      ['manage-doubts', 'Student questions', section => showDoubts(section, 'admin', api)],
    ]],
    ['Enquiries', [
      ['manage-inbox', 'Enquiries and admissions', section => showInbox(section, api, 'admin')],
    ]],
    ['Website', [
      ['manage-website', 'Website content and form builder', section => showSiteAdmin(section, api)],
    ]],
    ['Administration', [
      ['manage-administration', 'Administration', section => showAdminOperations(section, api)],
    ]],
    ['Help', [['admin-guides', 'Admin guides', showAdminGuide]]],
  ];

  const areas = tasks.map(([label, panels]) => {
    const link = element('a', label);
    link.href = '#' + panels[0][0];
    nav.append(link);
    const container = element('div', '', 'admin-area');
    container.hidden = true;
    content.append(container);
    return { link, container, panels, loaded: false };
  });

  function openSection() {
    const targetId = location.hash.slice(1);
    const active = areas.find(area => area.panels.some(([id]) => id === targetId)) || areas[0];
    for (const area of areas) {
      area.container.hidden = area !== active;
      if (area === active) area.link.setAttribute('aria-current', 'location');
      else area.link.removeAttribute('aria-current');
    }
    if (!active.loaded) {
      active.loaded = true;
      for (const [id, title, renderSection] of active.panels) {
        const section = panel(title, id, active.container);
        async function load() {
          const feedback = element('p', 'Loading…');
          feedback.setAttribute('role', 'status');
          section.append(feedback);
          try {
            await renderSection(section);
            feedback.remove();
          } catch (error) {
            feedback.textContent = error.message;
            const retry = element('button', 'Try again', 'quiet');
            retry.type = 'button';
            retry.addEventListener('click', () => {
              section.replaceChildren(section.firstElementChild);
              load();
            }, { once: true });
            section.append(retry);
          }
        }
        load();
      }
    }
    if (targetId) document.getElementById(targetId)?.focus();
  }

  adminNavigation = new AbortController();
  window.addEventListener('hashchange', openSection, { signal: adminNavigation.signal });
  openSection();
}

function table(title, columns, rows) {
  const section = panel(title);
  if (!rows.length) {
    section.append(element('p', 'No records available.'));
    return;
  }
  const scroll = element('div', '', 'table-scroll');
  const grid = element('table');
  const head = grid.createTHead().insertRow();
  for (const column of columns) {
    const cell = element('th', column);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = grid.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const text of row) tr.insertCell().textContent = text ?? '—';
  }
  scroll.append(grid);
  section.append(scroll);
}

async function showStudent(version) {
  const [data, { questions }] = await Promise.all([api('student'), api('student/questions')]);
  if (version !== renderVersion) return;
  const profile = panel('My profile');
  if (data.profile?.photoUrl) {
    const photo = element('img', null, 'profile-photo');
    photo.src = data.profile.photoUrl;
    photo.alt = 'Your profile photo';
    profile.append(photo);
  }
  profile.append(element('p', [data.profile?.admission_no, data.profile?.class_level, data.profile?.school].filter(Boolean).join(' · ') || 'No student profile available.'));
  showProfilePhoto(profile, api, data.profile?.photoUrl);
  if (data.notices.length) {
    const notices = panel('Student notices');
    for (const row of data.notices) {
      const entry = element('article');
      entry.append(element('h3', row.title), element('p', row.body_html?.replace(/<[^>]*>/g, ' ')));
      notices.append(entry);
    }
  }
  const records = panel('Study notes and remarks');
  if (!data.records.length) records.append(element('p', 'No notes or remarks available.'));
  for (const row of data.records) {
    const item = element('details');
    item.append(element('summary', row.title), element('p', row.body));
    if (row.fileUrl) {
      const attachment = element('a', 'Download attachment');
      attachment.href = row.fileUrl;
      item.append(attachment);
    }
    records.append(item);
  }
  table('Fees', ['Batch', 'Payable', 'Paid', 'Balance'], data.enrollments.map(row =>
    [row.batch, money.format(row.payable), money.format(row.paid), money.format(row.payable - row.paid)]));
  const receipts = panel('Payment receipts');
  if (!data.payments.length) receipts.append(element('p', 'No payments recorded.'));
  for (const payment of data.payments) {
    const link = element('a', (payment.receipt_no || 'Receipt') + ' · ' + money.format(payment.amount) + ' · ' + payment.paid_on);
    link.href = '/api/records/receipt/' + payment.id;
    link.target = '_blank';
    link.rel = 'noopener';
    receipts.append(link);
  }
  table('Attendance', ['Date', 'Status'], data.attendance.map(row => [row.day, row.status]));
  table('Results', ['Assessment', 'Score', 'Date'], data.scores.map(row => [row.title, row.score + ' / ' + row.max_score, row.record_date]));
  const bank = panel('Published questions');
  if (!questions.length) bank.append(element('p', 'No published questions yet.'));
  for (const question of questions) {
    const entry = element('details');
    entry.append(element('summary', question.question_text),
      element('p', [question.subject, question.chapter, question.q_type].join(' · ')),
      element('p', question.answer_text || 'No answer provided.', 'answer'));
    bank.append(entry);
  }
}

async function showStaff(version) {
  const data = await api('staff');
  if (version !== renderVersion) return;
  table('Students', ['Name', 'Admission number', 'Class', 'School'],
    data.students.map(row => [row.name, row.admission_no, row.class_level, row.school]));
  table('Faculty', ['Name', 'Subject', 'Qualifications'], data.faculty.map(row => [row.name, row.subject, row.qualifications]));
  table('Question bank', ['Class', 'Subject', 'Chapter', 'Question'], data.questions.map(row =>
    [row.class_level, row.subject, row.chapter, row.question_text]));
}

async function render(user) {
  const version = ++renderVersion;
  adminNavigation?.abort();
  login.hidden = Boolean(user) || !loginPage;
  if (user) document.getElementById('forgot-form').hidden = true;
  publicContent.hidden = Boolean(user) || loginPage;
  hero.hidden = Boolean(user) || loginPage;
  navigation.hidden = Boolean(user) || loginPage;
  portalLink.hidden = Boolean(user) || loginPage;
  document.body.classList.toggle('dashboard-mode', Boolean(user));
  password.hidden = !user?.mustChangePassword;
  dashboard.hidden = !user || Boolean(user.mustChangePassword);
  signOut.hidden = !user;
  views.replaceChildren();
  if (!user) {
    if (loginPage || location.pathname !== '/') {
      history.replaceState(null, '', '/login');
      login.hidden = false;
      publicContent.hidden = hero.hidden = navigation.hidden = portalLink.hidden = true;
    } else {
      await showPublic(publicContent, api).then(() => {
        if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
      }).catch(error => { if (version === renderVersion) publicContent.textContent = error.message; });
    }
    status.hidden = true;
    return;
  }
  const adminHash = user.role === 'admin' && location.pathname === '/admin' ? location.hash : '';
  history.replaceState(null, '', user.role === 'student' ? '/portal' : '/admin' + adminHash);
  if (user.mustChangePassword) {
    status.hidden = true;
    return;
  }
  document.getElementById('role').textContent = user.role === 'student' ? 'Student portal' : 'Staff portal';
  document.getElementById('welcome').textContent = 'Welcome, ' + user.name;
  if (user.role === 'admin') {
    document.getElementById('role').textContent = 'Admin portal';
    status.hidden = true;
    showAdmin();
    return;
  }
  status.textContent = 'Loading records…';
  status.hidden = false;
  try {
    if (user.role === 'student') await showStudent(version);
    else await showStaff(version);
    if (version === renderVersion) {
      const sections = [showExams(panel('Exams', 'manage-exams'), user.role, api), showMaterials(panel('Study materials', 'manage-materials'), user.role, api), showDoubts(panel('Student questions', 'manage-doubts'), user.role, api)];
      if (user.role !== 'student') {
        showStudentImport(panel('Student CSV import'), api);
        sections.push(showTutorial(panel('Tutorial records and marksheets', 'manage-tutorial'), api, user.role));
        sections.push(showPeople(panel('Manage people', 'manage-people'), user.role, api), showQuestionBank(panel('Manage question bank', 'manage-question-bank'), user.role, api), showInbox(panel('Enquiries and admissions', 'manage-inbox'), api, user.role), showRecords(panel('Enrollments, attendance and fees', 'manage-records'), api, user.role));
      }
      await Promise.all(sections);
      if (version === renderVersion) status.hidden = true;
    }
  } catch (error) {
    if (version === renderVersion) status.textContent = error.message;
  }
}

function bind(form, path) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    const message = form.querySelector('.error');
    button.disabled = true;
    message.hidden = true;
    try {
      const user = await api(path, Object.fromEntries(new FormData(form)));
      form.reset();
      await render(user);
    } catch (error) {
      message.textContent = error.message;
      message.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

bind(document.getElementById('login-form'), 'login');
bind(password, 'password');
signOut.addEventListener('click', async () => {
  signOut.disabled = true;
  try {
    await api('logout', {});
    await render(null);
  } catch (error) {
    status.textContent = error.message;
    status.hidden = false;
  } finally {
    signOut.disabled = false;
  }
});

const forgotForm = document.getElementById('forgot-form');
const resetForm = document.getElementById('reset-form');
const resetToken = location.pathname === '/reset' ? location.hash.slice(1) : '';
document.getElementById('forgot-toggle').addEventListener('click', () => {
  forgotForm.hidden = !forgotForm.hidden;
  if (!forgotForm.hidden) forgotForm.querySelector('input').focus();
});

function recoveryForm(form, action, extra = {}) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button');
    const notice = form.querySelector('[role=status]');
    submit.disabled = true;
    try {
      const result = await api(action, { ...Object.fromEntries(new FormData(form)), ...extra });
      form.reset();
      if (action === 'reset') {
        form.hidden = true;
        await render(null);
        status.textContent = 'Password updated. Sign in with your new password.';
        status.hidden = false;
      } else notice.textContent = result.message;
    } catch (error) {
      notice.textContent = error.message;
    } finally {
      notice.hidden = false;
      submit.disabled = false;
    }
  });
}
recoveryForm(forgotForm, 'forgot');
recoveryForm(resetForm, 'reset', { token: resetToken });
let entry;
if (location.pathname === '/reset') {
  navigation.hidden = true;
  history.replaceState(null, '', '/reset');
  status.hidden = /^[a-f0-9]{64}$/.test(resetToken);
  status.textContent = 'This reset link is invalid. Return to sign in to request another link.';
  resetForm.hidden = !status.hidden;
} else if (/^\/(courses|resources)\/[a-z0-9-]+$/.test(location.pathname)) {
  const [, category, slug] = location.pathname.split('/');
  publicContent.hidden = false;
  status.hidden = false;
  status.textContent = 'Loading page…';
  entry = showPublicDetail(publicContent, api, category, slug).then(() => { status.hidden = true; })
    .catch(error => { status.textContent = error.message; });
} else if (publicPage) {
  entry = render(null);
} else entry = api('session').then(({ user }) => render(user)).catch(error => {
  login.hidden = false;
  status.hidden = false;
  status.textContent = error.message;
});

preloadPage(entry);
