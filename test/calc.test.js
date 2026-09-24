import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as c from '../src/js/lib/calc.js';
import { build } from '../scripts/build.js';

/** NBSP / narrow NBSP → space and the non-breaking hyphen → '-' for readable expectations. */
const sp = (s) => String(s).replace(/[\u00A0\u202F]/g, ' ').replace(/\u2011/g, '-');
const approx = (actual, expected, eps = 1e-6, msg) =>
  assert.ok(Math.abs(actual - expected) < eps, msg ?? `${actual} ≈ ${expected}`);

const readData = (name) => {
  const file = new URL(`../data/${name}.json`, import.meta.url);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const data = {
  khi: readData('khi'),
  'khi-annual': readData('khi-annual'),
  elinkustannusindeksi: readData('elinkustannusindeksi'),
  ykhi: readData('ykhi'),
  hyodykkeet: readData('hyodykkeet'),
};
const hasData = Boolean(data.khi && data.elinkustannusindeksi && data['khi-annual']);

/* ----------------------------------------------------------------- periods */

test('periods: kinds, arithmetic and differences', () => {
  assert.equal(c.periodKind('2026-08'), 'month');
  assert.equal(c.periodKind('2026'), 'year');
  assert.equal(c.periodKind('2026-13'), null);
  assert.equal(c.periodKind(''), null);
  assert.equal(c.periodKind(null), null);
  assert.equal(c.periodAdd('2025-12', 1), '2026-01');
  assert.equal(c.periodAdd('1999', 3), '2002');
  assert.equal(c.periodDiff('2025-08', '2026-08'), 12);
  assert.equal(c.periodDiff('2000', '2026'), 26);
  assert.equal(c.periodDiff('2000', '2026-08'), null, 'mixed kinds');
  assert.equal(c.monthsBetween('2000', '2026-07'), 26 * 12, 'a year counts from July');
});

/* ------------------------------------------------------------------ series */

const SAMPLE = {
  khi: { months: ['2025-07', '2025-08', '2025-09'], index: { '2025=100': [99.5, 99.77, 100.1], '1972=100': [900, 907.25, 910] } },
  'khi-annual': { years: ['2024', '2025'], index: { '1972=100': [906.3, 909.3] } },
  elinkustannusindeksi: {
    monthly: { base: '1951:10=100', months: ['2025-07', '2025-08', '2025-09'], values: [2330, 2334, null] },
    annual: { base: '1951:10=100', years: ['2024', '2025'], values: [2332, 2339] },
    monthly1939: { base: '1938:8–1939:7=100', months: ['2025-08'], values: [26000] },
    annual1914: { base: '1914:1–6=100', years: ['1860', '1861'], values: [78, 86] },
  },
};

test('buildSeries: compact official series, trailing nulls trimmed', () => {
  const list = c.buildSeries(SAMPLE);
  const ids = list.map((s) => s.id);
  assert.deepEqual(ids, ['eki-1951', 'eki-1951-v', 'eki-1939', 'eki-1914-v', 'khi-2025', 'khi-1972', 'khi-1972-v']);
  const eki = list[0];
  assert.equal(eki.kind, 'month');
  assert.equal(eki.base, '1951:10=100');
  assert.equal(eki.decimals, 0);
  assert.equal(eki.start, '2025-07');
  assert.deepEqual(eki.values, [2330, 2334], 'trailing null removed');
  assert.equal(c.lastPeriod(eki), '2025-08');
  assert.equal(c.latestPeriod(eki), '2025-08');
  assert.equal(c.pointAt(eki, '2025-08'), 2334);
  assert.equal(c.pointAt(eki, '2025-09'), null, 'not published');
  assert.equal(c.pointAt(eki, '2025-06'), null, 'before the series');
  assert.equal(c.pointAt(eki, '2025'), null, 'annual period on a monthly series');
  assert.equal(c.pointAt(null, '2025-08'), null);
  const only = c.buildSeries(SAMPLE, { ids: ['khi-1972', 'nope', 'eki-1951'] });
  assert.deepEqual(only.map((s) => s.id), ['khi-1972', 'eki-1951']);
  assert.equal(c.compactSeries(['2020-01'], [null]), null);
});

test('series names and bases', () => {
  assert.equal(c.seriesName('eki-1951'), 'Elinkustannusindeksi (1951:10=100)');
  assert.equal(c.seriesName('khi-2025'), 'Kuluttajahintaindeksi (2025=100)');
  assert.equal(c.seriesName('khi-1972-v', 'en'), 'Consumer price index (1972=100)');
  assert.equal(c.seriesName('eki-1951', 'en', { short: true }), 'Cost-of-living index');
  assert.equal(c.seriesBase('eki-1939'), '1938:8–1939:7=100');
  assert.equal(c.seriesBase('khi-2015'), '2015=100');
  assert.equal(c.familyOf('khi-1972-v'), 'khi-1972');
});

/* ----------------------------------------------------------- rent increase */

test('rentIncrease: 900 € × 2385 / 2334 = 919,67 € and contract clauses', () => {
  const r = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385 });
  assert.equal(r.newRent, 919.67);
  assert.equal(r.increase, 19.67);
  assert.equal(r.increaseYear, 236.04);
  approx(r.indexChangePct, 2.1851, 1e-4);
  assert.equal(r.rule, 'index');

  const min = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, minPct: 3 });
  assert.equal(min.newRent, 927);
  assert.equal(min.rule, 'minimum');
  const max = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, maxPct: 2 });
  assert.equal(max.newRent, 918);
  assert.equal(max.rule, 'maximum');
  const extra = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, extraPct: 1 });
  approx(extra.appliedPct, 3.1851, 1e-4);
  assert.equal(extra.rule, 'extra');
  assert.equal(extra.newRent, 928.67);
  const down = c.rentIncrease({ rent: 900, baseIndex: 2385, checkIndex: 2334, noDecrease: true });
  assert.equal(down.newRent, 900);
  assert.equal(down.rule, 'noDecrease');
  const downAllowed = c.rentIncrease({ rent: 900, baseIndex: 2385, checkIndex: 2334 });
  assert.equal(downAllowed.newRent, 880.75);

  // Review example: 825 € × 125,15 / 122,47 = 843,05 € (+18,05 €, +2,2 %).
  const khi = c.rentIncrease({ rent: 825, baseIndex: 122.47, checkIndex: 125.15 });
  assert.equal(khi.newRent, 843.05);
  assert.equal(khi.increase, 18.05);
});

