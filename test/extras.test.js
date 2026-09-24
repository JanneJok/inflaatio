/**
 * EXTRAS modules: open data CSV/JSON (/data/), share image (/og/inflaatio.png),
 * English page (/en/), embeddable widget (/upotus/, /upotus/ohje/) and 404.
 * Unit tests for the generators plus one partial build of the five modules.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as fmt from '../src/js/lib/format.js';
import { csvNum, csvCell, toCsv, khiCsv, khiAnnualCsv, ykhiCsv, ekiCsv, fileSize, CSV_BOM } from '../src/pages/data.js';
import { woffToSfnt, pngSize, FALLBACK_FILE, OG_WIDTH, OG_HEIGHT, sparkPath, xmlEscape } from '../src/pages/og.js';
import { enMonth, enMonthShort, enNum, enPct, enPp, enDate, enLevelSentence, enDeltaSentence } from '../src/pages/en.js';
import { embedCode, WIDGET_HEIGHT } from '../src/pages/upotus.js';
import { latestSentence } from '../src/pages/notfound.js';
import { build, cspProblems } from '../scripts/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readData = (name) => JSON.parse(readFileSync(path.join(ROOT, 'data', `${name}.json`), 'utf8'));
const MINUS = '−';

/** Lines of a CSV body without the BOM and the final empty line. */
function csvLines(body) {
  assert.ok(body.startsWith(CSV_BOM), 'CSV starts with the UTF-8 BOM');
  assert.ok(body.endsWith('\r\n'), 'CSV ends with CRLF');
  const lines = body.slice(1).split('\r\n');
  assert.equal(lines.pop(), '');
  return lines;
}

/** Common checks: separator count, decimal comma, ASCII minus. */
function checkCsvCells(lines, columns) {
  for (const line of lines) {
    const cells = line.split(';');
    assert.equal(cells.length, columns, `column count in "${line.slice(0, 60)}"`);
    for (const cell of cells.slice(1)) {
      assert.ok(!cell.includes(MINUS), 'negative numbers use ASCII hyphen-minus');
      if (/^-?\d/.test(cell)) assert.match(cell, /^-?\d+(,\d+)?$/, `number with decimal comma: ${cell}`);
    }
  }
}

describe('data.js – CSV helpers', () => {
  test('csvNum: decimal comma, ASCII minus, empty for missing', () => {
    assert.equal(csvNum(2.2, 1), '2,2');
    assert.equal(csvNum(-0.2, 1), '-0,2');
    assert.equal(csvNum(2, 1), '2,0');
    assert.equal(csvNum(101.95, 2), '101,95');
    assert.equal(csvNum(2385), '2385');
    assert.equal(csvNum(-0.04, 1), '0,0');
    assert.equal(csvNum(null, 1), '');
    assert.equal(csvNum(undefined), '');
    assert.equal(csvNum(Number.NaN, 1), '');
  });

  test('csvCell quotes only when needed, toCsv adds BOM and CRLF', () => {
    assert.equal(csvCell('abc'), 'abc');
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('say "x"'), '"say ""x"""');
    assert.equal(csvCell(null), '');
    assert.equal(toCsv(['A', 'B'], [['1', '2,5']]), `${CSV_BOM}A;B\r\n1;2,5\r\n`);
  });

  test('fileSize in Finnish kilobytes', () => {
    assert.equal(fileSize(900, fmt), `0,9${fmt.NBSP}kt`);
    assert.equal(fileSize(52_000, fmt), `51${fmt.NBSP}kt`);
    assert.equal(fileSize(3 * 1024 * 1024, fmt), `3,0${fmt.NBSP}Mt`);
  });
});

