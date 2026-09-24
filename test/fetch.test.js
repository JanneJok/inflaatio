/**
 * Unit tests for the data fetch layer (scripts/fetch). No network: HTTP is
 * stubbed and every source response comes from test/fixtures/fetch/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { request, getJson, HttpError, isRetryable, backoffDelay, retryAfterMs, snippet } from '../scripts/fetch/http.js';
import { parseJsonStat, seriesOf, normaliseTime } from '../scripts/fetch/jsonstat.js';
import { RateLimiter, findVariable, findValues, findValue, mergeParts, tableWebUrl } from '../scripts/fetch/pxweb.js';
import { buildUrl, errorLabel, parseToc, pickCode, findDim } from '../scripts/fetch/eurostat.js';
import { parseCsv } from '../scripts/fetch/ecb.js';
import { Checker, ValidationError, assertSeries, freshness, ageDays, check } from '../scripts/fetch/validate.js';
import { stringifyData, sameContent, align, dataSpan, monthsBetween, quartersBetween, sentenceCase, latestPeriod } from '../scripts/fetch/util.js';
import { parseLabel, levelOf, parentOf } from '../scripts/fetch/coicop.js';
import { parseStatFi, parseEurostat, mergeCalendar, luxembourgToHelsinki, helsinki } from '../scripts/fetch/kalenteri.js';
import { run, mergeLog, eventDate, isoTimestamp, selectSources, parseArgs, SOURCES } from '../scripts/fetch/index.js';
import khiSource, { khiText } from '../scripts/fetch/sources/khi.js';
import ykhiSource, { ykhiText } from '../scripts/fetch/sources/ykhi.js';
import korotSource, { monthEndRates, changePoints } from '../scripts/fetch/sources/korot.js';
import ansiotSource from '../scripts/fetch/sources/ansiot.js';
import { baseFromTitle } from '../scripts/fetch/sources/elinkustannusindeksi.js';

const FIX = new URL('./fixtures/fetch/', import.meta.url);
const fixture = async (name) => readFile(new URL(name, FIX), 'utf8');
const fixtureJson = async (name) => JSON.parse(await fixture(name));
const clone = (v) => structuredClone(v);

/* ------------------------------------------------------------------ http */

/** Fake fetch returning queued responses. */
function fakeFetch(queue) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = '', headers = {} } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      headers: new Headers(headers),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  return { impl, calls };
}
const noSleep = async () => {};

test('http: retries 503 and network errors, then succeeds', async () => {
  const net = new TypeError('fetch failed');
  const { impl, calls } = fakeFetch([{ status: 503, body: 'busy' }, net, { status: 200, body: { ok: 1 } }]);
  const retries = [];
  const json = await getJson('https://x.test/a', { fetchImpl: impl, sleep: noSleep, onRetry: (r) => retries.push(r.attempt) });
  assert.deepEqual(json, { ok: 1 });
  assert.equal(calls.length, 3);
  assert.deepEqual(retries, [1, 2]);
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'every request has a timeout signal');
  assert.match(calls[0].init.headers['user-agent'], /inflaatio\.fi/);
});

test('http: 4xx fails fast with status, URL and body snippet', async () => {
  const { impl, calls } = fakeFetch([{ status: 400, body: '<html><b>Bad</b> variable Kuukausi</html>' }]);
  await assert.rejects(getJson('https://x.test/b', { fetchImpl: impl, sleep: noSleep }), (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 400);
    assert.match(e.message, /HTTP 400/);
    assert.match(e.message, /https:\/\/x\.test\/b/);
    assert.match(e.message, /Bad variable Kuukausi/);
    return true;
  });
  assert.equal(calls.length, 1, 'no retry on 400');
});

test('http: gives up after 3 retries (4 attempts) and honours Retry-After', async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, headers: { 'retry-after': '2' } }, { status: 500 }, { status: 502 }, { status: 504, body: 'gateway' },
  ]);
  const delays = [];
  await assert.rejects(request('https://x.test/c', { fetchImpl: impl, sleep: async (ms) => delays.push(ms) }), /HTTP 504.*after 4 attempts/);
  assert.equal(calls.length, 4);
  assert.equal(delays[0], 2000, 'Retry-After seconds');
  assert.equal(delays.length, 3);
});