test('rentIncrease: rounding modes, same month and invalid input', () => {
  assert.equal(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, rounding: 'euro' }).newRent, 920);
  assert.equal(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, rounding: 'euro-up' }).newRent, 920);
  assert.equal(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2339, rounding: 'euro-up' }).newRent, 902);
  assert.equal(c.rentIncrease({ rent: 900, baseIndex: 100, checkIndex: 100, rounding: 'euro-up' }).newRent, 900, 'exact euros stay');
  assert.equal(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, rounding: 'bogus' }).rounding, 'cent');
  const same = c.rentIncrease({ rent: 850.5, baseIndex: 2385, checkIndex: 2385 });
  assert.equal(same.newRent, 850.5);
  assert.equal(same.increase, 0);
  assert.equal(same.indexChangePct, 0);
  assert.deepEqual(c.rentIncrease({ rent: 0, baseIndex: 1, checkIndex: 1 }), { error: 'rent' });
  assert.deepEqual(c.rentIncrease({ rent: 900, baseIndex: null, checkIndex: 2385 }), { error: 'baseIndex' });
  assert.deepEqual(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: undefined }), { error: 'checkIndex' });
  assert.deepEqual(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, minPct: 5, maxPct: 3 }), { error: 'minMax' });
  assert.equal(c.roundMoney(NaN), null);
});

test('rentView: formula and notice texts (fi/en)', () => {
  const r = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385 });
  const v = c.rentView(r, { series: { id: 'eki-1951', decimals: 0 }, base: '2025-08', check: '2026-08' });
  assert.equal(sp(v.newRent), '919,67 €');
  assert.equal(sp(v.increase), '+19,67 €');
  assert.equal(sp(v.formula), '900,00 € × 2 385 / 2 334 = 919,67 €');
  assert.equal(sp(v.appliedPct), '+2,19 %');
  assert.equal(v.rule, '');
  assert.match(v.notice, /^Vuokrasopimuksen indeksiehdon mukaisesti/);
  assert.match(sp(v.notice), /Elinkustannusindeksin \(1951:10=100\) pisteluku oli perusajankohtana \(elokuu 2025\) 2 334 ja tarkistusajankohtana \(elokuu 2026\) 2 385\./);
  const min = c.rentView(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, minPct: 3 }), {
    series: { id: 'eki-1951', decimals: 0 },
    base: '2025-08',
    check: '2026-08',
  });
  assert.match(min.rule, /vähimmäiskorotuksen/);
  assert.equal(sp(min.newRent), '927,00 €');
  const en = c.rentView(r, { series: { id: 'eki-1951', decimals: 0 }, base: '2025-08', check: '2026-08', lang: 'en' });
  assert.equal(en.newRent, '€919.67');
  assert.equal(en.formula, '€900.00 × 2,385 / 2,334 = €919.67');
  assert.match(en.notice, /August 2025/);
});

/* ---------------------------------------------------------- value of money */

test('valueOfMoney and currency conversion', () => {
  const v = c.valueOfMoney({ amount: 100, fromIdx: 569.8, toIdx: 927.11 });
  approx(v.factor, 1.6271, 1e-4);
  approx(v.value, 162.71, 0.005);
  approx(v.changePct, 62.71, 0.005);
  assert.equal(c.valueOfMoney({ amount: 100, fromIdx: 0, toIdx: 1 }), null);
  assert.equal(c.valueOfMoney({ amount: null, fromIdx: 1, toIdx: 1 }), null);
  const same = c.valueOfMoney({ amount: 50, fromIdx: 927.11, toIdx: 927.11 });
  assert.equal(same.value, 50);
  approx(c.toEuros(594.573, 'mk', '1990-05'), 100);
  approx(c.toEuros(59457.3, 'mk', '1955'), 100, 1e-6, 'old markka before 1963');
  assert.equal(c.toEuros(100, 'eur', '2000'), 100);
  approx(c.fromEuros(100, 'mk', 1950), 59457.3, 1e-6);
});

test('pickMoneySeries: family choice, annual fallback and errors (sample data)', () => {
  const list = c.buildSeries(SAMPLE);
  const m = c.pickMoneySeries(list, '2025-07', '2025-09');
  assert.equal(m.family, 'khi-1972');
  assert.equal(m.fromIdx, 900);
  assert.equal(m.toIdx, 910);
  const annualToMonth = c.pickMoneySeries(list, '2024', '2025-09');
  assert.equal(annualToMonth.family, 'khi-1972', 'annual average → month within one base');
  assert.equal(annualToMonth.fromIdx, 906.3);
  assert.deepEqual(c.pickMoneySeries(list, '2025-10', '2025-09'), { error: 'future' });
  assert.deepEqual(c.pickMoneySeries(list, '2026', '2025-09'), { error: 'future' }, 'annual average of an incomplete year');
  assert.deepEqual(c.pickMoneySeries(list, 'x', '2025-09'), { error: 'invalid' });
  assert.deepEqual(c.pickMoneySeries(list, '1850', '2025-09'), { error: 'before' });
});

test('moneyPath: rebased chart points', () => {
  const list = c.buildSeries(SAMPLE);
  const pick = c.pickMoneySeries(list, '2025-07', '2025-09');
  const p = c.moneyPath(list, pick, 100);
  assert.equal(p.kind, 'month');
  assert.deepEqual(p.labels, ['2025-07', '2025-08', '2025-09']);
  approx(p.values[0], 100);
  approx(p.values[2], 101.1111, 1e-3);
  const back = c.moneyPath(list, c.pickMoneySeries(list, '2025-09', '2025-07'), 100);
  assert.deepEqual(back.labels, ['2025-07', '2025-08', '2025-09'], 'always ascending');
  approx(back.values[2], 100);
  assert.deepEqual(c.moneyPath(list, { error: 'future' }, 100).labels, []);
});

