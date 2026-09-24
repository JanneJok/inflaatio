/**
 * TOPICS pages: /hinnat/ (+ /hinnat/<slug>/), /polttoaineet/, /vertailu/, /korot/.
 * Pure calculations with fixtures, checks against the committed data files,
 * and a build of the four modules (every commodity route, titles, CSP, charts).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, cspProblems, ROOT } from '../scripts/build.js';
import { ymAdd } from '../src/js/lib/format.js';
import {
  fitText,
  effectiveWeight,
  itemsByCode,
  topMovers,
  contributionCheck,
  contributionHistory,
  commodityModels,
  commodityText,
  longRunChange,
  stackedBarsSvg,
  signed,
  joinFi,
  countWord,
  elativeSuffix,
  positivesSentence,
  commoditySubject,
  TITLE_PHRASES,
  MIN_WEIGHT,
} from '../src/pages/hinnat.js';
import { realRate, realRateSeries, decisionRows } from '../src/pages/korot.js';
import { fuelRows, perLitre, yearChangeSentence } from '../src/pages/polttoaineet.js';
import { latestByGeo, euRank, annualGaps, extremesWithTies, ordinalTranslative, rankSentence, latestSummary, areaInText, AGGREGATES } from '../src/pages/vertailu.js';
import { datasetsOf, slice, rangeKey, periodOf } from '../src/js/pages/hinnat.js';
import { valueFormatter } from '../src/js/charts/setup.js';

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const has = (rel) => existsSync(path.join(ROOT, rel));
const NBSP = ' ';

/* ------------------------------------------------------------- fixtures */

const H = {
  latest: '2026-08',
  weightYear: '2026',
  items: [
    { code: 'SSS', level: 0, parent: null, weight: 1000, yoy: 2.2, mom: -0.2, contribution: 2.183, leaf: false },
    { code: '01', level: 1, parent: 'SSS', weight: 600, yoy: 1, contribution: 0.6, leaf: false, shortName: 'Ruoka' },
    { code: '07', level: 1, parent: 'SSS', weight: 400, yoy: 4, contribution: 1.585, leaf: false, shortName: 'Liikenne' },
    { code: '011', level: 2, parent: '01', weight: 5, yoy: 1, contribution: 0.005, leaf: false },
    { code: '0111', level: 3, parent: '011', weight: null, yoy: 30, contribution: 0.1, leaf: true }, // parent weight 5 ‰
    { code: '0112', level: 3, parent: '011', weight: 0.5, yoy: 50, contribution: 0.01, leaf: true }, // too small
    { code: '0113', level: 3, parent: '011', weight: 2, yoy: -4, contribution: -0.01, leaf: true },
    { code: '0114', level: 3, parent: '011', weight: 2, yoy: null, contribution: null, leaf: true }, // no data
    { code: '071', level: 2, parent: '07', weight: 3, yoy: 10, contribution: 0.3, leaf: true },
    { code: '072', level: 2, parent: '07', weight: 3, yoy: -10, contribution: -0.3, leaf: true },
    { code: '073', level: 2, parent: '07', weight: 3, yoy: 0, contribution: 0, leaf: true }, // unchanged: on neither list
  ],
  groups: {
    months: ['2026-05', '2026-06', '2026-07', '2026-08'],
    codes: ['SSS', '01', '07'],
    series: {
      SSS: { yoy: [2, 2.1, 2.1, 2.2], contribution: [null, 2.07, 2.13, 2.183] },
      '01': { yoy: [1, 1, 1, 1], contribution: [null, 0.5, 0.55, 0.6] },
      '07': { yoy: [4, 4, 4, 4], contribution: [null, 1.57, 1.58, 1.585] },
    },
  },
};

/* ------------------------------------------------------------ helpers */

