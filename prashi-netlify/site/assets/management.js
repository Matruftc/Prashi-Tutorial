const classes = Array.from({ length: 12 }, (_, index) => 'Class ' + (index + 1));

function node(tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function makeForm(title, section, open = false) {
  const details = node('details');
  details.open = open;
  details.append(node('summary', title));
  const form = node('form');
  form.className = 'exam-form';
  details.append(form);
  section.append(details);
  return form;
}

function field(form, title, name, options = {}) {
  const { type, value = '', choices, required = false, accept } = options;
  const label = node('label', title);
  const input = node(choices ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  input.name = name;
  input.required = required;
  if (choices) for (const choice of choices) input.add(new Option(choice, choice));
  else if (type === 'textarea') input.rows = 6;
  else input.type = type || 'text';
  if (accept) input.accept = accept;
  if (input.type !== 'file' && value != null && (!choices || choices.includes(String(value)))) input.value = value;
  label.append(input);
  form.append(label);
  return input;
}

function button(text, action) {
  const item = node('button', text);
  item.type = 'button';
  item.addEventListener('click', action);
  return item;
}

function submit(form, title, action) {
  const next = node('button', title);
  const status = node('p');
  status.setAttribute('role', 'status');
  form.append(next, status);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    next.disabled = true;
    try { status.textContent = await action(new FormData(form)); }
    catch (error) { status.textContent = error.message; }
    finally { next.disabled = false; }
  });
  return next;
}

export async function encodeFile(file) {
  if (!file?.size) throw new Error('Choose a file.');
  if (file.size > 3 * 1024 * 1024) throw new Error('Choose a file up to 3 MiB.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]), { once: true });
    reader.addEventListener('error', () => reject(new Error('The file could not be read.')), { once: true });
    reader.readAsDataURL(file);
  });
  return { name: file.name, data };
}

export function addDocumentImport(container, api, onQuestions) {
  const file = field(container, 'Import questions from PDF or Word', 'document', { type: 'file', accept: '.pdf,.docx' });
  const feedback = node('p');
  feedback.setAttribute('role', 'status');
  const extract = button('Extract questions', async () => {
    extract.disabled = true;
    try {
      const { questions } = await api('documents/extract', { file: await encodeFile(file.files[0]) });
      onQuestions(questions);
      feedback.textContent = questions.length + ' questions extracted. Review the text before saving.';
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      extract.disabled = false;
    }
  });
  container.append(extract, feedback);
}

export async function showMaterials(section, role, api) {
  const staff = role !== 'student';
  const list = node('div');
  if (staff) {
    const form = makeForm('Upload private material', section);
    field(form, 'Title', 'title', { required: true });
    field(form, 'Class', 'classLevel', { choices: classes, value: 'Class 10' });
    field(form, 'File (up to 3 MiB)', 'file', { type: 'file', required: true, accept: '.pdf,.docx,.png,.jpg,.jpeg' });
    submit(form, 'Upload material', async data => {
      await api('materials', { title: data.get('title'), classLevel: data.get('classLevel'), file: await encodeFile(data.get('file')) });
      form.reset();
      await refresh();
      return 'Material uploaded.';
    });
  }
  section.append(list);
  async function refresh() {
    const { files } = await api('materials');
    list.replaceChildren();
    if (!files.length) list.append(node('p', 'No materials available.'));
    for (const file of files) {
      const item = node('div');
      item.className = 'record-actions';
      const link = node('a', file.title + ' · ' + file.class_level);
      link.href = '/api/materials/' + file._id;
      item.append(link);
      if (staff) item.append(button('Remove', async () => {
        if (!confirm('Remove this uploaded material?')) return;
        try {
          await api('materials/' + file._id, {});
          await refresh();
        } catch (error) { item.append(node('p', error.message)); }
      }));
      list.append(item);
    }
  }
  await refresh();
}

export async function showPeople(section, role, api) {
  for (const kind of (role === 'admin' ? ['students', 'teachers'] : ['students'])) {
    const students = kind === 'students';
    const path = 'people/' + kind;
    const list = node('div');
    const form = makeForm(students ? 'Add student login' : 'Add teacher login', section);
    const formFields = (form, record = {}) => {
      field(form, 'Name', 'name', { required: true, value: record.name });
      field(form, 'Email', 'email', { type: 'email', required: !students, value: record.email });
      if (students) {
        field(form, 'Class', 'class_level', { choices: ['', ...classes, 'Dropper / Other'], value: record.class_level });
        field(form, 'School', 'school', { value: record.school });
        field(form, 'Parent name', 'parent_name', { value: record.parent_name });
        field(form, 'Parent phone', 'parent_phone', { value: record.parent_phone });
      }
    };
    if (students) field(form, 'Admission number', 'admission', { required: true });
    formFields(form);
    submit(form, 'Create login', async data => {
      const secrets = await api(path, Object.fromEntries(data));
      form.reset();
      await refresh();
      return 'Login ' + secrets.login + ' · Temporary password ' + secrets.password;
    });
    section.append(list);
    async function refresh() {
      const { records } = await api(path);
      list.replaceChildren();
      for (const record of records) {
        const editor = makeForm([record.name, record.admission_no].filter(Boolean).join(' · ') || 'Unnamed account', list);
        formFields(editor, record);
        if (role === 'admin') field(editor, 'Account status', 'active', { choices: ['Active', 'Inactive'], value: record.active ? 'Active' : 'Inactive' });
        const accountStatus = node('p');
        accountStatus.setAttribute('role', 'status');
        const accountId = students ? record.user_id : record.id;
        editor.append(button('Issue temporary password', async () => {
          if (!confirm('Replace the current password and sign this account out?')) return;
          try {
            const credentials = await api(path + '/' + accountId + '/reset', {});
            accountStatus.textContent = 'Login ' + credentials.login + ' · Temporary password ' + credentials.password;
          } catch (error) { accountStatus.textContent = error.message; }
        }));
        if (role === 'admin' && students) editor.append(button('Delete student', async () => {
          if (!confirm('Permanently delete this student and their records?')) return;
          try {
            await api(path + '/' + accountId + '/delete', {});
            await refresh();
          } catch (error) { accountStatus.textContent = error.message; }
        }));
        editor.append(accountStatus);
        submit(editor, 'Save profile', async data => {
          const values = Object.fromEntries(data);
          if (values.active) values.active = values.active === 'Active';
          await api(path + '/' + (students ? record.user_id : record.id), values);
          editor.parentElement.firstElementChild.textContent = values.name;
          return 'Saved.';
        });
      }
    }
    await refresh();
  }
}