test('real data: rent 900 € with elinkustannusindeksi 8/2025 → 8/2026 = 919,67 €', { skip: !hasData && 'data/*.json missing' }, () => {
  const list = c.buildSeries(data);
  const eki = list.find((s) => s.id === 'eki-1951');
  assert.equal(c.pointAt(eki, '2025-08'), 2334);
  assert.equal(c.pointAt(eki, '2026-08'), 2385);
  const r = c.rentIncrease({ rent: 900, baseIndex: c.pointAt(eki, '2025-08'), checkIndex: c.pointAt(eki, '2026-08') });
  assert.equal(r.newRent, 919.67);
  // Every KHI base in khi.json is available for rent calculations.
  for (const b of Object.keys(data.khi.index)) assert.ok(list.some((s) => s.id === `khi-${b.slice(0, 4)}`), b);
});

test('real data: 1/2000 → 8/2026 money factor 1,6271 from the official 1972=100 series', { skip: !hasData && 'data/*.json missing' }, () => {
  const list = c.buildSeries(data, { ids: c.MONEY_SERIES_IDS });
  const pick = c.pickMoneySeries(list, '2000-01', '2026-08');
  assert.equal(pick.family, 'khi-1972');
  assert.equal(pick.fromIdx, 569.8);
  assert.equal(pick.toIdx, 927.11);
  const v = c.valueOfMoney({ amount: 100, fromIdx: pick.fromIdx, toIdx: pick.toIdx });
  assert.equal(Number(v.factor.toFixed(4)), 1.6271);
  const view = c.moneyView({ amount: 100, currency: 'eur', pick, value: v.value, factor: v.factor });
  assert.equal(sp(view.sentence), '100 € tammikuussa 2000 vastaa ostovoimaltaan 162,71 € elokuussa 2026.');
  assert.match(sp(view.change), /^Hinnat nousivat 62,7 % \(keskimäärin \+1,85 % vuodessa\)\.$/);
  assert.equal(sp(view.buys), 'Toisinpäin: 100 € elokuussa 2026 vastaa ostovoimaltaan 61,46 € (365,42 mk) tammikuussa 2000.');
  assert.equal(sp(view.basis), '100 € × 927,11 / 569,80 = 162,71 €');
  assert.equal(view.seriesName, 'Kuluttajahintaindeksi (1972=100)');
  const mk = c.moneyView({ amount: 1000, currency: 'mk', pick, value: c.toEuros(1000, 'mk', '2000-01') * v.factor, factor: v.factor });
  assert.match(sp(mk.sentence), /^1 000 mk tammikuussa 2000 vastaa ostovoimaltaan 273,66 € elokuussa 2026\.$/);

  // Before 1972: monthly elinkustannusindeksi 1938:8–1939:7=100.
  const old = c.pickMoneySeries(list, '1950-06', '2026-08');
  assert.equal(old.family, 'eki-1939');
  // Annual averages 1952–1971: elinkustannusindeksi 1951:10=100.
  assert.equal(c.pickMoneySeries(list, '1960', '2026-08').family, 'eki-1951');
  // Before 8/1939: annual 1914:1–6=100, capped at its last published year.
  const annual = c.pickMoneySeries(list, '1920', '2026-08');
  assert.equal(annual.family, 'eki-1914');
  assert.equal(annual.annualFallback, true);
  assert.equal(annual.capped, true);
  assert.equal(annual.to, c.latestPeriod(list.find((s) => s.id === 'eki-1914-v')));
  const path = c.moneyPath(list, annual, 100);
  assert.equal(path.kind, 'year');
  assert.equal(path.labels[0], '1920');
});

/* ----------------------------------------------------------------- savings */

test('savingsReal: Fisher example and historical index', () => {
  const s = c.savingsReal({ amount: 10000, nominalRate: 2.5, months: 60, assumedInflation: 2.2 });
  approx(s.nominalValue, 11314.08, 0.01);
  approx(s.realValue, 10147.6, 0.1);
  approx(s.realAnnualPct, (1.025 / 1.022 - 1) * 100, 1e-9);
  approx(s.inflationAnnualPct, 2.2, 1e-9);
  const cash = c.savingsReal({ amount: 1000, months: 12, fromIdx: 100, toIdx: 110 });
  approx(cash.nominalValue, 1000);
  approx(cash.realValue, 909.0909, 1e-3);
  approx(cash.purchasingPowerLossPct, 9.0909, 1e-3);
  assert.equal(c.savingsReal({ amount: 1000, months: 6, assumedInflation: 2 }).realAnnualPct, null, 'no annualising under 12 months');
  const zero = c.savingsReal({ amount: 1000, months: 0, assumedInflation: 2 });
  assert.equal(zero.realValue, 1000);
  assert.equal(zero.realAnnualPct, null);
  assert.deepEqual(c.savingsReal({ amount: -1, months: 12, assumedInflation: 2 }), { error: 'amount' });
  assert.deepEqual(c.savingsReal({ amount: 1, months: 12 }), { error: 'inflation' });
  assert.deepEqual(c.savingsReal({ amount: 1, months: -1, assumedInflation: 2 }), { error: 'months' });
  assert.deepEqual(c.savingsReal({ amount: 1, nominalRate: -100, months: 1, assumedInflation: 2 }), { error: 'rate' });
});

/* ------------------------------------------------------ personal inflation */

test('personalInflation: weighted mean, normalised; missing rates excluded', () => {
  const r = c.personalInflation({ weights: { a: 1, b: 3 }, rates: { a: 4, b: 0 } });
  approx(r.rate, 1);
  assert.equal(r.totalWeight, 4);
  approx(r.parts[0].share, 0.25);
  approx(r.parts[0].contribution, 1);
  const scaled = c.personalInflation({ weights: { a: 10, b: 30 }, rates: { a: 4, b: 0 } });
  approx(scaled.rate, 1, 1e-12, 'only relative weights matter');
  const missing = c.personalInflation({ weights: { a: 1, b: 1 }, rates: { a: 2, b: null } });
  approx(missing.rate, 2);
  assert.equal(c.personalInflation({ weights: { a: 0 }, rates: { a: 2 } }), null);
  assert.equal(c.personalInflation({ weights: null, rates: {} }), null);
});

