// Copies the onnxruntime-web files the app needs from node_modules into public/vendor/ort.
// Run after changing the onnxruntime-web version in package.json: npm run vendor
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/onnxruntime-web/dist');
const dest = join(root, 'public/vendor/ort');
mkdirSync(dest, { recursive: true });
for (const file of ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copyFileSync(join(src, file), join(dest, file));
  console.log('copied', file);
}
