import { DEFAULT_COUNTRY, LANGUAGES, STRINGS } from './i18n.js';
import { MAX_TAGS, TAG_EMOJI, TAGS, formatPlate, isValidPlate, normalizePlate } from './shared.js';

const COUNTRIES = (
  'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ ' +
  'CA CD CF CG CH CI CK CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
  'MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA ' +
  'RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR ' +
  'TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');
// Countries whose plates carry a blue band on the left.
const BLUE_BAND = new Set(
  ('AL AT BA BE BG CY CZ DE DK EE ES FI FR GB GR HR HU IE IT LT LU LV MD ME MK MT NL NO PL PT RO RS SE SI SK ' +
    'SM UA XK').split(' '),
);
const DAY = 86_400_000;

const $ = (selector) => document.querySelector(selector);

const storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private mode or storage disabled: the app still works, it just forgets preferences.
    }
  },
};

const state = {
  lang: pickLanguage(),
  country: null,
  detection: null, // plates found in the last photo
  scan: null, // { key, params, progress } of the status line under the photo
  car: null, // { country, plate, data }
  stars: 0,
  tags: new Set(),
  done: null, // translation key of the "done" message
  busy: false,
  info: null,
};
state.country = pickCountry();

// ---------- i18n ----------

function pickLanguage() {
  const saved = storage.get('lang');
  if (STRINGS[saved]) return saved;
  for (const tag of navigator.languages || [navigator.language]) {
    const code = String(tag).toLowerCase().split('-')[0];
    if (STRINGS[code]) return code;
  }
  return 'en';
}

function pickCountry() {
  const saved = storage.get('country');
  if (COUNTRIES.includes(saved)) return saved;
  for (const tag of navigator.languages || [navigator.language]) {
    const region = String(tag)
      .split('-')
      .slice(1)
      .find((part) => /^[a-z]{2}$/i.test(part));
    if (region && COUNTRIES.includes(region.toUpperCase())) return region.toUpperCase();
  }
  return DEFAULT_COUNTRY[state.lang] || 'US';
}

function lookup(table, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), table);
}

function fill(text, params) {
  return text.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    return typeof value === 'number' ? new Intl.NumberFormat(state.lang).format(value) : (value ?? '');
  });
}

function t(key, params = {}) {
  let value = lookup(STRINGS[state.lang], key) ?? lookup(STRINGS.en, key);
  if (value === undefined) return key;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'other' in value) {
    value = value[new Intl.PluralRules(state.lang).select(params.n ?? 0)] ?? value.other;
  }
  return typeof value === 'string' ? fill(value, params) : value;
}

const hasText = (key) => lookup(STRINGS[state.lang], key) !== undefined || lookup(STRINGS.en, key) !== undefined;

function countryName(code) {
  try {
    return new Intl.DisplayNames([state.lang], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

const flag = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));

// ---------- DOM helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

function showError(selector, message) {
  const node = $(selector);
  node.textContent = message || '';
  node.hidden = !message;
}

// ---------- API ----------

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...options.headers },
    });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'generic'), { code: data.error || 'generic' });
  return data;
}

const errorText = (err) => (hasText(`errors.${err?.code}`) ? t(`errors.${err.code}`) : t('errors.generic'));

// Remember (on this device only) what was rated or reported, to avoid pointless retries.
const carKey = (country, plate) => `${country}:${plate}`;

function ratedToday(country, plate) {
  const rated = storage.get('rated', {});
  return Date.now() - (rated[carKey(country, plate)] || 0) < DAY;
}

function markRated(country, plate) {
  const now = Date.now();
  const rated = Object.fromEntries(
    Object.entries(storage.get('rated', {})).filter(([, time]) => now - time < DAY),
  );
  rated[carKey(country, plate)] = now;
  storage.set('rated', rated);
}

const reportedIds = new Set(storage.get('reported', []));

function deviceId() {
  let id = storage.get('device');
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
    id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    storage.set('device', id);
  }
  return id;
}

// ---------- Language & country pickers ----------

function renderPickers() {
  const langSelect = $('#lang-select');
  langSelect.replaceChildren(
    ...LANGUAGES.map(({ code, name }) => el('option', { value: code, selected: code === state.lang }, name)),
  );
  langSelect.setAttribute('aria-label', t('language'));
  $('#lang-face').textContent = state.lang.toUpperCase();

  const collator = new Intl.Collator(state.lang);
  const options = COUNTRIES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  const countrySelect = $('#country-select');
  countrySelect.replaceChildren(
    ...options.map(({ code, name }) =>
      el('option', { value: code, selected: code === state.country }, `${flag(code)} ${name}`),
    ),
  );
  countrySelect.setAttribute('aria-label', t('countryLabel'));
  renderCountryFace();
}