test('inflationDifference: drivers sum to the difference', () => {
  const d = c.inflationDifference({ weights: { car: 3, food: 1 }, baseWeights: { car: 1, food: 1 }, rates: { car: 7, food: 1 } });
  approx(d.personal, 5.5);
  approx(d.base, 4);
  approx(d.difference, 1.5);
  approx(d.drivers.reduce((s, x) => s + x.effect, 0), 1.5);
  assert.equal(d.drivers[0].key, 'car');
});

/* ------------------------------------------------------------- real wages */

test('realWageChange: 3 200 → 3 300 € with index 2334 → 2385', () => {
  const r = c.realWageChange({ before: 3200, after: 3300, cpiFrom: 2334, cpiTo: 2385 });
  approx(r.nominalPct, 3.125);
  approx(r.pricePct, 2.1851, 1e-4);
  approx(r.realPct, 0.9198, 1e-4);
  approx(r.neededSalary, 3269.92, 0.005);
  approx(r.difference, 30.08, 0.005);
  assert.deepEqual(c.realWageChange({ before: 0, after: 1, cpiFrom: 1, cpiTo: 1 }), { error: 'before' });
  assert.deepEqual(c.realWageChange({ before: 1, after: 1, cpiFrom: null, cpiTo: 1 }), { error: 'cpi' });
  const same = c.realWageChange({ before: 3000, after: 3000, cpiFrom: 100, cpiTo: 100 });
  assert.equal(same.realPct, 0);
});

test('annualRate: geometric, never for periods under 12 months', () => {
  approx(c.annualRate(1.21, 24), 10);
  approx(c.annualRate(1 / 1.21, -24), 10, 1e-9, 'backwards');
  assert.equal(c.annualRate(1.05, 6), null);
  assert.equal(c.annualRate(null, 24), null);
});

/* --------------------------------------------------------- input parsing */

test('parseDecimal: Finnish and English input', () => {
  assert.equal(c.parseDecimal('850'), 850);
  assert.equal(c.parseDecimal('850,50'), 850.5);
  assert.equal(c.parseDecimal('850.50'), 850.5);
  assert.equal(c.parseDecimal('1 234,56 €'), 1234.56);
  assert.equal(c.parseDecimal('1 234,56'), 1234.56);
  assert.equal(c.parseDecimal('1.234,56'), 1234.56);
  assert.equal(c.parseDecimal('1,234.56'), 1234.56);
  assert.equal(c.parseDecimal('1.234.567'), 1234567);
  assert.equal(c.parseDecimal('−2,5 %'), -2.5);
  assert.equal(c.parseDecimal('+3'), 3);
  assert.equal(c.parseDecimal('900 euroa'), 900);
  assert.equal(c.parseDecimal('1,234', 'en'), 1234);
  assert.equal(c.parseDecimal('1,5', 'fi'), 1.5);
  assert.equal(c.parseDecimal(''), null);
  assert.equal(c.parseDecimal('   '), null);
  assert.equal(c.parseDecimal('abc'), null);
  assert.equal(c.parseDecimal('1,2,3'), null);
  assert.equal(c.parseDecimal('12a'), null);
  assert.equal(c.parseDecimal(null), null);
  assert.equal(c.parseDecimal(12.5), 12.5);
});

/* ------------------------------------------------------------ formatters */

test('formatter: fi via format.js, en with en-GB digits', () => {
  const fi = c.formatter('fi');
  const en = c.formatter('en');
  assert.equal(fi.eur(1234.5), '1 234,50 €');
  assert.equal(en.eur(1234.5), '€1,234.50');
  assert.equal(en.eur(-19.67, 2), '−€19.67');
  assert.equal(en.eur(19.67, 2, { sign: true }), '+€19.67');
  assert.equal(en.pct(2.2), '2.2%');
  assert.equal(en.pct(-0.2), '−0.2%');
  assert.equal(en.pp(0.1), '+0.1 pp');
  assert.equal(en.idx(2385, 0), '2,385');
  assert.equal(fi.period('2026-08'), 'elokuu 2026');
  assert.equal(fi.periodIn('2026'), 'vuonna 2026');
  assert.equal(en.period('2026-08'), 'August 2026');
  assert.equal(en.periodIn('2026-08'), 'in August 2026');
  assert.equal(fi.periodNumeric('2026-08'), '8/2026');
  assert.equal(fi.markka(967.43), '967,43 mk');
  assert.equal(en.num(null), '–');
});

/* ------------------------------------------------------------- more views */

test('moneyView: backwards period, English texts and the annual note', { skip: !hasData && 'data/*.json missing' }, () => {
  const list = c.buildSeries(data, { ids: c.MONEY_SERIES_IDS });
  const back = c.pickMoneySeries(list, '2026-08', '2000-01');
  const v = c.valueOfMoney({ amount: 100, fromIdx: back.fromIdx, toIdx: back.toIdx });
  const fi = c.moneyView({ amount: 100, currency: 'eur', pick: back, value: v.value, factor: v.factor });
  assert.equal(sp(fi.sentence), '100 € elokuussa 2026 vastaa ostovoimaltaan 61,46 € (365,42 mk) tammikuussa 2000.');
  assert.match(sp(fi.change), /^Hinnat olivat 38,5 % alemmat tammikuussa 2000\.$/);
  assert.equal(fi.buys, '', 'no reverse sentence before euro cash');
  assert.equal(fi.note, '');
  const en = c.moneyView({ amount: 100, currency: 'eur', pick: c.pickMoneySeries(list, '2000-01', '2026-08'), value: 162.71, factor: 1.6271 }, 'en');
  assert.equal(en.sentence, '€100 in January 2000 is equivalent to €162.71 in August 2026.');
  const old = c.pickMoneySeries(list, '1900', '2026-08');
  const ov = c.valueOfMoney({ amount: c.toEuros(100, 'mk', '1900'), fromIdx: old.fromIdx, toIdx: old.toIdx });
  const note = c.moneyView({ amount: 100, currency: 'mk', pick: old, value: ov.value, factor: ov.factor });
  assert.match(note.note, /^Laskelma tehdään vuositasolla elinkustannusindeksillä \(1914:1–6=100\), koska kuukausisarjat alkavat elokuusta 1939 ja muut vuosikeskiarvot vuodesta 1952\./);
  assert.match(sp(note.sentence), /^100 mk \(vanhaa markkaa\) vuonna 1900 vastaa ostovoimaltaan [0-9 ,]+ € vuonna 2025\.$/);
});

