/**
 * Home page (/): builds the `home` module into a temp dir and checks the
 * output, plus unit tests of the view-model helpers (src/js/charts/home-model.js)
 * and the FAQ placeholder resolver (src/pages/home.js).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, computeLatest, cspProblems, ROOT, themeBootScript } from '../scripts/build.js';
import { html } from '../scripts/lib/html.js';
import * as fmt from '../src/js/lib/format.js';
import * as stats from '../src/js/lib/stats.js';
import * as model from '../src/js/charts/home-model.js';
import home, { placeholders, resolvePlaceholders, richText, faqItems, pageDescription, DATA_FILES } from '../src/pages/home.js';
import * as components from '../src/templates/components.js';
import * as svg from '../scripts/lib/svg.js';
import * as htmlLib from '../scripts/lib/html.js';
import { layout, crumbs } from '../src/templates/layout.js';
import site from '../src/site.config.js';

const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
/** Every *.json of a repo directory by basename (like the build's ctx.data / ctx.content). */
const loadDir = (dir) => {
  const abs = path.join(ROOT, dir);
  const out = {};
  for (const f of existsSync(abs) ? readdirSync(abs) : []) if (f.endsWith('.json')) out[f.slice(0, -5)] = readJson(`${dir}/${f}`);
  return out;
};

const data = loadDir('data');
const content = loadDir('src/content');
const latest = computeLatest(data, content);
const ctx = { fmt, stats, data, content, latest };

let tmp;
let page;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-home-'));
  const out = path.join(tmp, 'dist');
  await build({ out, only: ['home'], quiet: true });
  page = await fs.readFile(path.join(out, 'index.html'), 'utf8');
});

after(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

const decode = (s) =>
  s
    .replace(/&nbsp;/g, fmt.NBSP)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Text a reader (or a screen reader) gets: element text + aria-label/title/data-label values. */
function readableText(doc) {
  const attrs = [...doc.matchAll(/\s(?:aria-label|title|data-label|alt)="([^"]*)"/g)].map((m) => m[1]);
  const body = doc
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  // Collapse ASCII whitespace only: NBSP before units must survive.
  return decode(`${body} ${attrs.join(' ')}`).replace(/[ \t\r\n]+/g, ' ');
}

/** Dates (14.9.2026), times (klo 8.00) and licence names (CC BY 4.0) are not decimals. */
const withoutDates = (s) =>
  s
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/g, 'PVM')
    .replace(/klo[ \u00a0]\d{1,2}\.\d{2}/g, 'KLO')
    .replace(/CC BY \d\.\d/g, 'CC BY');

/* ------------------------------------------------------------- built page */

