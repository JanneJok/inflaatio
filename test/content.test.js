/**
 * Rules of the hand-maintained content that the monthly content routine
 * (docs/SISALTOAGENTTI.md) proposes changes to in pull requests: the inflation
 * forecasts (src/content/ennusteet.json) and the chart event notes
 * (src/content/tapahtumat.json). CI runs these on every pull request, so a
 * proposal that breaks a rule cannot be merged by accident. Also the
 * freshness rules of the forecasts (home-model.js), the reminder script
 * (scripts/check-content.js) and the ECB rate markers of the home chart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fmt from '../src/js/lib/format.js';
import { currentForecasts, rateMarkers, daysBetween, FORECAST_MAX_AGE_DAYS, FORECAST_REMIND_DAYS } from '../src/js/charts/home-model.js';
import { checkForecasts } from '../scripts/check-content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Today in Helsinki; content may never be dated after it (the check only gets stricter over time). */
const TODAY = fmt.isoDate();

/* -------------------------------------------------------------- forecasts */

/**
 * Publishers whose forecasts are shown, and the only hosts their links may
 * point to (the publisher's own publication). A new publisher is added here
 * deliberately, after checking its terms of use.
 */
const PUBLISHERS = Object.freeze({
  'Suomen Pankki': ['www.eurojatalous.fi', 'www.suomenpankki.fi'],
  Valtiovarainministeriö: ['vm.fi', 'julkaisut.valtioneuvosto.fi'],
  'Euroopan keskuspankki (EKP)': ['www.ecb.europa.eu'],
});
/** Numbers, dates, a title and a link: no other fields (no text copied from the publication). */
const FORECAST_FIELDS = ['area', 'label', 'measure', 'org', 'published', 'title', 'url', 'values', 'verified'];

test('ennusteet.json: numbers with the publisher, date and a link to the original, nothing else', () => {
  const list = readJson('src/content/ennusteet.json');
  assert.ok(Array.isArray(list));
  const seen = new Set();
  for (const f of list) {
    const id = `${f.org} ${f.measure} ${f.area}`;
    assert.deepEqual(Object.keys(f).sort(), FORECAST_FIELDS, `${id}: fields`);
    assert.ok(Object.hasOwn(PUBLISHERS, f.org), `${id}: unknown publisher`);
    const url = new URL(f.url);
    assert.equal(url.protocol, 'https:', `${id}: https`);
    assert.ok(PUBLISHERS[f.org].includes(url.hostname), `${id}: link to the publisher's own site, not ${url.hostname}`);
    assert.ok(typeof f.title === 'string' && f.title.trim() === f.title && f.title.length >= 10 && f.title.length <= 120, `${id}: title`);
    assert.match(f.published, ISO_DATE, `${id}: published`);
    assert.match(f.verified, ISO_DATE, `${id}: verified`);
    assert.ok(f.published <= f.verified && f.verified <= TODAY, `${id}: published ≤ verified ≤ today`);
    assert.ok(['KHI', 'YKHI'].includes(f.measure), `${id}: measure`);
    assert.ok(['FI', 'EA'].includes(f.area), `${id}: area`);
    assert.ok(!(f.measure === 'KHI' && f.area === 'EA'), `${id}: KHI is a Finnish index`);
    // A euro area forecast is never shown as a Finnish figure.
    assert.equal(f.label, `${f.area === 'FI' ? 'Suomen' : 'Euroalueen'} inflaatio (${f.measure})`, `${id}: label`);
    const years = Object.keys(f.values);
    const year = Number(f.published.slice(0, 4));
    assert.ok(years.length >= 1 && years.length <= 4, `${id}: 1–4 years`);
    years.forEach((y, i) => {
      assert.match(y, /^\d{4}$/);
      assert.equal(Number(y), Number(years[0]) + i, `${id}: consecutive years, oldest first`);
    });
    assert.ok(Number(years[0]) >= year - 1 && Number(years.at(-1)) <= year + 4, `${id}: years around the publication year`);
    for (const [y, v] of Object.entries(f.values)) {
      assert.ok(fmt.isNum(v) && v > -5 && v < 30, `${id} ${y}: ${v}`);
      assert.equal(fmt.round(v, 1), v, `${id} ${y}: one decimal, as published`);
    }
    assert.ok(!seen.has(id), `${id}: one entry per publisher, measure and area (replace the old one)`);
    seen.add(id);
  }
});

