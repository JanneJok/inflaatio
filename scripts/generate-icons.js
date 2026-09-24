/**
 * Generates the site icons from one SVG master:
 *   src/static/icons/icon.svg                 SVG favicon (modern browsers)
 *   src/static/favicon.ico                    16 + 32 + 48 px (legacy, /favicon.ico requests)
 *   src/static/icons/favicon-{16,32}x….png    small PNGs
 *   src/static/icons/apple-touch-icon.png     180 px, full bleed (iOS rounds the corners itself)
 *   src/static/icons/android-chrome-*.png     192 + 512 px, rounded square ("any")
 *   src/static/icons/maskable-512x512.png     full bleed, mark inside the 80 % safe zone
 *
 * The mark: a petrol square (brand colour) with a white rising line that ends
 * in a dot — the same motif as the 24-month sparkline in the home page hero.
 *
 * Usage: npm run icons   (commit the regenerated files)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = path.join(ROOT, 'src', 'static');
const ICONS = path.join(STATIC, 'icons');

export const BRAND = '#0B5C7A';

/**
 * @param {{ rounded?: boolean, scale?: number }} [o]
 *   rounded: rounded-square background (false = full bleed for iOS/maskable)
 *   scale:   shrink the line mark around the centre (safe zones)
 * @returns {string} SVG markup
 */
export function iconSvg({ rounded = true, scale = 1 } = {}) {
  const bg = rounded
    ? `<rect width="64" height="64" rx="14" fill="${BRAND}"/>`
    : `<rect width="64" height="64" fill="${BRAND}"/>`;
  const t = scale === 1 ? '' : ` transform="translate(32 32) scale(${scale}) translate(-32 -32)"`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    bg +
    `<g${t}>` +
    '<path d="M12 44 23 34 32 40 49 22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="49" cy="22" r="5.5" fill="#fff"/>' +
    '</g></svg>'
  );
}

/** Rasterise an SVG string to a PNG buffer of `size` × `size` px. */
export function png(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/**
 * Minimal ICO container with PNG-encoded images (supported by all current browsers).
 * @param {{ size: number, data: Buffer }[]} images
 */
export function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function main() {
  mkdirSync(ICONS, { recursive: true });
  const rounded = iconSvg();
  const bleedApple = iconSvg({ rounded: false, scale: 0.86 });
  const bleedMaskable = iconSvg({ rounded: false, scale: 0.72 });

  const out = {
    'icons/icon.svg': Buffer.from(rounded + '\n'),
    'icons/favicon-16x16.png': png(rounded, 16),
    'icons/favicon-32x32.png': png(rounded, 32),
    'icons/apple-touch-icon.png': png(bleedApple, 180),
    'icons/android-chrome-192x192.png': png(rounded, 192),
    'icons/android-chrome-512x512.png': png(rounded, 512),
    'icons/maskable-512x512.png': png(bleedMaskable, 512),
    'favicon.ico': ico([16, 32, 48].map((size) => ({ size, data: png(rounded, size) }))),
  };
  for (const [rel, buf] of Object.entries(out)) {
    writeFileSync(path.join(STATIC, rel), buf);
    console.log(`  ${rel.padEnd(34)} ${(buf.length / 1024).toFixed(1)} kB`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