test('savingsView and wageView texts', () => {
  const hist = c.savingsReal({ amount: 10000, nominalRate: 0, months: 60, fromIdx: 100, toIdx: 118.1 });
  const hv = c.savingsView(hist, { kind: 'history', from: '2021-08', to: '2026-08' });
  assert.equal(sp(hv.realLabel), 'Ostovoima elokuun 2021 rahassa');
  assert.equal(sp(hv.lead), 'Nimellisesti 10 000 €, mutta hinnat nousivat 18,1 % elokuusta 2021 elokuuhun 2026.');
  assert.match(sp(hv.realReturn), /^Todellinen tuotto −3,27 % vuodessa \(−15,3 % koko ajalta\)\.$/);
  const short = c.savingsReal({ amount: 1000, nominalRate: 0, months: 6, fromIdx: 100, toIdx: 101 });
  assert.match(sp(c.savingsView(short, { kind: 'history', from: '2026-02', to: '2026-08' }).realReturn), /koko ajalta\.$/);
  const fc = c.savingsReal({ amount: 10000, nominalRate: 2.5, months: 60, assumedInflation: 2.2 });
  const fv = c.savingsView(fc, { kind: 'forecast' });
  assert.equal(sp(fv.real), '10 147,64 €');
  assert.equal(sp(fv.lead), 'Nimellisesti 11 314,08 € 5 vuoden kuluttua, kun korko on 2,50 % ja inflaatio 2,2 % vuodessa.');
  assert.equal(sp(fv.realReturn), 'Todellinen tuotto on noin +0,29 % vuodessa.');

  const w = c.realWageChange({ before: 3200, after: 3300, cpiFrom: 2334, cpiTo: 2385 });
  const wv = c.wageView(w, { before: 3200, after: 3300, from: '2025-08', to: '2026-08' });
  assert.equal(sp(wv.real), '+0,9 %');
  assert.equal(wv.verdict, 'Ostovoimasi kasvoi.');
  assert.equal(sp(wv.lead), 'Palkkasi muuttui 3 200 € → 3 300 € (+3,1 %) elokuusta 2025 elokuuhun 2026. Hinnat nousivat samana aikana 2,2 %.');
  assert.equal(sp(wv.needed), '3 269,92 €');
  const down = c.wageView(c.realWageChange({ before: 3200, after: 3200, cpiFrom: 100, cpiTo: 102 }), { before: 3200, after: 3200, from: '2025-08', to: '2026-08' });
  assert.equal(down.verdict, 'Ostovoimasi heikkeni.');
  const flat = c.wageView(c.realWageChange({ before: 3000, after: 3060, cpiFrom: 100, cpiTo: 102 }), { before: 3000, after: 3060, from: '2025-08', to: '2026-08', lang: 'en' });
  assert.equal(flat.verdict, 'Your purchasing power stayed about the same.');
});

/* ------------------------------------------------- review fixes (QA round) */

test('parseDecimal (en): a comma is a thousands separator only in a well-formed grouping', () => {
  assert.equal(c.parseDecimal('850,50', 'en'), 850.5, 'European decimal comma');
  assert.equal(c.parseDecimal('850,5', 'en'), 850.5);
  assert.equal(c.parseDecimal('1,250', 'en'), 1250);
  assert.equal(c.parseDecimal('12,345,678', 'en'), 12345678);
  assert.equal(c.parseDecimal('12,345.50', 'en'), 12345.5);
  assert.equal(c.parseDecimal('12,,5', 'en'), null);
  assert.equal(c.parseDecimal('1,23,4', 'en'), null);
  assert.equal(c.parseDecimal('1,2345', 'en'), null);
  assert.equal(c.parseDecimal('12,,5'), null, 'fi as well');
  assert.equal(c.parseDecimal('12,,5.3'), null, 'broken grouping with both separators');
  assert.equal(c.parseDecimal('1.2.3'), null, 'dots that are not thousands groups');
  assert.equal(c.parseDecimal('−1,234.5', 'en'), -1234.5);
});

/** Evaluate a displayed Finnish formula ("900,00 € × (2 385 / 2 334 + 1 / 100)"). */
function evalFormula(text) {
  const expr = sp(text).split('=')[0].replace(/€/g, '').replace(/−/g, '-').replace(/(\d) (?=\d{3}\b)/g, '$1').replace(/,/g, '.').replace(/×/g, '*');
  // Only numbers, spaces, parentheses and + - * / are left: parse them without string evaluation.
  const tokens = expr.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  let i = 0;
  const factor = () => {
    const t = tokens[i++];
    if (t === '(') {
      const v = sum();
      i++; // ')'
      return v;
    }
    if (t === '-') return -factor();
    return Number(t);
  };
  const product = () => {
    let v = factor();
    while (tokens[i] === '*' || tokens[i] === '/') v = tokens[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const sum = () => {
    let v = product();
    while (tokens[i] === '+' || tokens[i] === '-') v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

test('rentView: the shown formula and notice reproduce the new rent to the cent (QA-CODE-05)', () => {
  const S = { series: { id: 'eki-1951', decimals: 0 }, base: '2025-08', check: '2026-08' };
  const cases = [{}, { extraPct: 1 }, { extraPct: 0.75 }, { minPct: 3 }, { minPct: 2.555 }, { maxPct: 2 }, { maxPct: 1.2345 }];
  for (const p of cases) {
    const r = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, ...p });
    const v = c.rentView(r, S);
    assert.equal(Math.round(evalFormula(v.formula) * 100) / 100, r.newRent, `${JSON.stringify(p)}: ${sp(v.formula)}`);
    const inNotice = sp(v.notice).match(/Uusi vuokra on (.+?) = /)[1];
    assert.equal(Math.round(evalFormula(inNotice) * 100) / 100, r.newRent, `notice ${JSON.stringify(p)}`);
  }
  const extra = c.rentView(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, extraPct: 1 }), S);
  assert.equal(sp(extra.formula), '900,00 € × (2 385 / 2 334 + 1 / 100) = 928,67 €');
  assert.doesNotMatch(sp(extra.notice), /\+ 3,19 %/, 'no rounded percentage in the notice');
  const min = c.rentView(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, minPct: 2.555 }), S);
  assert.match(sp(min.formula), /2,555 \/ 100/, 'the user’s own decimals');
  const euro = c.rentView(c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385, rounding: 'euro' }), S);
  assert.match(sp(euro.notice), /= 920,00 €\/kk \(pyöristetty lähimpään euroon\)\./);
});

