const whatsappPlaceholder = '919000000000';
const username = /^[a-zA-Z0-9._-]{1,100}$/;

export const contactSettings = {
  whatsapp: 'Enter the full international WhatsApp number with country code. Clear this to hide the button.',
  social_instagram: 'Enter the Instagram @handle or profile URL. Clear this to hide the link.',
  social_youtube: 'Enter the YouTube @handle or channel URL. Clear this to hide the link.',
};

export function normalizeContactSetting(key, raw) {
  const value = raw.trim();
  if (!value) return '';
  if (key === 'whatsapp') {
    const number = /^\+?[\d\s()-]+$/.test(value) ? value.replace(/\D/g, '') : '';
    if (!/^[1-9]\d{7,14}$/.test(number)) throw new Error('Enter a WhatsApp number with its country code.');
    return number;
  }
  const instagram = key === 'social_instagram';
  const domain = instagram ? 'www.instagram.com' : 'www.youtube.com';
  const parts = value.replace(/^@/, '');
  if (username.test(parts) && (!instagram || /^[a-zA-Z0-9._]{1,30}$/.test(parts)) && !/\.(?:com|net|org)$/i.test(parts)) {
    return 'https://' + domain + (instagram ? '/' : '/@') + parts;
  }
  const invalid = instagram ? 'Enter an Instagram handle or instagram.com profile URL.' : 'Enter a YouTube handle or youtube.com channel URL.';
  let url;
  try { url = new URL(value.match(/^https?:\/\//i) ? value : 'https://' + value); }
  catch { throw new Error(invalid); }
  const allowedHosts = instagram ? ['instagram.com', 'www.instagram.com'] : ['youtube.com', 'www.youtube.com', 'm.youtube.com'];
  const path = url.pathname.replace(/\/+$/, '');
  const profilePath = instagram
    ? /^\/[a-zA-Z0-9._]{1,30}$/
    : /^(?:\/@[a-zA-Z0-9._-]{1,100}|\/(?:channel|c|user)\/[a-zA-Z0-9._-]{1,100})$/;
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !allowedHosts.includes(url.hostname) || !profilePath.test(path)) throw new Error(invalid);
  return 'https://' + domain + path;
}

export function publicContactLinks(settings) {
  const values = new Map(settings.map(row => [row.key, row.value]));
  const result = {};
  for (const [key, type] of [['whatsapp', 'whatsapp'], ['social_instagram', 'instagram'], ['social_youtube', 'youtube']]) {
    const raw = values.get(key);
    if (typeof raw !== 'string') continue;
    let value;
    try { value = normalizeContactSetting(key, raw); } catch { continue; }
    if (!value || (type === 'whatsapp' && value === whatsappPlaceholder)) continue;
    result[type] = type === 'whatsapp' ? 'https://wa.me/' + value : value;
  }
  return result;
}
