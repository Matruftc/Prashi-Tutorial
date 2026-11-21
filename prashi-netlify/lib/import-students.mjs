import { parse } from 'csv-parse/sync';

const headers = {
  'student name': 'name', name: 'name', 'admission number': 'admission', 'admission no': 'admission',
  class: 'class_level', 'class level': 'class_level', school: 'school', 'student email': 'email', email: 'email',
  'parent name': 'parent_name', 'parent phone': 'parent_phone', 'parent email': 'parent_email',
};

export function previewStudents(csv) {
  if (typeof csv !== 'string' || !csv.trim() || csv.length > 500_000) throw new Error('Select a CSV up to 500 KB.');
  const data = parse(csv, { bom: true, skip_empty_lines: true, trim: true, max_record_size: 10000 });
  if (data.length < 2 || data.length > 201) throw new Error('The CSV needs a header and 1 to 200 students.');
  const [head, ...rows] = data;
  const normalized = head.map(name => headers[name.toLowerCase().replace(/_/g, ' ')]);
  if (!normalized.includes('name') || !normalized.includes('admission')) throw new Error('Include Name and Admission Number columns.');
  const seen = new Set();
  return rows.map((row, index) => {
    const student = Object.fromEntries(normalized.flatMap((key, position) => key ? [[key, row[position]]] : []));
    if (/^\d{1,2}$/.test(student.class_level || '')) student.class_level = 'Class ' + student.class_level;
    student.admission = student.admission?.toUpperCase();
    const valid = Boolean(student.name && /^[A-Z0-9-]{3,20}$/.test(student.admission || '') && !seen.has(student.admission));
    if (valid) seen.add(student.admission);
    return { line: index + 2, student, valid };
  });
}
