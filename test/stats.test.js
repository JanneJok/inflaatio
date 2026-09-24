import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/js/lib/stats.js';
import { ymAdd, pp, pct } from '../src/js/lib/format.js';

/** Contiguous months from `start`, `n` long. */
const monthsFrom = (start, n) => Array.from({ length: n }, (_, i) => ymAdd(start, i));
const approx = (actual, expected, eps = 1e-9, msg) =>
  assert.ok(Math.abs(actual - expected) < eps, msg ?? `${actual} ≈ ${expected}`);

test('seriesAt and latest/first index', () => {
  const months = ['2026-06', '2026-07', '2026-08', '2026-09'];
  const arr = [1.9, 2.1, 2.2, null];
  assert.equal(s.seriesAt(months, arr, '2026-07'), 2.1);
  assert.equal(s.seriesAt(months, arr, '2026-09'), null, 'missing value');
  assert.equal(s.seriesAt(months, arr, '2025-01'), null, 'before start');
  assert.equal(s.seriesAt(months, arr, '2027-01'), null, 'after end');
  assert.equal(s.seriesAt([], arr, '2026-07'), null);
  assert.equal(s.seriesAt(['2026-01', '2026-03'], [1, 3], '2026-03'), 3, 'non-contiguous fallback');
  assert.equal(s.latestIndex(arr), 2);
  assert.equal(s.latestIndex([null, null]), -1);
  assert.equal(s.latestIndex([0, null]), 0, 'zero is a value');
  assert.equal(s.firstIndex([null, 0, 1]), 1);
  assert.equal(s.firstIndex(undefined), -1);
});

test('sliceRange: point counts per range (n months = n + 1 points)', () => {
  const months = monthsFrom('2010-01', 201); // 2010-01 … 2026-09
  const arr = months.map((_, i) => i);
  arr[arr.length - 1] = null; // 2026-09 not published yet
  const expected = { '6kk': 7, '1v': 13, '3v': 37, '5v': 61, '10v': 121 };
  for (const [key, points] of Object.entries(expected)) {
    const r = s.sliceRange(months, arr, key);
    assert.equal(r.months.length, points, key);
    assert.equal(r.series.length, points, key);
    assert.equal(r.months[r.months.length - 1], '2026-08', `${key} ends at latest data`);
    assert.equal(r.intervals, points - 1);
    assert.equal(r.complete, true);
  }
  const y1 = s.sliceRange(months, arr, '1v');
  assert.equal(y1.months[0], '2025-08', '1v starts at the same month a year earlier');
  assert.equal(y1.annualise, true);
  assert.equal(s.sliceRange(months, arr, '6kk').annualise, false, '6 kk is not annualised');
  assert.equal(s.sliceRange(months, arr, '6kk').months[0], '2026-02');

  const all = s.sliceRange(months, arr, 'kaikki');
  assert.equal(all.months[0], '2010-01');
  assert.equal(all.months.length, 200);
  assert.equal(all.complete, true);
});

test('sliceRange: shapes, leading nulls, short series, end anchor, errors', () => {
  const months = monthsFrom('2024-01', 32); // … 2026-08
  const khi = months.map((_, i) => 1 + i / 10);
  const ykhi = months.map((_, i) => (i < 5 ? null : 2 + i / 10));

  const obj = s.sliceRange(months, { khi, ykhi }, '1v');
  assert.deepEqual(Object.keys(obj.series), ['khi', 'ykhi']);
  assert.equal(obj.series.khi.length, 13);
  assert.equal(obj.series.ykhi[12], ykhi[31]);

  const arrs = s.sliceRange(months, [khi, ykhi], '1v');
  assert.equal(arrs.series.length, 2);
  assert.equal(arrs.series[0].length, 13);

  const onlyY = s.sliceRange(months, ykhi, 'kaikki');
  assert.equal(onlyY.months[0], '2024-06', 'leading nulls are dropped for kaikki');

  const short = s.sliceRange(months, khi, '5v');
  assert.equal(short.months.length, 32);
  assert.equal(short.complete, false, 'range longer than data');

  const anchored = s.sliceRange(months, khi, '1v', { end: '2025-12' });
  assert.equal(anchored.months[0], '2024-12');
  assert.equal(anchored.months[12], '2025-12');
  const clamp = s.sliceRange(months, khi, '6kk', { end: '2030-01' });
  assert.equal(clamp.months[clamp.months.length - 1], '2026-08');
  const before = s.sliceRange(months, khi, '6kk', { end: '2000-01' });
  assert.deepEqual(before.months, []);
  assert.deepEqual(before.series, []);

  const empty = s.sliceRange(months, months.map(() => null), '1v');
  assert.deepEqual(empty.months, []);
  assert.equal(empty.complete, false);

  assert.throws(() => s.sliceRange(months, khi, '2v'), RangeError);
  assert.equal(s.isRangeKey('kaikki'), true);
  assert.equal(s.isRangeKey('toString'), false);
  assert.deepEqual([...s.RANGE_KEYS], ['6kk', '1v', '3v', '5v', '10v', 'kaikki']);
});