function renderCountryFace() {
  $('#country-flag').textContent = flag(state.country);
  $('#country-code').textContent = state.country;
  $('.plate-row').classList.toggle('eu', BLUE_BAND.has(state.country));
}

function setCountry(code) {
  state.country = code;
  storage.set('country', code);
  $('#country-select').value = code;
  renderCountryFace();
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  }
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  }
  document.title = `Rate This Car · ${t('tagline')}`;
  renderPickers();
  renderScan();
  renderStarsInput();
  renderChips();
  renderStats();
  if (state.done) $('#done-text').textContent = t(state.done);
  if (state.car) {
    renderPlate();
    if (state.car.data) renderCarData();
  }
  if ($('#about-dialog').open) renderAbout();
}

// ---------- Home: photo → plate ----------

let readerModule = null;
let readerReady = false;
let onReaderProgress = null;

function loadReader() {
  readerModule ??= import('./plate-reader.js').then(async (module) => {
    await module.loadPlateReader((fraction) => onReaderProgress?.(fraction));
    readerReady = true;
    return module;
  });
  readerModule.catch(() => {
    readerModule = null;
  });
  return readerModule;
}

function setScan(key, params = {}, progress = undefined) {
  state.scan = { key, params, progress };
  renderScan();
}

function renderScan() {
  const box = $('#scan');
  if (!state.scan) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('#scan-status').textContent = t(state.scan.key, state.scan.params);
  const bar = $('#scan-progress');
  bar.hidden = state.scan.progress === undefined;
  bar.classList.toggle('indeterminate', state.scan.progress === null);
  if (typeof state.scan.progress === 'number') bar.style.setProperty('--p', `${state.scan.progress * 100}%`);
  else bar.style.removeProperty('--p');
  renderOtherPlates();
}

let scanId = 0;

async function scanPhoto(file) {
  const id = ++scanId;
  state.detection = null;
  $('#scan-preview').hidden = true;
  showError('#plate-error', '');
  setScan(readerReady ? 'readingPlate' : 'loadingReader', {}, null);
  $('#scan').scrollIntoView({ block: 'center' });
  onReaderProgress = (fraction) => {
    if (id !== scanId || readerReady) return;
    if (fraction == null) setScan('loadingReader', {}, null);
    else setScan('loadingReaderPct', { pct: Math.round(fraction * 100) }, fraction);
  };
  let reader;
  try {
    reader = await loadReader();
  } catch (err) {
    console.error(err);
    if (id === scanId) setScan('readerError');
    return;
  }
  if (id !== scanId) return;
  setScan('readingPlate', {}, null);
  let results;
  try {
    results = await reader.readPlates(file);
  } catch (err) {
    console.error(err);
    if (id === scanId) setScan('photoError');
    return;
  }
  if (id !== scanId) return;
  if (!results.length) {
    setScan('plateNotFound');
    $('#plate-input').focus();
    return;
  }
  state.detection = { results, known: reader.READER_COUNTRIES, index: 0 };
  selectDetected(0);
}

function selectDetected(index) {
  const { results, known } = state.detection;
  const result = results[index];
  state.detection.index = index;
  // Only trust the model's guess of the country when it knows the user's country too,
  // e.g. a French user photographing a Spanish car. It has never seen Indian or Chinese plates.
  if (
    result.country &&
    result.country !== state.country &&
    result.countryConfidence >= 0.8 &&
    known.includes(state.country) &&
    COUNTRIES.includes(result.country)
  ) {
    setCountry(result.country);
  }
  $('#plate-input').value = formatPlate(result.plate, state.country);
  const preview = $('#scan-preview');
  preview.src = result.preview;
  preview.hidden = false;
  const sure = result.confidence >= 0.6 && known.includes(state.country);
  setScan(sure ? 'plateFound' : 'plateUnsure');
  $('#go-btn').focus({ preventScroll: true });
}

function renderOtherPlates() {
  const box = $('#scan-others');
  const detection = state.detection;
  if (!detection || detection.results.length < 2) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.replaceChildren(
    el('span', {}, t('otherPlates')),
    ...detection.results
      .map((result, index) => ({ result, index }))
      .filter(({ index }) => index !== detection.index)
      .map(({ result, index }) =>
        el('button', { type: 'button', onclick: () => selectDetected(index) }, formatPlate(result.plate, state.country)),
      ),
  );
}