test('http: timeout error message and helpers', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { impl } = fakeFetch([timeout, timeout]);
  await assert.rejects(request('https://x.test/t', { fetchImpl: impl, sleep: noSleep, retries: 1, timeoutMs: 5 }), /timeout after 5 ms/);
  assert.equal(isRetryable(new HttpError('x', { status: 404, url: '' })), false);
  assert.equal(isRetryable(new HttpError('x', { status: 503, url: '' })), true);
  assert.equal(isRetryable(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  assert.equal(backoffDelay(1, { baseDelayMs: 1000 }, () => 0.5), 1000);
  assert.equal(backoffDelay(3, { baseDelayMs: 1000 }, () => 0.5), 4000);
  assert.equal(backoffDelay(10, { baseDelayMs: 1000, maxDelayMs: 5000 }, () => 0.5), 5000);
  assert.equal(retryAfterMs('3'), 3000);
  assert.equal(retryAfterMs('Thu, 01 Jan 2026 00:00:10 GMT', Date.parse('2026-01-01T00:00:00Z')), 10_000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(snippet('<p>a</p>\n\n b', 10), 'a b');
});

/* -------------------------------------------------------------- json-stat */

test('json-stat: PxWeb json-stat2 (dense) → series with contract months', async () => {
  const ds = parseJsonStat(await fixtureJson('pxweb-122p.json'));
  assert.equal(ds.updated, '2026-09-14T05:00:00Z');
  assert.deepEqual(ds.ids, ['timeperiod_m', 'contentscode']);
  const s = seriesOf(ds, 'timeperiod_m', { contentscode: 'Vuosimuutos' }, normaliseTime);
  assert.deepEqual(s.times, ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(s.values, [2.1, 2.1, 2.2]);
  assert.deepEqual(s.status, [null, null, null]);
  // single-category dimensions may be omitted from the coordinates
  assert.equal(ds.get({ timeperiod_m: '2026M08' }), 2.2);
  assert.equal(ds.get({ timeperiod_m: '2030M01' }), null, 'unknown category → null');
});

test('json-stat: Eurostat sparse values and status flags', async () => {
  const ds = parseJsonStat(await fixtureJson('eurostat-minr.json'));
  const where = { unit: 'RCH_A', coicop18: 'TOTAL', geo: 'FI' };
  const s = seriesOf(ds, 'time', where);
  assert.deepEqual(s.values, [2.5, 2.4, 2.3]);
  assert.deepEqual(s.status, [null, null, 'e']);
  const idx = seriesOf(ds, 'time', { ...where, unit: 'I25' });
  assert.deepEqual(idx.values, [102.71, 102.36, null], 'missing sparse value → null, never 0');
  assert.throws(() => ds.get({ time: '2026-08' }), /coordinate for dimension unit missing/);
  assert.throws(() => parseJsonStat({ id: ['a'], size: [2], dimension: { a: { category: { index: ['x'] } } } }), /1 categories but size 2/);
  assert.equal(normaliseTime('2026Q2'), '2026-Q2');
  assert.equal(normaliseTime('2025'), '2025');
});

/* ------------------------------------------------------------------ pxweb */

test('pxweb: variables and values are picked by pattern, not position', async () => {
  const meta = await fixtureJson('pxweb-11xs-meta.json');
  const time = findVariable(meta, { time: true });
  assert.equal(time.code, 'timeperiod_m');
  const cont = findVariable(meta, { code: /content|tiedot/i });
  const bases = findValues(cont, { text: /pisteluku.*\d{4}\s*=\s*100/i });
  assert.ok(bases.some((b) => b.code === 'ip_0_2025' && /2025=100/.test(b.text)));
  assert.equal(findValue(cont, { text: /2015=100/ }).code, 'ip_0_2015');
  assert.throws(() => findVariable(meta, { text: /Alue/ }), /not found; variables: timeperiod_m \(Kuukausi\)/);
  assert.throws(() => findValues(cont, { text: /1900=100/ }), /no value of contentscode matches/);
  assert.equal(tableWebUrl('khi', '122p.px'), 'https://pxdata.stat.fi/PxWeb/pxweb/fi/StatFin/StatFin__khi/122p.px/');
});

test('pxweb: split query parts merge back into one reader', () => {
  const part = (codes, base) => parseJsonStat({
    id: ['item', 'time'], size: [codes.length, 2], updated: `2026-09-1${base}T05:00:00Z`,
    dimension: { item: { category: { index: codes } }, time: { category: { index: ['2026M07', '2026M08'] } } },
    value: codes.flatMap((_, i) => [base + i, base + i + 0.5]),
  });
  const merged = mergeParts([part(['01', '02'], 1), part(['03'], 5)], 'item');
  assert.deepEqual(merged.dims.item.codes, ['01', '02', '03']);
  assert.equal(merged.get({ item: '02', time: '2026M08' }), 2.5);
  assert.equal(merged.get({ item: '03', time: '2026M07' }), 5);
  assert.equal(merged.get({ item: '99', time: '2026M07' }), null);
  assert.equal(merged.updated, '2026-09-15T05:00:00Z');
});

test('pxweb: rate limiter caps calls per window and concurrency', async () => {
  let now = 0;
  const slept = [];
  const lim = new RateLimiter({ maxCalls: 2, windowMs: 1000, concurrency: 1, now: () => now, sleep: async (ms) => { slept.push(ms); now += ms; } });
  let active = 0;
  let peak = 0;
  const job = async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    return now;
  };
  const times = await Promise.all([1, 2, 3].map(() => lim.schedule(job)));
  assert.equal(peak, 1);
  assert.deepEqual(times.slice(0, 2), [0, 0]);
  assert.ok(times[2] >= 1000, 'third call waits for the window');
  assert.equal(slept.length, 1);
});

/* --------------------------------------------------------------- eurostat */

test('eurostat: URL building, error labels, TOC and code picking', async () => {
  const url = buildUrl('prc_hicp_minr', { geo: ['FI', 'EA'], coicop18: 'TOTAL', unit: undefined, sinceTimePeriod: '1996-01' });
  assert.equal(url, 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&lang=en&geo=FI&geo=EA&coicop18=TOTAL&sinceTimePeriod=1996-01');
  assert.equal(errorLabel('{ "error": [{"status": 400,"id": 150,"label": "INVALID_QUERY_DIMENSION: Dimension \\"COICOP\\" is not defined"}]}'), 'INVALID_QUERY_DIMENSION: Dimension "COICOP" is not defined');
  assert.equal(errorLabel('not json'), null);
  const toc = parseToc('"title"\t"code"\t"type"\n"    HICP monthly (old)"\t"prc_hicp_manr"\t"dataset"\t"06.02.2026"\t"07.01.2026"\t"1997-01"\t"2025-12"\t1\n"    HICP - ECOICOP ver.2 - monthly"\t"prc_hicp_minr"\t"dataset"\t"17.09.2026"\t"01.09.2026"\t"1996-01"\t"2026-08"\t2\n');
  assert.deepEqual(toc.map((r) => [r.code, r.dataEnd]), [['prc_hicp_manr', '2025-12'], ['prc_hicp_minr', '2026-08']]);
  const ds = parseJsonStat(await fixtureJson('eurostat-minr.json'));
  assert.equal(findDim(ds, /^coicop/i), 'coicop18');
  assert.equal(pickCode(ds, 'geo', { codes: ['EA'] }), 'EA');
  assert.equal(pickCode(ds, 'geo', { codes: ['EA20'], label: /^Euro area \((changing composition|EA11)/i }), 'EA', 'label fallback');
  assert.equal(pickCode(ds, 'unit', { codes: ['I15'], required: false }), null);
  assert.throws(() => pickCode(ds, 'unit', { codes: ['RCH_M'] }), /no unit category RCH_M/);
});

/* -------------------------------------------------------------------- ecb */

test('ecb: CSV parser handles quotes; month-end deposit rate from change dates', async () => {
  const rows = parseCsv(await fixture('ecb-dfr.csv'));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].TITLE, 'Deposit facility - date of changes (raw data), "Level"');
  assert.equal(rows[2].OBS_VALUE, '2.5');
  const changes = changePoints(rows.map((r) => ({ period: r.TIME_PERIOD, value: Number(r.OBS_VALUE) })));
  assert.deepEqual(changes.map((c) => c.date), ['2025-06-11', '2026-06-17', '2026-09-16']);
  const months = monthsBetween('2025-05', '2026-09');
  const rates = monthEndRates(months, changes);
  assert.equal(rates[0], null, 'before the first change');
  assert.equal(rates[months.indexOf('2025-06')], 2);
  assert.equal(rates[months.indexOf('2026-06')], 2.25, 'change on the 17th is in force at month end');
  assert.equal(rates[months.indexOf('2026-08')], 2.25);
  assert.equal(rates[months.indexOf('2026-09')], 2.5);
  // daily series collapse to change points
  assert.deepEqual(changePoints([{ period: '2026-09-15', value: 2.25 }, { period: '2026-09-16', value: 2.5 }, { period: '2026-09-17', value: 2.5 }]).map((c) => c.date), ['2026-09-15', '2026-09-16']);
});

/* --------------------------------------------------------------- validate */

test('validate: periods must be well-formed, ascending and contiguous', () => {
  const problems = (fn) => {
    const c = new Checker('t');
    fn(c);
    return c.problems;
  };
  assert.deepEqual(problems((c) => c.periods('m', ['2026-06', '2026-07', '2026-08'])), []);
  assert.match(problems((c) => c.periods('m', ['2026-06', '2026-08']))[0], /gap between 2026-06 and 2026-08/);
  assert.match(problems((c) => c.periods('m', ['2026-07', '2026-06']))[0], /not strictly ascending/);
  assert.match(problems((c) => c.periods('m', ['2026-07', '2026-07']))[0], /not strictly ascending/);
  assert.match(problems((c) => c.periods('m', ['2026-13']))[0], /malformed period/);
  assert.match(problems((c) => c.periods('m', []))[0], /no periods/);
  assert.deepEqual(problems((c) => c.periods('q', ['2025-Q4', '2026-Q1'], 'Q')), []);
  assert.match(problems((c) => c.periods('q', ['2025-Q3', '2026-Q1'], 'Q'))[0], /gap/);
  assert.deepEqual(problems((c) => c.periods('y', ['2024', '2025'], 'A')), []);
});

test('validate: values aligned, finite, in range; zero is never "missing"', () => {
  const problems = (arr, n, rule) => {
    const c = new Checker('t');
    c.values('v', arr, n, rule);
    return c.problems;
  };
  assert.deepEqual(problems([1.2, null, -0.3], 3, { min: -5, max: 30 }), []);
  assert.match(problems([1, 2], 3)[0], /length 2 ≠ 3/);
  assert.match(problems([1, undefined, 2], 3)[0], /is not a finite number or null/);
  assert.match(problems([1, NaN, 2], 3)[0], /not a finite number/);
  assert.match(problems(['2.2'], 1)[0], /not a finite number/);
  assert.match(problems([31], 1, { min: -5, max: 30 })[0], /outside -5…30/);
  assert.match(problems([100, 0], 2, { positive: true })[0], /must be > 0 \(zero used as missing\? use null\)/);
  assert.match(problems([null, null], 2)[0], /no values/);
  const c = new Checker('t');
  c.noZeroAsMissing('yoy', [2.1, 0], [101.2, null]);
  assert.match(c.problems[0], /0 while index is missing/);
});

test('validate: latest never older than previous; index/rate consistency; freshness', () => {
  const c = new Checker('t');
  c.notOlder('khi', '2026-07', '2026-08');
  c.notOlder('khi', '2026-08', '2026-08');
  assert.equal(c.problems.length, 1);
  assert.match(c.problems[0], /2026-07 is older than the previous file's 2026-08/);

  const months = monthsBetween('2025-01', '2026-01');
  const index = months.map((_, i) => 100 + i);
  const good = new Checker('t').consistent('x', months, [...Array(12).fill(null), 12.0], index, 0.15);
  assert.equal(good.problems.length, 0);
  const bad = new Checker('t').consistent('x', months, [...Array(12).fill(null), 11.5], index, 0.15);
  assert.match(bad.problems[0], /disagree by > 0.15 pp \(e.g. 2026-01: official 11.5 vs index 12.00\)/);

  const today = new Date('2026-09-24T00:00:00Z');
  assert.equal(ageDays('2026-08', today), 40);
  assert.equal(freshness('khi', '2026-08', { today }).ok, true);
  assert.equal(freshness('khi', '2026-07', { today }).ok, true, '71 days is still fresh');
  const stale = freshness('khi', '2026-06', { today });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /2026-06 is 101 days old \(limit 75\)/);
  assert.equal(freshness('ykhi', null, { today }).ok, false);
});

test('validate: assertSeries and ValidationError list every problem', () => {
  assert.equal(assertSeries('s', { months: ['2026-07', '2026-08'], arrays: { yoy: [2.1, 2.2] }, rules: { yoy: { min: -5, max: 30 } }, prevLatest: '2026-07' }), true);
  assert.throws(() => assertSeries('s', { months: ['2026-07', '2026-09'], arrays: { yoy: [2.1, 99] }, rules: { yoy: { max: 30 } }, prevLatest: '2026-10' }), (e) => {
    assert.ok(e instanceof ValidationError);
    assert.equal(e.problems.length, 3);
    assert.match(e.message, /gap/);
    assert.match(e.message, /outside/);
    assert.match(e.message, /older than the previous/);
    return true;
  });
});

test('validate: KHI source validator on a fixture', async () => {
  const khi = await fixtureJson('khi-small.json');
  assert.equal(khiSource.validate(khi, null), true);
  assert.equal(khiSource.latest(khi), '2026-08');
  // Latest month moved backwards compared with the previous file.
  const older = clone(khi);
  for (const k of ['months', 'yoy', 'mom']) older[k] = older[k].slice(0, -1);
  for (const b of Object.keys(older.index)) older.index[b] = older.index[b].slice(0, -1);
  assert.throws(() => khiSource.validate(older, khi), /latest period 2026-07 is older than the previous file's 2026-08/);
  // Zero used as a missing index value.
  const zero = clone(khi);
  zero.index['2025=100'][25] = 0;
  assert.throws(() => khiSource.validate(zero, null), /must be > 0/);
  // Annual rate that does not match the index.
  const off = clone(khi);
  off.yoy[25] = 3.2;
  assert.throws(() => khiSource.validate(off, null), /disagree/);
  // Misaligned arrays.
  const mis = clone(khi);
  mis.mom.pop();
  assert.throws(() => khiSource.validate(mis, null), /khi\.mom: length 25 ≠ 26/);
});

test('validate: YKHI validator requires flash months without index to be flagged', async () => {
  const y = await fixtureJson('ykhi-small.json');
  assert.equal(ykhiSource.validate(y, null), true);
  const flash = clone(y);
  flash.geo.FI.index['2025=100'][flash.months.length - 1] = null;
  flash.geo.FI.index['2015=100'][flash.months.length - 1] = null;
  assert.throws(() => ykhiSource.validate(flash, null), /has no index but is not flagged provisional/);
  flash.flags = { FI: { '2026-08': 'p' } };
  assert.equal(ykhiSource.validate(flash, null), true);
});

/* ---------------------------------------------------------- change detection */

test('util: stringifyData keeps primitive arrays on one line and is deterministic', () => {
  const text = stringifyData({ months: ['2026-07', '2026-08'], yoy: [2.1, null], nested: { a: [{ b: 1 }] }, skip: undefined, nan: NaN });
  assert.equal(text, '{\n  "months": ["2026-07","2026-08"],\n  "yoy": [2.1,null],\n  "nested": {\n    "a": [\n      {\n        "b": 1\n      }\n    ]\n  },\n  "nan": null\n}\n');
  assert.deepEqual(JSON.parse(text).yoy, [2.1, null]);
});

test('util: change detection ignores formatting and timestamps, not values', () => {
  const a = { generatedAt: '2026-09-01T00:00:00Z', sources: { khi: { latest: '2026-08' } } };
  const b = JSON.parse(JSON.stringify({ ...a, generatedAt: '2026-09-24T00:00:00Z' }, null, 4));
  assert.equal(sameContent(a, b), true);
  assert.equal(sameContent({ yoy: [2.2] }, { yoy: [2.3] }), false);
  assert.equal(sameContent({ yoy: [2.2] }, null), false);
});

test('util: alignment, spans and helpers', () => {
  assert.deepEqual(align(['2026-06', '2026-07', '2026-08'], ['2026-08', '2026-06'], [2.2, 2.1]), [2.1, null, 2.2]);
  assert.deepEqual(dataSpan(['a', 'b', 'c', 'd'], [[null, 1, null, null], [null, null, 2, null]]), { first: 1, last: 2, start: 'b', end: 'c' });
  assert.equal(dataSpan(['a'], [[null]]), null);
  assert.deepEqual(quartersBetween('2025-Q4', '2026-Q2'), ['2025-Q4', '2026-Q1', '2026-Q2']);
  assert.equal(monthsBetween('2025-11', '2026-02').join(), '2025-11,2025-12,2026-01,2026-02');
  assert.equal(latestPeriod(['a', 'b', 'c'], [1, 2, null]), 'b');
  assert.equal(sentenceCase('ASUMINEN, VESI, SÄHKÖ'), 'Asuminen, vesi, sähkö');
  assert.equal(sentenceCase('Leipä'), 'Leipä');
});

test('coicop: labels, levels and parents', () => {
  assert.deepEqual(parseLabel('01.1.1.3 Leipä ja leipomotuotteet (LI)'), { coicop: '01.1.1.3', name: 'Leipä ja leipomotuotteet', nature: 'LI' });
  assert.deepEqual(parseLabel('04 ASUMINEN, VESI, SÄHKÖ, KAASU JA MUUT POLTTOAINEET'), { coicop: '04', name: 'Asuminen, vesi, sähkö, kaasu ja muut polttoaineet', nature: null });
  assert.deepEqual(parseLabel('0 Yhteensä'), { coicop: null, name: 'Yhteensä', nature: null });
  assert.equal(parseLabel('07.2.4.4 Yksityisajoneuvon vuokraaminen ilman kuljettajaa (P)').nature, 'P');
  assert.deepEqual(['SSS', '01', '011', '0111', '011221'].map(levelOf), [0, 1, 2, 3, 5]);
  const codes = new Set(['SSS', '01', '011', '0112', '01122', '011221', '07']);
  assert.equal(parentOf('011221', codes), '01122');
  assert.equal(parentOf('0112', codes), '011');
  assert.equal(parentOf('07', codes), 'SSS');
  assert.equal(parentOf('SSS', codes), null);
  assert.equal(baseFromTitle('11xn -- Elinkustannusindeksi (1938:8-1939:7=100), kuukausitiedot'), '1938:8–1939:7=100');
  assert.equal(baseFromTitle('Elinkustannusindeksi (1951:10=100), kuukausitiedot'), '1951:10=100');
});

test('hyodykesivut.json: ~60 unique ascii-kebab slugs with codes and categories', async () => {
  const pages = JSON.parse(await readFile(new URL('../scripts/fetch/hyodykesivut.json', import.meta.url), 'utf8'));
  assert.ok(pages.length >= 50 && pages.length <= 80, `${pages.length} pages`);
  assert.equal(new Set(pages.map((p) => p.slug)).size, pages.length, 'unique slugs');
  assert.equal(new Set(pages.map((p) => p.code)).size, pages.length, 'unique codes');
  for (const p of pages) {
    assert.match(p.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, p.slug);
    assert.match(p.code, /^\d{2,6}$/, p.code);
    assert.ok(p.name && p.category, p.slug);
  }
});

/* ---------------------------------------------------------------- changelog */

test('changelog: KHI and YKHI texts and events', async () => {
  const khi = await fixtureJson('khi-small.json');
  assert.equal(khiText(khi, '2026-08'), 'Tilastokeskus julkaisi elokuun 2026 kuluttajahintaindeksin: inflaatio 2,2 % (heinäkuussa 2,1 %).');
  const prev = clone(khi);
  for (const k of ['months', 'yoy', 'mom']) prev[k] = prev[k].slice(0, -1);
  assert.deepEqual(khiSource.events(khi, prev).map((e) => [e.source, e.period]), [['khi', '2026-08']]);
  assert.deepEqual(khiSource.events(khi, khi), [], 'no event without a new month');

  const y = await fixtureJson('ykhi-small.json');
  const last = y.months.length - 1;
  // Previous file ended in July; the new one has an August flash.
  const flashData = clone(y);
  flashData.flags = { FI: { '2026-08': 'p' } };
  const july = clone(y);
  july.months = july.months.slice(0, -1);
  july.geo.FI.yoy = july.geo.FI.yoy.slice(0, -1);
  const ev1 = ykhiSource.events(flashData, july);
  assert.deepEqual(ev1.map((e) => [e.period, e.kind]), [['2026-08', 'ennakko']]);
  assert.equal(ev1[0].text, `Eurostat julkaisi elokuun 2026 YKHI-ennakon: Suomi 2,4 %, euroalue ${y.geo.EA.yoy[last].toFixed(1).replace('.', ',')} %.`);
  // Same month, flash → final (value revised).
  const final = clone(y);
  const prevFlash = clone(flashData);
  prevFlash.geo.FI.yoy[last] = 2.6;
  const ev2 = ykhiSource.events(final, prevFlash);
  assert.deepEqual(ev2.map((e) => [e.period, e.kind]), [['2026-08', 'lopullinen']]);
  assert.match(ev2[0].text, /lopulliset YKHI-luvut: Suomi 2,4 % \(ennakko 2,6 %\)/);
  assert.deepEqual(ykhiSource.events(final, final), []);
  assert.match(ykhiText(y, '2026-08', 'lopullinen', 2.4), /Suomi 2,4 %, euroalue/, 'no revision note when unchanged');
});

test('changelog: ansiot and korot events', () => {
  const a = { periods: ['2026-Q1', '2026-Q2'], freq: 'Q', nominalYoy: [3.6, 3.4], realYoy: [3.0, 1.6] };
  const ev = ansiotSource.events(a, { ...a, periods: ['2026-Q1'], nominalYoy: [3.6], realYoy: [3.0] });
  assert.equal(ev[0].text, 'Tilastokeskus julkaisi ansiotasoindeksin 2. neljännekseltä 2026: ansiot +3,4 %, reaaliansiot +1,6 % vuodessa.');
  const k = { decisions: [{ date: '2026-06-17', depositRate: 2.25 }, { date: '2026-09-16', depositRate: 2.5 }] };
  const kev = korotSource.events(k, { decisions: k.decisions.slice(0, 1) });
  assert.deepEqual(kev.map((e) => e.text), ['EKP:n talletuskorko 2,50 % 16.9.2026 alkaen (aiemmin 2,25 %).']);
});

test('changelog: mergeLog dedupes and keeps newest first; eventDate uses the source timestamp', () => {
  const old = [{ date: '2026-09-14', source: 'khi', period: '2026-08', text: 'a' }];
  const { log, added } = mergeLog(old, [
    { date: '2026-10-02', source: 'ykhi', period: '2026-09', kind: 'ennakko', text: 'b' },
    { date: '2026-09-14', source: 'khi', period: '2026-08', text: 'dup' },
  ]);
  assert.deepEqual(log.map((e) => e.text), ['b', 'a']);
  assert.equal(added.length, 1);
  assert.equal(mergeLog(log, []).added.length, 0);
  const today = new Date('2026-09-15T09:00:00Z');
  assert.equal(eventDate('2026-09-14T05:00:00Z', today), '2026-09-14');
  assert.equal(eventDate('2026-09-14T11:00:00+0200', today), '2026-09-14', 'Eurostat offset format');
  assert.equal(eventDate('2026-01-14T06:00:00Z', today), '2026-09-15', 'old timestamps → today');
  assert.equal(eventDate(null, today), '2026-09-15');
  assert.equal(isoTimestamp('2026-09-17T11:00:00+0200'), '2026-09-17T11:00:00+02:00', 'Eurostat offset gets a colon');
  assert.equal(isoTimestamp('2026-09-14T05:00:00Z'), '2026-09-14T05:00:00Z');
  assert.equal(isoTimestamp('2026-09-10T14:22:33.000Z'), '2026-09-10T14:22:33.000Z');
  assert.equal(isoTimestamp(null), null);
});

/* ----------------------------------------------------------------- calendar */

test('calendar: stat.fi page, Eurostat JSON, time zones and merging', async () => {
  const fi = parseStatFi(await fixture('statfi-khi-page.html'));
  assert.deepEqual(fi.map((r) => [r.source, r.period, r.iso]), [
    ['ykhi-ennakko', '2026-09', '2026-10-02T05:00:00Z'],
    ['khi', '2026-09', '2026-10-14T05:00:00Z'],
    ['khi', '2026-10', '2026-11-13T06:00:00Z'],
  ], 'fuel releases and published items are skipped');
  const es = parseEurostat(await fixtureJson('eurostat-calendar.json'));
  assert.deepEqual(es.map((r) => [r.source, r.period]), [['ykhi-ennakko', '2026-09'], ['ykhi', '2026-09'], ['ykhi-ennakko', '2026-10']]);
  assert.deepEqual(helsinki('2026-10-14T05:00:00Z'), { date: '2026-10-14', time: '08:00' });
  assert.deepEqual(helsinki('2026-11-13T06:00:00Z'), { date: '2026-11-13', time: '08:00' });
  assert.deepEqual(luxembourgToHelsinki('2026-10-02T11:00Z'), { date: '2026-10-02', time: '12:00' });

  const e = (source, period, date, publisher) => ({ date, time: '08:00', source, period, label: 'x', publisher, url: 'u' });
  const merged = mergeCalendar(
    [e('khi', '2026-07', '2026-08-14', 'Tilastokeskus'), e('khi', '2026-01', '2026-02-13', 'Tilastokeskus'), e('ykhi-ennakko', '2026-09', '2026-10-01', 'Tilastokeskus')],
    [e('ykhi-ennakko', '2026-09', '2026-10-02', 'Tilastokeskus'), e('ykhi-ennakko', '2026-09', '2026-10-02', 'Eurostat'), e('khi', '2026-09', '2026-10-14', 'Tilastokeskus')],
    { today: new Date('2026-09-24T00:00:00Z') },
  );
  assert.deepEqual(merged.map((x) => [x.source, x.period, x.date, x.publisher]), [
    ['khi', '2026-07', '2026-08-14', 'Tilastokeskus'],
    ['ykhi-ennakko', '2026-09', '2026-10-02', 'Eurostat'],
    ['khi', '2026-09', '2026-10-14', 'Tilastokeskus'],
  ], 'old entries pruned, moved date replaced, Eurostat preferred for YKHI');
});

/* -------------------------------------------------------------- orchestrator */

test('cli: argument parsing and --only selection', () => {
  const o = parseArgs(['--only', 'khi,ykhi-annual', '--dry-run', '--no-calendar']);
  assert.deepEqual(o.only, ['khi', 'ykhi-annual']);
  assert.equal(o.dryRun, true);
  assert.equal(o.calendar, false);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--only']), /needs a value/);
  const sel = selectSources(SOURCES, ['khi-annual', 'ykhiAnnual']);
  assert.deepEqual(sel.selected.map((s) => s.key), ['khiAnnual', 'ykhiAnnual']);
  assert.equal(sel.calendar, false);
  assert.equal(selectSources(SOURCES, ['kalenteri']).selected.length, 0);
  assert.throws(() => selectSources(SOURCES, ['nope']), /Unknown source/);
  assert.equal(SOURCES.length, 10);
  for (const s of SOURCES) for (const k of ['key', 'file', 'name', 'publisher', 'license', 'fetch', 'validate', 'latest']) assert.ok(s[k], `${s.file}: ${k}`);
});

/** Fake source for pipeline tests. */
function fakeSource({ key = 'khi', file = 'khi.json', data, fail = null, freshness: fresh = false, events = null }) {
  return {
    key, file, name: `Name ${key}`, publisher: 'Test', license: 'CC BY 4.0', freshness: fresh,
    fetch: async () => {
      if (fail) throw new Error(fail);
      return { data: clone(data), meta: { table: 't1', url: 'https://example.test', updated: '2026-09-14T05:00:00Z', latest: data.months.at(-1) } };
    },
    validate: (d) => check(key, (c) => c.periods(`${key}.months`, d.months).values(`${key}.yoy`, d.yoy, d.months.length, { min: -5, max: 30 })),
    latest: (d) => d.months.at(-1),
    events,
  };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inflaatio-fetch-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const quiet = { log: () => {}, calendar: false, noStepSummary: true };

test('pipeline: writes only changed files; generatedAt changes only on change', async () => {
  await withTempDir(async (dir) => {
    const today = new Date('2026-09-15T10:00:00Z');
    const data = { months: ['2026-07', '2026-08'], yoy: [2.1, 2.2] };
    const src = fakeSource({ data });
    const r1 = await run({ ...quiet, dataDir: dir, today, sources: [src] });
    assert.equal(r1.exitCode, 0);
    assert.deepEqual(r1.results.map((r) => r.status), ['created']);
    const meta1 = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta1.generatedAt, today.toISOString());
    assert.deepEqual(meta1.sources.khi, { name: 'Name khi', publisher: 'Test', table: 't1', url: 'https://example.test', license: 'CC BY 4.0', updated: '2026-09-14T05:00:00Z', latest: '2026-08' });

    // Second run, same data: nothing written, generatedAt untouched.
    const r2 = await run({ ...quiet, dataDir: dir, today: new Date('2026-09-16T10:00:00Z'), sources: [src] });
    assert.deepEqual(r2.results.map((r) => r.status), ['unchanged']);
    assert.deepEqual(r2.writes, []);
    const meta2 = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
    assert.equal(meta2.generatedAt, today.toISOString());

    // Dry run with new data: reports but writes nothing.
    const src3 = fakeSource({ data: { months: ['2026-07', '2026-08', '2026-09'], yoy: [2.1, 2.2, 2.4] } });
    const r3 = await run({ ...quiet, dataDir: dir, today, sources: [src3], dryRun: true });
    assert.deepEqual(r3.results.map((r) => r.status), ['updated']);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'khi.json'), 'utf8')).months.length, 2);
    assert.deepEqual((await readdir(dir)).sort(), ['khi.json', 'meta.json'], 'no temp files left behind');
  });
});