describe('data.js – CSV files from the committed data', () => {
  test('khi.csv: one row per month, every base, official vs calculated monthly change', () => {
    const khi = readData('khi');
    const { header, body } = khiCsv(khi);
    const lines = csvLines(body);
    assert.equal(lines[0], header.join(';'));
    assert.equal(lines.length - 1, khi.months.length, 'rows = months');
    assert.equal(header.length, 4 + Object.keys(khi.index).length);
    assert.ok(header.includes('Pisteluku 2025=100') && header.includes('Pisteluku 1972=100'));
    checkCsvCells(lines.slice(1), header.length);
    // Latest row equals the data (formatted, not hard-coded).
    const i = khi.months.length - 1;
    const last = lines.at(-1).split(';');
    assert.equal(last[0], khi.months[i]);
    assert.equal(last[1], khi.yoy[i].toFixed(1).replace('.', ','));
    assert.equal(last[2], khi.mom[i].toFixed(1).replace('.', ','));
    assert.equal(last[3], 'virallinen');
    assert.equal(last[header.indexOf('Pisteluku 2025=100')], khi.index['2025=100'][i].toFixed(2).replace('.', ','));
    // Monthly change before momOfficialFrom is marked as calculated.
    const early = lines[1 + khi.months.indexOf('1990-01')].split(';');
    assert.equal(early[3], 'laskettu');
    // Missing values are empty fields (1972: no annual change yet).
    assert.equal(lines[1].split(';')[1], '');
  });

  test('khi-vuosi.csv: one row per official year', () => {
    const ka = readData('khi-annual');
    const { header, body } = khiAnnualCsv(ka);
    const lines = csvLines(body);
    assert.equal(lines.length - 1, ka.years.length);
    assert.equal(header[0], 'Vuosi');
    checkCsvCells(lines.slice(1), header.length);
  });

  test('ykhi.csv: Finland and euro area, rows = months, flags → ennakko', () => {
    const y = readData('ykhi');
    const { header, body } = ykhiCsv(y);
    const lines = csvLines(body);
    assert.equal(lines.length - 1, y.months.length);
    assert.ok(header.includes('Suomi vuosimuutos (%)') && header.includes('Euroalue vuosimuutos (%)'));
    checkCsvCells(lines.slice(1), header.length);

    const fixture = {
      months: ['2026-07', '2026-08'],
      geo: { FI: { yoy: [2.5, 2.4], mom: [0.2, -0.3], coreYoy: [1.5, null], index: { '2025=100': [102.71, null] } } },
      flags: { FI: { '2026-08': 'p' } },
    };
    const f = ykhiCsv(fixture);
    assert.deepEqual(f.header, ['Kuukausi', 'Suomi vuosimuutos (%)', 'Suomi kuukausimuutos (%)', 'Suomi pohjainflaatio (%)', 'Suomi pisteluku 2025=100', 'Suomi tila']);
    assert.deepEqual(f.rows, [
      ['2026-07', '2,5', '0,2', '1,5', '102,71', ''],
      ['2026-08', '2,4', '-0,3', '', '', 'ennakko'],
    ]);
  });

  test('elinkustannusindeksi.csv: both monthly series on one month axis', () => {
    const eki = readData('elinkustannusindeksi');
    const { months, body, header } = ekiCsv(eki, fmt);
    const lines = csvLines(body);
    const first = [eki.monthly.months[0], eki.monthly1939.months[0]].sort()[0];
    assert.equal(months[0], first);
    assert.equal(lines.length - 1, fmt.ymDiff(first, eki.monthly.months.at(-1)) + 1, 'rows = months of the union');
    checkCsvCells(lines.slice(1), header.length);
    const row = lines[1 + months.indexOf(eki.monthly.months.at(-1))].split(';');
    assert.equal(row[1], String(eki.monthly.values.at(-1)));

    const small = ekiCsv(
      { monthly: { base: 'A', months: ['2000-02', '2000-03'], values: [11, 12] }, monthly1939: { base: 'B', months: ['2000-01', '2000-02'], values: [1, 2] } },
      fmt,
    );
    assert.deepEqual(small.rows, [
      ['2000-01', '', '1'],
      ['2000-02', '11', '2'],
      ['2000-03', '12', ''],
    ]);
  });
});

