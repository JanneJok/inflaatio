/**
 * /og/inflaatio.png – social share image (module og, owner EXTRAS; PSA-22, PROD-21).
 *
 * A 1200×630 PNG generated at build time from an SVG template with the latest
 * KHI figure: brand, "Inflaatio Suomessa · {kuukausi}", the big annual rate,
 * the change from the previous month, a 24-month sparkline and the source line.
 *
 * Rasterised with @resvg/resvg-js using Inter (SIL Open Font License 1.1) from
 * the @fontsource/inter package. resvg reads TrueType/OpenType only, so the
 * package's WOFF 1.0 files are unpacked to plain sfnt fonts (woffToSfnt) in a
 * temporary directory for the render.
 *
 * Never breaks the build: if rasterising fails (native binary missing, font
 * missing…), the committed generic image src/static/og/fallback.png (no
 * figures, so it can never be stale) is published at the same URL instead and
 * a warning is printed. Regenerate the fallback with `ogFallbackSvg()` +
 * `renderPng()` if the brand changes.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { xmlEscape } from '../../scripts/lib/html.js';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_PATH = '/og/inflaatio.png';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FALLBACK_FILE = path.join(ROOT, 'src', 'static', 'og', 'fallback.png');

/** Inter weights used by the template (package file names). */
const FONT_FILES = [400, 500, 600, 700].map((w) => `@fontsource/inter/files/inter-latin-${w}-normal.woff`);

/* Colours of the light theme (src/css/tokens.css). The image is a bitmap, so
   the tokens are copied here as literal values. */
const C = {
  bg: '#FFFFFF',
  border: '#E3E7EC',
  text: '#0E1A24',
  text2: '#4A5866',
  text3: '#56616D',
  brand: '#0B5C7A',
  target: '#5F6B78',
  up: '#B42318',
  down: '#1D6FA3',
  flat: '#5F6B78',
};

/** XML escaping for the SVG template is the shared one (scripts/lib/html.js); re-exported for the tests. */
export { xmlEscape };

/**
 * Unpack a WOFF 1.0 font into a plain sfnt (TrueType/OpenType) font.
 * Tables are zlib-compressed individually (compLength < origLength) or stored.
 * @param {Buffer} woff
 * @returns {Buffer}
 */
export function woffToSfnt(woff) {
  if (woff.length < 44 || woff.readUInt32BE(0) !== 0x774f4646) throw new Error('woffToSfnt: not a WOFF 1.0 file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const t = {
      tag: woff.readUInt32BE(o),
      offset: woff.readUInt32BE(o + 4),
      compLength: woff.readUInt32BE(o + 8),
      origLength: woff.readUInt32BE(o + 12),
      checksum: woff.readUInt32BE(o + 16),
    };
    const raw = woff.subarray(t.offset, t.offset + t.compLength);
    t.data = t.compLength < t.origLength ? inflateSync(raw) : raw;
    if (t.data.length !== t.origLength) throw new Error('woffToSfnt: table length mismatch');
    tables.push(t);
  }
  const pad4 = (n) => (n + 3) & ~3;
  const headerLength = 12 + numTables * 16;
  const total = tables.reduce((sum, t) => sum + pad4(t.origLength), headerLength);
  const out = Buffer.alloc(total);
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(searchRange, 6);
  out.writeUInt16BE(entrySelector, 8);
  out.writeUInt16BE(numTables * 16 - searchRange, 10);
  let offset = headerLength;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.writeUInt32BE(t.tag, rec);
    out.writeUInt32BE(t.checksum, rec + 4);
    out.writeUInt32BE(offset, rec + 8);
    out.writeUInt32BE(t.origLength, rec + 12);
    t.data.copy(out, offset);
    offset += pad4(t.origLength);
  });
  return out;
}

/**
 * Width and height of a PNG from its IHDR chunk (null when not a PNG).
 * @param {Buffer} buf
 * @returns {{width: number, height: number}|null}
 */