export async function showQuestionBank(section, role, api) {
  const form = makeForm('Add questions to the bank', section);
  field(form, 'Class', 'class_level', { choices: classes, value: 'Class 10' });
  field(form, 'Subject', 'subject', { required: true });
  field(form, 'Chapter', 'chapter', { required: true });
  field(form, 'Question type', 'q_type', { required: true, value: '2 Marks' });
  const area = field(form, 'Separate questions with a blank line', 'questions', { type: 'textarea', required: true });
  addDocumentImport(form, api, questions => { area.value = questions.join('\n\n'); });
  const list = node('div');
  function splitRows(value) {
    return value.trim().split(/\n\s*\n/).filter(Boolean).map(text => {
      const [question, answer] = text.split(/\n\s*(?:answer|ans)[.:]\s*/i);
      return { question, answer };
    });
  }
  submit(form, 'Save questions', async data => {
    const values = Object.fromEntries(data);
    values.file_name = data.get('document')?.name || '';
    delete values.document;
    delete values.questions;
    const result = await api('question-bank/save', { ...values, rows: splitRows(area.value) });
    area.value = '';
    await refresh();
    return 'Added ' + result.added + ' questions. Skipped ' + result.skipped + ' duplicates.';
  });
  section.append(list);
  async function refresh() {
    const { groups, items, batches, uploads } = await api('question-bank');
    list.replaceChildren();
    const history = node('details');
    history.append(node('summary', 'Upload history'));
    for (const upload of uploads) history.append(node('p', [upload.created_at, upload.uploaded_by_name, upload.file_name,
      upload.chapter, upload.question_count + ' added', upload.skipped_count + ' skipped'].filter(Boolean).join(' · ')));
    list.append(history);
    for (const group of groups) {
      const editor = makeForm([group.class_level, group.subject, group.chapter, group.q_type].join(' · '), list);
      const feedback = node('p');
      const audience = field(editor, 'Audience', 'batch', { choices: [] });
      audience.add(new Option('Whole class', ''));
      for (const batch of batches) audience.add(new Option(batch.name, batch.id));
      for (const publish of [true, false]) editor.append(button(publish ? 'Publish' : 'Unpublish', async () => {
        try {
          await api('question-bank/share', { ...group, publish, batch: audience.value ? Number(audience.value) : null });
          feedback.textContent = publish ? 'Published to the selected audience.' : 'Unpublished.';
        } catch (error) { feedback.textContent = error.message; }
      }));
      editor.append(feedback);
      const matching = items.filter(row => ['class_level', 'subject', 'chapter', 'q_type'].every(key => row[key].toLowerCase() === group[key].toLowerCase()));
      for (const item of matching) {
        const answer = makeForm(item.question_text, editor.parentElement);
        field(answer, 'Answer', 'answer', { type: 'textarea', value: item.answer_text });
        if (role === 'admin') answer.append(button('Delete question', async () => {
          if (!confirm('Delete this question?')) return;
          try {
            await api('question-bank/' + item.id + '/delete', {});
            await refresh();
          } catch (error) { answer.append(node('p', error.message)); }
        }));
        submit(answer, 'Save answer', async values => {
          await api('question-bank/' + item.id + '/answer', { answer: values.get('answer') });
          return 'Saved.';
        });
      }
    }
    if (!groups.length) list.append(node('p', 'No questions in the bank.'));
  }
  await refresh();
}

const courseCurrency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function isPcmb(course) {
  return /\bpcmb\b/i.test(course.name || course.title || '');
}

function courseLevel(value) {
  return /^11th and 12th$/i.test(value || '') ? 'Classes 11 & 12' : value;
}

function subjectNames(value) {
  return [...new Set(String(value || '').split(',').map(subject => subject.trim()).filter(Boolean))];
}

function subjectList(subjects) {
  const list = node('ul');
  list.className = 'course-subjects';
  for (const subject of subjectNames(subjects)) list.append(node('li', subject));
  return list;
}

function courseFacts(rows) {
  const grid = node('dl');
  grid.className = 'course-facts';
  for (const [label, value] of rows) {
    if (value == null || value === '') continue;
    const fact = node('div');
    fact.append(node('dt', label), node('dd', value));
    grid.append(fact);
  }
  return grid;
}

function courseLink(label, href, appearance) {
  const link = node('a', label);
  link.href = href;
  link.className = 'course-button ' + appearance;
  return link;
}