test('pipeline: failed or invalid source keeps the previous file and exits 1', async () => {
  await withTempDir(async (dir) => {
    const today = new Date('2026-09-15T10:00:00Z');
    const good = { months: ['2026-07', '2026-08'], yoy: [2.1, 2.2] };
    await run({ ...quiet, dataDir: dir, today, sources: [fakeSource({ data: good }), fakeSource({ key: 'ykhi', file: 'ykhi.json', data: good })] });
    const before = await readFile(path.join(dir, 'ykhi.json'), 'utf8');

    const r = await run({
      ...quiet, dataDir: dir, today,
      sources: [
        fakeSource({ data: { months: ['2026-07', '2026-08'], yoy: [2.1, 99] } }),
        fakeSource({ key: 'ykhi', file: 'ykhi.json', data: good, fail: 'HTTP 503 Service Unavailable' }),
      ],
    });
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.results.map((x) => x.status), ['invalid', 'failed']);
    assert.match(r.results[0].note, /outside -5…30/);
    assert.match(r.results[1].note, /HTTP 503/);
    assert.equal(r.results[1].latest, '2026-08', 'latest from the kept file');
    assert.equal(await readFile(path.join(dir, 'ykhi.json'), 'utf8'), before, 'previous file untouched');
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'khi.json'), 'utf8')).yoy, [2.1, 2.2]);
  });
});

