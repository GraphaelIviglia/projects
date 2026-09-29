// On-device licence plate reader. Nothing leaves the phone: the photo is decoded,
// the plate is located with a YOLOv9 detector and read with a fast-plate-ocr model,
// both running in WebAssembly through onnxruntime-web.
//
// Models (MIT): github.com/ankandrew/open-image-models (yolo-v9-t-384-license-plates-end2end)
//               github.com/ankandrew/fast-plate-ocr (cct-s-v2-global-model, int8-quantized)

const ROOT = new URL('../', import.meta.url);
const ORT_URL = new URL('vendor/ort/ort.wasm.bundle.min.mjs', ROOT).href;
const DETECTOR_URL = new URL('models/plate-detector.onnx', ROOT).href;
const OCR_URL = new URL('models/plate-ocr.onnx', ROOT).href;

const DET_SIZE = 384;
const DET_MIN_SCORE = 0.25;
const MAX_SIDE = 2048; // cap on the working image; plates stay sharp, memory stays bounded
const OCR_W = 128;
const OCR_H = 64;
const OCR_SLOTS = 10;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
const PAD = '_';
// Order of the OCR model's "region" head, as ISO 3166-1 alpha-2 codes (null = unknown).
const REGIONS = [
  'AL', 'AD', 'AR', 'AM', 'AU', 'AT', 'AZ', 'BH', 'BY', 'BE', 'BA', 'BR', 'BG', 'KH', 'CA', 'HR',
  'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GI', 'GR', 'GG', 'HU', 'IS', 'ID', 'IE', 'IL', 'IT',
  'LV', 'LI', 'LT', 'LU', 'MY', 'MT', 'MX', 'MD', 'MC', 'ME', 'NL', 'NZ', 'MK', 'NO', 'PL',
  'PT', 'QA', 'RO', 'SM', 'RS', 'SG', 'SK', 'SI', 'ES', 'SE', 'CH', 'TH', 'TR', 'US', 'UA', 'GB', 'VN',
  null,
];
/** Countries whose plates the OCR model was trained on. */
export const READER_COUNTRIES = REGIONS.filter(Boolean);

let loading = null;

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Loads the runtime and both models once. `onProgress(fraction)` is called while the
 * model files download (fraction is null when the size is unknown).
 */