export async function showPublic(section, api) {
  const data = await api('website');
  section.replaceChildren();
  const clean = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const heading = (box, kicker, title, copy) => {
    const header = node('div');
    header.className = 'section-heading';
    header.append(node('p', kicker), node('h2', title));
    if (copy) header.append(node('p', copy));
    box.append(header);
  };
  const sectionBox = (id, style = '') => {
    const box = node('section');
    box.id = id;
    box.className = 'coaching-section ' + style;
    section.append(box);
    return box;
  };

  const courses = sectionBox('courses');
  heading(courses, 'Study programmes', 'Find the right course', 'Choose a programme for your class and the exams you’re preparing for.');
  const filters = node('div');
  filters.className = 'course-filters';
  filters.setAttribute('aria-label', 'Filter courses');
  const cards = node('div');
  cards.className = 'course-grid';
  courses.append(filters, cards);
  const categorize = item => /\bJEE\b/i.test(item.name) ? 'JEE' : /\bNEET\b/i.test(item.name) ? 'NEET' : 'School & boards';
  for (const filter of ['All courses', 'School & boards', 'JEE', 'NEET']) {
    if (filter !== 'All courses' && !data.courses.some(item => categorize(item) === filter)) continue;
    const tab = button(filter, () => displayCourses(filter));
    tab.className = 'course-filter';
    filters.append(tab);
  }
  function displayCourses(filter) {
    for (const item of filters.children) item.setAttribute('aria-pressed', String(item.textContent === filter));
    cards.replaceChildren();
    const matching = data.courses.filter(item => filter === 'All courses' || categorize(item) === filter);
    for (const item of matching) {
      const link = item.slug ? '/courses/' + encodeURIComponent(item.slug) : '#contact';
      const level = courseLevel(item.class_level) || categorize(item);
      const card = node('article');
      card.className = 'course-card';
      const badge = node('p', level);
      badge.className = 'course-kicker';
      card.append(badge, node('h3', item.name));
      if (subjectNames(item.subjects).length) card.append(subjectList(item.subjects));
      card.append(courseFacts([['Format', item.course_type], ['Duration', item.duration], ['Course fee', item.fee == null ? null : courseCurrency.format(item.fee)]]));
      card.append(courseLink(item.slug ? 'View programme' : 'Ask about this programme', link, 'action-secondary'));
      cards.append(card);
    }
    if (!matching.length) cards.append(node('p', 'No programmes are listed at the moment.'));
  }
  displayCourses('All courses');

  if (data.faculty.length) {
    const faculty = sectionBox('faculty', 'faculty-section');
    heading(faculty, 'Our faculty', 'Meet your teachers');
    const grid = node('div');
    grid.className = 'faculty-grid';
    for (const teacher of data.faculty) {
      const item = node('article');
      const avatar = node('span', teacher.name.split(/\s+/).filter(word => !word.endsWith('.')).slice(0, 2).map(word => word[0]).join(''));
      avatar.className = 'faculty-initials';
      avatar.setAttribute('aria-hidden', 'true');
      const detail = node('div');
      detail.append(node('h3', teacher.name), node('p', [teacher.subject, teacher.qualifications].filter(Boolean).join(' · ')));
      if (teacher.bio) detail.append(node('p', teacher.bio));
      item.append(avatar, detail);
      grid.append(item);
    }
    faculty.append(grid);
  }

  const achievers = data.results.filter(result => result.student_name && result.rank_or_score);
  if (achievers.length) {
    const wall = sectionBox('results', 'fame-wall');
    heading(wall, 'Prashi achievers', 'Wall of Fame', 'Celebrating our students and what they’ve achieved.');
    const gallery = node('ul');
    gallery.className = 'fame-gallery';
    for (const result of achievers) {
      const card = node('li');
      card.className = 'fame-card';
      const portrait = node('div');
      portrait.className = 'fame-portrait';
      const initials = node('span', result.student_name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase());
      initials.setAttribute('aria-hidden', 'true');
      portrait.append(initials);
      if (result.photo) {
        const image = node('img');
        image.src = result.photo;
        image.alt = '';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove(), { once: true });
        portrait.append(image);
      }
      const plaque = node('div');
      plaque.className = 'fame-plaque';
      const achievement = node('p', result.rank_or_score);
      achievement.className = 'fame-achievement';
      const exam = String(result.exam || '').trim();
      const year = result.year && !exam.includes(String(result.year)) ? String(result.year) : '';
      plaque.append(node('h3', result.student_name), node('p', [exam, year].filter(Boolean).join(' · ')), achievement);
      card.append(portrait, plaque);
      gallery.append(card);
    }
    wall.append(gallery);
  }

  for (const [id, kicker, title, items, summary] of [
    ['notices', 'Updates', 'Announcements', data.notices, item => [item.title, clean(item.body_html)]],
    ['resources', 'Study resources', 'Guides for your next exam', data.resources, item => [item.title, item.summary]],
    ['testimonials', 'Student feedback', 'What students say', data.testimonials, item => [item.student_name, item.quote]],
    ['faqs', 'Before you enrol', 'Frequently asked questions', data.faqs, item => [item.question, clean(item.answer_html)]],
  ]) {
    if (!items.length) continue;
    const box = sectionBox(id, id + '-section');
    heading(box, kicker, title);
    const group = node('div');
    group.className = id === 'faqs' ? 'faq-list' : 'editorial-grid';
    for (const item of items) {
      const [name, summaryText] = summary(item);
      const entry = node(id === 'faqs' ? 'details' : 'article');
      const titleNode = node(id === 'faqs' ? 'summary' : 'h3', name);
      if (id === 'resources' && item.slug) {
        const link = node('a', name);
        link.href = '/resources/' + encodeURIComponent(item.slug);
        titleNode.replaceChildren(link);
      }
      entry.append(titleNode, node('p', summaryText));
      group.append(entry);
    }
    box.append(group);
  }

  const contact = sectionBox('contact', 'admissions-section');
  const contactCopy = node('div');
  heading(contactCopy, 'Admissions', 'Talk to us about joining', 'Ask us about courses, batch timings, or how to enrol.');
  if (data.contact.address) contactCopy.append(node('p', data.contact.address));
  if (data.contact.office_hours) contactCopy.append(node('p', data.contact.office_hours));
  if (data.contact.phone) contactCopy.append(node('p', data.contact.phone));
  if (data.contact.email) contactCopy.append(node('p', data.contact.email));
  const contactLinks = node('div');
  contactLinks.className = 'admissions-social';
  for (const [key, label] of [['whatsapp', 'Chat on WhatsApp'], ['instagram', 'Instagram'], ['youtube', 'YouTube']]) {
    const url = data.contactLinks?.[key];
    if (!url) continue;
    const link = courseLink(label, url, key === 'whatsapp' ? 'action-primary' : 'action-secondary');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    contactLinks.append(link);
  }
  if (contactLinks.children.length) contactCopy.append(contactLinks);
  contact.append(contactCopy);
  const query = new URLSearchParams(location.search);
  const selectedCourse = data.courses.find(item => item.slug === query.get('course'));
  const form = makeForm('Send an enquiry', contact, true);
  if (selectedCourse) form.append(node('p', 'Enquiring about ' + selectedCourse.name));
  form.parentElement.className = 'admissions-form';
  const kind = field(form, 'Request', 'kind', {
    choices: ['enquiry', 'admission', 'counselling', 'contact'],
    value: query.get('request') === 'counselling' ? 'counselling' : 'enquiry',
  });
  const inputs = node('div');
  inputs.className = 'exam-form';
  form.append(inputs);
  let version = 0;
  async function loadForm() {
    const requestVersion = ++version;
    const { fields } = await api('forms/' + kind.value);
    if (requestVersion !== version) return;
    inputs.replaceChildren();
    if (!fields.length) {
      field(inputs, 'Name', 'name', { required: true });
      field(inputs, 'Email', 'email', { type: 'email' });
      field(inputs, 'Phone', 'phone', { type: 'tel' });
      field(inputs, 'Message', 'message', { type: 'textarea', required: true,
        value: selectedCourse ? 'I’d like to learn more about ' + selectedCourse.name + '.' : '' });
      return;
    }
    for (const item of fields) {
      const props = { type: item.type, required: Boolean(item.required) };
      if (item.type === 'select') props.choices = ['', ...String(item.options || '').split(/\r?\n/).filter(Boolean)];
      if (selectedCourse && item.name === 'course') props.value = selectedCourse.name;
      if (selectedCourse && item.name === 'message') props.value = 'I’d like to learn more about ' + selectedCourse.name + '.';
      const input = field(inputs, item.label, item.name, props);
      if (item.help_text) input.parentElement.append(node('small', item.help_text));
    }
  }
  kind.addEventListener('change', () => loadForm().catch(error => { inputs.textContent = error.message; }));
  await loadForm();
  field(form, 'I agree that Prashi can contact me about this request', 'consent', { type: 'checkbox', required: true, value: 'yes' });
  submit(form, 'Send request', async values => {
    const properties = Object.fromEntries([...values].filter(([key]) => key !== 'kind' && key !== 'consent'));
    const consent = values.has('consent');
    const { fields } = await api('forms/' + kind.value);
    if (fields.length) await api('forms/' + kind.value, { fields: properties, consent });
    else await api('enquiry', { ...properties, kind: kind.value === 'admission' ? 'admission' : 'enquiry', consent });
    form.reset();
    await loadForm();
    return 'Request received.';
  }).classList.add('action-amber');
}