test('currentForecasts: the newest of each kind, nothing over 7 months old, no years with an official figure', () => {
  const f = (org, published, values, extra = {}) => ({ org, published, measure: 'YKHI', area: 'FI', values, ...extra });
  const list = [
    f('A', '2026-03-10', { 2026: 2.0, 2027: 1.8 }),
    f('A', '2026-09-10', { 2026: 2.4, 2027: 1.9, 2028: 2.0 }),
    f('B', '2026-01-15', { 2026: 1.5, 2027: 1.6 }),
    f('C', '2026-06-01', { 2026: 2.2, 2027: null }, { measure: 'KHI' }),
    f('A', '2026-06-01', { 2026: 2.1 }, { area: 'EA' }),
    { org: 'D', published: 'syyskuu', values: { 2026: 1 } },
  ];
  const now = currentForecasts(list, { today: '2026-09-29', lastYear: 2025 });
  assert.deepEqual(now.shown.map((x) => [x.org, x.area, x.published]), [['A', 'FI', '2026-09-10'], ['C', 'FI', '2026-06-01'], ['A', 'EA', '2026-06-01']]);
  assert.deepEqual(now.shown[1].values, { 2026: 2.2 }, 'missing values are left out');
  assert.deepEqual(now.stale.map((x) => x.org), ['B']);
  assert.deepEqual(now.years, ['2026', '2027', '2028']);
  // February 2027: the official 2026 figure is out and the June forecasts are too old.
  const later = currentForecasts(list, { today: '2027-02-20', lastYear: 2026 });
  assert.deepEqual(later.shown.map((x) => [x.org, x.values]), [['A', { 2027: 1.9, 2028: 2.0 }]]);
  assert.deepEqual(later.stale.map((x) => `${x.org} ${x.area}`), ['B FI', 'C FI', 'A EA']);
  assert.deepEqual(later.years, ['2027', '2028']);
  // The limit day itself still shows the forecast; without a date nothing is hidden.
  const edge = fmt.isoDate(Date.parse('2026-01-15T12:00:00Z') + FORECAST_MAX_AGE_DAYS * 86400000);
  assert.equal(daysBetween('2026-01-15', edge), FORECAST_MAX_AGE_DAYS);
  assert.deepEqual(currentForecasts([list[2]], { today: edge }).stale, []);
  assert.equal(currentForecasts(list, { today: null }).stale.length, 0);
  assert.deepEqual(currentForecasts(undefined, { today: '2026-09-29' }), { shown: [], stale: [], years: [] });
});