describe('helpers', () => {
  test('fitText picks the first candidate that fits, else the shortest', () => {
    assert.equal(fitText(['a'.repeat(50), 'bbb', 'cc'], 45), 'bbb');
    assert.equal(fitText(['a'.repeat(50), 'b'.repeat(47)], 45), 'b'.repeat(47));
    assert.equal(fitText([null, 'x'], 45), 'x');
  });

  test('signed() drops the ± of a zero change', () => {
    assert.equal(signed(2.2), `+2,2${NBSP}%`);
    assert.equal(signed(-0.4), `−0,4${NBSP}%`);
    assert.equal(signed(0), `0,0${NBSP}%`);
    assert.equal(signed(0.04), `0,0${NBSP}%`);
    assert.equal(signed(null), '–');
  });

  test('joinFi, countWord and elativeSuffix build Finnish list and count phrases', () => {
    assert.equal(joinFi([]), '');
    assert.equal(joinFi(['Norja']), 'Norja');
    assert.equal(joinFi(['a', 'b']), 'a ja b');
    assert.equal(joinFi(['euroalue', 'EU', 'Norja']), 'euroalue, EU ja Norja');
    assert.equal(countWord(10), 'kymmenen');
    assert.equal(countWord(13), 'kolmetoista');
    assert.equal(countWord(25), '25');
    assert.equal(elativeSuffix(13), 'sta'); // kolmestatoista
    assert.equal(elativeSuffix(12), 'sta'); // kahdestatoista
    assert.equal(elativeSuffix(10), 'stä'); // kymmenestä
    assert.equal(elativeSuffix(11), 'stä'); // yhdestätoista
    assert.equal(elativeSuffix(121), 'stä');
    assert.equal(elativeSuffix(14), 'stä'); // neljästätoista
  });

  test('positivesSentence: number word, partitive and the right elative ending (13:sta)', () => {
    assert.equal(positivesSentence(10, 13, 'elokuussa 2026'), 'Kymmenen pääryhmää 13:sta nosti inflaatiota elokuussa 2026.');
    assert.equal(positivesSentence(1, 13, 'elokuussa 2026'), 'Yksi pääryhmä 13:sta nosti inflaatiota elokuussa 2026.');
    assert.equal(positivesSentence(0, 13, 'elokuussa 2026'), 'Mikään pääryhmä ei nostanut inflaatiota elokuussa 2026.');
  });

  test('every commodity slug has a title phrase', () => {
    const pages = readJson('scripts/fetch/hyodykesivut.json');
    for (const p of pages) assert.ok(TITLE_PHRASES[p.slug], `TITLE_PHRASES is missing ${p.slug}`);
  });
});

/* ------------------------------------------------- contributions / movers */

describe('hinnat calculations', () => {
  test('effectiveWeight falls back to the nearest ancestor with a weight', () => {
    const by = itemsByCode(H);
    assert.deepEqual(effectiveWeight(by.get('0113'), by), { weight: 2, own: true });
    assert.deepEqual(effectiveWeight(by.get('0111'), by), { weight: 5, own: false });
    assert.deepEqual(effectiveWeight({ code: 'x', parent: 'nope', weight: null }, by), { weight: null, own: false });
  });

  test('topMovers: leaves only, weight ≥ 1 ‰ (own or parent), sorted, zero excluded', () => {
    const m = topMovers(H, { n: 10 });
    assert.deepEqual(m.up.map((i) => i.code), ['0111', '071']);
    assert.deepEqual(m.down.map((i) => i.code), ['072', '0113']);
    assert.equal(m.eligible, 5); // 0111, 0113, 071, 072, 073
    assert.ok(!m.up.some((i) => i.code === '0112'), '0,5 ‰ item is filtered out');
    assert.equal(topMovers(H, { n: 1 }).up.length, 1);
    assert.equal(MIN_WEIGHT, 1);
  });

  test('contributionCheck reports the sum of main groups against the total', () => {
    const c = contributionCheck(H);
    assert.equal(c.sum, 2.185);
    assert.equal(c.total, 2.183);
    assert.equal(c.diff, 0.002);
    assert.equal(c.diffYoy, -0.015);
  });

  test('contributionHistory keeps only the months with published contributions', () => {
    const hist = contributionHistory(H, { highlight: 1 });
    assert.deepEqual(hist.months, ['2026-06', '2026-07', '2026-08']);
    assert.deepEqual(hist.codes, ['07']); // largest mean |contribution|
    assert.deepEqual(hist.otherCodes, ['01']);
    assert.deepEqual(hist.others, [0.5, 0.55, 0.6]);
    assert.deepEqual(hist.total, [2.07, 2.13, 2.183]);
    assert.equal(contributionHistory(H, { maxMonths: 2 }).months.length, 2);
  });

  test('committed data: main-group contributions add up to the total (check reported)', { skip: !has('data/hyodykkeet.json') }, () => {
    const h = readJson('data/hyodykkeet.json');
    const c = contributionCheck(h);
    // Tilastokeskus rounds each contribution to 3 decimals: 13 groups → ≤ 0.02 %-yks.
    assert.ok(Math.abs(c.diff) <= 0.02, `sum ${c.sum} vs total contribution ${c.total} (diff ${c.diff})`);
    assert.ok(Math.abs(c.diffYoy) <= 0.1, `sum ${c.sum} vs total annual change ${c.yoy} (diff ${c.diffYoy})`);
    // …and in every month of the history.
    const g = h.groups;
    const codes = g.codes.filter((x) => x !== 'SSS');
    g.months.forEach((ym, i) => {
      const total = g.series.SSS.contribution[i];
      if (total == null) return;
      const sum = codes.reduce((s, x) => s + (g.series[x].contribution[i] ?? 0), 0);
      assert.ok(Math.abs(sum - total) <= 0.02, `${ym}: sum ${sum.toFixed(3)} vs ${total}`);
    });
    console.log(`# contributions ${h.latest}: groups ${c.sum} vs total ${c.total} (diff ${c.diff}), annual change ${c.yoy}`);
  });
});

