/**
 * Archive pages (owner ARCHIVE): /inflaatio/…, /katsaus/…, /pisteluvut/, /feed.xml.
 * Builds only the archive modules into a temp dir (real data) and checks the
 * generated routes, labelling of the partial year, head metadata, CSP, the RSS
 * feed, plus the text/calculation helpers and the /pisteluvut/ page script
 * (against a minimal fake DOM).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, computeLatest, cspProblems, ROOT, themeBootScript } from '../scripts/build.js';
import { checkLinks } from '../scripts/check-links.js';
import * as fmt from '../src/js/lib/format.js';
import {
  archive,
  decades,
  deltaSentence,
  fitDescription,
  levelSentence,
  listFi,
  logId,
  momSentence,
  monthEnd,
  monthPath,
  monthsListFi,
  newestDate,
  newestTimestamp,
  prevMonthNote,
  priceLevelNow,
  rankSince,
  yearPath,
  yearText,
} from '../src/pages/inflaatio.js';
import { katsausHeadline, katsausModel, ownerComment } from '../src/pages/katsaus.js';
import { rfc822, xmlEscape, FEED_MAX_ITEMS } from '../src/pages/feed.js';
import { change12, indexSeries, valueAt } from '../src/pages/pisteluvut.js';

const MODULES = ['inflaatio', 'katsaus', 'pisteluvut', 'feed'];
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const data = {};
for (const f of ['khi', 'khi-annual', 'ykhi', 'ykhi-annual', 'hyodykkeet', 'elinkustannusindeksi', 'muutosloki', 'meta']) data[f] = readJson(`data/${f}.json`);
const content = { tapahtumat: readJson('src/content/tapahtumat.json'), julkaisukalenteri: readJson('src/content/julkaisukalenteri.json'), katsauskommentit: {} };
const latest = computeLatest(data, content);
const L = latest.khi.month;
const LY = fmt.yearOf(L);
/** Expected text with NBSP before the units (as format.js writes them). */
const n = (s) => s.replace(/ (%|€)/g, `${fmt.NBSP}$1`);
/** Minimal context for the pure model helpers (no esbuild). */
const ctx = { data, content, latest, baseUrl: 'https://inflaatio.fi', site: { brand: 'Inflaatio.fi' } };

let tmp;
let out;
let result;
const page = (p) => readFileSync(path.join(out, ...p.split('/').filter(Boolean), 'index.html'), 'utf8');

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-archive-'));
  out = path.join(tmp, 'dist');
  result = await build({ out, only: MODULES, quiet: true });
});

after(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ routes */

test('generates one page per year, month (2015→) and review (2024→)', () => {
  const years = LY - 1980 + 1;
  const months = fmt.ymDiff('2015-01', L) + 1;
  const reviews = fmt.ymDiff('2024-01', L) + 1;
  const pages = result.pages;
  assert.equal(pages.filter((p) => /^\/inflaatio\/\d{4}\/$/.test(p)).length, years);
  assert.equal(pages.filter((p) => /^\/inflaatio\/\d{4}\/[a-z]+\/$/.test(p)).length, months);
  assert.equal(pages.filter((p) => /^\/katsaus\/\d{4}-\d{2}\/$/.test(p)).length, reviews);
  assert.equal(pages.length, 1 + years + months + 1 + reviews + 1);
  for (const p of ['/inflaatio/', '/katsaus/', '/pisteluvut/', '/inflaatio/1980/', yearPath(LY), '/inflaatio/2015/tammikuu/', monthPath(L), '/katsaus/2024-01/', `/katsaus/${L}/`]) {
    assert.ok(pages.includes(p), `${p} generated`);
  }
  for (const p of ['/inflaatio/1979/', '/inflaatio/2014/joulukuu/', '/katsaus/2023-12/', monthPath(fmt.ymAdd(L, 1)), `/katsaus/${fmt.ymAdd(L, 1)}/`]) {
    assert.ok(!pages.includes(p), `${p} not generated`);
  }
  assert.ok(result.files.includes('/feed.xml'));
  assert.equal(monthPath('2026-06'), '/inflaatio/2026/kesakuu/');
  assert.equal(monthPath('2025-07'), '/inflaatio/2025/heinakuu/');
});

test('every archive page: CSP-safe, one h1, title ≤ 60, description ≤ 155, canonical, breadcrumbs', () => {
  for (const p of result.pages) {
    const doc = page(p);
    assert.deepEqual(cspProblems(doc), [], p);
    assert.equal((doc.match(/<h1[\s>]/g) ?? []).length, 1, `${p} has one h1`);
    const title = doc.match(/<title>([^<]*)<\/title>/)[1];
    assert.ok(title.length <= 60, `${p} title ${title.length}: ${title}`);
    const desc = doc.match(/<meta name="description" content="([^"]*)">/)[1];
    assert.ok(desc.length <= 155 && desc.length > 50, `${p} description ${desc.length}`);
    assert.ok(!/\.\.(?!\.)/.test(desc.replace(/&[a-z]+;/g, '')), `${p} description has no double period: ${desc}`);
    assert.match(doc, new RegExp(`<link rel="canonical" href="https://inflaatio\\.fi${p.replace(/[/]/g, '\\/')}">`));
    assert.match(doc, /"@type":"BreadcrumbList"/, `${p} breadcrumbs`);
    assert.doesNotMatch(doc, /reaaliaikai/i);
    assert.doesNotMatch(doc, /NaN|undefined|\[object /, `${p} has no NaN/undefined`);
    // Copy review: "vuosiluku" means the year number; "matalammat" → "alemmat" for prices.
    assert.doesNotMatch(doc, /vuosiluku|haalealla|matalammat|Kaksi vuotta taaksepäin/, p);
    // Negative inflation never "kiihtyi/hidastui −0,2 prosenttiin".
    assert.doesNotMatch(doc, /(kiihtyi|hidastui) −\d/, p);
    // "toukokuussa 2015 0,0 %" reads as one number: the month goes first or after the value.
    assert.doesNotMatch(doc, /(?:kuussa|kuun|vuonna) \d{4}[  ][+−-]?\d/, p);
  }
});

test('sitemap lastmod follows each archive page’s own data releases', () => {
  const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  const lastmod = (p) => sitemap.match(new RegExp(`<loc>https://inflaatio\\.fi${p.replace(/[/]/g, '\\/')}</loc><lastmod>([^<]+)</lastmod>`))?.[1];
  const newestData = newestDate(latest.dataUpdated, ...Object.values(latest.updated));
  const all = [...sitemap.matchAll(/<loc>https:\/\/inflaatio\.fi(\/(?:inflaatio|katsaus|pisteluvut)\/[^<]*)<\/loc><lastmod>([^<]+)<\/lastmod>/g)];
  assert.ok(all.length > 100);
  for (const [, p, d] of all) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/, p);
    assert.ok(d <= newestData, `${p}: ${d} is not after the newest data (${newestData})`);
  }
  assert.ok(new Set(all.map((x) => x[2])).size > 10, 'per-page dates, not one build-wide date');
  // Months older than the changelog: final by the end of the month after next.
  if (!data.muutosloki.some((e) => e.period <= '2015-02')) assert.equal(lastmod('/inflaatio/2015/tammikuu/'), '2015-03-31');
  if (!data.muutosloki.some((e) => e.period <= '2024-02')) assert.equal(lastmod('/katsaus/2024-01/'), '2024-03-31');
  // The latest month: its KHI release and YKHI flash/final.
  const m = archive(ctx).month(L);
  assert.equal(lastmod(monthPath(L)), newestDate(m.released, m.ykhiFlashReleased, m.ykhiFinalReleased, latest.updated.khi, latest.ykhi?.month === L ? latest.updated.ykhi : null));
  assert.equal(lastmod(`/katsaus/${L}/`), lastmod(monthPath(L)));
  // Past years change with every KHI release (price level to the latest month).
  assert.equal(lastmod('/inflaatio/2000/'), newestDate(latest.updated.khi, latest.updated.khiAnnual));
  assert.equal(lastmod('/pisteluvut/'), newestDate(latest.updated.khi, latest.updated.elinkustannusindeksi));
  const reviews = all.filter(([, p]) => /^\/katsaus\/\d{4}-\d{2}\/$/.test(p)).map((x) => x[2]);
  assert.equal(lastmod('/katsaus/'), newestDate(...reviews));
});