test('check-content: reminder when even the newest forecast is over 4 months old or one has dropped off the page', () => {
  const a = { org: 'A', published: '2026-09-10', measure: 'YKHI', area: 'FI', values: { 2026: 2.4 } };
  const b = { org: 'B', published: '2026-01-15', measure: 'YKHI', area: 'EA', values: { 2026: 2.0 } };
  const fresh = checkForecasts([a], '2026-09-29');
  assert.equal(fresh.ok, true);
  assert.match(fresh.report, /^## Ennusteiden tuoreus 29\.9\.2026\n/);
  assert.match(fresh.report, /Kaikki ennusteet ovat ajan tasalla\./);
  assert.match(fresh.report, /\| A \| YKHI \| FI \| 10\.9\.2026 \| 19 \| kyllä \|/);

  const dropped = checkForecasts([a, b], '2026-09-29');
  assert.equal(dropped.ok, false);
  assert.deepEqual(dropped.problems, [`B (YKHI, EA) ei enää näy etusivulla: ennuste on julkaistu 15.1.2026 eli 257 päivää sitten (raja ${FORECAST_MAX_AGE_DAYS} päivää).`]);
  assert.match(dropped.report, /\| B \| YKHI \| EA \| 15\.1\.2026 \| 257 \| ei \(liian vanha\) \|/);
  assert.match(dropped.report, /docs\/SISALTOAGENTTI\.md/);

  const quiet = checkForecasts([a], '2027-01-20');
  assert.equal(daysBetween(a.published, '2027-01-20'), 132);
  assert.equal(quiet.ok, false);
  assert.match(quiet.problems[0], new RegExp(`^Uusin ennuste \\(A\\) on julkaistu 10\\.9\\.2026 eli 132 päivää sitten\\. Uusia ennusteita ei ole tullut ${FORECAST_REMIND_DAYS} päivään\\.$`));

  const none = checkForecasts([], '2026-09-29');
  assert.equal(none.ok, true, 'an empty file is a choice');
  assert.match(none.report, /ennusteosio on piilossa/);
});

test('check-content CLI: report on stdout and in --report, exit code from the check', () => {
  const list = readJson('src/content/ennusteet.json');
  const today = list.map((f) => f.published).sort().at(-1) ?? TODAY;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'inflaatio-content-'));
  try {
    const out = path.join(dir, 'report.md');
    const run = spawnSync(process.execPath, ['scripts/check-content.js', '--today', today, '--report', out], { cwd: ROOT, encoding: 'utf8' });
    const expected = checkForecasts(list, today);
    assert.equal(run.status, expected.ok ? 0 : 1, run.stderr);
    assert.equal(run.stdout, expected.report);
    assert.equal(readFileSync(out, 'utf8'), expected.report);
    const bad = spawnSync(process.execPath, ['scripts/check-content.js', '--today', '29.9.2026'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(bad.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ----------------------------------------------------------------- events */

test('tapahtumat.json: month precision, short neutral labels, one per month, sorted', () => {
  const ev = readJson('src/content/tapahtumat.json');
  assert.ok(ev.length >= 15 && ev.length <= 40, `${ev.length} events`);
  for (const e of ev) {
    assert.deepEqual(Object.keys(e).sort(), ['label', 'month', 'text'], e.month);
    assert.match(e.month, /^\d{4}-(0[1-9]|1[0-2])$/);
    assert.ok(e.month >= '1980-01' && e.month <= TODAY.slice(0, 7), `${e.month}: only events that have happened`);
    assert.ok(e.label.length >= 3 && e.label.length <= 24, e.label);
    assert.ok(e.text.length > 20 && e.text.length <= 220 && /\.$/.test(e.text), e.text);
    // "12 %", "ALV 10 % → 14 %": a no-break space before the per cent sign.
    assert.doesNotMatch(`${e.label} ${e.text}`, / %/, `${e.month}: no-break space before %`);
  }
  const months = ev.map((e) => e.month);
  assert.deepEqual(months, [...months].sort(), 'oldest first');
  assert.equal(new Set(months).size, months.length, 'one event per month');
});

test('tapahtumat.json: ECB facts agree with data/korot.json', () => {
  const ev = readJson('src/content/tapahtumat.json');
  const dec = readJson('data/korot.json').decisions;
  const cuts = dec.filter((d, i) => i > 0 && d.date >= '2024-06-01' && d.date <= '2025-06-30' && d.depositRate < dec[i - 1].depositRate);
  assert.equal(cuts.length, 8);
  assert.match(ev.find((e) => e.month === '2025-06').text, /kahdeksas lasku kesäkuusta 2024 alkaen/);
  const hike = dec.findIndex((d) => d.date === '2022-07-27');
  assert.equal(dec[hike - 1].depositRate, -0.5);
  assert.equal(dec[hike].depositRate, 0);
  assert.match(ev.find((e) => e.month === '2022-07').text, /talletuskorko nousi −0,50 prosentista nollaan 27\.7\.2022/);
});

/* ------------------------------------------------------ ECB rate markers */

test('rateMarkers: one marker per month in which the deposit rate changed, with its tooltip text', () => {
  const dec = [
    { date: '2008-07-09', depositRate: 3.25 },
    { date: '2008-10-08', depositRate: 2.75 },
    { date: '2008-10-09', depositRate: 3.25 }, // corridor narrowed: back to 3.25 within the month
    { date: '2008-11-12', depositRate: 2.75 },
    { date: '2019-09-18', depositRate: -0.5 },
    { date: '2022-07-27', depositRate: 0 },
  ];
  const all = rateMarkers(dec, '1999-01', '2026-08');
  assert.deepEqual(all.map((m) => [m.month, m.dir]), [['2008-11', 'down'], ['2019-09', 'down'], ['2022-07', 'up']]);
  assert.equal(all[2].text, `EKP nosti talletuskorkoa: −0,50${fmt.NBSP}% → 0,00${fmt.NBSP}% (27.7.2022 alkaen).`);
  assert.equal(all[0].text, `EKP laski talletuskorkoa: 3,25${fmt.NBSP}% → 2,75${fmt.NBSP}% (12.11.2008 alkaen).`);
  assert.deepEqual(rateMarkers([...dec].reverse(), '2010-01', '2020-12').map((m) => m.month), ['2019-09'], 'range; input order does not matter');
  assert.deepEqual(rateMarkers(undefined, '1999-01', '2026-08'), []);

  // The real decisions: every month with a net change, nothing else.
  const real = readJson('data/korot.json').decisions;
  const markers = rateMarkers(real, '1999-01', '2099-12');
  const byMonth = new Map(markers.map((m) => [m.month, m.dir]));
  assert.equal(byMonth.get('2026-06'), 'up');
  assert.equal(byMonth.get('2025-06'), 'down');
  assert.ok(!byMonth.has('1999-01') && !byMonth.has('2008-10'), 'changes reversed within the month');
  assert.equal(markers.length, new Set(real.slice(1).map((d) => d.date.slice(0, 7))).size - 2);
  for (const m of markers) assert.match(m.text, /^EKP (nosti|laski) talletuskorkoa: .+ → .+ \(\d{1,2}\.\d{1,2}\.\d{4} alkaen\)\.$/);
});