test('mean and trailingMean', () => {
  assert.equal(s.mean([1, null, 3, undefined, NaN]), 2);
  assert.equal(s.mean([]), null);
  assert.equal(s.mean([null]), null);
  assert.equal(s.mean([2.1, 2.2]), 2.15, 'float noise removed');
  assert.equal(s.mean([-0.2, 0.2]), 0);
  const yoy = [...Array(11).fill(1), 2.2, null];
  approx(s.trailingMean(yoy, 12), (11 + 2.2) / 12);
  assert.equal(s.trailingMean(yoy, 13), null, 'not enough values');
  assert.equal(s.trailingMean([1, null, 3], 2, 2), null, 'gap in window');
});

test('min and max return every tied month', () => {
  const months = ['2022-10', '2022-11', '2022-12', '2025-10', '2026-01'];
  const arr = [8.8, 9.1, 9.1, -0.2, -0.2];
  assert.deepEqual(s.max(months, arr), { value: 9.1, indices: [1, 2], months: ['2022-11', '2022-12'] });
  assert.deepEqual(s.min(months, arr), { value: -0.2, indices: [3, 4], months: ['2025-10', '2026-01'] });
  assert.deepEqual(s.max(null, [1, 3, null]), { value: 3, indices: [1], months: [] });
  assert.equal(s.min(months, [null, null]), null);
});

test('cagr: geometric average annual growth (regression for the old 6.2 % bug)', () => {
  const g = s.cagr(32.06, 125.15, 559); // 1980-01 → 2026-08
  approx(g, 2.9667, 0.001);
  assert.equal(s.round(g, 1), 3.0);
  const oldLinear = ((125.15 - 32.06) / 32.06) * 100 / 560 * 12;
  assert.equal(s.round(oldLinear, 1), 6.2, 'documents the old formula');
  // 13 points (12 intervals) → CAGR equals the annual change
  approx(s.cagr(100, 102.2, 12), 2.2, 1e-9);
  approx(s.cagr(100, 121, 24), 10, 1e-9);
  assert.equal(s.cagr(0, 100, 12), null);
  assert.equal(s.cagr(100, null, 12), null);
  assert.equal(s.cagr(100, 110, 0), null);
});

test('totalChange, priceChangeFromIndex, pctChangeSeries', () => {
  approx(s.totalChange(100, 110), 10);
  const mom = s.priceChangeFromIndex(125.38, 125.15);
  approx(mom, -0.18344, 1e-4);
  assert.equal(pct(mom), '−0,2 %');
  assert.equal(s.totalChange(0, 1), null);
  assert.equal(s.totalChange(null, 1), null);
  const series = s.pctChangeSeries([100, 101, null, 102], 1);
  assert.equal(series[0], null);
  approx(series[1], 1);
  assert.equal(series[2], null);
  assert.equal(series[3], null);
  const yoy = s.pctChangeSeries([100, 1, 1, 102.2], 3);
  approx(yoy[3], 2.2);
});

test('rebase', () => {
  const r = s.rebase([50, null, 100, 125], 0);
  assert.deepEqual(r, [100, null, 200, 250]);
  assert.deepEqual(s.rebase([80, 100], 1, 1), [0.8, 1]);
  assert.deepEqual(s.rebase([null, 100], 0), [null, null]);
});

test('annualMeanOfMonthly: partial current year with span', () => {
  const months = monthsFrom('2025-01', 20); // 2025-01 … 2026-08
  const yoy = months.map((ym) => (ym.startsWith('2025') ? 1.0 : 2.0));
  yoy[0] = null; // 2025-01 missing
  const r = s.annualMeanOfMonthly(months, yoy);
  assert.deepEqual(r.years, [2025, 2026]);
  assert.deepEqual(r.values, [1, 2]);
  assert.deepEqual(r.monthsCount, [11, 8]);
  assert.deepEqual(r.spanStart, ['2025-02', '2026-01']);
  assert.deepEqual(r.spanEnd, ['2025-12', '2026-08']);
  assert.deepEqual(r.complete, [false, false]);
  const full = s.annualMeanOfMonthly(monthsFrom('2024-01', 12), [0.1, 0.2, ...Array(10).fill(0.3)]);
  assert.deepEqual(full.complete, [true]);
  assert.equal(full.values[0], 0.275);
  assert.deepEqual(s.annualMeanOfMonthly([], []).years, []);
});

