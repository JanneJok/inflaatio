import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as c from '../src/js/lib/calc.js';

/** NBSP → space for readable expectations. */
const sp = (s) => String(s).replace(/\u00A0/g, ' ');
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
  assert.equal(sp(view.buys), 'Toisin päin: 100 € elokuussa 2026 vastaa ostovoimaltaan 61,46 € tammikuussa 2000.');
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
  assert.match(sp(fi.change), /^Hinnat olivat tammikuussa 2000 38,5 % alemmat\.$/);
  assert.equal(fi.buys, '', 'no reverse sentence before euro cash');
  assert.equal(fi.note, '');
  const en = c.moneyView({ amount: 100, currency: 'eur', pick: c.pickMoneySeries(list, '2000-01', '2026-08'), value: 162.71, factor: 1.6271 }, 'en');
  assert.equal(en.sentence, '€100 in January 2000 is equivalent to €162.71 in August 2026.');
  const old = c.pickMoneySeries(list, '1900', '2026-08');
  const ov = c.valueOfMoney({ amount: c.toEuros(100, 'mk', '1900'), fromIdx: old.fromIdx, toIdx: old.toIdx });
  const note = c.moneyView({ amount: 100, currency: 'mk', pick: old, value: ov.value, factor: ov.factor });
  assert.match(note.note, /^Ennen elokuuta 1939 laskelma tehdään vuositasolla/);
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