test('rentView: the notice template says the review follows and when the new rent applies (CALC-06)', () => {
  const r = c.rentIncrease({ rent: 900, baseIndex: 2334, checkIndex: 2385 });
  const fi = c.rentView(r, { series: { id: 'eki-1951', decimals: 0 }, base: '2025-08', check: '2026-08' });
  assert.match(fi.notice, /^Vuokrasopimuksen indeksiehdon mukaisesti vuokraa tarkistetaan seuraavasti\. /);
  assert.match(fi.notice, /Uusi vuokra on voimassa \[päivämäärä\] alkaen\. Lähde: Tilastokeskus\.$/);
  const en = c.rentView(r, { series: { id: 'eki-1951', decimals: 0 }, base: '2025-08', check: '2026-08', lang: 'en' });
  assert.match(en.notice, /^Under the index clause of the lease, the rent is revised as follows\. /);
  assert.match(en.notice, /The new rent applies from \[date\]\. Source: Statistics Finland\.$/);
});

test('moneyView: markka inputs get the reverse sentence in markka, based on 100 € (QN-02, CALC-01)', { skip: !hasData && 'data/*.json missing' }, () => {
  const list = c.buildSeries(data, { ids: c.MONEY_SERIES_IDS });
  const view = (amount, currency, from, to, lang = 'fi') => {
    const pick = c.pickMoneySeries(list, from, to);
    const v = c.valueOfMoney({ amount: c.toEuros(amount, currency, pick.from), fromIdx: pick.fromIdx, toIdx: pick.toIdx });
    return c.moneyView({ amount, currency, pick, value: v.value, factor: v.factor }, lang);
  };
  // 1971: 100 € in 8/2026 ↔ 59,08 mk (factor 2385 / annual 1971 of 1951:10=100).
  const mk1971 = view(100, 'mk', '1971', '2026-08');
  assert.match(sp(mk1971.buys), /^Toisinpäin: 100 € elokuussa 2026 vastaa ostovoimaltaan 59,0\d mk vuonna 1971\.$/);
  assert.doesNotMatch(mk1971.buys, /€ vuonna 1971/, 'no euros for a markka year');
  // Old markka (before 1963): no "0,00 €", the amount in old markka.
  const mk1945 = view(100, 'mk', '1945', '2026-08');
  assert.match(sp(mk1945.buys), /^Toisinpäin: 100 € vuonna 2025 vastaa ostovoimaltaan [\d ]+,\d\d vanhaa markkaa vuonna 1945\.$/);
  assert.doesNotMatch(sp(mk1945.buys), /0,00 €/);
  // Euro input before euro cash: euros with the markka equivalent.
  const eur1950 = view(100, 'eur', '1950-06', '2026-08');
  assert.match(sp(eur1950.buys), /^Toisinpäin: 100 € elokuussa 2026 vastaa ostovoimaltaan [\d ]+,\d\d € \([\d ]+,\d\d vanhaa markkaa\) kesäkuussa 1950\.$/);
  const en = view(100, 'mk', '1971', '2026-08', 'en');
  assert.match(sp(en.buys), /^Conversely, €100 in August 2026 has the same purchasing power as 59\.0\d mk had in 1971\.$/);
});

test('moneyView: the annual-fallback note is true for 1939–1951 years too (QN-01)', { skip: !hasData && 'data/*.json missing' }, () => {
  const list = c.buildSeries(data, { ids: c.MONEY_SERIES_IDS });
  for (const from of ['1945', '1920', '1935-05']) {
    const pick = c.pickMoneySeries(list, from, '2026-08');
    assert.equal(pick.annualFallback, true, from);
    const v = c.valueOfMoney({ amount: 1, fromIdx: pick.fromIdx, toIdx: pick.toIdx });
    const fi = c.moneyView({ amount: 100, currency: 'mk', pick, value: v.value, factor: v.factor });
    assert.doesNotMatch(fi.note, /Ennen elokuuta 1939/, from);
    assert.match(fi.note, /koska kuukausisarjat alkavat elokuusta 1939 ja muut vuosikeskiarvot vuodesta 1952\./);
    const en = c.moneyView({ amount: 100, currency: 'mk', pick, value: v.value, factor: v.factor }, 'en');
    assert.match(en.note, /^The calculation uses annual figures of the cost-of-living index \(1914:1–6=100\), because the monthly series start in August 1939 and other annual averages in 1952\./);
  }
});

test('YKHI option: HICP series, months only, provisional flag (value of money)', () => {
  const ykhi = {
    months: ['1996-01', '1996-02', '1996-03'],
    geo: { FI: { index: { '2015=100': [71.2, 71.5, 71.6], '2025=100': [56.9, 57.1, null] } } },
    flags: { FI: { '1996-02': 'p' } },
  };
  const list = [...c.buildSeries(SAMPLE, { ids: c.MONEY_SERIES_IDS }), ...c.buildSeries({ ykhi })];
  const s = list.find((x) => x.id === 'ykhi-2025');
  assert.ok(s, 'newest base only');
  assert.equal(list.filter((x) => c.isYkhi(x.id)).length, 1);
  assert.equal(s.start, '1996-01');
  assert.deepEqual(s.values, [56.9, 57.1], 'trailing null removed');
  assert.deepEqual(s.provisional, ['1996-02']);
  assert.equal(c.seriesName('ykhi-2025'), 'Yhdenmukaistettu kuluttajahintaindeksi (2025=100)');
  assert.equal(c.seriesName('ykhi-2025', 'en'), 'Harmonised index of consumer prices (2025=100)');
  assert.equal(c.seriesBase('ykhi-2025'), '2025=100');
  const fam = { families: ['ykhi-2025'] };
  const pick = c.pickMoneySeries(list, '1996-01', '1996-02', fam);
  assert.equal(pick.family, 'ykhi-2025');
  assert.equal(pick.provisional, true);
  assert.deepEqual(c.pickMoneySeries(list, '1996', '1996-02', fam), { error: 'annual' }, 'no annual HICP averages');
  assert.deepEqual(c.pickMoneySeries(list, '1995-12', '1996-02', fam), { error: 'before' }, 'no fallback to other indices');
  assert.deepEqual(c.pickMoneySeries(list, '1996-01', '1996-03', fam), { error: 'future' });
  const v = c.valueOfMoney({ amount: 100, fromIdx: pick.fromIdx, toIdx: pick.toIdx });
  const view = c.moneyView({ amount: 100, currency: 'eur', pick, value: v.value, factor: v.factor });
  assert.equal(view.seriesName, 'Yhdenmukaistettu kuluttajahintaindeksi (2025=100)');
  assert.match(view.note, /Eurostatin ennakkotieto/);
  // The HICP never changes what the default (KHI chain) calculation picks.
  assert.equal(c.pickMoneySeries(list, '2025-07', '2025-09').family, 'khi-1972');
  // A HICP month published before the KHI is not "published" for the KHI chain.
  const ahead = { months: ['2025-09', '2025-10'], geo: { FI: { index: { '2025=100': [100, 100.2] } } } };
  const list2 = [...c.buildSeries(SAMPLE, { ids: c.MONEY_SERIES_IDS }), ...c.buildSeries({ ykhi: ahead })];
  assert.deepEqual(c.pickMoneySeries(list2, '2025-07', '2025-10'), { error: 'future' });
});