export async function showInbox(section, api, role) {
  const { rows, staff } = await api('inbox');
  const csv = node('a', 'Download enquiry CSV');
  csv.href = '/api/inbox/export.csv';
  section.append(csv);
  if (!rows.length) section.append(node('p', 'No enquiries or admissions yet.'));
  for (const row of rows) {
    const form = makeForm((row.details.name || row.details.student_name || 'Request') + ' · ' + row.form, section);
    for (const value of [row.details.email, row.details.phone, row.details.message]) if (value) form.append(node('p', String(value)));
    field(form, 'Status', 'status', { choices: ['new', 'contacted', 'demo_booked', 'enrolled', 'closed'], value: row.status });
    const assignment = field(form, 'Assigned to', 'assigned', { choices: [] });
    assignment.add(new Option('Unassigned', ''));
    for (const item of staff) assignment.add(new Option(item.name, item.id, false, item.id === row.assigned_to));
    const status = node('p');
    status.setAttribute('role', 'status');
    form.append(button('Save assignment', async () => {
      try {
        await api('inbox/' + row._id + '/assign', { staff: assignment.value ? Number(assignment.value) : null });
        status.textContent = 'Assignment saved.';
      } catch (error) { status.textContent = error.message; }
    }));
    const notes = node('div');
    for (const note of row.notes) notes.append(node('p', note.note));
    form.append(notes);
    const note = field(form, 'Internal note', 'note', { type: 'textarea' });
    form.append(button('Add note', async () => {
      try {
        await api('inbox/' + row._id + '/note', { note: note.value });
        notes.append(node('p', note.value));
        note.value = '';
      } catch (error) { status.textContent = error.message; }
    }));
    if (role === 'admin') form.append(button('Delete request', async () => {
      if (!confirm('Delete this request and its internal notes?')) return;
      try { await api('inbox/' + row._id + '/delete', {}); form.parentElement.remove(); }
      catch (error) { status.textContent = error.message; }
    }));
    form.append(status);
    submit(form, 'Save status', async values => {
      await api('inbox/' + row._id, { status: values.get('status') });
      return 'Status saved.';
    });
  }
}