/* ------------------------------------------------------- commodity pages */

describe('commodity pages', () => {
  const data = has('data/hyodykesarjat.json') ? { hyodykesarjat: readJson('data/hyodykesarjat.json'), khi: readJson('data/khi.json'), hyodykkeet: readJson('data/hyodykkeet.json') } : null;

  test('slugs are unique and URL-safe in hyodykesivut.json and the models', () => {
    const pages = readJson('scripts/fetch/hyodykesivut.json');
    const slugs = pages.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length, 'duplicate slug in hyodykesivut.json');
    for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    const codes = pages.map((p) => p.code);
    assert.equal(new Set(codes).size, codes.length, 'duplicate code in hyodykesivut.json');
    if (data) {
      const models = commodityModels(data);
      assert.equal(new Set(models.map((m) => m.path)).size, models.length);
    }
  });

  test('every item with data gets a model with the right month and KHI comparison', { skip: !data }, () => {
    const models = commodityModels(data);
    const withData = Object.entries(data.hyodykesarjat.items).filter(([, it]) => it.yoy?.some((v) => v != null));
    assert.equal(models.length, withData.length);
    const beef = models.find((m) => m.slug === 'naudanliha');
    assert.ok(beef);
    assert.equal(beef.month, data.hyodykesarjat.latest);
    assert.equal(beef.rank >= 1 && beef.rank <= beef.peers, true);
    const khiIdx = data.khi.months.indexOf(beef.month);
    assert.equal(beef.khiYoy, data.khi.yoy[khiIdx]);
    assert.equal(beef.group?.code, '01');
  });

  test('commodityText: rise, fall, zero and plural subjects read correctly', () => {
    const base = { slug: 'x', month: '2026-08', khiYoy: 2.2 };
    const up = commodityText({ ...base, yoy: 30.7, diff: 28.5 }, null);
    // Month first so the year and the value are never side by side ("2026 30,7 %").
    assert.match(up[0], /^Elokuussa 2026 hinnat olivat 30,7 % korkeammat kuin vuotta aiemmin\.$/);
    assert.match(up[1], /28,5 prosenttiyksikköä keskimääräistä nopeampaa\.$/);
    const down = commodityText({ ...base, yoy: -0.2, diff: -2.4 }, null);
    assert.match(down[0], /0,2 % alemmat/);
    assert.ok(!down[0].includes('matalammat'));
    assert.match(down[1], /hitaampaa\.$/);
    assert.match(commodityText({ ...base, yoy: 0, diff: -2.2 }, null)[0], /samalla tasolla/);
    assert.match(commodityText({ ...base, yoy: 2.4, diff: 0.2 }, null)[1], /lähellä keskimääräistä/);
    assert.match(commodityText({ ...base, slug: 'vuokra', yoy: -0.2, diff: -2.4 }, null)[0], /^Elokuussa 2026 vuokrat olivat/);
    assert.equal(commodityText({ ...base, slug: 'kahvi', yoy: -3.5, diff: -5.7 }, null)[0], `Elokuussa 2026 kahvin hinnat olivat 3,5${NBSP}% alemmat kuin vuotta aiemmin.`);
    const long = { start: '2016-08', end: '2026-08', years: 10, item: 45.2, khi: 24.7 };
    assert.match(commodityText({ ...base, yoy: 1, diff: -1.2 }, long)[2], /^Kymmenessä vuodessa \(elokuusta 2016 elokuuhun 2026\) hinnat ovat nousseet 45,2 %, kun kaikki kuluttajahinnat ovat nousseet 24,7 %\.$/);
  });

  test('commoditySubject derives the plural subject from the title phrase', () => {
    assert.deepEqual(commoditySubject({ slug: 'kahvi' }), { text: 'kahvin hinnat', prices: true });
    assert.deepEqual(commoditySubject({ slug: 'hedelmat' }), { text: 'hedelmien hinnat', prices: true });
    assert.deepEqual(commoditySubject({ slug: 'ravintolat' }), { text: 'ravintolahinnat', prices: true });
    assert.deepEqual(commoditySubject({ slug: 'asuntolainojen-korot' }), { text: 'asuntolainojen korkomenot', prices: false });
    assert.deepEqual(commoditySubject({ slug: 'elokuvat-ja-teatteri' }), { text: 'hinnat', prices: true });
    assert.deepEqual(commoditySubject({ slug: 'x' }), { text: 'hinnat', prices: true });
  });

  test('longRunChange compares the item index and the KHI over the same months', () => {
    const months = Array.from({ length: 121 }, (_, i) => ymAdd('2016-08', i));
    const model = { months, indexSeries: months.map((_, i) => 100 + i / 10) };
    const khi = { months, index: { '2025=100': months.map(() => 100) } };
    const r = longRunChange(model, khi);
    assert.equal(r.start, '2016-08');
    assert.equal(r.end, '2026-08');
    assert.equal(r.years, 10);
    assert.equal(r.item, 12);
    assert.equal(r.khi, 0);
  });

  test('stackedBarsSvg: accessible, CSP-safe, stacks negatives below zero', () => {
    const svgOut = String(
      stackedBarsSvg({
        months: ['2026-07', '2026-08'],
        stacks: [
          { cls: 's3', label: 'A', values: [0.5, -0.2] },
          { cls: 's4', label: 'B', values: [0.3, 0.4] },
        ],
        total: { label: 'Yhteensä', values: [0.8, 0.2] },
        ariaLabel: 'Testi',
      }),
    );
    assert.match(svgOut, /role="img"/);
    assert.match(svgOut, /aria-label="Testi"/);
    assert.equal((svgOut.match(/<rect /g) ?? []).length, 4);
    assert.equal((svgOut.match(/chart-dot--khi/g) ?? []).length, 2);
    assert.match(svgOut, /<path class="chart-line chart-line--khi" d="M5 [\d.]+L15 [\d.]+"/, 'the total is drawn as a line, as in the interactive chart');
    assert.deepEqual(cspProblems(svgOut), []);
    assert.throws(() => stackedBarsSvg({ months: [], stacks: [] }), /ariaLabel/);
  });
});