test('YKHI option with real data: 1/2000 → latest month', { skip: !(hasData && data.ykhi) && 'data/ykhi.json missing' }, () => {
  const list = [...c.buildSeries(data, { ids: c.MONEY_SERIES_IDS }), ...c.buildSeries({ ykhi: data.ykhi })];
  const s = list.find((x) => c.isYkhi(x.id));
  const last = c.latestPeriod(s);
  const pick = c.pickMoneySeries(list, '2000-01', last, { families: [s.family] });
  assert.equal(pick.family, s.family);
  assert.equal(pick.fromIdx, c.pointAt(s, '2000-01'));
  assert.equal(pick.toIdx, c.pointAt(s, last));
  const path = c.moneyPath(list, pick, 100);
  assert.equal(path.kind, 'month');
  assert.equal(path.labels[0], '2000-01');
  assert.equal(path.labels.at(-1), last);
});

test('personalHistory: the same weights for every month', () => {
  assert.deepEqual(c.personalHistory({ weights: { a: 1, b: 3 }, series: { a: [4, 2, null], b: [0, 2, null] }, length: 3 }), [1, 2, null]);
  const one = c.personalHistory({ weights: { a: 1, b: 1 }, series: { a: [2], b: [null] }, length: 1 });
  approx(one[0], 2, 1e-12, 'a missing group is left out of both sums');
  assert.deepEqual(c.personalHistory({ weights: {}, series: {}, length: 2 }), [null, null]);
});

test('personalHistory with real data: official weights track the official KHI', { skip: !data.hyodykkeet && 'data/hyodykkeet.json missing' }, () => {
  const h = data.hyodykkeet;
  const groups = h.items.filter((it) => it.level === 1);
  const weights = Object.fromEntries(groups.map((g) => [g.code, g.weight]));
  const series = Object.fromEntries(groups.map((g) => [g.code, h.groups.series[g.code].yoy]));
  const own = c.personalHistory({ weights, series, length: h.groups.months.length });
  assert.equal(own.length, h.groups.months.length);
  const official = h.groups.series.SSS.yoy;
  // Latest month: the same weights as the index → within rounding of the official rate.
  assert.ok(Math.abs(own.at(-1) - official.at(-1)) < 0.1, `${own.at(-1)} vs ${official.at(-1)}`);
});

/* ------------------------------------------------------ built calculator pages */

