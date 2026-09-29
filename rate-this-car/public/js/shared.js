// Code shared by the browser app and the API worker: plate handling, tags and validation.

export const MAX_COMMENT_LENGTH = 200;
export const MAX_TAGS = 5;

// Quick comments. Stored as ids, displayed in the reader's language.
export const TAGS = {
  bad: ['dangerous', 'speeding', 'tailgating', 'phone', 'litter', 'no_signal', 'aggressive', 'red_light'],
  good: ['courteous', 'safe', 'let_merge', 'pedestrians', 'signals'],
};
export const TAG_IDS = [...TAGS.bad, ...TAGS.good];

export const TAG_EMOJI = {
  dangerous: '⚠️',
  speeding: '💨',
  tailgating: '🧲',
  phone: '📱',
  litter: '🗑️',
  no_signal: '↪️',
  aggressive: '😡',
  red_light: '🚦',
  courteous: '🙏',
  safe: '✅',
  let_merge: '🤝',
  pedestrians: '🚶',
  signals: '💡',
};

/** Uppercases and strips separators: " ab-123 cd " -> "AB123CD". Keeps non-Latin letters (e.g. 京). */
export function normalizePlate(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function isValidPlate(plate) {
  return /^[\p{L}\p{N}]{2,12}$/u.test(plate);
}

export function isValidCountry(country) {
  return /^[A-Z]{2}$/.test(country);
}

/** Pretty-prints well-known formats; falls back to the normalized plate. */
export function formatPlate(plate, country) {
  const p = normalizePlate(plate);
  let m;
  switch (country) {
    case 'FR':
      if ((m = p.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
      break;
    case 'IT':
      if ((m = p.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/))) return `${m[1]} ${m[2]}${m[3]}`;
      break;
    case 'ES':
      if ((m = p.match(/^(\d{4})([A-Z]{3})$/))) return `${m[1]} ${m[2]}`;
      break;
    case 'GB':
      if ((m = p.match(/^([A-Z]{2}\d{2})([A-Z]{3})$/))) return `${m[1]} ${m[2]}`;
      break;
    case 'IN':
      if ((m = p.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/))) {
        return [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ');
      }
      break;
    case 'CN':
      if ((m = p.match(/^(\p{Script=Han})([A-Z])([A-Z0-9]{5,6})$/u))) return `${m[1]}${m[2]}·${m[3]}`;
      break;
  }
  return p;
}

/** True when the text looks like it contains a link, an email address or a phone number. */
export function containsContactInfo(text) {
  return (
    /(https?:\/\/|www\.)/i.test(text) ||
    /\b[a-z0-9-]{2,}\.(com|net|org|fr|io|co|app|xyz|info|me|ly|gg|tv|es|in|cn|uk|de|link|site|online)\b/i.test(text) ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) ||
    /(?:\+?\d[\s.\-/]?){8,}/.test(text)
  );
}

/**
 * Validates a rating submission. Returns { ok: true, value } with cleaned values,
 * or { ok: false, error } where error is a stable code the UI translates.
 */
export function validateRating(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid_request' };
  const country = String(input.country ?? '').toUpperCase();
  if (!isValidCountry(country)) return { ok: false, error: 'invalid_country' };
  const plate = normalizePlate(input.plate);
  if (!isValidPlate(plate)) return { ok: false, error: 'invalid_plate' };
  const stars = input.stars;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: 'invalid_stars' };
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || !tags.every((t) => TAG_IDS.includes(t))) {
    return { ok: false, error: 'invalid_tags' };
  }
  const comment = typeof input.comment === 'string' ? input.comment.replace(/\s+/g, ' ').trim() : '';
  if ([...comment].length > MAX_COMMENT_LENGTH) return { ok: false, error: 'comment_too_long' };
  if (comment && containsContactInfo(comment)) return { ok: false, error: 'comment_contact' };
  const lang = typeof input.lang === 'string' && /^[a-z]{2}$/.test(input.lang) ? input.lang : null;
  // Random id kept on the phone, so people sharing one IP (mobile networks) are told apart.
  const device = typeof input.device === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(input.device) ? input.device : null;
  return { ok: true, value: { country, plate, stars, tags: [...new Set(tags)], comment, lang, device } };
}