export async function showDoubts(section, role, api) {
  const list = node('div');
  if (role === 'student') {
    const form = makeForm('Ask a teacher', section);
    field(form, 'Subject', 'subject');
    field(form, 'Question', 'message', { type: 'textarea', required: true });
    submit(form, 'Send question', async values => {
      await api('records/doubts', Object.fromEntries(values));
      form.reset();
      await refresh();
      return 'Question sent.';
    });
  }
  section.append(list);
  async function refresh() {
    const { rows } = await api('records/doubts');
    list.replaceChildren();
    if (!rows.length) list.append(node('p', 'No questions sent yet.'));
    for (const row of rows) {
      const details = node('details');
      const subject = row.subject || 'Question';
      details.append(node('summary', (role === 'student' ? '' : (row.student_name || ('Student ' + row.student_id)) + ' · ') + subject + ' · ' + row.status));
      details.append(node('p', row.message), node('p', row.reply || 'Awaiting a reply.'));
      if (role !== 'student') {
        const form = node('form');
        form.className = 'exam-form';
        field(form, 'Reply', 'answer', { type: 'textarea', required: true, value: row.reply });
        submit(form, 'Send reply', async data => {
          await api('records/doubts/' + row._id, { answer: data.get('answer') });
          await refresh();
          return 'Reply sent.';
        });
        form.append(button('Close question', async () => {
          try { await api('records/doubts/' + row._id + '/close', {}); await refresh(); }
          catch (error) { form.append(node('p', error.message)); }
        }));
        details.append(form);
      }
      list.append(details);
    }
  }
  await refresh();
}

export async function showRecords(section, api, role) {
  const [{ batches, rows, transactions }, { records }] = await Promise.all([api('records'), api('people/students')]);
  function options(select, entries) {
    for (const [id, name] of entries) select.add(new Option(name, id));
    select.required = true;
  }
  const studentNames = new Map(records.map(record => [record.user_id, record.name || record.admission_no]));
  const batchNames = new Map(batches.map(batch => [batch.id, batch.name]));
  const enrollment = makeForm('Enroll a student', section);
  const enrollmentStudent = field(enrollment, 'Student', 'student', { choices: [] });
  const enrollmentBatch = field(enrollment, 'Batch', 'batch', { choices: [] });
  const enrollmentHelp = node('p');
  enrollmentHelp.setAttribute('role', 'status');
  enrollment.append(enrollmentHelp);
  function updateEnrollmentChoices() {
    for (const [select, names, prompt] of [
      [enrollmentStudent, studentNames, 'Choose a student'],
      [enrollmentBatch, batchNames, 'Choose a batch'],
    ]) {
      const selected = select.value;
      select.replaceChildren(new Option(prompt, ''));
      options(select, names);
      if (names.has(Number(selected))) select.value = selected;
    }
    enrollmentHelp.textContent = [
      studentNames.size ? '' : 'Add a student under Manage people first.',
      batchNames.size ? '' : 'Add a batch under Website content and form builder first.',
    ].filter(Boolean).join(' ');
  }
  updateEnrollmentChoices();
  field(enrollment, 'Total fee in rupees', 'fee', { type: 'number', value: '0', required: true });
  field(enrollment, 'Discount in rupees', 'discount', { type: 'number', value: '0', required: true });
  field(enrollment, 'Status', 'status', { choices: ['active', 'completed', 'dropped'] });
  const attendance = makeForm('Mark attendance', section);
  const payment = makeForm('Record a payment', section);
  const attendanceEnrollment = field(attendance, 'Enrollment', 'enrollment', { choices: [] });
  const paymentEnrollment = field(payment, 'Enrollment', 'enrollment', { choices: [] });
  function addEnrollmentChoices(row) {
    const label = (studentNames.get(row.student_id) || 'Student ' + row.student_id) + ' · ' + (batchNames.get(row.batch_id) || 'Batch ' + row.batch_id);
    for (const select of [attendanceEnrollment, paymentEnrollment]) options(select, [[row.id, label]]);
  }
  rows.forEach(addEnrollmentChoices);
  const batchAttendance = makeForm('Mark a full batch', section);
  const batch = field(batchAttendance, 'Batch', 'batch', { choices: [] });
  options(batch, batchNames);
  field(batchAttendance, 'Date', 'day', { type: 'date', required: true });
  const roster = node('div');
  roster.className = 'exam-form';
  batchAttendance.append(roster);
  function fillRoster() {
    roster.replaceChildren();
    for (const row of rows.filter(row => row.batch_id === Number(batch.value) && row.status === 'active')) {
      field(roster, studentNames.get(row.student_id) || ('Student ' + row.student_id), String(row.student_id),
        { choices: ['present', 'absent', 'late', 'excused'] });
    }
  }
  batch.addEventListener('change', fillRoster);
  fillRoster();
  submit(batchAttendance, 'Save batch attendance', async data => {
    const entries = [...roster.querySelectorAll('select')].map(item => ({ student: Number(item.name), status: item.value }));
    await api('records/attendance/batch', { batch: Number(data.get('batch')), day: data.get('day'), rows: entries });
    return 'Attendance saved.';
  });
  const edits = node('details');
  edits.append(node('summary', 'Edit enrollments and review payments'));
  function addEnrollmentEditor(row) {
    const form = makeForm((studentNames.get(row.student_id) || 'Student') + ' · ' + (batchNames.get(row.batch_id) || 'Batch'), edits);
    field(form, 'Total fee', 'fee', { type: 'number', value: row.fee_total, required: true });
    field(form, 'Discount', 'discount', { type: 'number', value: row.discount, required: true });
    field(form, 'Status', 'status', { choices: ['active', 'completed', 'dropped'], value: row.status });
    const response = node('p');
    if (role === 'admin') form.append(button('Delete enrollment', async () => {
      if (!confirm('Delete this enrollment and its payments?')) return;
      try { await api('records/enrollment/' + row.id + '/delete', {}); location.reload(); }
      catch (error) { response.textContent = error.message; }
    }));
    for (const payment of transactions.filter(item => item.enrollment_id === row.id)) {
      const entry = node('div');
      const receipt = node('a', (payment.receipt_no || 'Receipt') + ' · ₹' + payment.amount);
      receipt.href = '/api/records/receipt/' + payment.id;
      receipt.target = '_blank';
      receipt.rel = 'noopener';
      entry.append(receipt);
      if (role === 'admin') entry.append(button('Delete payment', async () => {
        if (!confirm('Delete this payment entry?')) return;
        try { await api('records/payment/' + payment.id + '/delete', {}); entry.remove(); }
        catch (error) { response.textContent = error.message; }
      }));
      form.append(entry);
    }
    form.append(response);
    submit(form, 'Save enrollment changes', async data => {
      await api('records/enrollment/' + row.id + '/edit', {
        fee: Number(data.get('fee')), discount: Number(data.get('discount')), status: data.get('status'),
      });
      return 'Enrollment updated.';
    });
  }
  rows.forEach(addEnrollmentEditor);
  section.append(edits);
  const saveEnrollment = submit(enrollment, 'Save enrollment', async data => {
    const student = Number(data.get('student'));
    const batchId = Number(data.get('batch'));
    const fee = Number(data.get('fee'));
    const discount = Number(data.get('discount'));
    const status = data.get('status');
    const { id } = await api('records/enrollment', { student, batch: batchId, fee, discount, status });
    const row = { id, student_id: student, batch_id: batchId, fee_total: fee, discount, status };
    rows.unshift(row);
    addEnrollmentChoices(row);
    addEnrollmentEditor(row);
    fillRoster();
    return 'Enrollment saved.';
  });
  enrollment.parentElement.addEventListener('toggle', async () => {
    if (!enrollment.parentElement.open) return;
    saveEnrollment.disabled = true;
    try {
      const [{ batches: latestBatches }, { records: latestStudents }] = await Promise.all([api('records'), api('people/students')]);
      studentNames.clear();
      for (const record of latestStudents) studentNames.set(record.user_id, record.name || record.admission_no);
      batchNames.clear();
      for (const item of latestBatches) batchNames.set(item.id, item.name);
      const selectedBatch = batch.value;
      batch.replaceChildren();
      options(batch, batchNames);
      if (batchNames.has(Number(selectedBatch))) batch.value = selectedBatch;
      updateEnrollmentChoices();
      fillRoster();
    } catch (error) {
      enrollmentHelp.textContent = error.message;
    } finally {
      saveEnrollment.disabled = false;
    }
  });
  field(attendance, 'Date', 'day', { type: 'date', required: true });
  field(attendance, 'Status', 'status', { choices: ['present', 'absent', 'late', 'excused'] });
  submit(attendance, 'Save attendance', async data => {
    await api('records/attendance', { ...Object.fromEntries(data), enrollment: Number(data.get('enrollment')) });
    return 'Attendance saved.';
  });
  field(payment, 'Amount in rupees', 'amount', { type: 'number', required: true });
  field(payment, 'Date', 'day', { type: 'date', required: true });
  field(payment, 'Mode', 'mode', { choices: ['Cash', 'UPI', 'Bank transfer', 'Card', 'Cheque', 'Other'] });
  submit(payment, 'Save payment', async data => {
    const result = await api('records/payment', { ...Object.fromEntries(data), enrollment: Number(data.get('enrollment')), amount: Number(data.get('amount')) });
    return 'Payment recorded. Receipt ' + result.receipt;
  });
}