function submitPlate(event) {
  event.preventDefault();
  const plate = normalizePlate($('#plate-input').value);
  if (!isValidPlate(plate)) {
    showError('#plate-error', t('invalidPlate'));
    $('#plate-input').focus();
    return;
  }
  showError('#plate-error', '');
  location.hash = `#/car/${state.country}/${encodeURIComponent(plate)}`;
}

// ---------- Car page ----------

function renderPlate() {
  const { country, plate } = state.car;
  const node = $('#car-plate');
  node.className = `plate${BLUE_BAND.has(country) ? ' eu' : ''}`;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', `${countryName(country)}: ${formatPlate(plate, country)}`);
  node.replaceChildren(
    el('span', { class: 'plate-band', title: countryName(country) }, country),
    el('span', { class: 'plate-text' }, formatPlate(plate, country)),
  );
}

async function openCar(country, plate) {
  showView('view-car');
  state.car = { country, plate, data: null };
  resetRateForm();
  renderPlate();
  const detected = state.detection?.results.find((r) => r.plate === plate);
  $('#car-preview').hidden = !detected;
  if (detected) $('#car-preview').src = detected.preview;
  if (ratedToday(country, plate)) showDone('alreadyRatedToday');
  await loadCar();
}

async function loadCar() {
  const { country, plate } = state.car;
  $('#summary').replaceChildren(el('p', { class: 'loading-line' }, t('loading')));
  $('#recent').hidden = true;
  try {
    const data = await api(`/plates/${country}/${encodeURIComponent(plate)}`);
    if (state.car?.country !== country || state.car?.plate !== plate) return;
    state.car.data = data;
    renderCarData();
  } catch (err) {
    if (state.car?.country !== country || state.car?.plate !== plate) return;
    $('#summary').replaceChildren(
      el('p', { class: 'field-error' }, errorText(err)),
      el('button', { type: 'button', class: 'btn btn-secondary', onclick: loadCar }, t('retry')),
    );
  }
}

const tagLabel = (tag) => `${TAG_EMOJI[tag]} ${t(`tags.${tag}`)}`;
const tagTone = (tag) => (TAGS.bad.includes(tag) ? 'bad' : 'good');

function starsStatic(value, size = '') {
  return el(
    'span',
    {
      class: `stars-static ${size}`,
      style: `--value:${value}`,
      role: 'img',
      'aria-label': `${new Intl.NumberFormat(state.lang, { maximumFractionDigits: 1 }).format(value)} / 5`,
    },
    '★★★★★',
  );
}

function renderCarData() {
  const data = state.car.data;
  const summary = $('#summary');
  if (!data.count) {
    summary.replaceChildren(el('p', { class: 'empty' }, t('noRatings')));
  } else {
    const top = Object.entries(data.tags)
      .filter(([tag]) => TAG_EMOJI[tag])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    summary.replaceChildren(
      el(
        'div',
        { class: 'avg' },
        el(
          'span',
          { class: 'avg-num' },
          new Intl.NumberFormat(state.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
            data.average,
          ),
        ),
        el('div', {}, starsStatic(data.average, 'lg'), el('span', { class: 'count' }, t('ratingsCount', { n: data.count }))),
      ),
      top.length
        ? el(
            'ul',
            { class: 'tag-bars' },
            ...top.map(([tag, n]) =>
              el(
                'li',
                { class: tagTone(tag) },
                el('span', {}, tagLabel(tag)),
                el('span', { class: 'bar' }, el('i', { style: `width:${Math.round((100 * n) / data.count)}%` })),
                el('span', { class: 'n' }, new Intl.NumberFormat(state.lang).format(n)),
              ),
            ),
          )
        : null,
    );
  }
  $('#ratings-list').replaceChildren(...data.ratings.map(ratingItem));
  $('#recent').hidden = !data.ratings.length;
}

function timeAgo(time) {
  const format = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  const seconds = Math.round((time - Date.now()) / 1000);
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second'); // "now"
}

