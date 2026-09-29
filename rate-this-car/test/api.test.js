// Runs the real Worker locally (wrangler dev engine, throwaway D1) and exercises the API.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_dev } from 'wrangler';

const ADMIN_TOKEN = 'test-admin-token';
let worker;
let persistDir;

before(async () => {
  persistDir = mkdtempSync(join(tmpdir(), 'rate-this-car-'));
  worker = await unstable_dev('src/worker.js', {
    config: 'wrangler.jsonc',
    persistTo: persistDir,
    vars: { ADMIN_TOKEN, RETENTION_DAYS: '365' },
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true, testScheduled: true },
  });
});

after(async () => {
  await worker?.stop();
  rmSync(persistDir, { recursive: true, force: true });
});

function post(path, body, { ip = '203.0.113.1', headers = {} } = {}) {
  return worker.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers },
    body: JSON.stringify(body),
  });
}

const rate = (body, opts) => post('/api/ratings', { country: 'FR', stars: 3, ...body }, opts);

test('a new plate has no ratings', async () => {
  const res = await worker.fetch('/api/plates/FR/ZZ999ZZ');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.count, 0);
  assert.equal(data.average, null);
  assert.deepEqual(data.ratings, []);
});

test('rating a car returns the updated summary, and the plate is normalized', async () => {
  const res = await rate({ plate: 'ab-111-cd', stars: 2, tags: ['litter'], comment: 'Threw a can', lang: 'en' });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.plate, 'AB111CD');
  assert.equal(data.count, 1);
  assert.equal(data.average, 2);
  assert.deepEqual(data.tags, { litter: 1 });
  assert.equal(data.ratings[0].comment, 'Threw a can');

  const lookup = await (await worker.fetch('/api/plates/fr/AB%20111%20CD')).json();
  assert.equal(lookup.count, 1);
  assert.equal(lookup.ratings[0].id, data.id);
});

test('one rating per car per device per day; people sharing an IP can still rate', async () => {
  const ip = '198.51.100.7';
  const device = (n) => `device-${n}-aaaaaaaaaaaaaaaa`;
  assert.equal((await rate({ plate: 'AB222CD', stars: 5, device: device(1) }, { ip })).status, 201);
  // Same phone on another network: still the same person.
  const again = await rate({ plate: 'AB222CD', stars: 1, device: device(1) }, { ip: '198.51.100.99' });
  assert.equal(again.status, 429);
  assert.equal((await again.json()).error, 'already_rated');
  // Other phones behind the same carrier IP: a few are fine, then it looks like brigading.
  assert.equal((await rate({ plate: 'AB222CD', stars: 1, device: device(2) }, { ip })).status, 201);
  assert.equal((await rate({ plate: 'AB222CD', stars: 3, device: device(3) }, { ip })).status, 201);
  assert.equal((await rate({ plate: 'AB222CD', stars: 3, device: device(4) }, { ip })).status, 429);
  // Clients without a device id count as one device per IP.
  assert.equal((await rate({ plate: 'AB222CD', stars: 1 }, { ip: '198.51.100.8' })).status, 201);
  const last = await rate({ plate: 'AB222CD', stars: 1 }, { ip: '198.51.100.8' });
  assert.equal(last.status, 429);
  const data = await (await worker.fetch('/api/plates/FR/AB222CD')).json();
  assert.equal(data.count, 4);
  assert.equal(data.average, 2.5);
});

test('the same plate in another country is another car', async () => {
  assert.equal((await rate({ plate: 'AB333CD', country: 'IT' }, { ip: '192.0.2.50' })).status, 201);
  const fr = await (await worker.fetch('/api/plates/FR/AB333CD')).json();
  assert.equal(fr.count, 0);
});