export function showProfilePhoto(section, api, photo) {
  const form = makeForm('Change profile photo', section);
  field(form, 'Choose a JPEG or PNG photo', 'file', { type: 'file', required: true, accept: '.jpg,.jpeg,.png' });
  submit(form, 'Save photo', async values => {
    await api('student/photo', { file: await encodeFile(values.get('file')) });
    location.reload();
    return 'Photo saved.';
  });
  if (photo) {
    const message = node('p');
    section.append(button('Remove photo', async () => {
      try {
        await api('student/photo', { remove: true });
        location.reload();
      } catch (error) { message.textContent = error.message; }
    }), message);
  }
}


export async function showAdminOperations(section, api) {
  const [{ events }, { tables }] = await Promise.all([api('activity'), api('exports')]);
  const activity = node('details');
  activity.append(node('summary', 'Recent activity'));
  for (const event of events) activity.append(node('p', [event.created_at, event.user_name, event.summary].filter(Boolean).join(' · ')));
  if (!events.length) activity.append(node('p', 'No recorded activity yet.'));
  const exports = node('details');
  exports.append(node('summary', 'Download data'));
  for (const item of ['all.zip', ...tables.map(table => table + '.xlsx')]) {
    const paragraph = node('p');
    const link = node('a', item === 'all.zip' ? 'Download all tables as ZIP' : item);
    link.href = '/api/exports/' + item;
    paragraph.append(link);
    exports.append(paragraph);
  }
  section.append(activity, exports);
}

