import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/js/lib/format.js';

const NB = ' ';
const MI = '−';
const DASH = '–';
/** '%-yks.' with the non-breaking hyphen U+2011. */
const PPU = '%‑yks.';

test('constants are the expected code points', () => {
  assert.equal(f.NBSP.charCodeAt(0), 0x00a0);
  assert.equal(f.MINUS.charCodeAt(0), 0x2212);
  assert.equal(f.DASH.charCodeAt(0), 0x2013);
  assert.equal(f.NB_HYPHEN.charCodeAt(0), 0x2011);
  assert.equal(f.PP_UNIT, PPU);
});

test('Intl fi-FI in this runtime uses U+2212 minus and NBSP grouping', () => {
  const s = new Intl.NumberFormat('fi-FI', { minimumFractionDigits: 1 }).format(-1234.5);
  assert.equal(s, `${MI}1${NB}234,5`);
});

test('round: half away from zero, float noise, no negative zero', () => {
  assert.equal(f.round(2.25, 1), 2.3);
  assert.equal(f.round(-2.25, 1), -2.3);
  assert.equal(f.round(1.005, 2), 1.01);
  assert.equal(f.round(0.15, 1), 0.2);
  assert.equal(f.round(2.1499999999999995, 1), 2.2); // noisy 2.15
  assert.equal(f.round(2.2 - 2.1, 1), 0.1);
  assert.ok(Object.is(f.round(-0.04, 1), 0));
  assert.ok(Object.is(f.round(-0, 1), 0));
  assert.equal(f.round(1234.5), 1235);
  assert.equal(f.round(null), null);
  assert.equal(f.round(NaN, 1), null);
  assert.equal(f.round('2.2', 1), null);
});

test('pct', () => {
  assert.equal(f.pct(2.2), `2,2${NB}%`);
  assert.equal(f.pct(2.2, { sign: true }), `+2,2${NB}%`);
  assert.equal(f.pct(-0.2), `${MI}0,2${NB}%`);
  assert.equal(f.pct(-0.2, { sign: true }), `${MI}0,2${NB}%`);
  assert.equal(f.pct(0), `0,0${NB}%`);
  assert.equal(f.pct(0, { sign: true }), `±0,0${NB}%`);
  assert.equal(f.pct(-0.04), `0,0${NB}%`, 'rounded negative zero has no minus');
  assert.equal(f.pct(-0.04, { sign: true }), `±0,0${NB}%`);
  assert.equal(f.pct(2.25), `2,3${NB}%`);
  assert.equal(f.pct(-2.25), `${MI}2,3${NB}%`);
  assert.equal(f.pct(7), `7,0${NB}%`, 'always fixed decimals (no "7 %")');
  assert.equal(f.pct(2.345, { decimals: 2 }), `2,35${NB}%`);
  assert.equal(f.pct(2.6, { decimals: 0 }), `3${NB}%`);
  assert.equal(f.pct(1234.5), `1${NB}234,5${NB}%`);
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, '2.2', {}]) {
    assert.equal(f.pct(bad), DASH, `pct(${String(bad)})`);
  }
});

test('pp (percentage points)', () => {
  assert.equal(f.pp(0.1), `+0,1${NB}${PPU}`);
  assert.equal(f.pp(-0.1), `${MI}0,1${NB}${PPU}`);
  assert.equal(f.pp(0), `±0,0${NB}${PPU}`);
  assert.equal(f.pp(0.04), `±0,0${NB}${PPU}`);
  assert.equal(f.pp(-0.04), `±0,0${NB}${PPU}`);
  assert.equal(f.pp(2.2 - 2.1), `+0,1${NB}${PPU}`, 'float noise');
  assert.equal(f.pp(1.7, { sign: false }), `1,7${NB}${PPU}`);
  assert.equal(f.pp(null), DASH);
  // The unit never breaks at its hyphen in running text (QV-10).
  assert.doesNotMatch(f.pp(0.1), /-/);
});

test('num, idx, eur', () => {
  assert.equal(f.num(1234), `1${NB}234`);
  assert.equal(f.num(12345678), `12${NB}345${NB}678`);
  assert.equal(f.num(1234567.891, 2), `1${NB}234${NB}567,89`);
  assert.equal(f.num(-5.55, 1), `${MI}5,6`);
  assert.equal(f.num(3, 1, { sign: true }), '+3,0');
  assert.equal(f.num(0), '0');
  assert.equal(f.num(undefined), DASH);
  assert.equal(f.idx(125.15), '125,15');
  assert.equal(f.idx(100), '100,00');
  assert.equal(f.idx(1234.567), `1${NB}234,57`);
  assert.equal(f.idx(null), DASH);
  assert.equal(f.eur(1234.56), `1${NB}234,56${NB}€`);
  assert.equal(f.eur(-5), `${MI}5,00${NB}€`);
  assert.equal(f.eur(12.4, 0), `12${NB}€`);
  assert.equal(f.eur(3.2, 2, { sign: true }), `+3,20${NB}€`);
  assert.equal(f.eur(NaN), DASH);
});