test('invalid submissions are rejected with a reason', async () => {
  const cases = [
    [{ plate: 'AB444CD', stars: 6 }, 'invalid_stars'],
    [{ plate: 'A', stars: 3 }, 'invalid_plate'],
    [{ plate: 'AB444CD', tags: ['made_up'] }, 'invalid_tags'],
    [{ plate: 'AB444CD', comment: 'see www.example.com' }, 'comment_contact'],
  ];
  for (const [body, code] of cases) {
    const res = await rate(body, { ip: '192.0.2.60' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, code);
  }
  const noJson = await worker.fetch('/api/ratings', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(noJson.status, 400);
});

test('cross-site writes are refused', async () => {
  const res = await rate({ plate: 'AB555CD' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('a rating reported by 3 different people is hidden; repeat reports do not count', async () => {
  const { id } = await (await rate({ plate: 'AB666CD', comment: 'rude' }, { ip: '192.0.2.70' })).json();
  for (const ip of ['10.0.0.1', '10.0.0.1', '10.0.0.2']) {
    assert.equal((await post(`/api/ratings/${id}/report`, {}, { ip })).status, 200);
  }
  assert.equal((await (await worker.fetch('/api/plates/FR/AB666CD')).json()).count, 1);
  await post(`/api/ratings/${id}/report`, {}, { ip: '10.0.0.3' });
  assert.equal((await (await worker.fetch('/api/plates/FR/AB666CD')).json()).count, 0);
  assert.equal((await post('/api/ratings/999999/report', {})).status, 404);
});

test('admin endpoints are invisible without the token and can delete a plate', async () => {
  assert.equal((await worker.fetch('/api/admin/reported')).status, 404);
  const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
  const reported = await (await worker.fetch('/api/admin/reported', { headers: auth })).json();
  assert.ok(reported.ratings.some((r) => r.comment === 'rude' && r.hidden === 1));

  await rate({ plate: 'AB777CD' }, { ip: '192.0.2.80' });
  const del = await worker.fetch('/api/admin/plates/FR/AB-777-CD', { method: 'DELETE', headers: auth });
  assert.deepEqual(await del.json(), { ok: true, deleted: 1 });
  assert.equal((await (await worker.fetch('/api/plates/FR/AB777CD')).json()).count, 0);
});

test('info counts every rating ever shared', async () => {
  const data = await (await worker.fetch('/api/info')).json();
  assert.ok(data.ratings >= 6);
  assert.equal(data.retentionDays, 365);
});

test('unknown routes, wrong methods and malformed input get JSON errors, not crashes', async () => {
  assert.equal((await worker.fetch('/api/nope')).status, 404);
  assert.equal((await worker.fetch('/api/ratings')).status, 405);
  assert.equal((await worker.fetch('/api/plates/FR/%E0%A4%A')).status, 400);
  assert.equal((await rate({ plate: 'AB888CD' }, { headers: { origin: 'null' } })).status, 403);
  const big = await worker.fetch('/api/ratings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country: 'FR', plate: 'AB999CD', stars: 3, comment: 'x'.repeat(5000) }),
  });
  assert.equal(big.status, 400);
});

test('IPv6 users are rate-limited per /64 prefix', async () => {
  const device = (n) => `v6-device-${n}-aaaaaaaaaaaa`;
  const ips = ['2001:db8:1:2::1', '2001:db8:1:2:aaaa::2', '2001:0db8:0001:0002::3'];
  for (const [i, ip] of ips.entries()) {
    assert.equal((await rate({ plate: 'AB121CD', device: device(i) }, { ip })).status, 201);
  }
  assert.equal((await rate({ plate: 'AB121CD', device: device(9) }, { ip: '2001:db8:1:2::ff' })).status, 429);
  assert.equal((await rate({ plate: 'AB121CD', device: device(9) }, { ip: '2001:db8:1:3::ff' })).status, 201);
});

test('the home page carries absolute link-preview URLs and isolation headers', async () => {
  const res = await worker.fetch('/');
  assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
  const html = await res.text();
  assert.match(html, /<meta property="og:image" content="http[^"]+\/icons\/og-image\.png">/);
  assert.match(html, /<meta property="og:url" content="http[^"]+\/">/);
});

test('the daily clean-up keeps recent ratings', async () => {
  const res = await worker.fetch('/__scheduled?cron=17+3+*+*+*');
  assert.equal(res.status, 200);
  assert.equal((await (await worker.fetch('/api/plates/FR/AB111CD')).json()).count, 1);
});
