const time = new Intl.DateTimeFormat('sv-SE', {
  timeZone: process.env.TIME_ZONE || 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium',
});

export function publicationWindow() {
  const now = time.format(new Date()).replace('T', ' ');
  return { $and: [
    { $or: [{ publish_at: null }, { publish_at: '' }, { publish_at: { $lte: now } }] },
    { $or: [{ expires_at: null }, { expires_at: '' }, { expires_at: { $gt: now } }] },
  ] };
}