test('levelBand', () => {
  assert.equal(s.levelBand(-0.2), 'deflation');
  assert.equal(s.levelBand(-0.04), 'low', 'rounds to 0,0');
  assert.equal(s.levelBand(0), 'low');
  assert.equal(s.levelBand(1.94), 'low');
  assert.equal(s.levelBand(1.96), 'elevated', 'displayed as 2,0 %');
  assert.equal(s.levelBand(2), 'elevated');
  assert.equal(s.levelBand(3.9), 'elevated');
  assert.equal(s.levelBand(4), 'high');
  assert.equal(s.levelBand(9.1), 'high');
  assert.equal(s.levelBand(null), null);
  assert.equal(s.LEVEL_BANDS.length, 4);
});

test('deltaClass and ppChange agree with pp()', () => {
  assert.equal(s.deltaClass(0.1), 'up');
  assert.equal(s.deltaClass(-0.1), 'down');
  assert.equal(s.deltaClass(0), 'flat');
  assert.equal(s.deltaClass(0.04), 'flat');
  assert.equal(s.deltaClass(-0.049), 'flat');
  assert.equal(s.deltaClass(0.05), 'up');
  assert.equal(s.deltaClass(-0.05), 'down');
  assert.equal(s.deltaClass(undefined), null);
  assert.equal(s.ppChange(2.2, 2.1), 0.1);
  assert.equal(s.ppChange(2.1, 2.2), -0.1);
  assert.ok(Object.is(s.ppChange(2.2, 2.2), 0));
  assert.equal(s.ppChange(0.3, 1.6), -1.3);
  assert.equal(s.ppChange(null, 2), null);
  for (const d of [0.04, 0.05, -0.05, 0.1, 2.2 - 2.1, 2.25 - 2.2]) {
    const cls = s.deltaClass(d);
    const text = pp(d);
    const expectedPrefix = cls === 'up' ? '+' : cls === 'down' ? '−' : '±';
    assert.ok(text.startsWith(expectedPrefix), `${d}: ${cls} vs ${text}`);
  }
});

test('alignSeries / alignMany', () => {
  const r = s.alignSeries(['2025-01', '2025-02', '2025-03'], [1, 2, 3], ['2025-02', '2025-03', '2025-04', '2025-05'], [20, 30, null, 50]);
  assert.deepEqual(r.months, ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05']);
  assert.deepEqual(r.a, [1, 2, 3, null, null]);
  assert.deepEqual(r.b, [null, 20, 30, null, 50]);
  const across = s.alignSeries(['2025-12'], [1], ['2026-02'], [2]);
  assert.deepEqual(across.months, ['2025-12', '2026-01', '2026-02']);
  assert.deepEqual(across.a, [1, null, null]);
  const none = s.alignMany([{ months: [], values: [] }]);
  assert.deepEqual(none, { months: [], values: [[]] });
});

test('rangeStats on a sliced range', () => {
  const months = monthsFrom('2025-08', 13);
  const yoy = [0.5, 0.4, 0.3, -0.2, 0.1, 0.2, -0.2, 0.3, 1.0, 1.5, 1.8, 2.1, 2.2];
  const index = months.map((_, i) => 100 + (i === 12 ? 2.2 : i * 0.1));
  const r = s.rangeStats(months, yoy, index);
  assert.equal(r.start, '2025-08');
  assert.equal(r.end, '2026-08');
  assert.equal(r.points, 13);
  assert.equal(r.intervals, 12);
  approx(r.total, 2.2);
  approx(r.annual, 2.2);
  assert.deepEqual(r.min.months, ['2025-11', '2026-02']);
  assert.equal(r.max.value, 2.2);
  assert.deepEqual(r.latest, { value: 2.2, month: '2026-08' });
  const short = s.rangeStats(months.slice(6), yoy.slice(6), index.slice(6));
  assert.equal(short.intervals, 6);
  assert.equal(short.annual, null, 'no annualising under 12 months');
  assert.ok(short.total !== null);
  const noIndex = s.rangeStats(months, yoy);
  assert.equal(noIndex.total, null);
  assert.equal(noIndex.annual, null);
});