const MONTH_TABLE = [
  ['01', 'tammikuu', 'tammi', 'tammikuussa', 'tammikuusta', 'tammikuun', 'tammikuuhun', 'tammikuu'],
  ['02', 'helmikuu', 'helmi', 'helmikuussa', 'helmikuusta', 'helmikuun', 'helmikuuhun', 'helmikuu'],
  ['03', 'maaliskuu', 'maalis', 'maaliskuussa', 'maaliskuusta', 'maaliskuun', 'maaliskuuhun', 'maaliskuu'],
  ['04', 'huhtikuu', 'huhti', 'huhtikuussa', 'huhtikuusta', 'huhtikuun', 'huhtikuuhun', 'huhtikuu'],
  ['05', 'toukokuu', 'touko', 'toukokuussa', 'toukokuusta', 'toukokuun', 'toukokuuhun', 'toukokuu'],
  ['06', 'kesäkuu', 'kesä', 'kesäkuussa', 'kesäkuusta', 'kesäkuun', 'kesäkuuhun', 'kesakuu'],
  ['07', 'heinäkuu', 'heinä', 'heinäkuussa', 'heinäkuusta', 'heinäkuun', 'heinäkuuhun', 'heinakuu'],
  ['08', 'elokuu', 'elo', 'elokuussa', 'elokuusta', 'elokuun', 'elokuuhun', 'elokuu'],
  ['09', 'syyskuu', 'syys', 'syyskuussa', 'syyskuusta', 'syyskuun', 'syyskuuhun', 'syyskuu'],
  ['10', 'lokakuu', 'loka', 'lokakuussa', 'lokakuusta', 'lokakuun', 'lokakuuhun', 'lokakuu'],
  ['11', 'marraskuu', 'marras', 'marraskuussa', 'marraskuusta', 'marraskuun', 'marraskuuhun', 'marraskuu'],
  ['12', 'joulukuu', 'joulu', 'joulukuussa', 'joulukuusta', 'joulukuun', 'joulukuuhun', 'joulukuu'],
];

test('month names and inflections for all 12 months', () => {
  for (const [mm, nom, short, ine, ela, gen, ill, slug] of MONTH_TABLE) {
    const ym = `2026-${mm}`;
    assert.equal(f.monthName(ym), `${nom} 2026`);
    assert.equal(f.monthName(ym, { year: false }), nom);
    assert.equal(f.monthNameOnly(ym), nom);
    assert.equal(f.monthShort(ym), `${short} 2026`);
    assert.equal(f.monthShort(ym, { year: false }), short);
    assert.equal(f.inessive(ym), `${ine} 2026`);
    assert.equal(f.inessiveNoYear(ym), ine);
    assert.equal(f.elative(ym), `${ela} 2026`);
    assert.equal(f.elative(ym, { year: false }), ela);
    assert.equal(f.genitive(ym), `${gen} 2026`);
    assert.equal(f.genitive(ym, { year: false }), gen);
    assert.equal(f.illative(ym), `${ill} 2026`);
    assert.equal(f.monthSlug(ym), slug);
    assert.equal(f.monthFromSlug(slug), Number(mm));
    assert.equal(f.monthFromSlug(nom), Number(mm), 'accepts ä spelling too');
  }
  assert.equal(f.MONTHS.length, 12);
  assert.equal(f.MONTHS_SHORT.length, 12);
});

test('month formatters: missing and malformed input', () => {
  for (const fn of [f.monthName, f.monthShort, f.monthNameOnly, f.inessive, f.inessiveNoYear, f.elative, f.genitive]) {
    assert.equal(fn(null), DASH);
    assert.equal(fn(undefined), DASH);
    assert.equal(fn(''), DASH);
  }
  assert.throws(() => f.monthName('2026-13'), RangeError);
  assert.throws(() => f.monthName('2026-8'), RangeError);
  assert.throws(() => f.parseYm('2026-00'), RangeError);
  assert.throws(() => f.parseYm(202608), RangeError);
  assert.equal(f.monthFromSlug('elokuun'), null);
  assert.equal(f.monthFromSlug(null), null);
  assert.equal(f.monthFromSlug(' Elokuu '), 8);
});

test('month helpers do not depend on the time zone (no UTC Date parsing)', () => {
  const prev = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(f.monthName('2026-08'), 'elokuu 2026');
    assert.equal(f.date('2026-09-01'), '1.9.2026');
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
});

