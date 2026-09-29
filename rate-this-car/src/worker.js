// Rate This Car API — Cloudflare Worker + D1.
//
// Privacy by design:
// - plates are stored as keyed hashes (HMAC with a random per-deployment secret), never in clear;
// - IP addresses and device ids are only kept as keyed, daily-rotating hashes for anti-abuse, wiped after 48 h;
// - ratings are deleted after RETENTION_DAYS (default 365); photos never reach the server.
import { isValidCountry, isValidPlate, normalizePlate, validateRating } from '../public/js/shared.js';

const DAY = 86_400_000;
// Mobile carriers put many people behind one IP address, so per-IP caps stay generous
// and "one rating per car per day" is enforced per device.
const RATINGS_PER_DEVICE_PER_DAY = 30;
const RATINGS_PER_IP_PER_DAY = 100;
const SAME_CAR_PER_IP_PER_DAY = 3;
const REPORTS_PER_IP_PER_DAY = 100;
const HIDE_AFTER_REPORTS = 3;
const MAX_BODY_BYTES = 4096;
const SUMMARY_SCAN_LIMIT = 500;
const RECENT_RATINGS = 30;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('secret', lower(hex(randomblob(32))))`,
  `INSERT OR IGNORE INTO meta (key, value) VALUES ('ratings_total', '0')`,
  `CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_key TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    tags TEXT NOT NULL DEFAULT '',
    comment TEXT,
    lang TEXT,
    ip_hash TEXT,
    device_hash TEXT,
    reports INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ratings_by_plate ON ratings (plate_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS ratings_by_ip ON ratings (ip_hash)`,
  `CREATE INDEX IF NOT EXISTS ratings_by_device ON ratings (device_hash)`,
  `CREATE INDEX IF NOT EXISTS ratings_by_date ON ratings (created_at)`,
  `CREATE TABLE IF NOT EXISTS reports (
    rating_id INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (rating_id, ip_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS reports_by_ip ON reports (ip_hash, created_at)`,
];

let ready; // per-isolate: schema created and hashing key imported

function init(env) {
  ready ??= (async () => {
    await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
    const { value } = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'secret'`).first();
    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(value),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  })().catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