export function showStudentImport(section, api) {
  const form = makeForm('Import students from CSV', section);
  const template = node('a', 'Download the CSV template');
  template.href = '/api/people/students/template.csv';
  form.append(template);
  field(form, 'Student CSV', 'file', { type: 'file', accept: '.csv', required: true });
  const preview = node('div');
  section.append(preview);
  submit(form, 'Preview import', async data => {
    const file = data.get('file');
    if (!file?.size || file.size > 500_000) throw new Error('Choose a CSV up to 500 KB.');
    const { rows } = await api('people/students/import', { csv: await file.text() });
    preview.replaceChildren();
    const approved = rows.filter(row => row.valid);
    for (const row of rows) preview.append(node('p', 'Row ' + row.line + ' · ' + (row.student.name || 'Missing name') +
      (row.valid ? '' : ' · Invalid or duplicate admission number')));
    if (approved.length) {
      const progress = node('p');
      progress.setAttribute('role', 'status');
      const start = button('Create ' + approved.length + ' student accounts', async () => {
        start.disabled = true;
        for (const { student, line } of approved) {
          try {
            const credentials = await api('people/students', student);
            preview.append(node('p', credentials.login + ' · Temporary password ' + credentials.password));
          } catch (error) {
            preview.append(node('p', 'Row ' + line + ' · ' + error.message));
          }
        }
        progress.textContent = 'Import finished. Copy the temporary passwords before leaving this page.';
      });
      preview.append(start, progress);
    }
    return 'Review the preview before creating accounts.';
  });
}

export async function showTutorial(section, api, role) {
  const [{ batches }, { rows }] = await Promise.all([api('records'), api('tutorial')]);
  const categories = ['material', 'notes', 'test_paper', 'remark', 'mock_result'];
  const form = makeForm('Create a record or import marks', section);
  const batch = field(form, 'Batch', 'batch', { choices: [], required: true });
  for (const item of batches) batch.add(new Option(item.name, item.id));
  const template = node('a', 'Download this batch’s Excel marksheet');
  const updateTemplate = () => { template.href = '/api/tutorial/template.xlsx?batch=' + encodeURIComponent(batch.value); };
  batch.addEventListener('change', updateTemplate);
  updateTemplate();
  form.append(template);
  const type = field(form, 'Type', 'type', { choices: categories });
  function recordFields(editor, row = {}) {
    field(editor, 'Title', 'title', { required: true, value: row.title });
    field(editor, 'Date', 'date', { type: 'date', value: row.record_date });
    field(editor, 'Text', 'text', { type: 'textarea', value: row.body });
    const visible = field(editor, 'Make visible to students', 'visible', { type: 'checkbox' });
    visible.checked = Boolean(row.visible_to_student);
  }
  recordFields(form);
  const file = field(form, 'Excel marksheet for mock results', 'file', { type: 'file', accept: '.xlsx' });
  file.parentElement.hidden = true;
  type.addEventListener('change', () => {
    file.parentElement.hidden = type.value !== 'mock_result';
    file.required = type.value === 'mock_result';
  });
  const status = node('p');
  status.setAttribute('role', 'status');
  form.append(status);
  submit(form, 'Save record', async data => {
    const payload = { title: data.get('title'), type: data.get('type'), batch: Number(data.get('batch')),
      date: data.get('date'), text: data.get('text'), visible: data.has('visible') };
    if (payload.type === 'mock_result') payload.file = (await encodeFile(data.get('file'))).data;
    const result = await api('tutorial', payload);
    return 'Saved ' + result.added + ' record(s). Reload to review.';
  });
  const bulk = makeForm('Release or hide records for a batch', section);
  const bulkBatch = field(bulk, 'Batch', 'batch', { choices: [], required: true });
  for (const item of batches) bulkBatch.add(new Option(item.name, item.id));
  field(bulk, 'Visibility', 'visible', { choices: ['Release', 'Hide'] });
  submit(bulk, 'Update batch visibility', async values => {
    const result = await api('tutorial/release', { batch: Number(values.get('batch')), visible: values.get('visible') === 'Release' });
    return 'Updated ' + result.changed + ' record(s).';
  });
  const existing = node('div');
  section.append(existing);
  for (const row of rows) {
    const editor = makeForm(row.title + ' · ' + row.type, existing);
    recordFields(editor, row);
    if (role === 'admin') editor.append(button('Delete record', async () => {
      if (!confirm('Delete this tutorial record?')) return;
      try { await api('tutorial/' + row.id + '/delete', {}); editor.parentElement.remove(); }
      catch (error) { editor.append(node('p', error.message)); }
    }));
    submit(editor, 'Save record changes', async values => {
      await api('tutorial/' + row.id + '/edit', {
        title: values.get('title'), date: values.get('date'), text: values.get('text'), type: row.type, visible: values.has('visible'),
      });
      return 'Saved.';
    });
  }
}