/* ----------------------------------------------------------------- korot */

describe('korot calculations', () => {
  test('realRate = nominal − inflation without float noise', () => {
    assert.equal(realRate(2.954, 2.2), 0.754);
    assert.equal(realRate(-0.5, 1.1), -1.6);
    assert.equal(realRate(0.3, 0.3), 0);
    assert.equal(realRate(null, 2), null);
    assert.equal(realRate(2, undefined), null);
  });

  test('realRateSeries aligns the KHI by month and leaves gaps as null', () => {
    const korot = { months: ['2026-06', '2026-07', '2026-08'], euribor12: [2.798, 2.855, 2.954] };
    const khi = { months: ['2026-05', '2026-06', '2026-07'], yoy: [2.1, 2.1, 2.1] };
    assert.deepEqual(realRateSeries(korot, khi), { months: korot.months, values: [0.698, 0.755, null] });
  });

  test('committed data: the latest real rate uses the same month for both inputs', { skip: !has('data/korot.json') }, () => {
    const k = readJson('data/korot.json');
    const khi = readJson('data/khi.json');
    const r = realRateSeries(k, khi);
    const i = r.values.findLastIndex((v) => v != null);
    const ym = r.months[i];
    assert.equal(r.values[i], Math.round((k.euribor12[i] - khi.yoy[khi.months.indexOf(ym)]) * 1000) / 1000);
  });

  test('decisionRows: newest first, change in %-points, first row is the starting level', () => {
    const rows = decisionRows([
      { date: '1999-01-01', depositRate: 2 },
      { date: '2026-06-17', depositRate: 2.25 },
      { date: '2026-09-16', depositRate: 2.5 },
    ]);
    assert.deepEqual(rows, [
      { date: '2026-09-16', rate: 2.5, change: 0.25 },
      { date: '2026-06-17', rate: 2.25, change: 0.25 },
      { date: '1999-01-01', rate: 2, change: null },
    ]);
  });
});

/* ------------------------------------------------------- fuels / compare */