function ratingItem(rating) {
  const reported = reportedIds.has(rating.id);
  const tags = rating.tags.filter((tag) => TAG_EMOJI[tag]);
  const button = el(
    'button',
    { type: 'button', class: 'link', disabled: reported },
    reported ? t('reported') : t('report'),
  );
  button.addEventListener('click', () => reportRating(rating.id, button));
  return el(
    'li',
    { class: 'rating' },
    el(
      'div',
      { class: 'rating-head' },
      starsStatic(rating.stars),
      el('time', { datetime: new Date(rating.createdAt).toISOString() }, timeAgo(rating.createdAt)),
    ),
    tags.length
      ? el('div', { class: 'rating-tags' }, ...tags.map((tag) => el('span', { class: `tag ${tagTone(tag)}` }, tagLabel(tag))))
      : null,
    rating.comment ? el('p', { class: 'rating-comment' }, rating.comment) : null,
    button,
  );
}

async function reportRating(id, button) {
  if (!confirm(t('reportConfirm'))) return;
  button.disabled = true;
  try {
    await api(`/ratings/${id}/report`, { method: 'POST', body: '{}' });
    reportedIds.add(id);
    storage.set('reported', [...reportedIds].slice(-200));
    button.textContent = t('reported');
    toast(t('reported'));
  } catch (err) {
    button.disabled = false;
    toast(errorText(err));
  }
}

// ---------- Rating form ----------

function renderStarsInput() {
  const box = $('#stars-input');
  box.setAttribute('aria-label', t('yourRating'));
  box.replaceChildren(
    ...[1, 2, 3, 4, 5].map((n) =>
      el(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'star',
          'aria-checked': String(state.stars === n),
          'aria-label': `${t('starAria', { n })}: ${t('stars')[n - 1]}`,
          onclick: () => setStars(n),
          onpointerenter: (event) => event.pointerType === 'mouse' && paintStars(n),
          onpointerleave: () => paintStars(),
        },
        '★',
      ),
    ),
  );
  paintStars();
}

function paintStars(preview = 0) {
  const shown = preview || state.stars;
  document.querySelectorAll('#stars-input .star').forEach((star, i) => star.classList.toggle('on', i < shown));
  $('#star-label').textContent = shown ? t('stars')[shown - 1] : t('tapToRate');
}

function setStars(n) {
  state.stars = n;
  document
    .querySelectorAll('#stars-input .star')
    .forEach((star, i) => star.setAttribute('aria-checked', String(i + 1 === n)));
  paintStars();
  $('#rate-details').hidden = false;
  showError('#rate-error', '');
  renderChips();
}

function renderChips() {
  const stars = state.stars;
  const groups = !stars ? [] : stars <= 2 ? ['bad'] : stars >= 4 ? ['good'] : ['bad', 'good'];
  for (const tag of [...state.tags]) {
    if (!groups.includes(tagTone(tag))) state.tags.delete(tag);
  }
  const full = state.tags.size >= MAX_TAGS;
  $('#chips').replaceChildren(
    ...groups.flatMap((group) => [
      groups.length > 1 ? el('p', { class: 'group-label' }, t(group === 'bad' ? 'problems' : 'kudos')) : null,
      ...TAGS[group].map((tag) =>
        el(
          'button',
          {
            type: 'button',
            class: `chip ${group}`,
            'aria-pressed': String(state.tags.has(tag)),
            disabled: full && !state.tags.has(tag),
            onclick: () => toggleTag(tag),
          },
          tagLabel(tag),
        ),
      ),
    ]).filter(Boolean),
  );
}

function toggleTag(tag) {
  if (state.tags.has(tag)) state.tags.delete(tag);
  else if (state.tags.size < MAX_TAGS) state.tags.add(tag);
  renderChips();
}

function resetRateForm() {
  state.stars = 0;
  state.tags.clear();
  state.done = null;
  $('#comment').value = '';
  $('#comment-count').textContent = '0';
  $('#rate-details').hidden = true;
  $('#rate-form').hidden = false;
  $('#rate-done').hidden = true;
  showError('#rate-error', '');
  renderStarsInput();
  renderChips();
}

function showDone(key) {
  state.done = key;
  $('#done-text').textContent = t(key);
  $('#rate-form').hidden = true;
  $('#rate-done').hidden = false;
}