describe('og.js – share image helpers', () => {
  test('woffToSfnt unpacks the bundled Inter WOFF into a valid sfnt', () => {
    const require = createRequire(import.meta.url);
    const woff = readFileSync(require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff'));
    const sfnt = woffToSfnt(woff);
    const version = sfnt.readUInt32BE(0);
    assert.ok(version === 0x00010000 || version === 0x4f54544f, 'TrueType or CFF flavour');
    const numTables = sfnt.readUInt16BE(4);
    assert.equal(numTables, woff.readUInt16BE(12));
    const tags = [];
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      const tag = sfnt.toString('latin1', rec, rec + 4);
      const offset = sfnt.readUInt32BE(rec + 8);
      const length = sfnt.readUInt32BE(rec + 12);
      assert.equal(offset % 4, 0, `${tag} is 4-byte aligned`);
      assert.ok(offset + length <= sfnt.length, `${tag} inside the file`);
      tags.push(tag);
    }
    for (const t of ['cmap', 'head', 'hhea', 'hmtx', 'name', 'OS/2']) assert.ok(tags.includes(t), `table ${t}`);
    assert.equal(sfnt.toString('latin1', 12 + tags.indexOf('head') * 16, 12 + tags.indexOf('head') * 16 + 4), 'head');
    assert.throws(() => woffToSfnt(Buffer.from('not a font at all, just text…')), /WOFF/);
  });

  test('committed fallback PNG is 1200×630', () => {
    assert.ok(existsSync(FALLBACK_FILE), 'src/static/og/fallback.png exists');
    assert.deepEqual(pngSize(readFileSync(FALLBACK_FILE)), { width: OG_WIDTH, height: OG_HEIGHT });
    assert.equal(pngSize(Buffer.from('GIF89a')), null);
  });

  test('sparkPath scales into the box and skips gaps; xmlEscape', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    const s = sparkPath([1, null, 3], box);
    assert.match(s.d, /^M0 [\d.]+M100 [\d.]+$/);
    assert.equal(s.end.x, 100);
    assert.ok(s.yOf(2) > 0 && s.yOf(2) < 50);
    assert.equal(xmlEscape('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  });
});

describe('en.js – English formatting', () => {
  test('numbers, percentages and percentage points', () => {
    assert.equal(enPct(2.2), '2.2%');
    assert.equal(enPct(-0.2), `${MINUS}0.2%`);
    assert.equal(enPct(0.4, { sign: true }), '+0.4%');
    assert.equal(enPct(null), '–');
    assert.equal(enNum(2385, 0), '2,385');
    assert.equal(enNum(-0.04, 1), '0.0');
    assert.equal(enPp(0.1), '+0.1 pp');
    assert.equal(enPp(-0.3), `${MINUS}0.3 pp`);
    assert.equal(enPp(0), '±0.0 pp');
  });

  test('months, dates and sentences', () => {
    assert.equal(enMonth('2026-08'), 'August 2026');
    assert.equal(enMonthShort('2026-09'), 'Sep 2026');
    assert.equal(enMonthShort('2026-09', { year: false }), 'Sep');
    assert.equal(enDate('2026-09-14T05:00:00Z'), '14 September 2026');
    assert.equal(enDate('2026-10-14'), '14 October 2026');
    assert.equal(enLevelSentence(2.2, '2026-08'), 'Consumer prices in Finland were 2.2% higher in August 2026 than a year earlier');
    assert.match(enLevelSentence(-0.2, '2025-10'), /0\.2% lower in October 2025/);
    assert.equal(enDeltaSentence(0.1, 2.1, '2026-07'), 'Inflation accelerated from 2.1% in July 2026.');
    assert.equal(enDeltaSentence(-0.5, 0.5, '2025-09'), 'Inflation slowed from 0.5% in September 2025.');
    assert.equal(enDeltaSentence(null, 2.1, '2026-07'), '');
  });
});

describe('upotus.js / notfound.js helpers', () => {
  test('embed code', () => {
    const code = embedCode('https://inflaatio.fi');
    assert.match(code, /^<iframe src="https:\/\/inflaatio\.fi\/upotus\/" width="320" height="140" /);
    assert.match(code, /title="Inflaatio Suomessa – Inflaatio\.fi"/);
    assert.match(embedCode('https://inflaatio.fi', { theme: 'tumma', width: 'full' }), /src="https:\/\/inflaatio\.fi\/upotus\/\?teema=tumma" width="100%"/);
    assert.equal(WIDGET_HEIGHT, 140);
  });

  test('404 sentence with month and source', () => {
    assert.equal(latestSentence(fmt, { month: '2026-08', yoy: 2.2 }), `Elokuussa 2026 kuluttajahinnat olivat 2,2${fmt.NBSP}% korkeammat kuin vuotta aiemmin (Tilastokeskus).`);
    assert.match(latestSentence(fmt, { month: '2025-10', yoy: -0.2 }), /matalammat/);
  });
});

describe('partial build of the EXTRAS modules', () => {
  let tmp;
  let out;
  let result;
  const read = (p) => readFileSync(path.join(out, ...(p.endsWith('/') ? `${p}index.html` : p).split('/').filter(Boolean)), 'utf8');

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-extras-'));
    out = path.join(tmp, 'dist');
    result = await build({ out, only: ['en', 'upotus', 'data', 'notfound', 'og'], quiet: true });
  });

  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  test('pages and files are produced without warnings', () => {
    for (const p of ['/en/', '/upotus/', '/upotus/ohje/', '/data/', '/404.html']) assert.ok(result.pages.includes(p), p);
    for (const f of ['/og/inflaatio.png', '/data/khi.csv', '/data/khi-vuosi.csv', '/data/ykhi.csv', '/data/elinkustannusindeksi.csv', '/data/latest.json', '/data/json/khi.json']) {
      assert.ok(result.files.includes(f), f);
    }
    assert.deepEqual(result.warnings, [], 'titles ≤ 60 and descriptions ≤ 155 characters');
    for (const p of result.pages) assert.deepEqual(cspProblems(read(p)), [], p);
  });

  test('OG image: PNG signature and 1200×630 (IHDR)', () => {
    const png = readFileSync(path.join(out, 'og', 'inflaatio.png'));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  });

  test('404 and widget are noindex and not in the sitemap', () => {
    const notFound = read('/404.html');
    assert.match(notFound, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(notFound, /rel="canonical"/);
    assert.match(notFound, /<h1>Sivua ei löytynyt<\/h1>/);
    for (const href of ['/', '/inflaatio/', '/laskurit/', '/hinnat/']) assert.ok(notFound.includes(`href="${href}"`), href);

    const widget = read('/upotus/');
    assert.match(widget, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(widget, /class="site-header"|class="site-footer"|id="evasteilmoitus"/, 'bare layout');
    assert.match(widget, /<a href="https:\/\/inflaatio\.fi\/" target="_blank" rel="noopener">Lähde: Inflaatio\.fi · Tilastokeskus<\/a>/);
    assert.match(widget, /role="img" aria-label="Vuosimuutos kuukausittain/);

    const sitemap = read('/sitemap.xml');
    assert.doesNotMatch(sitemap, /404\.html|\/upotus\/<\/loc>/);
    for (const p of ['/data/', '/en/', '/upotus/ohje/']) assert.ok(sitemap.includes(`<loc>https://inflaatio.fi${p}</loc>`), p);
  });

  test('widget theme script runs as a classic script (no imports)', () => {
    const widget = read('/upotus/');
    const m = widget.match(/<script src="(\/assets\/pages\/upotus-ohje-[A-Z0-9]+\.js)" data-upotus="widget"><\/script>/);
    assert.ok(m, 'classic head script with data-upotus="widget"');
    const js = read(m[1]);
    assert.doesNotMatch(js, /\bimport\s*[{*("'\w]|\bexport\s*[{*\w]/);
    assert.ok(js.includes('teema'));
  });

  test('instructions page: code block, copy tracking, preview', () => {
    const page = read('/upotus/ohje/');
    assert.match(page, /<code id="upotuskoodi">&lt;iframe src=&quot;https:\/\/inflaatio\.fi\/upotus\/&quot;/);
    assert.match(page, /data-copy-target="#upotuskoodi"[^>]*data-track="widget_code_copied"|data-track="widget_code_copied"[^>]*data-copy-target="#upotuskoodi"/);
    assert.match(page, /<iframe class="embed-preview__frame" id="upotus-esikatselu" src="\/upotus\/"/);
    assert.match(page, /<script type="application\/json" id="upotus-koodit">/);
  });

  test('English page: lang, hreflang pairs, figures with month and source', () => {
    const page = read('/en/');
    assert.match(page, /<html lang="en">/);
    assert.match(page, /<link rel="alternate" hreflang="en" href="https:\/\/inflaatio\.fi\/en\/">/);
    assert.match(page, /<link rel="alternate" hreflang="fi" href="https:\/\/inflaatio\.fi\/">/);
    assert.match(page, /<link rel="alternate" hreflang="x-default" href="https:\/\/inflaatio\.fi\/">/);
    const khi = readData('khi');
    const month = enMonth(khi.months.at(-1));
    assert.ok(page.includes(`<h1>Inflation in Finland: ${enPct(khi.yoy.at(-1))} (${month})</h1>`));
    assert.ok(page.includes('href="/en/rent-increase-calculator/"') && page.includes('href="/en/value-of-money/"'));
  });

  test('open data: CSV files, JSON copies, latest.json and Dataset JSON-LD', () => {
    const csv = read('/data/khi.csv');
    assert.ok(csv.startsWith(CSV_BOM));
    assert.equal(csv.slice(1).split('\r\n').length - 2, readData('khi').months.length);
    assert.deepEqual(JSON.parse(read('/data/json/khi.json')), readData('khi'));
    assert.deepEqual(JSON.parse(read('/data/json/ykhi.json')), readData('ykhi'));

    const latest = JSON.parse(read('/data/latest.json'));
    const khi = readData('khi');
    assert.equal(latest.kuukausi, khi.months.at(-1));
    assert.equal(latest.khi.vuosimuutos, khi.yoy.at(-1));
    assert.ok(['ennakko', 'lopullinen'].includes(latest.ykhi.tila));

    const page = read('/data/');
    const ld = [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    const datasets = ld.filter((d) => d['@type'] === 'Dataset');
    assert.ok(datasets.length >= 4);
    for (const d of datasets) {
      assert.ok(d.description.length >= 50, 'Dataset description ≥ 50 chars');
      assert.ok(d.distribution.some((x) => x.encodingFormat === 'text/csv' && x.contentUrl.startsWith('https://inflaatio.fi/data/')));
    }
    assert.match(page, /data-track="csv_download"/);
    assert.match(page, /Näin viittaat/);
  });
});