describe('polttoaineet and vertailu calculations', () => {
  test('fuelRows: € and % change from a year earlier', () => {
    const months = Array.from({ length: 13 }, (_, i) => ymAdd('2025-08', i));
    const p = { months, labels: { diesel: 'Diesel' }, series: { diesel: [1.61, ...Array(11).fill(2), 2.25] } };
    const [d] = fuelRows(p, '2026-08');
    assert.equal(d.month, '2026-08');
    assert.equal(d.value, 2.25);
    assert.equal(d.yearAgo, 1.61);
    assert.equal(d.diffYear, 0.64);
    assert.equal(Math.round(d.pctYear * 10) / 10, 39.8);
    assert.equal(perLitre(2.09), `2,09${NBSP}€/l`);
    assert.equal(perLitre(null), '–');
  });

  test('yearChangeSentence says the shared verb once and handles opposite and flat changes', () => {
    const row = (diffYear, pctYear) => ({ diffYear, pctYear });
    assert.equal(yearChangeSentence(row(0.4, 23.7), row(0.64, 39.8)), `Vuodessa bensiinin litrahinta nousi 0,40${NBSP}€ (+23,7${NBSP}%) ja dieselin 0,64${NBSP}€ (+39,8${NBSP}%).`);
    assert.equal(yearChangeSentence(row(0.1, 5), row(-0.05, -2)), `Vuodessa bensiinin litrahinta nousi 0,10${NBSP}€ (+5,0${NBSP}%) ja dieselin laski 0,05${NBSP}€ (−2,0${NBSP}%).`);
    assert.equal(yearChangeSentence(row(0, 0), row(0.1, 5)), `Vuodessa bensiinin litrahinta pysyi ennallaan ja dieselin nousi 0,10${NBSP}€ (+5,0${NBSP}%).`);
    assert.equal(yearChangeSentence(row(0.001, 0), row(0, 0)), 'Vuodessa bensiinin ja dieselin litrahinnat pysyivät ennallaan.');
  });

  test('extremesWithTies lists every tie (on the shown 1-decimal value); aggregates are EA and EU', () => {
    const rows = [
      { geo: 'FI', label: 'Suomi', value: 2.4 },
      { geo: 'EA', label: 'Euroalue', value: 3.2 },
      { geo: 'EU', label: 'EU', value: 3.2 },
      { geo: 'SE', label: 'Ruotsi', value: 0.3 },
      { geo: 'NO', label: 'Norja', value: 3.2 },
      { geo: 'DK', label: 'Tanska', value: 3.24 },
      { geo: 'XX', label: 'Tyhjä', value: null },
    ];
    const all = extremesWithTies(rows);
    assert.deepEqual(all.max.rows.map((r) => r.geo), ['EA', 'EU', 'NO', 'DK']);
    assert.equal(all.min.value, 0.3);
    const countries = extremesWithTies(rows.filter((r) => !AGGREGATES.includes(r.geo)));
    assert.deepEqual(countries.max.rows.map((r) => r.geo), ['NO', 'DK']);
    assert.equal(extremesWithTies([]), null);
  });

  test('ordinalTranslative and rankSentence: "seitsemänneksi matalin", rank 1 "matalin", big ranks as numbers', () => {
    assert.equal(ordinalTranslative(1), '');
    assert.equal(ordinalTranslative(2), 'toiseksi');
    assert.equal(ordinalTranslative(7), 'seitsemänneksi');
    assert.equal(ordinalTranslative(10), 'kymmenenneksi');
    assert.equal(ordinalTranslative(13), 'kolmanneksitoista');
    assert.equal(ordinalTranslative(20), null);
    const r = { rank: 7, total: 27, value: 2.4, month: '2026-08' };
    assert.equal(rankSentence(r), `Suomen inflaatio 2,4${NBSP}% oli elokuussa 2026 seitsemänneksi matalin EU:n 27 jäsenmaan joukossa.`);
    assert.match(rankSentence({ ...r, rank: 1 }), /elokuussa 2026 matalin EU:n/);
    assert.match(rankSentence({ ...r, rank: 23 }), /sijalla 23 EU:n 27 jäsenmaan joukossa, kun maat järjestetään matalimmasta/);
    assert.ok(!/\d+\. matalin/.test(rankSentence(r)));
  });

  test('latestSummary: one month → month first; different months → each with its own month', () => {
    const fi = { label: 'Suomi', value: 2.4, month: '2026-08' };
    const ea = { label: 'Euroalue', value: 3.2, month: '2026-08' };
    assert.equal(latestSummary([fi, ea]), `Elokuussa 2026: Suomi 2,4${NBSP}% ja euroalue 3,2${NBSP}%.`);
    assert.equal(latestSummary([fi, { ...ea, month: '2026-07' }]), `Viimeisimmät luvut: Suomi 2,4${NBSP}% (elo 2026) ja euroalue 3,2${NBSP}% (heinä 2026).`);
    assert.equal(areaInText('Ruotsi'), 'Ruotsi');
  });

  test('latestByGeo keeps each area’s own latest month and flags provisional values', () => {
    const y = {
      months: ['2026-06', '2026-07', '2026-08'],
      geo: { FI: { yoy: [2.7, 2.5, 2.4] }, EA: { yoy: [2.8, 2.9, 3.2] }, NO: { yoy: [2.6, 2.9, null] } },
      labels: { FI: 'Suomi', EA: 'Euroalue', NO: 'Norja' },
      flags: { FI: { '2026-08': 'p' } },
    };
    const rows = latestByGeo(y);
    assert.deepEqual(rows.map((r) => r.geo), ['FI', 'EA', 'NO']);
    const [fi, ea, no] = rows;
    assert.equal(fi.provisional, true);
    assert.equal(fi.delta, -0.1);
    assert.equal(ea.delta, 0.3);
    assert.equal(no.month, '2026-07');
    assert.equal(no.value, 2.9);
  });

  test('euRank: 1 = lowest inflation, ties share the better rank', () => {
    const y = { countries: { months: ['2026-08'], labels: { FI: 'Suomi', SE: 'Ruotsi', DK: 'Tanska', MT: 'Malta', RO: 'Romania' }, yoy: { FI: [2.4], SE: [0.3], DK: [2], MT: [2], RO: [6.3] } } };
    const r = euRank(y, 'FI');
    assert.equal(r.rank, 4);
    assert.equal(r.total, 5);
    assert.equal(r.values[0].geo, 'SE');
    assert.equal(euRank(y, 'XX'), null);
  });

  test('annualGaps uses the official annual tables of both indices', () => {
    const data = {
      'khi-annual': { years: ['2023', '2024', '2025'], yoy: [6.2, 1.6, 0.3] },
      'ykhi-annual': { years: ['2023', '2024', '2025'], geo: { FI: [4.3, 1, 1.8] } },
    };
    assert.deepEqual(annualGaps(data, 2), [
      { year: '2024', khi: 1.6, ykhi: 1, gap: 0.6 },
      { year: '2025', khi: 0.3, ykhi: 1.8, gap: -1.5 },
    ]);
  });
});