async function keyedHash(key, text) {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig, 0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(request) {
  const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
  if (!ip.includes(':')) return ip;
  // One IPv6 subscriber usually owns a whole /64: rate-limit the prefix, not the address.
  const [head, tail] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const error = (code, status) => json({ error: code }, status);

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const splitTags = (tags) => (tags ? tags.split(',') : []);

function retentionDays(env) {
  const days = Number.parseInt(env.RETENTION_DAYS, 10);
  return Number.isInteger(days) && days >= 0 ? days : 365;
}

async function plateSummary(env, plateKey) {
  const { results } = await env.DB.prepare(
    `SELECT id, stars, tags, comment, created_at FROM ratings
     WHERE plate_key = ? AND hidden = 0 ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(plateKey, SUMMARY_SCAN_LIMIT)
    .all();
  const tags = {};
  let sum = 0;
  for (const r of results) {
    sum += r.stars;
    for (const t of splitTags(r.tags)) tags[t] = (tags[t] || 0) + 1;
  }
  return {
    count: results.length,
    average: results.length ? Math.round((sum / results.length) * 10) / 10 : null,
    tags,
    ratings: results.slice(0, RECENT_RATINGS).map((r) => ({
      id: r.id,
      stars: r.stars,
      tags: splitTags(r.tags),
      comment: r.comment || '',
      createdAt: r.created_at,
    })),
  };
}

function parsePlateParams(countryParam, plateParam) {
  let country;
  let plate;
  try {
    country = decodeURIComponent(countryParam).toUpperCase();
    plate = normalizePlate(decodeURIComponent(plateParam));
  } catch {
    return null; // malformed percent-encoding
  }
  return isValidCountry(country) && isValidPlate(plate) ? { country, plate } : null;
}

function isSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // not sent by the browser for same-origin fetches in some engines
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false; // "null" origin (sandboxed frames, file://)
  }
}

async function getPlate(env, params) {
  const key = await init(env);
  const plateKey = await keyedHash(key, `plate:${params.country}:${params.plate}`);
  return json({ country: params.country, plate: params.plate, ...(await plateSummary(env, plateKey)) });
}

async function createRating(request, env) {
  const body = await readJson(request);
  if (!body) return error('invalid_request', 400);
  const check = validateRating(body);
  if (!check.ok) return error(check.error, 400);
  const { country, plate, stars, tags, comment, lang, device } = check.value;
  const key = await init(env);
  const now = Date.now();
  const day = Math.floor(now / DAY);
  const ip = clientIp(request);
  const plateKey = await keyedHash(key, `plate:${country}:${plate}`);
  const ipHash = await keyedHash(key, `ip:${day}:${ip}`);
  // Clients that send no device id count as one device per IP.
  const deviceHash = await keyedHash(key, `device:${day}:${device || `ip:${ip}`}`);
  const today = await env.DB.prepare(
    `SELECT COALESCE(SUM(ip_hash = ?1), 0) AS ip_total,
            COALESCE(SUM(ip_hash = ?1 AND plate_key = ?3), 0) AS ip_same,
            COALESCE(SUM(device_hash = ?2), 0) AS device_total,
            COALESCE(SUM(device_hash = ?2 AND plate_key = ?3), 0) AS device_same
     FROM ratings WHERE ip_hash = ?1 OR device_hash = ?2`,
  )
    .bind(ipHash, deviceHash, plateKey)
    .first();
  if (today.device_same > 0 || today.ip_same >= SAME_CAR_PER_IP_PER_DAY) return error('already_rated', 429);
  if (today.device_total >= RATINGS_PER_DEVICE_PER_DAY || today.ip_total >= RATINGS_PER_IP_PER_DAY) {
    return error('too_many', 429);
  }
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ratings (plate_key, stars, tags, comment, lang, ip_hash, device_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(plateKey, stars, tags.join(','), comment || null, lang, ipHash, deviceHash, now),
    env.DB.prepare(`UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'ratings_total'`),
  ]);
  return json(
    { ok: true, id: inserted.meta.last_row_id, country, plate, ...(await plateSummary(env, plateKey)) },
    201,
  );
}

async function reportRating(request, env, id) {
  const key = await init(env);
  const now = Date.now();
  // Stable (not daily) hash so one person cannot hide a rating by reporting it on 3 different days.
  const ipHash = await keyedHash(key, `report:${clientIp(request)}`);
  const rating = await env.DB.prepare(`SELECT id FROM ratings WHERE id = ?`).bind(id).first();
  if (!rating) return error('not_found', 404);
  const { count } = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM reports WHERE ip_hash = ? AND created_at > ?`,
  )
    .bind(ipHash, now - DAY)
    .first();
  if (count >= REPORTS_PER_IP_PER_DAY) return error('too_many', 429);
  const added = await env.DB.prepare(
    `INSERT OR IGNORE INTO reports (rating_id, ip_hash, created_at) VALUES (?, ?, ?)`,
  )
    .bind(id, ipHash, now)
    .run();
  if (added.meta.changes) {
    await env.DB.prepare(
      `UPDATE ratings SET reports = reports + 1,
       hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?`,
    )
      .bind(HIDE_AFTER_REPORTS, id)
      .run();
  }
  return json({ ok: true });
}

async function info(env) {
  await init(env);
  const row = await env.DB.prepare(`SELECT value FROM meta WHERE key = 'ratings_total'`).first();
  return json({
    ratings: Number(row?.value || 0),
    contact: env.CONTACT_EMAIL || null,
    retentionDays: retentionDays(env),
  });
}

// Moderation, for takedown requests. Enabled only when the ADMIN_TOKEN secret is set:
//   curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" https://<app>/api/admin/plates/FR/AB123CD
async function isAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return false;
  const enc = new TextEncoder();
  const given = enc.encode(request.headers.get('authorization') || '');
  const expected = enc.encode(`Bearer ${env.ADMIN_TOKEN}`);
  return given.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(given, expected);
}

async function admin(request, env, parts) {
  if (!(await isAdmin(request, env))) return error('not_found', 404);
  const key = await init(env);
  const [resource, a, b] = parts;
  if (request.method === 'GET' && resource === 'reported') {
    const { results } = await env.DB.prepare(
      `SELECT id, stars, tags, comment, reports, hidden, created_at FROM ratings
       WHERE reports > 0 ORDER BY reports DESC, created_at DESC LIMIT 200`,
    ).all();
    return json({ ratings: results });
  }
  if (resource === 'ratings' && /^\d+$/.test(a || '')) {
    const id = Number(a);
    if (request.method === 'DELETE' && b === undefined) {
      const [res] = await env.DB.batch([
        env.DB.prepare(`DELETE FROM ratings WHERE id = ?`).bind(id),
        env.DB.prepare(`DELETE FROM reports WHERE rating_id = ?`).bind(id),
      ]);
      return json({ ok: true, deleted: res.meta.changes });
    }
    if (request.method === 'POST' && b === 'restore' && parts.length === 3) {
      await env.DB.prepare(`UPDATE ratings SET hidden = 0, reports = 0 WHERE id = ?`).bind(id).run();
      await env.DB.prepare(`DELETE FROM reports WHERE rating_id = ?`).bind(id).run();
      return json({ ok: true });
    }
  }
  if (resource === 'plates' && request.method === 'DELETE' && a && b) {
    const params = parsePlateParams(a, b);
    if (!params) return error('invalid_plate', 400);
    const plateKey = await keyedHash(key, `plate:${params.country}:${params.plate}`);
    const res = await env.DB.prepare(`DELETE FROM ratings WHERE plate_key = ?`).bind(plateKey).run();
    return json({ ok: true, deleted: res.meta.changes });
  }
  return error('not_found', 404);
}

async function route(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const { method } = request;
  // No cookies are used, but refuse cross-site writes anyway.
  if (method !== 'GET' && !isSameOrigin(request, url)) return error('forbidden', 403);
  if (parts[0] === 'info' && parts.length === 1) {
    return method === 'GET' ? info(env) : error('method_not_allowed', 405);
  }
  if (parts[0] === 'plates' && parts.length === 3) {
    if (method !== 'GET') return error('method_not_allowed', 405);
    const params = parsePlateParams(parts[1], parts[2]);
    return params ? getPlate(env, params) : error('invalid_plate', 400);
  }
  if (parts[0] === 'ratings' && parts.length === 1) {
    return method === 'POST' ? createRating(request, env) : error('method_not_allowed', 405);
  }
  if (parts[0] === 'ratings' && parts.length === 3 && parts[2] === 'report' && /^\d+$/.test(parts[1])) {
    if (method !== 'POST') return error('method_not_allowed', 405);
    if (!(await readJson(request))) return error('invalid_request', 400);
    return reportRating(request, env, Number(parts[1]));
  }
  if (parts[0] === 'admin') return admin(request, env, parts.slice(1));
  return error('not_found', 404);
}

async function cleanup(env) {
  await init(env);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ratings WHERE created_at < ?`).bind(now - retentionDays(env) * DAY),
    env.DB.prepare(
      `UPDATE ratings SET ip_hash = NULL, device_hash = NULL
       WHERE (ip_hash IS NOT NULL OR device_hash IS NOT NULL) AND created_at < ?`,
    ).bind(now - 2 * DAY),
    env.DB.prepare(`DELETE FROM reports WHERE created_at < ?`).bind(now - 30 * DAY),
  ]);
}

// Link previews (Reddit, WhatsApp, X...) need absolute URLs, and the domain is only known at request time.
async function homePage(request, env, url) {
  const asset = await env.ASSETS.fetch(request);
  if (!(asset.headers.get('content-type') || '').includes('text/html')) return asset;
  const response = new Response(asset.body, asset);
  // Cross-origin isolation lets the plate reader use several CPU threads.
  response.headers.set('cross-origin-opener-policy', 'same-origin');
  response.headers.set('cross-origin-embedder-policy', 'require-corp');
  return new HTMLRewriter()
    .on('meta[property="og:image"]', {
      element(meta) {
        meta.setAttribute('content', new URL(meta.getAttribute('content'), url).href);
      },
    })
    .on('head', {
      element(head) {
        head.append(`<meta property="og:url" content="${url.origin}/">`, { html: true });
      },
    })
    .transform(response);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') return homePage(request, env, url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      console.error(err);
      return error('server_error', 500);
    }
  },
  async scheduled(controller, env) {
    await cleanup(env);
  },
};