test('parseYm, toYm, ymAdd, ymDiff, yearOf', () => {
  assert.deepEqual(f.parseYm('2026-08'), { y: 2026, m: 8 });
  assert.equal(f.toYm(2026, 8), '2026-08');
  assert.equal(f.ymAdd('2026-08', 0), '2026-08');
  assert.equal(f.ymAdd('2026-08', 5), '2027-01');
  assert.equal(f.ymAdd('2026-01', -1), '2025-12');
  assert.equal(f.ymAdd('2026-08', -12), '2025-08');
  assert.equal(f.ymAdd('2026-08', -559), '1980-01');
  assert.equal(f.ymAdd('2000-12', 1), '2001-01');
  assert.equal(f.ymDiff('2025-08', '2026-08'), 12);
  assert.equal(f.ymDiff('2026-08', '2025-08'), -12);
  assert.equal(f.ymDiff('1980-01', '2026-08'), 559);
  assert.equal(f.ymDiff('2026-08', '2026-08'), 0);
  for (const [a, b] of [['1995-03', '2026-11'], ['2026-12', '2024-01']]) {
    assert.equal(f.ymAdd(a, f.ymDiff(a, b)), b);
  }
  assert.equal(f.yearOf('2026-08'), 2026);
  assert.equal(f.yearOf('2026-08-14'), 2026);
});

test('monthRange, monthsSpan, partialYear, capitalize', () => {
  assert.equal(f.monthRange('2025-09', '2026-08'), `syys 2025 ${DASH} elo 2026`);
  assert.equal(f.monthRange('2026-08', '2026-08'), 'elo 2026');
  assert.equal(f.monthRange(null, '2026-08'), DASH);
  assert.equal(f.monthsSpan('2026-01', '2026-08'), `tammi${DASH}elo`);
  assert.equal(f.monthsSpan('2026-01', '2026-01'), 'tammi');
  assert.equal(f.monthsSpan('2025-11', '2026-02'), `marras 2025 ${DASH} helmi 2026`);
  assert.equal(f.partialYear('2026-01', '2026-08'), `2026 (tammi${DASH}elo)`);
  assert.equal(f.partialYear('2026-01', '2026-01'), '2026 (tammi)');
  assert.equal(f.partialYear('2025-01', '2025-12'), '2025');
  assert.equal(f.partialYear('1996-02', '1996-12'), `1996 (helmi${DASH}joulu)`);
  assert.equal(f.capitalize('elokuu 2026'), 'Elokuu 2026');
  assert.equal(f.capitalize('äiti'), 'Äiti');
  assert.equal(f.capitalize(''), '');
});

test('date, dateTime, isoDate', () => {
  assert.equal(f.date('2026-09-14'), '14.9.2026');
  assert.equal(f.date('2026-01-05'), '5.1.2026');
  // timestamps are shown in Helsinki time (UTC+3 in September)
  assert.equal(f.date('2026-09-14T22:30:00Z'), '15.9.2026');
  assert.equal(f.date('2026-09-14T05:00:00Z'), '14.9.2026');
  assert.equal(f.date(new Date(Date.UTC(2026, 0, 31, 22, 30))), '1.2.2026'); // UTC+2 in winter
  assert.equal(f.date(null), DASH);
  assert.equal(f.date(''), DASH);
  assert.equal(f.date('not a date'), DASH);
  assert.equal(f.dateTime('2026-09-14T05:00:00Z'), '14.9.2026 klo 8.00');
  assert.equal(f.dateTime('2026-09-14T21:05:00Z'), '15.9.2026 klo 0.05');
  assert.equal(f.dateTime(undefined), DASH);
  assert.equal(f.isoDate('2026-09-14'), '2026-09-14');
  assert.equal(f.isoDate(new Date('2026-09-14T22:30:00Z')), '2026-09-15');
  assert.equal(f.isoDate('2026-09-14T05:00:00Z'), '2026-09-14');
  assert.equal(f.isoDate('garbage'), null);
  assert.match(f.isoDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('English formatters (en-GB digits, U+2212 minus)', () => {
  assert.deepEqual([f.EN_MONTHS[0], f.EN_MONTHS[11], f.EN_MONTHS_SHORT[7]], ['January', 'December', 'Aug']);
  assert.equal(f.enNum(1234.5, 1), '1,234.5');
  assert.equal(f.enNum(-0.2, 1), `${MI}0.2`);
  assert.equal(f.enNum(-0.04, 1), '0.0');
  assert.equal(f.enNum(0, 1, { sign: true }), '±0.0');
  assert.equal(f.enPct(2.2), '2.2%');
  assert.equal(f.enPct(0.4, { sign: true }), '+0.4%');
  assert.equal(f.enPp(-0.1), `${MI}0.1${NB}pp`);
  assert.equal(f.enEur(1234.5), '€1,234.50');
  assert.equal(f.enEur(-3, 0), `${MI}€3`);
  assert.equal(f.enMonthName('2026-08'), 'August 2026');
  assert.equal(f.enMonthShort('2026-08', { year: false }), 'Aug');
  assert.equal(f.enDate('2026-09-17'), '17 September 2026');
  assert.equal(f.enDate('2026-09-14T22:30:00Z'), '15 September 2026');
  for (const bad of [null, undefined, NaN]) {
    assert.equal(f.enPct(bad), DASH);
    assert.equal(f.enEur(bad), DASH);
  }
  assert.equal(f.enDate(undefined), DASH);
  assert.equal(f.enMonthName(null), DASH);
});