test('lastmod date helpers', () => {
  assert.equal(newestDate('2026-09-14T05:00:00Z', '2026-09-17T11:00:00+02:00', null, '2026-08-01'), '2026-09-17');
  assert.equal(newestDate(null, undefined), null);
  assert.equal(newestDate('2026-09-14T22:30:00Z'), '2026-09-15', 'Helsinki calendar day');
  assert.equal(newestTimestamp('2026-01-14T06:00:00Z', '2026-09-17T11:00:00+02:00', 'x', null), '2026-09-17T11:00:00+02:00');
  assert.equal(newestTimestamp(null), null);
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(monthEnd('2025-12'), '2025-12-31');
});

test('internal links between archive pages resolve (others’ routes excluded)', async () => {
  const { errors } = await checkLinks({ dir: out });
  const mine = errors.filter((e) => /="\/(inflaatio|katsaus|pisteluvut|feed\.xml)/.test(e) || /#[^ ]+ not found/.test(e) || /aria-/.test(e));
  assert.deepEqual(mine, []);
});

test('sitemap lists the HTML pages but not the feed', () => {
  const sitemap = readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/inflaatio\.fi\/inflaatio\/2022\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/inflaatio\.fi\/pisteluvut\/<\/loc>/);
  assert.doesNotMatch(sitemap, /feed\.xml/);
});

/* ------------------------------------------------------------ year pages */

test('year pages use official annual figures; the current year is labelled partial', () => {
  const ka = data['khi-annual'];
  const official2023 = ka.yoy[ka.years.indexOf('2023')];
  const y2023 = page('/inflaatio/2023/');
  assert.match(y2023, new RegExp(`<title>Inflaatio 2023 Suomessa: ${fmt.pct(official2023)} \\| Inflaatio\\.fi</title>`));
  assert.match(y2023, /Tilastokeskuksen virallinen vuosimuutos/);

  const cy = latest.khi.currentYear;
  if (!cy.complete) {
    const doc = page(yearPath(LY));
    assert.ok(doc.includes(`(${cy.span})`), 'title/kpi carry the month span');
    assert.ok(doc.includes(`Vuosi ${cy.label}`), `KPI label ${cy.label}`);
    assert.ok(doc.includes(`${cy.span}kuun`), 'text names the months');
    assert.doesNotMatch(doc, /Tilastokeskuksen virallinen vuosimuutos<\/p>\s*<\/article>/);
    const overview = page('/inflaatio/');
    assert.ok(overview.includes(`Vuosi ${cy.label}`));
  }
  // 2022: "highest since 1984" (both 7,1 %)
  assert.match(page('/inflaatio/2022/'), /korkein sitten vuoden 1984/);
});