describe('calculator pages (built)', { skip: !(hasData && data.hyodykkeet) && 'data/*.json missing' }, () => {
  const MODULES = ['laskurit', 'vuokrankorotus', 'rahanarvo', 'oma-inflaatio', 'ostovoima', 'en-calculators'];
  let tmp;
  const pages = {};
  /** Visible text of a page (tags removed, entities and NBSPs normalised). */
  const text = (h) =>
    sp(
      h
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    ).replace(/\s+/g, ' ');
  const island = (h, id) => JSON.parse(h.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`))[1]);

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-calc-'));
    const out = path.join(tmp, 'dist');
    await build({ out, only: MODULES, quiet: true });
    for (const p of ['laskurit', 'vuokrankorotus', 'rahanarvo', 'oma-inflaatio', 'ostovoima', 'en/rent-increase-calculator', 'en/value-of-money']) {
      pages[p] = await fs.readFile(path.join(out, p, 'index.html'), 'utf8');
    }
  });
  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  test('/laskurit/: five cards in the 3-column grid, grammatical description (QV-25, CALC-08)', () => {
    const h = pages.laskurit;
    assert.match(h, /class="card-grid laskurit-grid"/);
    assert.equal((h.match(/class="card__link"/g) ?? []).length >= 5, true);
    assert.match(h, /<meta name="description" content="Laskurit vuokrankorotukselle, rahan arvolle, säästöille, omalle inflaatiolle ja ostovoimalle\./);
    const t = text(h);
    assert.doesNotMatch(t, /, eli hinnat/);
    assert.match(t, /Ansiot (nousivat|laskivat) vuodessa [\d,]+ % (ja|, mutta) reaaliansiot/);
  });

  test('/vuokrankorotus/: sources, clauses, example wording (QN-15, CALC-05, CALC-08)', () => {
    const t = text(pages.vuokrankorotus);
    assert.match(t, /kuluttajahintaindeksi, taulukot 11xs ja 15b5/);
    assert.match(t, /Laskuri · elinkustannusindeksi, [a-zäö]+ \d{4}/);
    assert.match(t, /Sopimuksen lisäehdot Vähimmäiskorotus \(valinnainen\)/);
    assert.doesNotMatch(t, /\(valinnaiset\)/);
    assert.match(t, /esimerkiksi elinkustannusindeksillä samojen kuukausien muutos on \+[\d,]+ %/);
    assert.match(t, /Jos tarkistusväli on muu kuin tasan vuosi, korotus voi poiketa vuosimuutoksesta selvästi\./);
    assert.doesNotMatch(t, /ero vuosimuutokseen on vielä suurempi/);
    assert.match(t, /vuokraa tarkistetaan seuraavasti\./);
  });

  test('/en/rent-increase-calculator/: component language options instead of local workarounds', () => {
    const h = pages['en/rent-increase-calculator'];
    assert.match(h, /<span class="field__optional">\(optional\)<\/span>/);
    assert.doesNotMatch(h, /\(valinnainen\)/);
    const t = text(h);
    assert.match(t, /Source: Statistics Finland \(cost-of-living index, table 11xl; consumer price index, tables 11xs and 15b5\) · Updated \d{1,2} [A-Z][a-z]+ \d{4}/);
    assert.match(t, /Index and base year/);
    assert.match(t, /Additional increase on top of the index/);
    assert.match(t, /Calculator · Cost-of-living index, [A-Z][a-z]+ \d{4}/);
  });

  test('/rahanarvo/: YKHI option, one live region, texts (gap, QA-CODE-10, CALC-02/03)', () => {
    const h = pages.rahanarvo;
    assert.match(h, /<select[^>]*id="indeksi"/);
    assert.match(h, /<option value="ykhi">Yhdenmukaistettu kuluttajahintaindeksi, YKHI \(Eurostat, vuodesta 1996\)<\/option>/);
    const d = island(h, 'raha-data');
    assert.deepEqual(d.families.khi, [...c.MONEY_FAMILIES]);
    assert.equal(d.families.ykhi.length, 1);
    assert.ok(d.series.some((s) => c.isYkhi(s.id)));
    assert.equal(d.params.index, 'indeksi');
    // The chart summary is not a second live region (the result panel announces).
    const figure = h.slice(h.indexOf('id="raha-kaavio"'));
    assert.doesNotMatch(figure.slice(0, figure.indexOf('</figure>')), /aria-live/);
    const t = text(h);
    assert.match(t, /Samaa ostovoimaa vastaava summa, €/);
    assert.match(t, /Eurokäteinen käyttöön \(1\/2002\)/);
    assert.match(t, /Laskuri kattaa ajan vuodesta 1860 lähtien\./);
    assert.match(t, /Toisinpäin: 100 € /);
    assert.match(t, /Vuosikeskiarvot ennen vuotta 1952: elinkustannusindeksi 1914:1–6=100 \(11xy\)/);
    assert.match(t, /samojen tavaroiden ja palvelujen ostamiseen/);
    assert.match(t, /Ne eivät ota huomioon veroja, kuluja tai korkojen muutoksia, eivätkä ne ole/);
    assert.match(h, /data-msg-inflation="Anna oletettu inflaatio prosentteina \(−10 ja 30 väliltä\), esimerkiksi 2\."/);
    assert.match(h, /data-msg-before="Laskuri kattaa ajan vuodesta \{alku\} lähtien\."/);
  });

  test('/en/value-of-money/: savings section in English, English idiom (gap, CALC-09)', () => {
    const h = pages['en/value-of-money'];
    assert.match(h, /<section class="section raha-saastot" id="savings"/);
    const s = island(h, 'saasto-data');
    assert.equal(s.lang, 'en');
    assert.equal(s.params.hAmount, 'hamount');
    const t = text(h);
    for (const phrase of ['What has happened to savings?', 'What will happen to savings?', 'Not investment advice', 'Purchasing power in', 'The result shows how much money is needed to buy the same basket', 'Markka amounts are converted at 5.94573 markka per euro.', 'The calculator goes back to 1860.']) {
      assert.ok(t.includes(phrase), phrase);
    }
    assert.doesNotMatch(t, /Säästösumma|Toteutunut tuotto|Nimellinen arvo/);
    assert.match(t, /Calculator · Consumer price index, [A-Z][a-z]+ \d{4}/);
    assert.match(t, /Conversely, €100 in [A-Z][a-z]+ \d{4} has the same purchasing power as/);
  });

  test('/oma-inflaatio/: 5-year chart, hint state, labelled contribution (gap, QV-26, QN-09, CALC-04)', () => {
    const h = pages['oma-inflaatio'];
    assert.match(h, /<figure class="chart-figure" id="oi-kehitys"/);
    assert.match(h, /data-chart="oi-kehitys"/);
    assert.equal((h.match(/<tr[^>]*>/g) ?? []).length > 60, true, '60 months in the table');
    assert.match(h, /<p class="calc__hint" data-result-hint hidden>/);
    const d = island(h, 'oma-data');
    assert.equal(d.history.months.length, data.hyodykkeet.groups.months.length);
    const t = text(h);
    assert.match(t, /Suurin tekijä omassa inflaatiossasi: [a-zäö ,-]+ \(osuus × hintamuutos [+−][\d,]+ %-yks\.\)/);
    assert.match(t, /voi poiketa hieman virallisesta luvusta/);
    assert.match(t, /Arvio osuuksillasi oli [−\d,]+ % [a-zäö]+ \d{4}; virallinen KHI oli/);
    assert.match(t, /Laskuri · hyödykeryhmät, [a-zäö]+ \d{4}/);
  });

  test('/ostovoima/: second person, wording and labels (CALC-02, CALC-07)', () => {
    const h = pages.ostovoima;
    const t = text(h);
    assert.match(t, /Riittääkö palkankorotuksesi\?/);
    assert.doesNotMatch(t, /palkankorotukseni/);
    assert.doesNotMatch(t, / vs\. /);
    assert.match(t, /Reaaliansiot vuoteen 2015 verrattuna/);
    assert.match(h, /data-label-more="Näytä kaikki neljännekset \(\d+\)"/);
    assert.match(h, /data-msg-before="Laskurin varhaisin kuukausi on \{alku\}\."/);
    assert.match(t, /Nimelliset ansiot ovat (nousseet|laskeneet) [\d,]+ % vuoden 2015 tasosta/);
    assert.match(t, /Esimerkiksi 3 200 € → 3 300 € on \+[\d,]+ %, ja hinnat (nousivat|laskivat) [\d,]+ % [a-zäö]+ \d{4} [a-zäö]+ \d{4}, joten ostovoima (kasvoi|heikkeni|pysyi)/);
    assert.doesNotMatch(t, /Ansiotaso nousi/, 'no repeated verb form of the old lede');
  });
});