export function pngSize(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!buf || buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Sparkline path inside a box, with the 0 % and 2 % reference lines.
 * @param {(number|null)[]} values
 * @param {{x: number, y: number, w: number, h: number}} box
 * @returns {{d: string, end: {x: number, y: number}|null, yOf: (v: number) => number, min: number, max: number}}
 */
export function sparkPath(values, box) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  let min = Math.min(0, ...nums);
  let max = Math.max(2, ...nums);
  const pad = (max - min) * 0.08 || 1;
  min -= pad;
  max += pad;
  const n = values.length;
  const xOf = (i) => box.x + (n > 1 ? (i / (n - 1)) * box.w : box.w / 2);
  const yOf = (v) => box.y + (1 - (v - min) / (max - min)) * box.h;
  let d = '';
  let pen = false;
  let end = null;
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    const x = Math.round(xOf(i) * 10) / 10;
    const y = Math.round(yOf(v) * 10) / 10;
    d += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
    end = { x, y };
  });
  return { d, end, yOf, min, max };
}

/**
 * The share image as SVG, from ctx.latest / ctx.data (null without KHI data).
 * @param {any} ctx
 * @returns {string|null}
 */
export function ogSvg(ctx) {
  const { fmt, stats } = ctx;
  const k = ctx.latest?.khi;
  const khi = ctx.data?.khi;
  if (!k || !fmt.isNum(k.yoy) || !khi?.months?.length) return null;

  const i = khi.months.indexOf(k.month);
  const from = Math.max(0, i - 24);
  const values = khi.yoy.slice(from, i + 1);
  const months = khi.months.slice(from, i + 1);
  const box = { x: 680, y: 262, w: 440, h: 180 };
  const spark = sparkPath(values, box);

  const [number, unit] = fmt.pct(k.yoy).split(fmt.NBSP);
  // Long values (−0,2 or 10,4) get a smaller size so they never reach the chart.
  const big = number.length >= 4 ? 168 : 210;
  const dir = stats.deltaClass(k.delta) ?? 'flat';
  const deltaText = fmt.isNum(k.delta)
    ? `${fmt.pp(k.delta)} ${fmt.elative(k.prevMonth, { year: false })} (${fmt.pct(k.prevYoy)})`
    : '';
  const arrow =
    dir === 'up'
      ? `<path d="M80 486 L96 458 L112 486 Z" fill="${C.up}"/>`
      : dir === 'down'
        ? `<path d="M80 460 L112 460 L96 488 Z" fill="${C.down}"/>`
        : '';
  const deltaX = dir === 'flat' ? 80 : 126;
  const eyebrow = `Inflaatio Suomessa · ${fmt.monthName(k.month)}`.toUpperCase();
  const updated = k.updated ? ` · Päivitetty ${fmt.date(k.updated)}` : '';
  const ref = (v, color, dash) => {
    if (v < spark.min || v > spark.max) return '';
    const y = Math.round(spark.yOf(v) * 10) / 10;
    return `<line x1="${box.x}" x2="${box.x + box.w}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="2"${dash ? ' stroke-dasharray="10 8"' : ''}/>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="Inter">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${C.bg}"/>
<rect width="${OG_WIDTH}" height="10" fill="${C.brand}"/>
<text x="80" y="104" font-size="40" font-weight="700" fill="${C.text}">Inflaatio<tspan fill="${C.brand}">.fi</tspan></text>
<text x="1120" y="104" font-size="26" font-weight="500" fill="${C.text3}" text-anchor="end">Kuluttajahintaindeksi (KHI)</text>
<text x="80" y="214" font-size="30" font-weight="600" fill="${C.text2}" letter-spacing="2">${xmlEscape(eyebrow)}</text>
<text x="72" y="408" font-size="${big}" font-weight="700" fill="${C.text}" letter-spacing="${-Math.round(big / 26)}">${xmlEscape(number)}<tspan font-size="${Math.round(big * 0.57)}" font-weight="600" fill="${C.text2}" dx="${Math.round(big / 10)}" letter-spacing="0">${xmlEscape(unit ?? '')}</tspan></text>
${arrow}
<text x="${deltaX}" y="484" font-size="32" font-weight="500" fill="${C[dir]}">${xmlEscape(deltaText)}</text>
${ref(0, C.border, false)}
${ref(2, C.target, true)}
<line x1="${box.x + box.w / 2 - 92}" x2="${box.x + box.w / 2 - 62}" y1="${box.y + box.h + 36}" y2="${box.y + box.h + 36}" stroke="${C.target}" stroke-width="2" stroke-dasharray="10 8"/>
<text x="${box.x + box.w / 2 - 52}" y="${box.y + box.h + 44}" font-size="22" fill="${C.target}">tavoite 2 %</text>
<path d="${spark.d}" fill="none" stroke="${C.brand}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
${spark.end ? `<circle cx="${spark.end.x}" cy="${spark.end.y}" r="11" fill="${C.brand}" stroke="${C.bg}" stroke-width="4"/>` : ''}
<text x="${box.x}" y="${box.y + box.h + 44}" font-size="22" fill="${C.text3}">${xmlEscape(fmt.monthShort(months[0]))}</text>
<text x="${box.x + box.w}" y="${box.y + box.h + 44}" font-size="22" fill="${C.text3}" text-anchor="end">${xmlEscape(fmt.monthShort(months.at(-1)))}</text>
<line x1="80" x2="1120" y1="534" y2="534" stroke="${C.border}" stroke-width="2"/>
<text x="80" y="584" font-size="24" fill="${C.text2}">${xmlEscape(`Kuluttajahintojen vuosimuutos · Lähde: Tilastokeskus${updated}`)}</text>
<text x="1120" y="584" font-size="26" font-weight="600" fill="${C.brand}" text-anchor="end">inflaatio.fi</text>
</svg>`;
}

/**
 * Generic share image without figures (the committed fallback).
 * @returns {string}
 */
export function ogFallbackSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" font-family="Inter">
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${C.bg}"/>
<rect width="${OG_WIDTH}" height="10" fill="${C.brand}"/>
<text x="80" y="104" font-size="40" font-weight="700" fill="${C.text}">Inflaatio<tspan fill="${C.brand}">.fi</tspan></text>
<text x="80" y="250" font-size="30" font-weight="600" fill="${C.text2}" letter-spacing="2">SUOMEN VIRALLISET INFLAATIOLUVUT</text>
<text x="76" y="370" font-size="104" font-weight="700" fill="${C.text}" letter-spacing="-3">Inflaatio Suomessa</text>
<text x="80" y="444" font-size="34" font-weight="500" fill="${C.text2}">Kuluttajahintaindeksi, YKHI, laskurit ja avoin data</text>
<line x1="80" x2="1120" y1="534" y2="534" stroke="${C.border}" stroke-width="2"/>
<text x="80" y="584" font-size="24" fill="${C.text2}">Lähteet: Tilastokeskus ja Eurostat</text>
<text x="1120" y="584" font-size="26" font-weight="600" fill="${C.brand}" text-anchor="end">inflaatio.fi</text>
</svg>`;
}

/**
 * Rasterise an SVG to PNG with resvg and the bundled Inter fonts.
 * @param {string} svg
 * @returns {Promise<Buffer>}
 */
export async function renderPng(svg) {
  const mod = await import('@resvg/resvg-js');
  const Resvg = mod.Resvg ?? mod.default?.Resvg;
  if (typeof Resvg !== 'function') throw new Error('@resvg/resvg-js has no Resvg export');
  const require = createRequire(import.meta.url);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-og-'));
  try {
    const fontFiles = [];
    for (const spec of FONT_FILES) {
      const file = path.join(dir, `${path.basename(spec, '.woff')}.ttf`);
      await fs.writeFile(file, woffToSfnt(await fs.readFile(require.resolve(spec))));
      fontFiles.push(file);
    }
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: OG_WIDTH },
      font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter' },
      logLevel: 'off',
    })
      .render()
      .asPng();
    const size = pngSize(png);
    if (!size || size.width !== OG_WIDTH || size.height !== OG_HEIGHT) throw new Error('unexpected PNG size');
    return png;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** @param {any} ctx */
export default async function og(ctx) {
  const svg = ogSvg(ctx) ?? ogFallbackSvg();
  let body;
  try {
    body = await renderPng(svg);
  } catch (err) {
    console.warn(`[og] Share image could not be rasterised (${err.message}); publishing src/static/og/fallback.png instead.`);
    try {
      body = await fs.readFile(FALLBACK_FILE);
    } catch {
      console.warn('[og] Fallback image src/static/og/fallback.png is missing; no share image was written.');
      return [];
    }
  }
  return [{ path: OG_PATH, body }];
}