async function submitRating(event) {
  event.preventDefault();
  if (state.busy || !state.car) return;
  if (!state.stars) {
    showError('#rate-error', t('errors.invalid_stars'));
    return;
  }
  const { country, plate } = state.car;
  const button = $('#publish-btn');
  state.busy = true;
  button.disabled = true;
  button.textContent = t('publishing');
  showError('#rate-error', '');
  try {
    const data = await api('/ratings', {
      method: 'POST',
      body: JSON.stringify({
        country,
        plate,
        stars: state.stars,
        tags: [...state.tags],
        comment: $('#comment').value,
        lang: state.lang,
        device: deviceId(),
      }),
    });
    markRated(country, plate);
    if (state.car?.plate === plate && state.car?.country === country) {
      state.car.data = data;
      renderCarData();
      showDone('thanks');
      $('#rate-done').scrollIntoView({ block: 'center' });
    }
  } catch (err) {
    if (err.code === 'already_rated') {
      markRated(country, plate);
      showDone('alreadyRatedToday');
    } else {
      showError('#rate-error', errorText(err));
    }
  } finally {
    state.busy = false;
    button.disabled = false;
    button.textContent = t('publish');
  }
}

// ---------- About, stats, sharing, install ----------

function renderAbout() {
  const days = state.info?.retentionDays ?? 365;
  const contact = state.info?.contact;
  const [before, after = ''] = t('removalContact').split('{email}');
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('#about-body').replaceChildren(
    el('h2', {}, t('aboutTitle')),
    el('p', {}, t('aboutIntro')),
    el('h3', {}, `🚫📱 ${t('safetyTitle')}`),
    el('p', {}, t('safetyText')),
    el('h3', {}, `🔒 ${t('privacyTitle')}`),
    el('ul', {}, ...t('privacy').map((line) => el('li', {}, fill(line, { days })))),
    el('h3', {}, `⚖️ ${t('fairTitle')}`),
    el('p', {}, t('fairText')),
    el('h3', {}, `🗑️ ${t('removalTitle')}`),
    el(
      'p',
      {},
      t('removalText'),
      contact ? ` ${before}` : null,
      contact ? el('a', { href: `mailto:${contact}` }, contact) : null,
      contact ? after : null,
    ),
    isIos && !standalone ? el('p', { class: 'fine' }, t('iosInstall')) : null,
    el('p', { class: 'fine' }, t('credits')),
  );
}

function renderStats() {
  const count = state.info?.ratings ?? 0;
  const node = $('#stats');
  node.hidden = count < 10;
  node.textContent = t('statsLine', { n: count });
}

async function shareApp() {
  const url = new URL('./', location.href).href;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Rate This Car', text: t('shareText'), url });
    } catch {
      // Cancelled by the user.
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('linkCopied'));
  } catch {
    prompt('', url);
  }
}

let installPrompt = null;

// ---------- Routing & start-up ----------

function showView(id) {
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== id;
  window.scrollTo(0, 0);
}

function route() {
  const match = location.hash.match(/^#\/car\/([a-z]{2})\/([^/?#]+)$/i);
  if (match) {
    const country = match[1].toUpperCase();
    let plate = '';
    try {
      plate = normalizePlate(decodeURIComponent(match[2]));
    } catch {
      // Malformed link: fall through to the home page.
    }
    if (COUNTRIES.includes(country) && isValidPlate(plate)) {
      openCar(country, plate);
      return;
    }
  }
  state.car = null;
  showView('view-home');
}

function start() {
  $('#lang-select').addEventListener('change', (event) => {
    state.lang = event.target.value;
    storage.set('lang', state.lang);
    applyLanguage();
  });
  $('#country-select').addEventListener('change', (event) => setCountry(event.target.value));

  for (const input of [$('#camera-input'), $('#gallery-input')]) {
    // Start downloading the plate reader while the user is taking the picture.
    input.addEventListener('click', () => loadReader().catch(() => {}));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) scanPhoto(file);
    });
  }
  $('#demo-btn').addEventListener('click', async () => {
    loadReader().catch(() => {});
    try {
      const res = await fetch('demo/car.jpg');
      scanPhoto(await res.blob());
    } catch {
      toast(t('errors.offline'));
    }
  });
  $('#plate-form').addEventListener('submit', submitPlate);
  $('#plate-input').addEventListener('input', () => showError('#plate-error', ''));

  $('#rate-form').addEventListener('submit', submitRating);
  $('#comment').addEventListener('input', (event) => {
    $('#comment-count').textContent = String(event.target.value.length);
  });

  $('#about-btn').addEventListener('click', () => {
    renderAbout();
    $('#about-dialog').showModal();
  });
  for (const button of document.querySelectorAll('.share-btn')) button.addEventListener('click', shareApp);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    $('#install-btn').hidden = true;
  });

  window.addEventListener('hashchange', route);
  applyLanguage();
  route();

  api('/info')
    .then((info) => {
      state.info = info;
      renderStats();
    })
    .catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
  }
}

start();