test('year pages: description promises only existing sections; spacing and wording', () => {
  const desc = (doc) => doc.match(/<meta name="description" content="([^"]*)">/)[1];
  const y1985 = page('/inflaatio/1985/');
  assert.doesNotMatch(desc(y1985), /euroalue/, 'no YKHI before 1996/97');
  assert.match(desc(y1985), /hinnat nykyrahassa\.$/);
  assert.doesNotMatch(y1985, /id="vertailu"/);
  const y2022 = page('/inflaatio/2022/');
  assert.match(desc(y2022), /vertailu euroalueeseen/);
  // Stats row and the chart title below it are separated (stack).
  assert.match(y2022, /<div class="stack-lg"><dl class="stats/);
  assert.ok(y2022.includes('ostokset, joiden hinta vuonna 2022 oli 100 euroa'));
  assert.ok(y2022.includes(`ja ${fmt.genitive(L)} pisteluku`));
  assert.ok(page('/inflaatio/1990/').includes('joiden hinta vuonna 1990 oli euroiksi muunnettuna 100 euroa'));
  // Month names in full with a shared suffix (2022: 9,1 % in November and December).
  assert.match(y2022, /Marras- ja joulukuu/);
  assert.match(y2022, /\(marras- ja joulukuu\)/);
  const y1980 = page('/inflaatio/1980/');
  assert.ok(y1980.includes(`Tammi${fmt.DASH}joulu 1980`));
  assert.doesNotMatch(y1980, /tammi 1980 – joulu 1980/);
});

