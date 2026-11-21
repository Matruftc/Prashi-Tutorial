import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const tables = ['users', 'students', 'faculty', 'courses', 'batches', 'enrollments', 'payments', 'attendance',
  'questions', 'chapter_access', 'qb_uploads', 'netlify_exams', 'netlify_attempts', 'submissions', 'doubts', 'records',
  'settings', 'articles', 'faqs', 'notices', 'results', 'testimonials', 'holidays', 'audit_log'];
const secretProjection = { password_hash: 0, password_reset: 0, ip: 0, ip_hash: 0 };

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text) || /^\s*[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function download(bytes, name, mime) {
  return new Response(bytes, { headers: {
    'Content-Type': mime, 'Content-Disposition': 'attachment; filename="' + name + '"',
    'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
  } });
}

export async function spreadsheet(name, rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name.slice(0, 31));
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  if (columns.length) {
    sheet.addRow(columns);
    for (const row of rows) sheet.addRow(columns.map(key => {
      const value = row[key];
      if (value == null) return '';
      if (value instanceof Date) return value;
      return typeof value === 'object' ? JSON.stringify(value) : value;
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return book.xlsx.writeBuffer();
}

export const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function adminOps(db, user, action, method, send) {
  if (user.role !== 'admin') return send({ message: 'Access denied.' }, 403);
  if (action === 'activity' && method === 'GET') {
    const events = await db.collection('audit_log').find({}, { projection: { ip: 0 } }).sort('created_at', -1).limit(300).toArray();
    return send({ events });
  }
  if (action === 'exports' && method === 'GET') return send({ tables });
  if (method !== 'GET') return send({ message: 'Method not allowed.' }, 405);
  const name = action.split('/')[1];
  async function load(collection) {
    const rows = await db.collection(collection).find({}, { projection: collection === 'users' || collection === 'audit_log' || collection === 'submissions' ? secretProjection : {} })
      .limit(2501).toArray();
    return rows.length > 2500 ? null : rows;
  }
  if (name === 'all.zip') {
    const zip = new JSZip();
    for (const table of tables) {
      const rows = await load(table);
      if (!rows) return send({ message: 'A collection exceeds the portal export limit. Use a database backup.' }, 413);
      zip.file(table + '.xlsx', await spreadsheet(table, rows));
    }
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return bytes.length <= 4_000_000
      ? download(bytes, 'prashi-export.zip', 'application/zip')
      : send({ message: 'The complete export is too large. Download the individual collections.' }, 413);
  }
  const table = name?.replace(/\.xlsx$/, '');
  if (!name?.endsWith('.xlsx') || !tables.includes(table)) return send({ message: 'Collection not found.' }, 404);
  const rows = await load(table);
  if (!rows) return send({ message: 'This collection exceeds the portal export limit.' }, 413);
  const bytes = await spreadsheet(table, rows);
  return bytes.length <= 4_000_000 ? download(bytes, table + '.xlsx', excelMime) : send({ message: 'Export too large.' }, 413);
}