export async function showSiteAdmin(section, api) {
  const { models, flag, integers } = await api('site-admin');
  const names = {
    site_name: 'Institute name', form_fields: 'Form builder', faqs: 'FAQs',
    whatsapp: 'WhatsApp number', social_instagram: 'Instagram handle', social_youtube: 'YouTube handle',
    description_html: 'Description', body_html: 'Text', answer_html: 'Answer',
  };
  const label = value => names[value] || value.replaceAll('_', ' ').replace(/^[a-z]/, character => character.toUpperCase());
  const settings = node('details');
  settings.append(node('summary', 'Site settings'));
  section.append(settings);
  const rows = (await api('site-admin/settings')).rows;
  for (const row of rows) {
    const form = makeForm(label(row.key), settings);
    if (row.help) form.append(node('p', row.help));
    field(form, 'Value', 'value', { value: row.value });
    submit(form, 'Save setting', async data => {
      await api('site-admin/settings', { key: row.key, value: data.get('value') });
      return 'Saved.';
    });
  }
  const types = ['text', 'tel', 'email', 'textarea', 'select', 'date', 'number', 'checkbox'];
  for (const [name, keys] of Object.entries(models)) {
    const group = node('details');
    group.append(node('summary', label(name)));
    section.append(group);
    group.addEventListener('toggle', async () => {
      if (!group.open || group.children.length > 1) return;
      const content = node('div');
      group.append(content);
      const path = 'site-admin/' + name;
      try {
        const { rows } = await api(path);
        const display = record => record.name || record.title || record.question || record.student_name || record.label || ('Record ' + record.id);
        for (const record of [{}, ...rows]) {
          const form = makeForm(record.id ? display(record) : 'Add record', content);
          for (const key of keys) {
            const rowValue = typeof record[key] === 'string' && key.endsWith('_html')
              ? record[key].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : record[key];
            const props = { value: rowValue };
            if (flag.includes(key)) props.type = 'checkbox';
            else if (integers.includes(key)) props.type = 'number';
            else if (key.endsWith('_html') || ['bio', 'quote', 'summary', 'options', 'highlights'].includes(key)) props.type = 'textarea';
            else if (key === 'form') props.choices = ['admission', 'enquiry', 'counselling', 'contact'];
            else if (key === 'type' && name === 'form_fields') props.choices = types;
            else if (key === 'audience') props.choices = ['public', 'students'];
            else if (key === 'status' && name === 'batches') props.choices = ['open', 'full', 'closed'];
            else if (key === 'kind' && name === 'results') props.choices = ['rank', 'year_stat', 'improvement'];
            else if (key.endsWith('_date')) props.type = 'date';
            const input = field(form, label(key), key, props);
            if (flag.includes(key)) input.checked = record.id ? Boolean(record[key]) : ['visible', 'active'].includes(key);
            if (record.locked && ['name', 'form', 'type', 'required', 'active'].includes(key)) input.disabled = true;
          }
          if (record.id && !record.locked && !['courses', 'batches'].includes(name)) form.append(button('Delete record', async () => {
            if (!confirm('Delete this content item?')) return;
            try { await api(path + '/' + record.id + '/delete', {}); form.parentElement.remove(); }
            catch (error) { form.append(node('p', error.message)); }
          }));
          submit(form, record.id ? 'Save changes' : 'Add', async data => {
            const changes = {};
            for (const input of form.querySelectorAll('[name]')) {
              if (input.disabled) continue;
              const key = input.name;
              const value = data.get(key);
              changes[key] = flag.includes(key) ? input.checked : integers.includes(key) ? (value ? Number(value) : null) : value;
              if (record.id && key.endsWith('_html') && value === input.defaultValue) delete changes[key];
            }
            await api(path + (record.id ? '/' + record.id : ''), changes);
            return record.id ? 'Saved.' : 'Added. Reload this section to edit it.';
          });
        }
      } catch (error) { content.textContent = error.message; }
    });
  }
}


export async function showPublicDetail(section, api, category, slug) {
  const item = await api('website/' + category + '/' + slug);
  if (item.course) {
    renderCourseDetail(section, item, slug);
    return;
  }
  section.className = 'panel';
  section.replaceChildren(node('h1', item.title));
  document.title = item.title + ' · Prashi Tutorial';
  if (item.image) {
    const image = node('img');
    image.className = 'course-photo';
    image.src = item.image;
    image.alt = '';
    section.append(image);
  }
  const text = value => String(value || '').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '');
  for (const detail of [...item.details, text(item.summary), text(item.description)].filter(Boolean)) {
    const paragraph = node('p', detail);
    paragraph.className = 'answer';
    section.append(paragraph);
  }
}

function renderCourseDetail(section, item, slug) {
  const programme = item.course;
  section.className = 'course-detail';
  const back = courseLink('All courses', '/#courses', 'course-back');
  const header = node('header');
  header.className = 'course-detail-header';
  const level = node('p', [courseLevel(programme.level), programme.mode].filter(Boolean).join(' · '));
  level.className = 'course-kicker';
  header.append(level, node('h1', item.title));
  if (isPcmb(item)) header.append(node('p', 'Study Physics, Chemistry, Mathematics and Biology together.'));
  header.append(courseLink('Enquire about this programme', '/?course=' + encodeURIComponent(slug) + '#contact', 'action-primary'));
  section.replaceChildren(back, header);
  document.title = item.title + ' · Prashi Tutorial';

  const grid = node('div');
  grid.className = 'course-detail-grid';
  const overview = node('article');
  overview.className = 'panel';
  const subjects = subjectNames(programme.subjects);
  if (subjects.length) overview.append(node('h2', 'Subjects covered'), subjectList(programme.subjects));
  const highlights = String(item.summary || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (highlights.length) {
    const list = node('ul');
    list.className = 'course-highlights';
    for (const highlight of highlights) list.append(node('li', highlight));
    overview.append(node('h2', 'Programme highlights'), list);
  }
  if (item.description) {
    const content = String(item.description).replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '').trim();
    const text = node('p', content);
    text.className = 'answer';
    if (content) overview.append(node('h2', 'About the course'), text);
  }
  if (item.image && !isPcmb(item)) {
    const image = node('img');
    image.className = 'course-detail-photo';
    image.src = item.image;
    image.alt = '';
    image.loading = 'lazy';
    overview.append(image);
  }
  if (overview.children.length) grid.append(overview);
  const facts = node('aside');
  facts.className = 'panel course-overview';
  facts.append(node('h2', 'Programme at a glance'), courseFacts([
    ['Class', courseLevel(programme.level)], ['Format', programme.mode], ['Duration', programme.duration],
    ['Class timing', programme.schedule], ['Course fee', programme.fee == null ? null : courseCurrency.format(programme.fee)],
  ]));
  grid.append(facts);
  section.append(grid);
}