describe('built page', () => {
  test('title contains the latest KHI value and month and fits in 60 characters', () => {
    const title = decode(page.match(/<title>([^<]*)<\/title>/)[1]);
    assert.ok(title.length <= 60, title);
    assert.ok(title.includes(fmt.pct(latest.khi.yoy)), title);
    assert.ok(title.includes(fmt.monthName(latest.khi.month)) || title.includes(fmt.monthShort(latest.khi.month)), title);
    assert.match(title, /\| Inflaatio\.fi$/);
    const desc = decode(page.match(/<meta name="description" content="([^"]*)">/)[1]);
    assert.ok(desc.length <= 155, desc);
    assert.ok(desc.includes(fmt.pct(latest.khi.yoy)));
    assert.match(page, /<link rel="canonical" href="https:\/\/inflaatio\.fi\/">/);
  });

  test('no dot decimals in visible numbers (dates and times excepted)', () => {
    const text = withoutDates(readableText(page));
    const bad = text.match(/.{0,30}\d\.\d.{0,30}/g);
    assert.equal(bad, null, `dot decimals: ${bad?.join(' | ')}`);
    // Units in their own element (KPI cards) are separated by CSS, so strip tags without a gap here.
    const joined = decode(page.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ''));
    const spaced = joined.match(/.{0,30}\d [%€].{0,10}/g);
    assert.equal(spaced, null, `normal space before a unit (NBSP expected): ${spaced?.join(' | ')}`);
    // "elokuussa 2026 2,2 %" reads as one number: the month goes first or after the value.
    const runOn = text.match(/.{0,30}(?:kuussa|kuun|vuonna) \d{4}[  ][+−-]?\d.{0,10}/g);
    assert.equal(runOn, null, `a year directly followed by a value: ${runOn?.join(' | ')}`);
  });

  test('KPI cards: "Muutos edellisestä kuukaudesta" in %-yks., "Hinnat kuukaudessa" in %', () => {
    const cards = [...page.matchAll(/<article class="kpi"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    const byLabel = (label) => cards.filter((c) => c.includes(`>${label}<`));
    const delta = byLabel('Muutos edellisestä kuukaudesta');
    const mom = byLabel('Hinnat kuukaudessa');
    assert.equal(delta.length, 2, 'KHI and YKHI panels');
    assert.equal(mom.length, 2);
    // %-yks. may use a non-breaking hyphen (U+2011) and carry its NBSP inside the unit span.
    for (const c of delta) assert.match(c, /<span class="kpi__unit">(?:\u00a0|&nbsp;)?%[-\u2011]yks\.<\/span>/);
    for (const c of mom) assert.match(c, /<span class="kpi__unit">(?:\u00a0|&nbsp;)?%<\/span>/);
    // Colour + arrow only on the change card.
    for (const c of cards.filter((x) => !x.includes('>Muutos edellisestä kuukaudesta<'))) assert.doesNotMatch(c, /kpi__value--(up|down|flat)/);
    const expected = stats.deltaClass(latest.khi.delta);
    assert.match(delta[0], new RegExp(`kpi__value--${expected}`));
    assert.ok(page.includes(fmt.pp(latest.khi.delta).split(fmt.NBSP)[0]));
  });

  test('both metric panels are server-rendered; KHI is the default view', () => {
    assert.match(page, /<div class="home" data-home data-mittari="khi">/);
    assert.match(page, /data-metric-panel="khi" id="tunnusluvut-khi"/);
    assert.match(page, /data-metric-panel="ykhi" id="tunnusluvut-ykhi"/);
    assert.match(page, /data-segmented="mittari"/);
    assert.match(page, /data-segmented="jakso"/);
  });

  test('FAQ placeholders are resolved and every question is shown', () => {
    assert.doesNotMatch(readableText(page), /\{\{|\}\}/);
    for (const f of content.faq) assert.ok(page.includes(decodeHtmlUnsafe(f.q)), f.q);
    assert.ok(readableText(page).includes(model.annualChangeSentence(latest.khi.month, latest.khi.yoy)));
  });

  test('never "reaaliaikainen" (page, FAQ, page script)', async () => {
    assert.doesNotMatch(page, /reaaliaikai/i);
    assert.doesNotMatch(JSON.stringify(content.faq), /reaaliaikai/i);
    for (const f of ['src/pages/home.js', 'src/js/pages/home.js', 'src/js/charts/home-model.js', 'src/js/charts/home-charts.js']) {
      assert.doesNotMatch(readFileSync(path.join(ROOT, f), 'utf8'), /reaaliaikai/i, f);
    }
  });

  test('JSON-LD parses: Organization, WebSite, WebPage and Dataset, no FAQPage', () => {
    const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    assert.ok(blocks.length >= 1);
    const nodes = blocks.flatMap((b) => b['@graph'] ?? [b]);
    const types = nodes.map((n) => n['@type']);
    for (const t of ['Organization', 'WebSite', 'WebPage', 'Dataset']) assert.ok(types.includes(t), t);
    assert.ok(!types.includes('FAQPage'));
    assert.doesNotMatch(page, /FAQPage/);
    const webPage = nodes.find((n) => n['@type'] === 'WebPage');
    assert.ok(!Number.isNaN(Date.parse(webPage.dateModified)), webPage.dateModified);
    const ds = nodes.find((n) => n['@type'] === 'Dataset');
    assert.match(ds.temporalCoverage, /^\d{4}-\d{2}\/\d{4}-\d{2}$/);
    assert.ok(ds.temporalCoverage.endsWith(latest.khi.month) || ds.temporalCoverage.endsWith(latest.ykhi.month));
    assert.deepEqual(
      ds.distribution.map((d) => d.contentUrl),
      DATA_FILES.map((f) => `https://inflaatio.fi${f.path}`),
    );
  });

  test('CSP-safe markup and a text alternative for every chart', () => {
    assert.deepEqual(cspProblems(page), []);
    const svgs = [...page.matchAll(/<svg xmlns[^>]*>/g)].map((m) => m[0]);
    assert.ok(svgs.length >= 6);
    for (const s of svgs) assert.match(s, /role="img"/), assert.match(s, /aria-label="[^"]{20,}"/);
    assert.match(page, /data-chart="kehitys"[^>]*hidden/);
    assert.match(page, /data-chart="hintataso"[^>]*hidden/);
    assert.match(page, /id="kehitys-taulukko"/);
    assert.match(page, /id="vuositaulukko"/);
  });

  test('data island covers every metric × range and decodes to the month axis', () => {
    const island = JSON.parse(page.match(/<script type="application\/json" id="etusivu-data">([\s\S]*?)<\/script>/)[1]);
    const months = model.monthAxis(island.start, island.n);
    assert.equal(months.at(-1) >= latest.khi.month, true);
    const khi = model.decodeSeries(island.s.khi, island.n);
    assert.equal(khi[months.indexOf(latest.khi.month)], latest.khi.yoy);
    for (const m of model.METRICS) {
      for (const k of stats.RANGE_KEYS) {
        assert.ok(island.text.stats[m][k].length >= 3, `${m} ${k}`);
        assert.ok(island.text.level[m][k].summary.includes('€'), `${m} ${k}`);
      }
    }
    for (const k of stats.RANGE_KEYS) {
      // The summary describes the selected metric (its own extremes, the other metric as context).
      assert.match(island.text.trend[k].summary.khi, /^[A-ZÄÖ][a-zäö]+ \d{4} KHI oli /, k);
      assert.match(island.text.trend[k].summary.ykhi, /^[A-ZÄÖ][a-zäö]+ \d{4} YKHI oli /, k);
      assert.match(island.text.trend[k].summary.ykhi, / YKHI oli korkeimmillaan /);
    }
    // Price level: the same official base as the statistics row; "Kaikki" reaches back to the KHI series start.
    assert.equal(island.text.level.khi['5v'].base, '2025=100');
    const allBase = island.text.level.khi.kaikki.base;
    assert.notEqual(allBase, '2025=100');
    assert.ok(island.lvl.khi[allBase], 'index series of the base is shipped');
    assert.equal(island.text.level.khi.kaikki.period.split(' – ')[0], island.text.trend.kaikki.period.split(' – ')[0]);
    assert.ok(island.text.level.khi.kaikki.summary.includes(allBase));
    assert.equal(island.s.khiIdx, undefined, 'index series travel only in lvl');
    // 6 kk is never annualised.
    assert.equal(island.text.stats.khi['6kk'].at(-1).label, 'Hinnat jaksolla');
    assert.equal(island.text.stats.khi['5v'].at(-1).label, 'Hinnat vuodessa');
  });

  test('main chart: shared legend, toggles off by default and not printed, one announcement channel', () => {
    const fig = page.match(/<figure class="chart-figure" id="kehitys-kaavio"[\s\S]*?<\/figure>/)[0];
    for (const key of ['ea', 'core', 'core-ea', 'events']) assert.match(fig, new RegExp(`<li class="legend__item" hidden data-series="${key}">`), key);
    assert.match(fig, /<fieldset class="home-toggles js-only no-print">/);
    assert.match(fig, /id="kehitys-tapahtumat"(?![^>]*checked)[^>]*>/);
    assert.doesNotMatch(fig, /id="kehitys-(euroalue|pohja)"[^>]*checked/);
    // The page script announces changes once; the summaries are not live regions.
    assert.doesNotMatch(page, /chart-figure__summary" aria-live/);
    // The segmented range control names the month table it updates.
    assert.match(page, /aria-controls="[^"]*kehitys-taulukko[^"]*"/);
    assert.match(page, /data-label-less="Näytä vain 12 viimeisintä kuukautta"/);
    assert.match(page, /id="hintataso-perusta">2025=100</);
  });

  test('texts: no doubled periods, times keep "klo" with the hour, core inflation defined in full', () => {
    const text = readableText(page);
    assert.doesNotMatch(text, /yks\.\./);
    assert.doesNotMatch(page, /klo \d/, 'NBSP after "klo"');
    assert.ok(text.includes('Eurostat (ilman energiaa, ruokaa, alkoholia ja tupakkaa)'));
    assert.doesNotMatch(text, /(?:hillitsi|nostaja oli) (?!pääryhmä)[a-zäö]/, 'group names are introduced with "pääryhmä"');
    assert.doesNotMatch(text, /haalealla|tasoluokan|Laskee virallisista/);
    assert.ok(text.includes('Sivusto tarkistaa uudet luvut kahdesti päivässä'));
    // The sparkline's solid zero line has a legend entry.
    const spark = page.match(/<figure class="home-hero__spark"[\s\S]*?<\/figure>/)[0];
    assert.match(spark, /series--muted[\s\S]*?0(?:\u00a0|&nbsp;)%/);
  });

  test('old in-page anchors still exist', () => {
    for (const id of ['home', 'nyt', 'tunnusluvut', 'analytiikka', 'kehitys', 'vuosittain', 'faq', 'tietoa', 'ukk', 'lahteet', 'khi-vai-ykhi']) {
      assert.match(page, new RegExp(`id="${id}"`), id);
    }
  });
});

/** Question text as it appears in HTML (the html template escapes &, <, >, quotes). */
function decodeHtmlUnsafe(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------------------------------------------------- view model */

describe('home-model', () => {
  test('encodeSeries / decodeSeries round trip', () => {
    const arr = [null, null, 1.2, null, 3.4, null];
    const enc = model.encodeSeries(arr);
    assert.deepEqual(enc, { o: 2, v: [1.2, null, 3.4] });
    assert.deepEqual(model.decodeSeries(enc, 6), arr);
    assert.deepEqual(model.encodeSeries([null, null]), { o: 0, v: [] });
    assert.deepEqual(model.decodeSeries(null, 2), [null, null]);
  });

  test('month texts group consecutive months', () => {
    assert.equal(model.monthsText(['2022-11', '2022-12']), 'marras–joulu 2022');
    assert.equal(model.monthsText(['2025-10', '2026-01']), 'loka 2025, tammi 2026');
    assert.equal(model.runInessive(['2016-02']), 'helmikuussa 2016');
    assert.equal(model.runInessive(['2025-10', '2025-11']), 'loka–marraskuussa 2025');
    assert.equal(model.runInessive(['2009-06', '2009-07', '2009-08', '2009-09', '2009-10', '2009-11', '2009-12', '2010-01']), 'kesäkuusta 2009 tammikuuhun 2010');
    const months2015 = ['2015-01', '2015-02', '2015-03', '2015-04', '2015-06', '2015-07'];
    assert.equal(model.monthsInessive([...months2015, '2016-02']), 'tammi–huhtikuussa ja kesä–heinäkuussa 2015 sekä helmikuussa 2016');
  });

  test('range statistics: CAGR over n−1 intervals, never annualised under 12 months', () => {
    const months = model.monthAxis('2024-01', 25);
    const index = months.map((_, i) => 100 * 1.1 ** (i / 12));
    const yoy = months.map((_, i) => (i % 2 ? 2 : 1));
    const items = model.rangeStatItems({ months, yoy, index });
    assert.deepEqual(items.map((i) => i.label), ['Alin', 'Keskiarvo', 'Korkein', 'Hinnat vuodessa']);
    assert.equal(items[3].value, `+10,0${fmt.NBSP}%`);
    const short = model.rangeStatItems({ months: months.slice(0, 7), yoy: yoy.slice(0, 7), index: index.slice(0, 7) });
    assert.equal(short[3].label, 'Hinnat jaksolla');
    assert.equal(short[3].value, fmt.pct(stats.totalChange(index[0], index[6]), { sign: true }));
  });

  test('price level is rebased to 100 € at the start of the range', () => {
    const months = model.monthAxis('2020-01', 25);
    const index = months.map((_, i) => 90 + i);
    const pl = model.priceLevel(months, index, '1v');
    assert.equal(pl.months.length, 13);
    assert.equal(pl.values[0], 100);
    assert.equal(fmt.round(pl.last, 2), fmt.round(((90 + 24) / (90 + 12)) * 100, 2));
    const t = model.priceLevelText(pl, 'khi', '2025=100');
    assert.ok(t.summary.startsWith(`Ostokset, jotka maksoivat 100${fmt.NBSP}€ tammikuussa 2021, maksoivat `) && t.summary.includes(`€ tammikuussa 2022. `), t.summary);
    assert.match(t.summary, /Hintataso nousi jaksolla/);
    // Table: one row a year, newest first (the page script rebuilds it with the same helper).
    const rows = model.priceLevelRows(pl);
    assert.equal(rows.length, 2);
    assert.equal(rows[0][0], 'tammi 2022');
    assert.equal(rows[1][1], `100,00${fmt.NBSP}€`);
    assert.equal(model.priceLevelCaption(pl, 'ykhi'), `Hintataso (YKHI), jakson alku tammi 2021 = 100${fmt.NBSP}€`);
  });

  test('sign-aware sentences', () => {
    assert.equal(model.annualChangeSentence('2026-08', 2.2), `Elokuussa 2026 kuluttajahinnat olivat 2,2${fmt.NBSP}% korkeammat kuin vuotta aiemmin.`);
    assert.equal(model.annualChangeSentence('2026-08', 0), 'Elokuussa 2026 kuluttajahinnat olivat samalla tasolla kuin vuotta aiemmin.');
    assert.ok(model.annualChangeSentence('2026-01', -0.2).includes(`0,2${fmt.NBSP}% alemmat`));
    assert.match(model.annualChangeSentence('2026-01', 0.04), /samalla tasolla/);
    assert.equal(model.momNote('2026-07', '2026-08', -0.2), `Kuluttajahinnat laskivat heinäkuusta elokuuhun 0,2${fmt.NBSP}%.`);
    assert.match(model.momNote('2025-12', '2026-01', 0.3), /nousivat joulukuusta 2025 tammikuuhun 2026/);
    assert.equal(model.deltaNote('2026-07', 2.1, '2026-08', 2.2), 'Inflaatio kiihtyi heinäkuun 2,1 prosentista elokuun 2,2 prosenttiin.');
    assert.match(model.deltaNote('2026-07', 2.5, '2026-08', 2.4), /hidastui/);
    assert.match(model.deltaNote('2026-07', 2.1, '2026-08', 2.1), /pysyi elokuussa heinäkuun tasolla/);
    assert.equal(model.yearAgoNote('2026-08', 2.2, 0.5), 'Elokuussa 2025. Nyt inflaatio on 1,7 prosenttiyksikköä korkeampi.');
  });

  test('title and description fit even with long month names and negative values', () => {
    for (const [m, v] of [['2026-08', 2.2], ['2026-11', -10.2], ['2026-03', 12.3]]) {
      const t = model.pageTitle(m, v);
      assert.ok(`${t} | Inflaatio.fi`.length <= 60, t);
      assert.ok(t.includes(fmt.pct(v)));
      const d = pageDescription(fmt, m, v, 1980);
      assert.ok(d.length <= 155, d);
    }
    assert.equal(model.pageTitle('2026-08', 2.2), `Inflaatio Suomessa nyt: 2,2${fmt.NBSP}% (elokuu 2026)`);
  });

  test('trend summary describes the selected metric, the other one as context', () => {
    const months = model.monthAxis('2024-01', 6);
    const yoy = [1.0, 0.5, 0.5, 2.0, 1.5, 1.2];
    const s = model.trendSummary({
      metric: 'ykhi',
      self: { month: '2024-06', yoy: 1.2, provisional: true },
      other: { month: '2024-05', yoy: 2.4 },
      months,
      yoy,
    });
    assert.equal(
      s,
      `Kesäkuussa 2024 YKHI oli 1,2${fmt.NBSP}% (ennakko) ja KHI 2,4${fmt.NBSP}% (toukokuu 2024). ` +
        `Jaksolla tammi 2024 – kesä 2024 YKHI oli korkeimmillaan 2,0${fmt.NBSP}% (huhti 2024) ja matalimmillaan 0,5${fmt.NBSP}% (helmi–maalis 2024).`,
    );
    const k = model.trendSummary({ metric: 'khi', self: { month: '2024-06', yoy: 2.4 }, other: { month: '2024-06', yoy: 1.2 }, months: [], yoy: [] });
    assert.equal(k, `Kesäkuussa 2024 KHI oli 2,4${fmt.NBSP}% ja YKHI 1,2${fmt.NBSP}%.`);
  });

  test('?nayta= round trip for the optional series', () => {
    assert.equal(model.parseShow(null), null);
    assert.deepEqual(model.parseShow(''), { ea: false, core: false, events: false });
    assert.deepEqual(model.parseShow('pohja,ea,xyz'), { ea: true, core: true, events: false });
    assert.equal(model.formatShow({ ea: true, core: false, events: true }), 'ea tapahtumat');
    assert.deepEqual(model.parseShow('ea tapahtumat'), { ea: true, core: false, events: true });
    assert.equal(model.formatShow({}), '');
    assert.deepEqual(model.parseShow(model.formatShow({ ea: true, core: true, events: true })), { ea: true, core: true, events: true });
  });

  test('month table toggle labels name the unit', () => {
    assert.deepEqual(model.trendTableLabels(61), { more: 'Näytä kaikki kuukaudet (61)', less: 'Näytä vain 12 viimeisintä kuukautta' });
  });

  test('wrapText keeps lines short', () => {
    const lines = model.wrapText('Venäjän hyökkäys Ukrainaan 24.2.2022 nosti jyrkästi energian ja ruoan hintoja.', 30);
    assert.ok(lines.every((l) => l.length <= 30));
    assert.equal(lines.join(' '), 'Venäjän hyökkäys Ukrainaan 24.2.2022 nosti jyrkästi energian ja ruoan hintoja.');
  });
});

/* --------------------------------------------------------- placeholders */

describe('FAQ placeholders', () => {
  const resolvers = placeholders(ctx);

  test('every answer resolves from data; no placeholder is left', () => {
    const items = faqItems(ctx);
    assert.equal(items.length, content.faq.length);
    for (const f of items) {
      assert.doesNotMatch(f.a, /\{\{|\}\}/, f.id);
      assert.doesNotMatch(withoutDates(f.a), /\d\.\d/, `${f.id}: dot decimal`);
    }
    const ids = items.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, 'unique ids');
  });

  test('values match the data', () => {
    assert.equal(resolvers['khi.yoy'](), fmt.pct(latest.khi.yoy));
    assert.equal(resolvers['khi.year']('2023'), fmt.pct(data['khi-annual'].yoy[data['khi-annual'].years.indexOf('2023')]));
    assert.equal(resolvers['khi.maxMonth'](), `13,7${fmt.NBSP}% joulukuussa 1980`);
    assert.equal(resolvers['khi.maxMonthIn']('2022'), `9,1${fmt.NBSP}% marras–joulukuussa 2022`);
    assert.equal(resolvers['khi.maxYear'](), `12,0${fmt.NBSP}% vuonna 1981`);
    assert.equal(resolvers['khi.higherSince']('2022'), 1984);
    assert.equal(resolvers['khi.lastDeflationYear'](), `vuonna 2015 (${fmt.MINUS}0,2${fmt.NBSP}%)`);
    assert.equal(resolvers['khi.minMonthSince']('2000'), `${fmt.MINUS}1,5${fmt.NBSP}% lokakuussa 2009`);
    assert.match(resolvers['khi.negativeMonths']('2000'), /kesäkuusta 2009 tammikuuhun 2010/);
    assert.equal(resolvers['ykhi.rangeIn']('2025-10,2025-11,2026-01'), `1,0–1,5${fmt.NBSP}%`);
    assert.equal(resolvers['eki.value'](), fmt.num(latest.elinkustannusindeksi.value, 0));
    // Before the official annual changes: computed from the official annual averages.
    assert.equal(resolvers['khi.annualAvgMaxBefore'](), `17,9${fmt.NBSP}% vuonna 1975`);
    assert.equal(resolvers['eki.maxRise1914'](), 'yli kolminkertaistuivat vuonna 1918');
    assert.equal(resolvers['eki.base1914'](), '1914:1–6=100');
    assert.equal(resolvers['korot.now']() != null, true);
  });

  test('"Ennen vuotta 1980 inflaatio oli vielä korkeampi" holds for the data', () => {
    const a = data['khi-annual'];
    const official = Math.max(...a.yoy.filter(fmt.isNum));
    const idx = a.index['1972=100'];
    const changes = a.years.map((y, i) => (i && Number(y) < 1980 && fmt.isNum(idx[i]) && fmt.isNum(idx[i - 1]) ? (idx[i] / idx[i - 1] - 1) * 100 : null));
    assert.ok(Math.max(...changes.filter(fmt.isNum)) > official);
    const e = data.elinkustannusindeksi.annual1914;
    const i1918 = e.years.indexOf('1918');
    assert.ok(e.values[i1918] / e.values[i1918 - 1] > 3, '1918 yli kolminkertaistui');
    const faq = faqItems(ctx).find((f) => f.id === 'ukk-korkein-inflaatio');
    assert.match(faq.a, /Ennen vuotta 1980 inflaatio oli vielä korkeampi/);
    assert.match(faq.a, /Inflaatio\.fi on laskenut/);
    const ekp = faqItems(ctx).find((f) => f.id === 'ukk-ekp-tavoite');
    assert.match(ekp.a, /talletuskorko on \d{1,2}\.\d{1,2}\.\d{4} alkaen \d/);
  });

  test('the fixed claims of faq.json still hold for the data', () => {
    const annual = new Map(data['khi-annual'].years.map((y, i) => [Number(y), data['khi-annual'].yoy[i]]));
    const ykhi = new Map(data['ykhi-annual'].years.map((y, i) => [Number(y), data['ykhi-annual'].geo.FI[i]]));
    assert.ok([1980, 1981].every((y) => annual.get(y) > 10), '1980–1981 yli 10 %');
    assert.ok([2003, 2004, 2005].every((y) => annual.get(y) < 1), '2003–2005 alle 1 %');
    const tens = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019].map((y) => annual.get(y));
    assert.ok(tens.filter((v) => v >= 0 && v <= 3).length >= 7, '2010-luvulla pääosin 0–3 %');
    assert.ok(annual.get(2015) < 0, '2015 hinnat laskivat');
    assert.ok(annual.get(2023) > ykhi.get(2023), 'korkojen nousu nosti KHI:tä 2023');
    assert.ok(annual.get(2025) < ykhi.get(2025), 'korkojen lasku painoi KHI:tä 2025');
    const khiAt = (m) => stats.seriesAt(data.khi.months, data.khi.yoy, m);
    assert.ok(['2025-10', '2025-11', '2026-01'].every((m) => khiAt(m) < 0), 'miinuslukemat 10–11/2025 ja 1/2026');
  });

  test('unknown placeholders and missing data fail loudly', () => {
    assert.throws(() => resolvePlaceholders('{{ei.ole}}', resolvers), /Tuntematon paikkamerkki/);
    assert.throws(() => resolvePlaceholders('{{khi.year:1900}}', resolvers), /arvoa ei löydy/);
    assert.throws(() => resolvePlaceholders('{{khi.yoy', resolvers), /Virheellinen paikkamerkki/);
    assert.equal(resolvePlaceholders('A {{next.khiSentence}} B', { 'next.khiSentence': () => '' }), 'A B');
  });

  test('richText: paragraphs, safe links only, everything escaped', () => {
    const out = String(richText(html, 'Eka <b>kappale</b> [linkki](/inflaatio/).\n\nToka [ulkoinen](https://stat.fi/).'));
    assert.equal(out, '<p>Eka &lt;b&gt;kappale&lt;/b&gt; <a href="/inflaatio/">linkki</a>.</p><p>Toka <a href="https://stat.fi/">ulkoinen</a>.</p>');
    assert.throws(() => richText(html, '[x](javascript:alert(1))'), /ei ole sallittu/);
    assert.throws(() => richText(html, '[x](//evil.example/)'), /ei ole sallittu/);
  });
});

/* ------------------------------------------------------ edge scenarios */


/** A build context like scripts/build.js creates, for arbitrary data/content. */
function makeCtx(d, c) {
  const warnings = [];
  const x = {
    site,
    baseUrl: site.baseUrl,
    buildDate: '2026-10-03',
    data: d,
    content: c,
    latest: computeLatest(d, c),
    fmt,
    stats,
    svg,
    c: components,
    html: htmlLib.html,
    raw: htmlLib.raw,
    attrs: htmlLib.attrs,
    classes: htmlLib.classes,
    jsonLd: htmlLib.jsonLd,
    jsonScript: htmlLib.jsonScript,
    safeJson: htmlLib.safeJson,
    asset: (n) => `/assets/${n}`,
    assetImports: () => [],
    themeBoot: themeBootScript(),
    warn: (m) => warnings.push(m),
    warnings,
  };
  x.layout = (o) => layout(x, o);
  x.crumbs = (...a) => crumbs(x, ...a);
  return x;
}

/** YKHI flash estimate for the month after the latest KHI month (the state between Eurostat's flash and Tilastokeskus' release). */
function withYkhiFlash() {
  const d = structuredClone(data);
  const y = d.ykhi;
  const next = fmt.ymAdd(y.months.at(-1), 1);
  y.months.push(next);
  for (const [geo, g] of Object.entries(y.geo)) {
    for (const [k, v] of Object.entries(g)) {
      if (Array.isArray(v)) v.push(k === 'yoy' ? (geo === 'FI' ? 2.5 : geo === 'EA' ? 3.0 : null) : null);
      else if (v && typeof v === 'object') for (const arr of Object.values(v)) arr.push(null);
    }
  }
  y.flags = { FI: { [next]: 'p' }, EA: { [next]: 'p' } };
  return { d, next };
}

describe('edge scenarios', () => {
  test('YKHI flash month newer than KHI: labelled "ennakko", no invented values', async () => {
    const { d, next } = withYkhiFlash();
    const x = makeCtx(d, content);
    assert.equal(x.latest.ykhi.month, next);
    assert.equal(x.latest.ykhi.provisional, true);
    const [out] = await home(x);
    const text = readableText(out.html);
    assert.ok(text.includes(`inflaatio oli 2,5${fmt.NBSP}% (${fmt.monthName(next)}, ennakko)`), 'hero lede names the flash month');
    assert.ok(text.includes('Kuukausimuutosta ei ole vielä julkaistu.'));
    assert.match(out.html, /chip--provisional/);
    assert.ok(text.includes(model.pageTitle(latest.khi.month, latest.khi.yoy)), 'title stays on KHI');
    assert.doesNotMatch(text, /\{\{|\}\}|NaN|undefined/);
    // Core inflation of the flash month is missing: the FAQ names the month of the value it shows.
    const core = placeholders(x)['ykhi.core']();
    assert.match(core, /\(.+ \d{4}\)$/);
    assert.deepEqual(cspProblems(out.html), []);
  });

  test('optional content missing: no FAQ, forecasts or event toggle, page still complete', async () => {
    const x = makeCtx(data, {});
    const [out] = await home(x);
    assert.doesNotMatch(out.html, /id="ukk"/);
    assert.doesNotMatch(out.html, /id="ennusteet"/);
    assert.doesNotMatch(out.html, /id="kehitys-tapahtumat"/);
    assert.match(out.html, /Seuraavia julkaisupäiviä ei ole vielä ilmoitettu/);
    assert.match(out.html, /id="kehitys"/);
    assert.equal(x.warnings.length, 0, x.warnings.join('; '));
  });

  test('forecasts render with their area, publisher link and date', async () => {
    const x = makeCtx(data, {
      ...content,
      ennusteet: [{ org: 'Testilaitos', published: '2026-09-15', url: 'https://example.org/ennuste', measure: 'YKHI', area: 'EA', values: { 2026: 2.1, 2027: 1.9 } }],
    });
    const [out] = await home(x);
    assert.match(out.html, /id="ennusteet"/);
    assert.match(out.html, /<a href="https:\/\/example\.org\/ennuste">Testilaitos<\/a>/);
    assert.ok(out.html.includes('Euroalue, YKHI'));
    assert.ok(out.html.includes(`2,1${fmt.NBSP}%`));
  });

  test('missing KHI data fails loudly', async () => {
    const d = { ...data };
    delete d.khi;
    await assert.rejects(() => home(makeCtx(d, content)), /khi\.json/);
  });
});