export function loadPlateReader(onProgress) {
  if (!loading) {
    loading = (async () => {
      const ort = await import(ORT_URL);
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
        : 1;
      const sizes = { det: 0, ocr: 0 };
      const done = { det: 0, ocr: 0 };
      const report = (key) => (received, total) => {
        done[key] = received;
        sizes[key] = total;
        if (!onProgress) return;
        const known = sizes.det && sizes.ocr;
        onProgress(known ? (done.det + done.ocr) / (sizes.det + sizes.ocr) : null);
      };
      const [detBytes, ocrBytes] = await Promise.all([
        fetchBytes(DETECTOR_URL, report('det')),
        fetchBytes(OCR_URL, report('ocr')),
      ]);
      const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      const det = await ort.InferenceSession.create(detBytes, options);
      const ocr = await ort.InferenceSession.create(ocrBytes, options);
      return { ort, det, ocr };
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

function makeCanvas(width, height) {
  const el = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = el.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { el, ctx };
}

async function decodeImage(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(blob); // older engines reject the option value
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const work = makeCanvas(width, height);
  work.ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return { ...work, width, height };
}

async function detect({ ort, det }, image) {
  const { width: W, height: H } = image;
  const r = Math.min(DET_SIZE / W, DET_SIZE / H);
  const nw = Math.round(W * r);
  const nh = Math.round(H * r);
  const dw = (DET_SIZE - nw) / 2;
  const dh = (DET_SIZE - nh) / 2;
  const box = makeCanvas(DET_SIZE, DET_SIZE);
  box.ctx.fillStyle = 'rgb(114,114,114)';
  box.ctx.fillRect(0, 0, DET_SIZE, DET_SIZE);
  box.ctx.drawImage(image.el, Math.round(dw - 0.1), Math.round(dh - 0.1), nw, nh);
  const px = box.ctx.getImageData(0, 0, DET_SIZE, DET_SIZE).data;
  const n = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = px[4 * i] / 255;
    input[n + i] = px[4 * i + 1] / 255;
    input[2 * n + i] = px[4 * i + 2] / 255;
  }
  const outputs = await det.run({
    [det.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]),
  });
  const out = outputs[det.outputNames[0]]; // [N, 7]: batch, x1, y1, x2, y2, class, score
  const d = out.data;
  const boxes = [];
  for (let i = 0; i < out.dims[0]; i++) {
    const score = d[i * 7 + 6];
    if (score < DET_MIN_SCORE) continue;
    const x1 = Math.max(0, Math.trunc((d[i * 7 + 1] - dw) / r));
    const y1 = Math.max(0, Math.trunc((d[i * 7 + 2] - dh) / r));
    const x2 = Math.min(W, Math.trunc((d[i * 7 + 3] - dw) / r));
    const y2 = Math.min(H, Math.trunc((d[i * 7 + 4] - dh) / r));
    if (x2 - x1 < 4 || y2 - y1 < 2) continue;
    boxes.push({ score, x1, y1, x2, y2 });
  }
  // The car right in front of you usually has the biggest plate in the photo.
  const rank = (b) => b.score * Math.sqrt((b.x2 - b.x1) * (b.y2 - b.y1));
  return boxes.sort((a, b) => rank(b) - rank(a));
}

async function recognize({ ort, ocr }, image, b) {
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;
  const c = makeCanvas(OCR_W, OCR_H);
  c.ctx.drawImage(image.el, b.x1, b.y1, w, h, 0, 0, OCR_W, OCR_H);
  const px = c.ctx.getImageData(0, 0, OCR_W, OCR_H).data;
  const input = new Uint8Array(OCR_W * OCR_H * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    input[j] = px[i];
    input[j + 1] = px[i + 1];
    input[j + 2] = px[i + 2];
  }
  const outputs = await ocr.run({
    [ocr.inputNames[0]]: new ort.Tensor('uint8', input, [1, OCR_H, OCR_W, 3]),
  });
  const plateProbs = outputs.plate.data; // [1, slots, alphabet]
  const k = ALPHABET.length;
  let text = '';
  const charProbs = [];
  for (let s = 0; s < OCR_SLOTS; s++) {
    let best = 0;
    for (let j = 1; j < k; j++) if (plateProbs[s * k + j] > plateProbs[s * k + best]) best = j;
    text += ALPHABET[best];
    charProbs.push(plateProbs[s * k + best]);
  }
  const trimmed = text.replace(/_+$/, '');
  const probs = charProbs.slice(0, trimmed.length);
  const plate = trimmed.replaceAll(PAD, '');
  let country = null;
  let countryConfidence = 0;
  if (outputs.region) {
    const rp = outputs.region.data;
    let best = 0;
    for (let j = 1; j < rp.length; j++) if (rp[j] > rp[best]) best = j;
    country = REGIONS[best] ?? null;
    countryConfidence = rp[best];
  }
  return {
    plate,
    confidence: probs.length ? Math.min(...probs) : 0,
    country,
    countryConfidence,
    score: b.score,
    box: b,
  };
}

/** Returns a small JPEG data URL of the plate area, for display only. */
function cropPreview(image, b) {
  const padX = Math.round((b.x2 - b.x1) * 0.15);
  const padY = Math.round((b.y2 - b.y1) * 0.35);
  const x1 = Math.max(0, b.x1 - padX);
  const y1 = Math.max(0, b.y1 - padY);
  const x2 = Math.min(image.width, b.x2 + padX);
  const y2 = Math.min(image.height, b.y2 + padY);
  const height = 120;
  const width = Math.max(1, Math.round(((x2 - x1) / Math.max(1, y2 - y1)) * height));
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image.el, x1, y1, x2 - x1, y2 - y1, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/**
 * Finds and reads the plates in a photo. Resolves to an array of candidates, best first
 * (empty when no plate is visible): { plate, confidence, country, countryConfidence, preview }.
 */
export async function readPlates(blob, { onProgress, maxPlates = 3, withPreview = true } = {}) {
  const runtime = await loadPlateReader(onProgress);
  const image = await decodeImage(blob);
  const boxes = (await detect(runtime, image)).slice(0, maxPlates);
  const results = [];
  for (const b of boxes) {
    const r = await recognize(runtime, image, b);
    if (r.plate.length < 2) continue;
    if (withPreview) r.preview = cropPreview(image, b);
    results.push(r);
  }
  return results;
}