/* --------------------------------------------------- browser chart helpers */

describe('interactive chart spec (src/js/pages/hinnat.js)', () => {
  const months = Array.from({ length: 30 }, (_, i) => ymAdd('2024-03', i));
  const spec = {
    months,
    ranges: ['1v', 'kaikki'],
    range: '1v',
    datasets: [
      { type: 'line', series: 's5', label: 'A', data: months.map((_, i) => i) },
      { type: 'line', series: 'khi', label: 'B', data: months.map(() => 1), dashed: true },
    ],
  };

  test('slice(): default range, explicit range and unknown keys', () => {
    const d = slice(spec, undefined);
    assert.equal(d.months.length, 13);
    assert.equal(d.months.at(-1), months.at(-1));
    assert.deepEqual(d.series[0], spec.datasets[0].data.slice(-13));
    assert.equal(slice(spec, 'kaikki').months.length, 30);
    assert.equal(slice(spec, '5v').months.length, 13, 'a range not offered falls back to the default');
    const noRanges = { ...spec, ranges: undefined };
    assert.equal(slice(noRanges, '1v').months.length, 30);
  });

  test('rangeKey() accepts only offered ranges; periodOf() gives the subtitle period', () => {
    assert.equal(rangeKey(spec, 'kaikki'), 'kaikki');
    assert.equal(rangeKey(spec, '5v'), '1v');
    assert.equal(rangeKey(spec, 'bogus'), '1v');
    assert.equal(rangeKey(spec, null), '1v');
    assert.equal(periodOf(slice(spec, '1v').months), 'elo 2025 – elo 2026');
    assert.equal(periodOf([]), '');
  });

  test('datasetsOf(): a dataset’s own decimals are kept (KHI 1 decimal next to rates with 2)', () => {
    assert.equal(valueFormatter('%', 1)(2.2), `2,2${NBSP}%`);
    assert.equal(valueFormatter('%', 2)(2.2), `2,20${NBSP}%`);
    const [khiDs, rateDs] = datasetsOf({ datasets: [{ type: 'line', series: 'khi', label: 'KHI', data: [2.2], decimals: 1 }, { type: 'line', series: 's5', label: 'Euribor', data: [2.954] }] }, [[2.2], [2.954]]);
    assert.equal(khiDs.decimals, 1);
    assert.equal(rateDs.decimals, undefined);
  });

  test('datasetsOf(): line/bar datasets keep series, stacks and draw the total on top', () => {
    const stacked = {
      stacked: true,
      datasets: [
        { type: 'bar', series: 's3', label: 'Liikenne', data: [1], stack: 'ryhmat' },
        { type: 'line', series: 'khi', label: 'Yhteensä', data: [1], stack: 'yhteensa' },
      ],
    };
    const [bar, line] = datasetsOf(stacked, [[0.9], [2.2]]);
    assert.equal(bar.type, 'bar');
    assert.equal(bar.series, 's3');
    assert.equal(bar.stack, 'ryhmat');
    assert.deepEqual(bar.data, [0.9]);
    assert.equal(line.type, 'line');
    assert.equal(line.stack, 'yhteensa');
    assert.equal(line.order, -1);
    const [a, b] = datasetsOf(spec, [[1], [2]]);
    assert.deepEqual(a.borderDash, []);
    assert.deepEqual(b.borderDash, [5, 4]);
    assert.equal(a.order, undefined);
  });
});

