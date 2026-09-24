import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND, iconSvg, ico } from '../scripts/generate-icons.js';

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'static');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf) {
  assert.ok(buf.subarray(0, 8).equals(PNG_SIG), 'PNG signature');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('icon PNGs have the expected dimensions', () => {
  const expected = {
    'icons/favicon-16x16.png': 16,
    'icons/favicon-32x32.png': 32,
    'icons/apple-touch-icon.png': 180,
    'icons/android-chrome-192x192.png': 192,
    'icons/android-chrome-512x512.png': 512,
    'icons/maskable-512x512.png': 512,
  };
  for (const [rel, size] of Object.entries(expected)) {
    assert.deepEqual(pngSize(readFileSync(path.join(STATIC, rel))), [size, size], rel);
  }
});

test('favicon.ico holds 16, 32 and 48 px PNG images', () => {
  const buf = readFileSync(path.join(STATIC, 'favicon.ico'));
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  const n = buf.readUInt16LE(4);
  assert.equal(n, 3);
  const sizes = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const len = buf.readUInt32LE(e + 8);
    const off = buf.readUInt32LE(e + 12);
    const img = buf.subarray(off, off + len);
    const [w, h] = pngSize(img);
    assert.equal(w, buf.readUInt8(e));
    assert.equal(h, buf.readUInt8(e + 1));
    sizes.push(w);
  }
  assert.deepEqual(sizes, [16, 32, 48]);
});

test('SVG favicon is the brand mark and matches the generator', () => {
  const svg = readFileSync(path.join(STATIC, 'icons', 'icon.svg'), 'utf8').trim();
  assert.equal(svg, iconSvg());
  assert.ok(svg.includes(BRAND));
  assert.ok(!/<script|on\w+=/i.test(svg));
});

test('ico() writes a valid directory for 256 px entries', () => {
  const fake = Buffer.concat([PNG_SIG, Buffer.alloc(24)]);
  const out = ico([{ size: 256, data: fake }]);
  assert.equal(out.readUInt8(6), 0); // 256 is stored as 0
  assert.equal(out.readUInt32LE(6 + 12), 22);
  assert.equal(out.length, 22 + fake.length);
});
