/**
 * Pure helpers of the Chart.js setup module (src/js/charts/setup.js).
 * The module is browser code, but these functions need no DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthTicks, axisFormatter, valueFormatter, withAlpha, lineDataset, targetLine, SERIES_TOKENS } from '../src/js/charts/setup.js';
import { ymAdd } from '../src/js/lib/format.js';
import { SERIES_CLASSES } from '../scripts/lib/svg.js';

const months = (start, n) => Array.from({ length: n }, (_, i) => ymAdd(start, i));

test('monthTicks: long ranges show January years, thinned to the width', () => {
  const m = months('2021-08', 61); // 5 v
  const wide = monthTicks(m, 900);
  assert.deepEqual([...wide.values()], ['2022', '2023', '2024', '2025', '2026']);
  for (const i of wide.keys()) assert.match(m[i], /-01$/);
  const all = months('1980-01', 560);
  const narrow = monthTicks(all, 320); // 5 labels max
  const years = [...narrow.values()].map(Number);
  assert.ok(years.length <= 5 && years.length >= 3, `${years}`);
  assert.ok(years.every((y) => y % 10 === 0), 'decades on a phone');
  assert.equal(new Set(years).size, years.length, 'no duplicate years');
});

test('monthTicks: short ranges show months, the year on the first label and when it changes', () => {
  const m = months('2025-08', 13); // 1 v
  const t = monthTicks(m, 900);
  assert.equal(t.get(12), 'elo', 'the latest month always has a label');
  assert.equal([...t.values()][0], 'elo 2025');
  assert.ok([...t.values()].includes('tammi 2026'));
  const narrow = monthTicks(m, 260); // 4 labels → every 6 months
  assert.deepEqual([...narrow.values()], ['elo 2025', 'helmi 2026', 'elo']);
  assert.equal(monthTicks([], 500).size, 0);
});

test('axis and value formatters use fi-FI notation', () => {
  const ax = axisFormatter('%');
  assert.equal(ax(2), '2 %');
  assert.equal(ax(0.5), '0,5 %');
  assert.equal(ax(-2), '−2 %');
  assert.equal(axisFormatter('pp')(0.25), '0,25 %-yks.');
  assert.equal(valueFormatter('%')(2.2), '2,2 %');
  assert.equal(valueFormatter('pp')(-0.1), '−0,1 %-yks.');
  assert.equal(valueFormatter('€')(1234.5), '1 234,50 €');
  assert.equal(valueFormatter('index')(125.15), '125,15');
  assert.equal(valueFormatter('%')(null), '–');
});

test('dataset helpers and colour utilities', () => {
  assert.equal(withAlpha('#0B5C7A', 0.5), 'rgb(11 92 122 / 0.5)');
  assert.equal(withAlpha('red', 0.5), 'red');
  const ds = lineDataset({ series: 'khi', label: 'KHI', data: [1, null, 2] });
  assert.equal(ds.series, 'khi');
  assert.equal(ds.tension, 0);
  assert.equal(ds.pointRadius, 0);
  assert.equal(ds.borderWidth, 2);
  const t = targetLine(2, 'Tavoite');
  assert.equal(t.yMin, 2);
  assert.equal(t.label.display, true);
  // Same series keys as the server-side SVG charts.
  assert.deepEqual(Object.keys(SERIES_TOKENS).sort(), [...SERIES_CLASSES].sort());
});
