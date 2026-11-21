const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

export const publicSources = [
  ['courses', 'image'], ['faculty', 'photo'], ['articles', 'cover_image'], ['results', 'photo'], ['testimonials', 'photo'],
];

export const privateSources = [['students', 'photo'], ['records', 'file_path']];

export function legacyName(value) {
  if (typeof value !== 'string') return null;
  const name = value.startsWith('/uploads/') ? value.slice('/uploads/'.length) : value;
  return filenamePattern.test(name) ? name : null;
}

export function legacyPublicUrl(value) {
  const name = legacyName(value);
  return name ? '/api/legacy/public/' + name : null;
}

export async function legacyDownload(db, action, user, send) {
  const match = /^legacy\/(public|private)\/([^/]+)$/.exec(action);
  if (!match || !legacyName(match[2])) return send({ message: 'File not found.' }, 404);
  const [, visibility, name] = match;
  if (visibility === 'private') {
    if (!user) return send({ message: 'Sign in to continue.' }, 401);
    if (user.role === 'student') {
      const matches = [name, '/uploads/' + name];
      const batchIds = await db.collection('enrollments').distinct('batch_id', { student_id: user.id, status: { $ne: 'dropped' } });
      const [photo, record] = await Promise.all([
        db.collection('students').findOne({ user_id: user.id, photo: { $in: matches } }, { projection: { _id: 1 } }),
        db.collection('records').findOne({ file_path: { $in: matches }, visible_to_student: 1, $or: [
          { student_id: user.id }, { student_id: null, batch_id: { $in: batchIds } },
        ] }, { projection: { _id: 1 } }),
      ]);
      if (!photo && !record) return send({ message: 'File not found.' }, 404);
    } else if (!['admin', 'staff'].includes(user.role)) return send({ message: 'File not found.' }, 404);
  }
  const file = await db.collection('legacy_uploads').findOne({ _id: visibility + ':' + name });
  if (!file) return send({ message: 'File not found.' }, 404);
  const image = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type);
  return new Response(file.bytes.value(), { headers: {
    'Content-Type': image ? file.type : 'application/octet-stream',
    'Content-Disposition': (image ? 'inline' : 'attachment') + '; filename="' + name + '"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': visibility === 'public' && image ? 'public, max-age=3600' : 'no-store, private',
  } });
}