test('pipeline: stale KHI/YKHI fails the run; new period appends to the changelog', async () => {
  await withTempDir(async (dir) => {
    const old = { months: ['2026-05', '2026-06'], yoy: [2.1, 2.1] };
    const events = (d, p) => (d.months.at(-1) !== p.months.at(-1) ? [{ source: 'khi', period: d.months.at(-1), text: `uusi ${d.months.at(-1)}` }] : []);
    const r1 = await run({ ...quiet, dataDir: dir, today: new Date('2026-09-24T10:00:00Z'), sources: [fakeSource({ data: old, freshness: true, events })] });
    assert.equal(r1.exitCode, 1);
    assert.equal(r1.results[0].status, 'stale');
    assert.match(r1.results[0].note, /2026-06 is 101 days old/);

    const today = new Date('2026-09-14T09:00:00Z');
    const r2 = await run({ ...quiet, dataDir: dir, today, sources: [fakeSource({ data: { months: ['2026-05', '2026-06', '2026-07', '2026-08'], yoy: [2.1, 2.1, 2.1, 2.2] }, freshness: true, events })] });
    assert.equal(r2.exitCode, 0);
    const log = JSON.parse(await readFile(path.join(dir, 'muutosloki.json'), 'utf8'));
    assert.deepEqual(log, [{ date: '2026-09-14', source: 'khi', period: '2026-08', text: 'uusi 2026-08' }]);
  });
});