/* ---------------------------------------------------------------- content */

test('ennusteet.json: verified forecasts with publisher url, date, measure and area', () => {
  if (!has('src/content/ennusteet.json')) return;
  const list = readJson('src/content/ennusteet.json');
  assert.ok(Array.isArray(list));
  for (const f of list) {
    assert.ok(f.org && f.url && f.title, 'org, title and url');
    assert.match(f.url, /^https:\/\//);
    assert.match(f.published, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['KHI', 'YKHI'].includes(f.measure), `measure ${f.measure}`);
    assert.ok(['FI', 'EA'].includes(f.area), `area ${f.area}`);
    const years = Object.keys(f.values);
    assert.ok(years.length > 0);
    for (const [yr, v] of Object.entries(f.values)) {
      assert.match(yr, /^\d{4}$/);
      assert.ok(typeof v === 'number' && v > -5 && v < 30, `${f.org} ${yr}: ${v}`);
    }
  }
});

/* ------------------------------------------------------------------ build */

describe('build of the TOPICS modules', { skip: !has('data/hyodykkeet.json') }, () => {
  let tmp;
  let out;
  let result;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-topics-'));
    out = path.join(tmp, 'dist');
    result = await build({ out, only: ['hinnat', 'polttoaineet', 'vertailu', 'korot'], quiet: true });
  });
  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  const read = (p) => fs.readFile(path.join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');

  test('every hyodykesivu with data has a route, plus the four topic pages', async () => {
    const sarjat = readJson('data/hyodykesarjat.json');
    const pages = readJson('scripts/fetch/hyodykesivut.json');
    const expected = pages.filter((p) => sarjat.items[p.slug]?.yoy?.some((v) => v != null)).map((p) => `/hinnat/${p.slug}/`);
    assert.ok(expected.length >= 50, `only ${expected.length} commodity pages`);
    for (const p of [...expected, '/hinnat/', '/polttoaineet/', '/vertailu/', '/korot/']) {
      assert.ok(result.pages.includes(p), `missing ${p}`);
    }
    assert.equal(result.pages.filter((p) => p.startsWith('/hinnat/')).length, expected.length + 1);
  });

  test('no title/description warnings; titles unique; no missing values in text', async () => {
    assert.deepEqual(result.warnings, []);
    const titles = new Map();
    for (const p of result.pages) {
      const doc = await read(p);
      const title = doc.match(/<title>([^<]*)<\/title>/)[1];
      assert.ok(!titles.has(title), `duplicate title "${title}" (${p} and ${titles.get(title)})`);
      titles.set(title, p);
      const main = doc.slice(doc.indexOf('<main'), doc.indexOf('</main>'));
      for (const bad of ['undefined', 'NaN', 'Infinity', '[object']) assert.ok(!main.includes(bad), `${p} contains ${bad}`);
      assert.match(doc, /<link rel="canonical" href="https:\/\/inflaatio\.fi\/[^"]*">/);
      assert.match(doc, /"@type":"BreadcrumbList"/);
      assert.match(doc, /"@type":"Dataset"/);
      assert.deepEqual(cspProblems(doc), []);
    }
  });

  test('commodity page: breadcrumbs Hinnat › item, charts with text alternatives', async () => {
    const doc = await read('/hinnat/naudanliha/');
    assert.match(doc, /<a href="\/hinnat\/">Hinnat<\/a>/);
    assert.match(doc, /<span aria-current="page">Naudanliha<\/span>/);
    assert.match(doc, /Pisteluku, 2025=100/);
    assert.ok((doc.match(/role="img"/g) ?? []).length >= 2);
    assert.ok((doc.match(/class="chart-figure__summary"/g) ?? []).length >= 2);
  });

  test('interactive chart data islands match their month axes', async () => {
    for (const p of ['/hinnat/', '/polttoaineet/', '/korot/']) {
      const doc = await read(p);
      const islands = [...doc.matchAll(/<script type="application\/json" id="([^"]+)-data">([\s\S]*?)<\/script>/g)];
      assert.ok(islands.length >= 1, `${p}: no chart data`);
      for (const [, id, json] of islands) {
        const spec = JSON.parse(json);
        assert.ok(doc.includes(`data-topic-chart="${id}"`), `${p}: container for ${id}`);
        for (const d of spec.datasets) assert.equal(d.data.length, spec.months.length, `${p} ${id} ${d.label}`);
        if (spec.ranges) assert.ok(spec.ranges.includes(spec.range));
      }
      assert.match(doc, /<script type="module" src="\/assets\/pages\/hinnat-[A-Z0-9]+\.js"><\/script>/);
    }
  });

  test('range charts: subtitle period label, URL parameter, KHI with 1 decimal on /korot/', async () => {
    const params = new Set();
    for (const p of ['/hinnat/', '/polttoaineet/', '/korot/']) {
      const doc = await read(p);
      for (const [, id, json] of doc.matchAll(/<script type="application\/json" id="([^"]+)-data">([\s\S]*?)<\/script>/g)) {
        const spec = JSON.parse(json);
        if (!spec.ranges) continue;
        assert.ok(doc.includes(`data-range-label="${id}"`), `${p} ${id}: subtitle has no range label`);
        assert.match(spec.param ?? '', /^[a-z]+$/, `${p} ${id}: range is not kept in the URL`);
        assert.ok(!params.has(`${p}${spec.param}`), `${p}: two charts share ?${spec.param}`);
        params.add(`${p}${spec.param}`);
        if (id === 'korot-kaavio') assert.equal(spec.datasets.find((d) => d.series === 'khi').decimals, 1);
      }
    }
  });

  test('texts: month before the value, "alemmat", no "vs.", group names as "pääryhmä X"', async () => {
    for (const p of result.pages) {
      const doc = await read(p);
      const main = doc.slice(doc.indexOf('<main'), doc.indexOf('</main>')).replace(/<[^>]+>/g, ' ');
      assert.ok(!main.includes('matalammat'), `${p}: "matalammat"`);
      assert.ok(!/ vs\. /.test(main), `${p}: "vs."`);
      assert.ok(!/(?:kuussa|kuun) \d{4} [+\u2212-]?\d+,\d/.test(main), `${p}: a year directly followed by a value`);
      assert.ok(!/yks\.\./.test(doc), `${p}: doubled period after %-yks.`);
    }
    const hinnat = await read('/hinnat/');
    assert.match(hinnat, /pääryhmää 13:sta nosti inflaatiota/);
    assert.match(hinnat, /Eniten inflaatiota nosti pääryhmä /);
    assert.ok(!hinnat.includes('kallistujat ja halventujat'));
    const vertailu = await read('/vertailu/');
    assert.match(vertailu, /Korkein \d+,\d\u00a0% \(/);
    assert.ok(!/Korkein: Euroalue/.test(vertailu), 'aggregates are not the highest "country"');
    assert.ok(!/\d+\. matalin/.test(vertailu), 'ordinal written as a word');
  });

  test('/hinnat/ top lists: rank next to the name, contribution also under the name for phones', async () => {
    const doc = await read('/hinnat/');
    const start = doc.indexOf('id="kallistujat-taulukko"');
    const table = doc.slice(start, doc.indexOf('</table>', start));
    assert.equal((table.match(/class="hinnat-mover__name"/g) ?? []).length, 10);
    assert.equal((table.match(/class="hinnat-mover__contrib"/g) ?? []).length, 10);
    assert.match(table, /<th scope="col" class="num hinnat-col-contrib">/);
  });

  test('/hinnat/ lists both top 10 tables and links every commodity page', async () => {
    const doc = await read('/hinnat/');
    assert.match(doc, /id="kallistujat-taulukko"/);
    assert.match(doc, /id="halventujat-taulukko"/);
    for (const p of result.pages.filter((x) => /^\/hinnat\/[^/]+\/$/.test(x))) assert.ok(doc.includes(`href="${p}"`), `/hinnat/ does not link ${p}`);
  });
});