test('year texts: "since" records need two years in between; prose spells out the unit', () => {
  const A = archive(ctx);
  const t2023 = yearText(A, A.yearMap.get(2023)).join(' ');
  assert.doesNotMatch(t2023, /matalin sitten vuoden 2021/, '2022 alone explains it');
  const t2022 = yearText(A, A.yearMap.get(2022)).join(' ');
  assert.match(t2022, /korkein sitten vuoden 1984/);
  assert.match(t2022, /Inflaatio kiihtyi edellisvuodesta 4,9 prosenttiyksikköä \(2021: 2,2/);
  assert.doesNotMatch(t2022, /yks\./);
  if (A.yearMap.get(2015).khi.value < 0) assert.match(yearText(A, A.yearMap.get(2015)).join(' '), /Hintojen vuosimuutos laski edellisvuodesta/);
  const cur = A.yearMap.get(LY);
  if (cur.khi.partial) assert.match(yearText(A, cur).join(' '), /kun loppuvuoden kuukaudet julkaistaan/);
});

test('overview: annual figure and header use the newest release; table note and subtitle wording', () => {
  const doc = page('/inflaatio/');
  const u = latest.updated;
  const newest = [u.khiAnnual, latest.khi.currentYear.complete ? null : u.khi, u.ykhi, u.ykhiAnnual].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1);
  const stamp = `Päivitetty <time datetime="${newest.slice(0, 10)}">${fmt.date(newest)}</time>`;
  const figure = doc.slice(doc.indexOf('id="vuodet-kaavio"'));
  assert.ok(figure.includes(stamp), `annual chart source line: ${stamp}`);
  assert.ok(doc.slice(0, doc.indexOf('id="tunnusluvut"')).includes(stamp), 'page header');
  assert.match(doc, /Suomen inflaatio vuodesta 1980 alkaen Tilastokeskuksen virallisina vuosimuutoksina\./);
  assert.doesNotMatch(doc, /\(vuosi \d{4} \(/, 'no nested parentheses');
  if (!latest.khi.currentYear.complete) {
    assert.ok(doc.includes(`${latest.khi.currentYear.label} vaaleampana`));
    assert.ok(doc.includes(`; vuoden ${LY} luku on ${latest.khi.currentYear.span}kuun vuosimuutosten keskiarvo.`));
  }
});

test('month pages show both bases with labels, YKHI, euro area and neighbours', () => {
  const doc = page(monthPath(L));
  assert.ok(doc.includes(`KHI 2025=100`) && doc.includes(fmt.idx(latest.khi.index2025)));
  assert.ok(doc.includes(`KHI 2015=100`) && doc.includes(fmt.idx(latest.khi.index2015)));
  assert.ok(doc.includes(`Inflaatio ${fmt.inessive(L)}: ${fmt.pct(latest.khi.yoy)}`));
  assert.ok(doc.includes(fmt.pp(latest.khi.delta).split(fmt.NBSP)[0]));
  assert.match(doc, /rel="prev"/);
  assert.doesNotMatch(doc, /rel="next"/, 'latest month has no next link');
  const first = page('/inflaatio/2015/tammikuu/');
  assert.doesNotMatch(first, /rel="prev"/);
  assert.match(first, /rel="next"/);
});

/* ---------------------------------------------------------------- katsaus */

test('reviews: Article JSON-LD, generated paragraphs, next release for the latest month', () => {
  const doc = page(`/katsaus/${L}/`);
  const A0 = archive(ctx);
  assert.match(doc, /"@type":"Article"/);
  const k = katsausModel(ctx, L);
  assert.ok(k.paragraphs.length >= 3 && k.paragraphs.length <= 5, `${k.paragraphs.length} paragraphs`);
  if (k.published) assert.match(doc, new RegExp(`"datePublished":"${k.published}"`));
  const nr = latest.nextRelease?.khi;
  if (nr && nr.period === fmt.ymAdd(L, 1)) assert.ok(k.paragraphs.at(-1).includes(fmt.date(nr.date)));
  assert.equal(katsausHeadline({ yoy: 2.2, delta: 0.1 }), 'Inflaatio kiihtyi 2,2 prosenttiin');
  assert.equal(katsausHeadline({ yoy: 0.7, delta: -0.3 }), 'Inflaatio hidastui 0,7 prosenttiin');
  assert.equal(katsausHeadline({ yoy: 2.1, delta: 0 }), 'Inflaatio pysyi 2,1 prosentissa');
  // Negative inflation is never "kiihtyi/hidastui −0,2 prosenttiin".
  assert.equal(katsausHeadline({ yoy: -0.2, prevYoy: 0.5, delta: -0.7 }), 'Kuluttajahinnat laskivat vuodessa 0,2 prosenttia');
  assert.equal(katsausHeadline({ yoy: -0.1, prevYoy: -0.2, delta: 0.1 }), 'Kuluttajahinnat laskivat vuodessa 0,1 prosenttia');
  assert.equal(katsausHeadline({ yoy: 0.2, prevYoy: -0.1, delta: 0.3 }), 'Inflaatio palasi plussalle, 0,2 prosenttiin');
  assert.equal(katsausHeadline({ yoy: 0.04, prevYoy: -0.1, delta: 0.1 }), 'Kuluttajahinnat pysyivät vuotta aiemmalla tasolla');
  for (const ym of ['2025-10', '2025-11', '2026-01']) {
    const h = katsausModel(ctx, ym).headline;
    if (A0.month(ym).yoy < 0) assert.match(h, /^Kuluttajahinnat laskivat vuodessa \d+,\d prosenttia$/, `${ym}: ${h}`);
  }
  const back = katsausModel(ctx, '2025-12');
  if (A0.month('2025-12').yoy > 0 && A0.month('2025-11').yoy < 0) assert.match(back.headline, /^Inflaatio palasi plussalle/);
  assert.match(doc, /Inflaatio kahden vuoden ajalta/);
  assert.doesNotMatch(doc, /Kaksi vuotta taaksepäin|vuosiluku/);
  const desc = doc.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.match(desc, /^Inflaatiokatsaus, /);
  const older = katsausModel(ctx, '2024-03');
  assert.equal(older.next, null);
  assert.ok(older.paragraphs.every((p) => typeof p === 'string' && p.endsWith('.')));
});

test('owner comments are optional and normalised', () => {
  const c = { ...ctx, content: { katsauskommentit: { '2026-08': 'Yksi.', '2026-07': { text: ['A.', 'B.'], author: 'N' }, '2026-06': { text: '' } } } };
  assert.deepEqual(ownerComment(c, '2026-08'), { paragraphs: ['Yksi.'], author: null, date: null });
  assert.deepEqual(ownerComment(c, '2026-07').paragraphs, ['A.', 'B.']);
  assert.equal(ownerComment(c, '2026-06'), null);
  assert.equal(ownerComment(c, '2026-05'), null);
});

/* ------------------------------------------------------------------- feed */

/** Tiny well-formedness check: every element closes in order. */
function assertWellFormed(xml) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, close, name, , selfClose] = m;
    if (selfClose) continue;
    if (close) assert.equal(stack.pop(), name, `closing </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'all elements closed');
  // No stray markup characters outside tags / entities.
  const text = body.replace(/<[^>]+>/g, '');
  assert.doesNotMatch(text, /[<>]/);
  assert.doesNotMatch(text, /&(?!(amp|lt|gt|quot|apos);)/);
}

test('feed.xml is valid RSS 2.0 with atom:link and dated items', () => {
  const xml = readFileSync(path.join(out, 'feed.xml'), 'utf8');
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assertWellFormed(xml);
  assert.match(xml, /<atom:link href="https:\/\/inflaatio\.fi\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/);
  assert.match(xml, /<language>fi<\/language>/);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.ok(items.length > 0 && items.length <= FEED_MAX_ITEMS);
  const dates = [];
  const guids = new Set();
  for (const it of items) {
    for (const tag of ['title', 'link', 'guid', 'pubDate', 'description']) assert.match(it, new RegExp(`<${tag}[ >][^<]+</${tag}>`), tag);
    assert.match(it, /<link>https:\/\/inflaatio\.fi\/[^<]*<\/link>/);
    const pd = it.match(/<pubDate>([^<]+)<\/pubDate>/)[1];
    assert.match(pd, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:00 [+-]\d{4}$/);
    dates.push(Date.parse(pd));
    const guid = it.match(/<guid[^>]*>([^<]+)<\/guid>/)[1];
    assert.ok(!guids.has(guid), `unique guid ${guid}`);
    guids.add(guid);
  }
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a), 'newest first');
  // Every changelog entry of the data is present while the feed is under its limit.
  if (items.length < FEED_MAX_ITEMS) assert.equal(items.filter((it) => /isPermaLink="false"/.test(it)).length, data.muutosloki.length);
  // Linked pages exist in the build.
  for (const it of items) {
    const link = it.match(/<link>https:\/\/inflaatio\.fi([^<#]*)/)[1];
    if (/^\/(inflaatio|katsaus)\//.test(link)) assert.ok(existsSync(path.join(out, ...link.split('/').filter(Boolean), 'index.html')), link);
  }
});

test('rfc822 dates use Helsinki time (EEST/EET)', () => {
  assert.equal(rfc822('2026-09-14', '08:00'), 'Mon, 14 Sep 2026 08:00:00 +0300');
  assert.equal(rfc822('2026-01-15', '12:00'), 'Thu, 15 Jan 2026 12:00:00 +0200');
  assert.equal(rfc822('2026-03-29', '04:30'), 'Sun, 29 Mar 2026 04:30:00 +0300');
  assert.throws(() => rfc822('2026-9-1', '08:00'));
  assert.equal(xmlEscape(`a & <b> "c" 'd'`), 'a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;');
  assert.equal(logId({ source: 'ykhi', period: '2026-08', kind: 'ennakko' }), 'muutos-ykhi-2026-08-ennakko');
});

/* ------------------------------------------------------- model and texts */

test('Finnish text helpers', () => {
  assert.equal(listFi(['a']), 'a');
  assert.equal(listFi(['a', 'b', 'c']), 'a, b ja c');
  // Month first, so the year and the value are never side by side; "alemmat" for prices.
  assert.equal(levelSentence('2026-08', 2.2), n('Elokuussa 2026 kuluttajahinnat olivat 2,2 % korkeammat kuin vuotta aiemmin.'));
  assert.equal(levelSentence('2025-10', -0.2), n('Lokakuussa 2025 kuluttajahinnat olivat 0,2 % alemmat kuin vuotta aiemmin.'));
  assert.match(levelSentence('2016-01', 0), /^Tammikuussa 2016 kuluttajahinnat olivat samalla tasolla/);
  // "from July's 2.1 per cent (+0.1 %-points)"; a year boundary names the year before the month.
  assert.equal(deltaSentence('2026-07', 2.1, 0.1), `Inflaatio kiihtyi heinäkuun 2,1 prosentista (${fmt.pp(0.1)}).`);
  assert.equal(deltaSentence('2023-12', 3.6, -0.3), `Inflaatio hidastui vuoden 2023 joulukuun 3,6 prosentista (${fmt.pp(-0.3)}).`);
  assert.equal(deltaSentence('2025-12', 0.2, -0.4), `Hintojen vuosimuutos laski vuoden 2025 joulukuun 0,2 prosentista (${fmt.pp(-0.4)}).`);
  // Below zero the sentence is about the annual change of prices, not "inflation accelerated".
  assert.equal(deltaSentence('2025-10', -0.2, 0.1), `Hintojen vuosimuutos nousi lokakuun ${fmt.MINUS}0,2 prosentista (${fmt.pp(0.1)}).`);
  assert.equal(deltaSentence('2025-09', 0.5, -0.7), `Hintojen vuosimuutos laski syyskuun 0,5 prosentista (${fmt.pp(-0.7)}).`);
  assert.equal(deltaSentence('2026-06', 2.1, 0), 'Inflaatio pysyi kesäkuun tasolla.');
  assert.equal(deltaSentence('2026-06', null, 0.1), '');
  assert.equal(monthsListFi(['2026-08']), 'elokuu');
  assert.equal(monthsListFi(['2026-11', '2026-12']), 'marras- ja joulukuu');
  assert.equal(monthsListFi(['2026-02', '2026-03', '2026-12']), 'helmi-, maalis- ja joulukuu');
  assert.equal(monthsListFi([]), '');
  assert.equal(prevMonthNote('2026-07', 2.1), n('Heinäkuussa 2,1 %'));
  assert.equal(prevMonthNote('2025-12', 0.2), n('Vuoden 2025 joulukuussa 0,2 %'));
  assert.equal(momSentence(-0.2), n('Hintataso laski kuukaudessa 0,2 %.'));
  assert.equal(momSentence(0.04), 'Hintataso pysyi kuukauden aikana ennallaan.');
  assert.equal(momSentence(null), '');
  const long = fitDescription(['x'.repeat(100), 'y'.repeat(60)]);
  assert.equal(long, 'x'.repeat(100));
  assert.ok(fitDescription(['z'.repeat(200)]).length <= 155);
});

test('records, ranks, decades and price level come from the official data', () => {
  const A = archive(ctx);
  const ka = data['khi-annual'];
  const official = ka.years.map((y, i) => [Number(y), ka.yoy[i]]).filter(([, v]) => v != null);
  const max = Math.max(...official.map(([, v]) => v));
  assert.equal(A.records.yearMax.value, max);
  assert.deepEqual(A.records.yearMax.months, official.filter(([, v]) => v === max).map(([y]) => String(y)));
  assert.equal(rankSince(A.years.filter((r) => r.khi.official), 2022, 'high').year, 1984);
  assert.equal(rankSince(A.years, 1980, 'high'), null);

  const d80 = decades(A).find((d) => d.decade === 1980);
  const i79 = ka.index['1972=100'][ka.years.indexOf('1979')];
  const i89 = ka.index['1972=100'][ka.years.indexOf('1989')];
  assert.ok(Math.abs(d80.avg - ((i89 / i79) ** (1 / 10) - 1) * 100) < 1e-9);
  assert.equal(d80.officialFrom, 1980);
  assert.equal(d80.officialTo, 1989);

  const lvl = priceLevelNow(A, 2000);
  const i2000 = ka.index['1972=100'][ka.years.indexOf('2000')];
  const iNow = data.khi.index['1972=100'][data.khi.months.indexOf(L)];
  assert.ok(Math.abs(lvl.eur100 - (100 * iNow) / i2000) < 1e-9);
  assert.equal(priceLevelNow(A, LY), null, 'no price level for the current year');

  const text2022 = yearText(A, A.yearMap.get(2022));
  assert.ok(text2022[0].startsWith(n('Kuluttajahinnat nousivat vuonna 2022 keskimäärin 7,1 %')));
  const cur = A.yearMap.get(LY);
  if (!cur.khi.official) {
    assert.equal(cur.khi.label, latest.khi.currentYear.label);
    assert.ok(Math.abs(cur.khi.value - latest.khi.currentYear.value) < 1e-9);
  }
});

test('month model: groups use contributions when published, otherwise group changes', () => {
  const A = archive(ctx);
  const m = A.month(L);
  assert.equal(m.yoy, latest.khi.yoy);
  assert.equal(m.delta, latest.khi.delta);
  assert.equal(m.mom, latest.khi.mom);
  const g = data.hyodykkeet.groups;
  const iL = g.months.indexOf(L);
  if (iL >= 0 && g.series.SSS.contribution[iL] != null) {
    assert.equal(m.groups.mode, 'contribution');
    assert.equal(m.groups.rows.length, g.codes.length - 1);
    const sum = m.groups.rows.reduce((s, r) => s + r.contribution, 0);
    assert.ok(Math.abs(sum - latest.khi.yoy) < 0.3);
  }
  const early = g.months.find((ym, i) => g.series.SSS.contribution[i] == null && g.series.SSS.yoy[i] != null);
  if (early) assert.equal(A.month(early).groups.mode, 'yoy');
  assert.equal(A.month('2015-01').groups, null, 'no group data before the 60-month window');
});

test('contributions: "yhteensä" is the sum of the main groups; names follow "pääryhmä"', () => {
  const A = archive(ctx);
  const m = A.month(L);
  if (m.groups?.mode !== 'contribution') return;
  const sum = m.groups.rows.reduce((s, r) => s + r.contribution, 0);
  assert.ok(Math.abs(m.groups.sum - sum) < 1e-12);
  const text = `Pääryhmien vaikutukset ovat yhteensä ${fmt.pp(sum, { decimals: 2 })}; kokonaisindeksin vuosimuutos oli ${fmt.pct(m.yoy)}.`;
  const top = m.groups.rows[0];
  for (const p of [monthPath(L), `/katsaus/${L}/`]) {
    const doc = page(p);
    assert.ok(doc.includes(text), `${p}: ${text}`);
    assert.ok(doc.includes(`Eniten vuosimuutosta nosti pääryhmä ${top.name} (${fmt.pp(top.contribution, { decimals: 2 })})`), p);
  }
  // August 2026: the groups sum to +2,19 while the total index's own contribution is +2,18.
  if (L === '2026-08') {
    assert.equal(fmt.pp(m.groups.sum, { decimals: 2 }), fmt.pp(2.19, { decimals: 2 }));
    assert.equal(fmt.pp(m.groups.total, { decimals: 2 }), fmt.pp(2.18, { decimals: 2 }));
  }
  const k = katsausModel(ctx, L);
  assert.ok(k.paragraphs.some((p) => p.includes(`pääryhmä${k.up.length === 1 ? '' : 't'} ${top.name}`)));
});

test('group changes before contributions: falling prices are not "rose the least"', () => {
  const A = archive(ctx);
  const ym = A.monthPages.find((x) => A.month(x).groups?.mode === 'yoy' && fmt.round(A.month(x).groups.rows.at(-1).yoy, 1) < 0);
  if (!ym) return;
  const rows = A.month(ym).groups.rows;
  const doc = page(monthPath(ym));
  assert.ok(doc.includes(`ja laskivat eniten pääryhmässä ${rows.at(-1).name} (${fmt.pct(rows.at(-1).yoy, { sign: true })})`), ym);
  assert.ok(doc.includes('eniten laskivat pääryhmässä'), `${ym} aria-label`);
  assert.doesNotMatch(doc, /vähiten pääryhmässä/);
});

test('events file: month precision, short neutral labels, sorted', () => {
  const ev = content.tapahtumat;
  assert.ok(ev.length >= 15 && ev.length <= 30);
  for (const e of ev) {
    assert.match(e.month, /^\d{4}-(0[1-9]|1[0-2])$/);
    assert.ok(e.label.length <= 24, e.label);
    assert.ok(e.text.length > 20 && /\.$/.test(e.text), e.text);
    assert.ok(e.month >= '1980-01' && e.month <= L);
  }
  assert.deepEqual(ev.map((e) => e.month), [...ev.map((e) => e.month)].sort());
  // Facts checked against the ECB decisions in data/korot.json.
  const dec = readJson('data/korot.json').decisions;
  const cuts = dec.filter((d, i) => i > 0 && d.date >= '2024-06-01' && d.date <= '2025-06-30' && d.depositRate < dec[i - 1].depositRate);
  assert.equal(cuts.length, 8);
  assert.match(ev.find((e) => e.month === '2025-06').text, /kahdeksas lasku kesäkuusta 2024 alkaen/);
  const hike = dec.findIndex((d) => d.date === '2022-07-27');
  assert.equal(dec[hike - 1].depositRate, -0.5);
  assert.equal(dec[hike].depositRate, 0);
  assert.match(ev.find((e) => e.month === '2022-07').text, /talletuskorko nousi −0,50 prosentista nollaan 27\.7\.2022/);
});

test('katsaus index: table note and lede wording', () => {
  const doc = page('/katsaus/');
  assert.ok(doc.includes('Muutos = ero edellisen kuukauden vuosimuutokseen, prosenttiyksikköä.'));
  assert.ok(doc.includes('Tekstit laaditaan automaattisesti Tilastokeskuksen ja Eurostatin luvuista.'));
  assert.ok(page(`/katsaus/${L}/`).includes(`Vuoden ${LY} inflaatio ja kuukausiluvut.`));
  assert.ok(page(monthPath(L)).includes(`Vuoden ${LY} inflaatio ja kaikki kuukaudet.`));
  for (const p of result.pages.filter((x) => /^\/inflaatio\/\d{4}\/[a-z]+\/$/.test(x))) {
    assert.doesNotMatch(page(p).match(/<meta name="description" content="([^"]*)">/)[1], /(^|\. )Pisteluvut\.$/, `${p}: no bare "Pisteluvut." fragment`);
  }
});

/* ------------------------------------------------------------- pisteluvut */

test('pisteluvut: every official base + elinkustannusindeksi, points-based change', () => {
  const series = indexSeries(ctx);
  assert.deepEqual(series.map((s) => s.key), [...Object.keys(data.khi.index).map((b) => b.slice(0, 4)).sort((a, b) => b - a), 'eki']);
  const k25 = series.find((s) => s.key === '2025');
  assert.equal(valueAt(k25, L), latest.khi.index2025);
  const eki = series.find((s) => s.key === 'eki');
  assert.equal(eki.base, '1951:10=100');
  const a = valueAt(eki, fmt.ymAdd(L, -12));
  const b = valueAt(eki, L);
  assert.ok(Math.abs(change12(eki, L) - (b / a - 1) * 100) < 1e-9);
  const doc = page('/pisteluvut/');
  assert.match(doc, /<script type="application\/json" id="pisteluvut-data">/);
  assert.match(doc, /<select[^>]*id="pisteluvut-perusvuosi"/);
  assert.equal((doc.match(/class="disclosure pisteluvut-vuosi"/g) ?? []).length, LY - 1995 + 1, 'history per year on 2025=100');
});

/* ---------------------------------------- /pisteluvut/ script (fake DOM) */

class FakeText {
  constructor(t) {
    this.nodeType = 3;
    this.data = String(t);
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = String(v);
  }
}

class FakeEl {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.listeners = {};
    this.classList = { add() {}, remove() {} };
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      if (typeof n === 'string') this.append(new FakeText(n));
      else if (n.isFragment) this.append(...n.childNodes);
      else {
        this.childNodes.push(n);
        n.parentElement = this;
      }
    }
  }
  replaceChildren(...nodes) {
    this.childNodes = [];
    this.append(...nodes);
  }
  get lastChild() {
    return this.childNodes.at(-1) ?? null;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) {
    this.childNodes = [new FakeText(v)];
  }
  all(tag) {
    const want = tag.toUpperCase();
    const outList = [];
    const walk = (n) => n.childNodes?.forEach((c) => (c.tagName === want && outList.push(c), walk(c)));
    walk(this);
    return outList;
  }
  querySelector(sel) {
    return this.all(sel)[0] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type) {
    for (const fn of this.listeners[type] ?? []) fn({ type, target: this });
  }
}

test('pisteluvut page script switches the base and keeps it in the URL', async () => {
  const mod = await import('../src/js/pages/pisteluvut.js');
  const doc = page('/pisteluvut/');
  const island = doc.match(/<script type="application\/json" id="pisteluvut-data">([\s\S]*?)<\/script>/)[1];
  const els = new Map();
  const mk = (id, tag) => {
    const e = new FakeEl(tag);
    els.set(id, e);
    return e;
  };
  mk('pisteluvut-data', 'script').textContent = island;
  const select = mk('pisteluvut-perusvuosi', 'select');
  select.value = '2025';
  const table = mk('pisteluvut-taulukko', 'table');
  table.setAttribute('data-collapsed', 'true');
  table.append(new FakeEl('caption'), new FakeEl('tbody'));
  const history = mk('pisteluvut-historia', 'div');
  const intro = new FakeEl('p');
  const title = mk('pisteluvut-historia-otsikko', 'span');
  intro.append(title, ', 1995–2026. Avaa vuosi nähdäksesi sen kuukaudet.');
  mk('pisteluvut-tila', 'div');

  const loc = { href: 'https://inflaatio.fi/pisteluvut/', pathname: '/pisteluvut/', search: '', hash: '' };
  const saved = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
  globalThis.Node = { TEXT_NODE: 3 };
  globalThis.document = {
    getElementById: (id) => els.get(id) ?? null,
    createElement: (tag) => new FakeEl(tag),
    createTextNode: (t) => new FakeText(t),
    createDocumentFragment: () => Object.assign(new FakeEl('#fragment'), { isFragment: true }),
  };
  globalThis.window = {
    location: loc,
    history: {
      state: null,
      replaceState(_s, _t, url) {
        const u = new URL(url, 'https://inflaatio.fi');
        loc.search = u.search;
        loc.href = u.href;
      },
    },
  };
  try {
    const show = mod.init();
    assert.equal(typeof show, 'function');
    select.value = '1972';
    select.dispatch('change');
    const tbody = table.querySelector('tbody');
    assert.equal(tbody.childNodes.length, 36);
    assert.equal(tbody.childNodes.filter((r) => r.hasAttribute('data-extra')).length, 24);
    assert.equal(tbody.childNodes[0].childNodes[1].textContent, fmt.idx(data.khi.index['1972=100'][data.khi.months.indexOf(L)]));
    assert.match(table.querySelector('caption').textContent, /^Kuluttajahintaindeksi 1972=100, /);
    assert.equal(history.childNodes.length, LY - 1972 + 1);
    assert.equal(history.childNodes.at(-1).querySelector('summary').textContent, '1972');
    assert.equal(title.textContent, 'Kuluttajahintaindeksi 1972=100');
    assert.equal(intro.lastChild.textContent, `, 1972–${LY}. Avaa vuosi nähdäksesi sen kuukaudet.`);
    assert.equal(loc.search, '?indeksi=1972');
    // One announcement channel: the page's own polite live region (no toast).
    assert.equal(els.get('pisteluvut-tila').textContent, 'Näytetään Kuluttajahintaindeksi 1972=100.');
    assert.doesNotMatch(readFileSync(path.join(ROOT, 'src/js/pages/pisteluvut.js'), 'utf8'), /announce\(/);
    // A full year shows the official annual average as a 13th row.
    const y2000 = history.childNodes.find((d) => d.querySelector('summary').textContent === '2000');
    assert.equal(y2000.querySelector('tbody').childNodes.length, 13);

    select.value = 'eki';
    select.dispatch('change');
    assert.equal(history.childNodes.at(-1).querySelector('summary').textContent, '1951');
    assert.match(table.querySelector('caption').textContent, /^Elinkustannusindeksi 1951:10=100/);

    select.value = '2025';
    select.dispatch('change');
    assert.equal(loc.search, '', 'default base removes the parameter');
  } finally {
    Object.assign(globalThis, saved);
  }
});

/* ------------------------------------------------ edge cases (stub ctx) */

/** Copy of the data with every monthly series cut after `ym` (as if it were the latest month). */
function truncate(src, ym) {
  const d = structuredClone(src);
  const cut = (months, ...arrays) => {
    const n = months.indexOf(ym) + 1;
    return [months.slice(0, n), ...arrays.map((a) => a?.slice(0, n))];
  };
  const k = d.khi;
  const n = k.months.indexOf(ym) + 1;
  k.yoy = k.yoy.slice(0, n);
  k.mom = k.mom.slice(0, n);
  for (const b of Object.keys(k.index)) k.index[b] = k.index[b].slice(0, n);
  k.months = k.months.slice(0, n);
  const y = d.ykhi;
  const ny = y.months.indexOf(ym) + 1;
  for (const g of Object.values(y.geo)) for (const key of Object.keys(g)) {
    if (Array.isArray(g[key])) g[key] = g[key].slice(0, ny);
    else if (g[key] && typeof g[key] === 'object') for (const b of Object.keys(g[key])) g[key][b] = g[key][b].slice(0, ny);
  }
  y.months = y.months.slice(0, ny);
  y.flags = {};
  const e = d.elinkustannusindeksi.monthly;
  [e.months, e.values] = cut(e.months, e.values);
  d.muutosloki = d.muutosloki.filter((x) => x.period <= ym);
  return d;
}

async function stubCtx(d) {
  const htmlLib = await import('../scripts/lib/html.js');
  const components = await import('../src/templates/components.js');
  const svg = await import('../scripts/lib/svg.js');
  const stats = await import('../src/js/lib/stats.js');
  const { layout, crumbs } = await import('../src/templates/layout.js');
  const site = (await import('../src/site.config.js')).default;
  const warnings = [];
  const c = {
    site,
    baseUrl: site.baseUrl,
    data: d,
    content: { ...content, katsauskommentit: { '2026-01': 'Omistajan kommentti.' } },
    latest: computeLatest(d, content),
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
    asset: (name) => `/assets/${name}`,
    assetImports: () => [],
    themeBoot: themeBootScript(),
    warn: (m) => warnings.push(m),
    warnings,
  };
  c.layout = (o) => layout(c, o);
  c.crumbs = (...a) => crumbs(c, ...a);
  return c;
}

async function renderAll(c) {
  const mods = await Promise.all(MODULES.map((m) => import(`../src/pages/${m}.js`)));
  const outs = [];
  for (const m of mods) outs.push(...(await m.default(c)));
  return new Map(outs.map((o) => [o.path, o]));
}

test('January: a one-month current year is labelled and every page still renders', async () => {
  const c = await stubCtx(truncate(data, '2026-01'));
  const outs = await renderAll(c);
  assert.deepEqual(c.warnings, []);
  const y = outs.get('/inflaatio/2026/').html;
  assert.match(y, /<title>Inflaatio 2026 Suomessa: [^<]+ \(tammi\) \| Inflaatio\.fi<\/title>/);
  assert.match(y, /ensimmäinen kuukausiluku/);
  assert.ok(outs.has('/inflaatio/2026/tammikuu/') && !outs.has('/inflaatio/2026/helmikuu/'));
  assert.ok(outs.has('/katsaus/2026-01/'));
  assert.match(outs.get('/katsaus/2026-01/').html, /Ylläpitäjän kommentti/);
  assert.match(outs.get('/katsaus/2026-01/').html, /Omistajan kommentti\./);
  for (const [p, o] of outs) if (o.html) assert.deepEqual(cspProblems(o.html), [], p);
});

test('December before the official annual figure: the year is complete but not official', async () => {
  const d = truncate(data, '2025-12');
  const ka = d['khi-annual'];
  const i = ka.years.indexOf('2025');
  ka.years = ka.years.slice(0, i);
  ka.yoy = ka.yoy.slice(0, i);
  for (const b of Object.keys(ka.index)) ka.index[b] = ka.index[b].slice(0, i);
  const c = await stubCtx(d);
  const A = archive(c);
  const r = A.yearMap.get(2025);
  assert.equal(r.khi.official, false);
  assert.equal(r.khi.partial, false);
  assert.equal(r.khi.label, '2025');
  const outs = await renderAll(c);
  const y = outs.get('/inflaatio/2025/').html;
  assert.match(y, /<title>Inflaatio 2025 Suomessa: [^<]+ \(tammi–joulu\) \| Inflaatio\.fi<\/title>/);
  assert.match(y, /virallinen vuosimuutos ei ole vielä aineistossa/);
  assert.deepEqual(c.warnings, []);
});