test('pipeline: calendar step is best effort and merges into the content file', async () => {
  await withTempDir(async (dir) => {
    const calendarFile = path.join(dir, 'julkaisukalenteri.json');
    await writeFile(calendarFile, '[]\n');
    const entry = { date: '2026-10-14', time: '08:00', source: 'khi', period: '2026-09', label: 'Kuluttajahintaindeksi, syyskuu 2026', publisher: 'Tilastokeskus', url: 'https://stat.fi/fi/tilasto/khi' };
    const r = await run({
      ...quiet, calendar: true, dataDir: dir, calendarFile, today: new Date('2026-09-24T10:00:00Z'), sources: [],
      fetchCalendarImpl: async () => ({ entries: [entry], errors: ['Eurostat: HTTP 503'] }),
    });
    assert.equal(r.exitCode, 0, 'calendar problems are warnings');
    assert.deepEqual(r.warnings, ['kalenteri: Eurostat: HTTP 503']);
    assert.deepEqual(JSON.parse(await readFile(calendarFile, 'utf8')), [entry]);
    const r2 = await run({ ...quiet, calendar: true, dataDir: dir, calendarFile, today: new Date('2026-09-24T10:00:00Z'), sources: [], fetchCalendarImpl: async () => { throw new Error('boom'); } });
    assert.equal(r2.exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(calendarFile, 'utf8')), [entry], 'kept on failure');
  });
});
