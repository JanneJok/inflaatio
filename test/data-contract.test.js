/**
 * Data contract (SPEC §7, docs/DATA.md) checked against the committed
 * data/*.json and src/content/*.json files: period format and contiguity,
 * aligned arrays, null for missing values (never 0), rounding, required keys
 * and cross-file consistency (meta.latest, slugs). Structural only — value
 * ranges and freshness are validated by the fetchers (scripts/fetch/validate.js).
 * Skipped when data/ has not been fetched yet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAVE_DATA = fs.existsSync(path.join(ROOT, 'data', 'meta.json'));
const load = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
let errors = [];
const ok = (cond, msg) => {
  if (!cond) errors.push(msg);
};
/** Run one group of checks as a test; every failed check is listed. */
const contract = (name, fn) =>
  test(`data contract: ${name}`, { skip: !HAVE_DATA && 'data/ not fetched (npm run fetch)' }, () => {
    errors = [];
    fn();
    assert.deepEqual(errors, []);
  });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;
const QUARTER = /^\d{4}-Q[1-4]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function decimals(v) {
  if (!Number.isFinite(v)) return 0;
  const s = String(v);
  if (s.includes('e')) return 99;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function nextPeriod(p) {
  if (MONTH.test(p)) {
    let [y, m] = p.split('-').map(Number);
    m++;
    if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  if (QUARTER.test(p)) {
    let y = Number(p.slice(0, 4));
    let q = Number(p.slice(6));
    q++;
    if (q > 4) { q = 1; y++; }
    return `${y}-Q${q}`;
  }
  if (YEAR.test(p)) return String(Number(p) + 1);
  return null;
}

/** Periods: well-formed, ascending, contiguous. */
function periods(file, name, arr, re) {
  ok(Array.isArray(arr) && arr.length > 0, `${file}: ${name} must be a non-empty array`);
  if (!Array.isArray(arr)) return;
  const bad = arr.filter((p) => typeof p !== 'string' || !re.test(p));
  ok(bad.length === 0, `${file}: ${name} has malformed periods ${JSON.stringify(bad.slice(0, 3))}`);
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] !== nextPeriod(arr[i - 1])) {
      ok(false, `${file}: ${name} not contiguous/ascending at ${arr[i - 1]} → ${arr[i]}`);
      return;
    }
  }
}

/** Values aligned with periods; finite numbers or null; decimals ≤ max; no zero-as-missing (optional). */
function series(file, name, arr, len, maxDec, { min = -Infinity, max = Infinity, allowNullOnly = false } = {}) {
  ok(Array.isArray(arr), `${file}: ${name} must be an array`);
  if (!Array.isArray(arr)) return;
  ok(arr.length === len, `${file}: ${name} length ${arr.length} ≠ periods ${len}`);
  const bad = arr.filter((v) => !(v === null || (typeof v === 'number' && Number.isFinite(v))));
  ok(bad.length === 0, `${file}: ${name} has non-number/non-null values ${JSON.stringify(bad.slice(0, 3))}`);
  const tooPrecise = arr.filter((v) => typeof v === 'number' && decimals(v) > maxDec);
  ok(tooPrecise.length === 0, `${file}: ${name} has values with > ${maxDec} decimals, e.g. ${tooPrecise.slice(0, 3)}`);
  const out = arr.filter((v) => typeof v === 'number' && (v < min || v > max));
  ok(out.length === 0, `${file}: ${name} values outside ${min}…${max}: ${out.slice(0, 3)}`);
  if (!allowNullOnly) ok(arr.some((v) => v !== null), `${file}: ${name} is all null`);
}

/** The newest non-null index of an array. */
const lastIdx = (arr) => {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return i;
  return -1;
};

contract('meta', () => {
  const f = 'data/meta.json';
  const d = load(f);
  ok(typeof d.generatedAt === 'string' && !Number.isNaN(Date.parse(d.generatedAt)), `${f}: generatedAt must be an ISO timestamp`);
  const required = ['khi', 'khiAnnual', 'elinkustannusindeksi', 'ykhi', 'ykhiAnnual', 'hyodykkeet', 'polttoaineet', 'ansiot', 'korot'];
  for (const k of required) {
    const s = d.sources?.[k];
    ok(isObj(s), `${f}: sources.${k} missing`);
    if (!isObj(s)) continue;
    for (const p of ['name', 'publisher', 'url', 'license', 'updated', 'latest']) ok(typeof s[p] === 'string' && s[p].length > 0, `${f}: sources.${k}.${p} missing`);
    ok(typeof s.table === 'string' || typeof s.dataset === 'string', `${f}: sources.${k} needs table or dataset`);
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s.updated), `${f}: sources.${k}.updated is not strict ISO 8601 (${s.updated})`);
    ok(/^\d{4}(-\d{2}|-Q[1-4])?$/.test(s.latest), `${f}: sources.${k}.latest malformed (${s.latest})`);
    ok(/^https:\/\//.test(s.url), `${f}: sources.${k}.url must be https`);
  }
});

const meta = HAVE_DATA ? load('data/meta.json') : null;

contract('khi', () => {
  const f = 'data/khi.json';
  const d = load(f);
  periods(f, 'months', d.months, MONTH);
  const n = d.months.length;
  series(f, 'yoy', d.yoy, n, 1, { min: -5, max: 30 });
  series(f, 'mom', d.mom, n, 1, { min: -5, max: 10 });
  ok(isObj(d.index), `${f}: index must be an object`);
  for (const [base, arr] of Object.entries(d.index ?? {})) {
    ok(/^\d{4}=100$/.test(base), `${f}: index key "${base}" must be '<year>=100'`);
    series(f, `index['${base}']`, arr, n, 2, { min: 0.01 });
  }
  for (const base of ['2025=100', '2015=100', '2010=100', '2005=100', '2000=100', '1995=100']) ok(Array.isArray(d.index?.[base]), `${f}: index['${base}'] missing`);
  const li = lastIdx(d.yoy);
  ok(d.months[li] === meta.sources.khi.latest, `${f}: latest yoy month ${d.months[li]} ≠ meta.latest ${meta.sources.khi.latest}`);
  ok(lastIdx(d.index['2025=100']) === li, `${f}: latest 2025=100 month ≠ latest yoy month`);
  ok(lastIdx(d.mom) === li, `${f}: latest mom month ≠ latest yoy month`);
  // yoy vs index consistency for the last 24 months (2025=100 or 2015=100)
  const idx = d.index['2015=100'];
  let worst = 0;
  for (let i = li - 24; i <= li; i++) {
    if (idx[i] == null || idx[i - 12] == null || d.yoy[i] == null) continue;
    worst = Math.max(worst, Math.abs((idx[i] / idx[i - 12] - 1) * 100 - d.yoy[i]));
  }
  ok(worst <= 0.15, `${f}: yoy vs 2015=100 index differ by ${worst.toFixed(3)} %-yks.`);
  const zeros = d.index['2025=100'].filter((v) => v === 0).length;
  ok(zeros === 0, `${f}: zero index values (zero-as-missing)`);
});

contract('khi-annual', () => {
  const f = 'data/khi-annual.json';
  const d = load(f);
  periods(f, 'years', d.years, YEAR);
  const n = d.years.length;
  series(f, 'yoy', d.yoy, n, 1, { min: -5, max: 30 });
  for (const [base, arr] of Object.entries(d.index ?? {})) {
    ok(/^\d{4}=100$/.test(base), `${f}: index key "${base}"`);
    series(f, `index['${base}']`, arr, n, 2, { min: 0.01 });
  }
  const khiLatestYear = Number(meta.sources.khi.latest.slice(0, 4));
  ok(Number(d.years.at(-1)) < khiLatestYear || meta.sources.khi.latest.endsWith('-12'), `${f}: contains the current partial year ${d.years.at(-1)}`);
  ok(d.years.at(-1) === meta.sources.khiAnnual.latest, `${f}: last year ≠ meta.latest`);
});

contract('elinkustannusindeksi', () => {
  const f = 'data/elinkustannusindeksi.json';
  const d = load(f);
  ok(d.monthly?.base === '1951:10=100', `${f}: monthly.base must be '1951:10=100'`);
  periods(f, 'monthly.months', d.monthly?.months, MONTH);
  series(f, 'monthly.values', d.monthly?.values, d.monthly?.months?.length, 2, { min: 1 });
  ok(d.monthly.months.at(-1) === meta.sources.elinkustannusindeksi.latest, `${f}: latest month ≠ meta.latest`);
  if (d.annual) {
    ok(typeof d.annual.base === 'string', `${f}: annual.base`);
    periods(f, 'annual.years', d.annual.years, YEAR);
    series(f, 'annual.values', d.annual.values, d.annual.years.length, 2, { min: 1 });
  }
  for (const k of ['monthly1939', 'annual1914']) {
    if (!d[k]) continue;
    const per = d[k].months ?? d[k].years;
    periods(f, `${k} periods`, per, d[k].months ? MONTH : YEAR);
    series(f, `${k}.values`, d[k].values, per.length, 2, { min: 1 });
  }
});

contract('ykhi', () => {
  const f = 'data/ykhi.json';
  const d = load(f);
  periods(f, 'months', d.months, MONTH);
  ok(d.months[0] === '1996-01', `${f}: months must start 1996-01 (starts ${d.months[0]})`);
  const n = d.months.length;
  for (const g of ['FI', 'EA', 'SE', 'DK', 'NO', 'DE', 'EE']) {
    const geo = d.geo?.[g];
    ok(isObj(geo), `${f}: geo.${g} missing`);
    if (!geo) continue;
    series(f, `geo.${g}.yoy`, geo.yoy, n, 1, { min: -5, max: 30 });
    ok(typeof d.labels?.[g] === 'string', `${f}: labels.${g} missing`);
  }
  for (const g of ['FI', 'EA']) {
    const geo = d.geo[g];
    ok(isObj(geo.index) && Array.isArray(geo.index['2015=100']), `${f}: geo.${g}.index['2015=100'] missing`);
    for (const [base, arr] of Object.entries(geo.index ?? {})) {
      ok(/^\d{4}=100$/.test(base), `${f}: geo.${g}.index key ${base}`);
      series(f, `geo.${g}.index['${base}']`, arr, n, 2, { min: 0.01 });
    }
    series(f, `geo.${g}.coreYoy`, geo.coreYoy, n, 1, { min: -5, max: 30 });
    if (geo.mom) series(f, `geo.${g}.mom`, geo.mom, n, 1, { min: -5, max: 10 });
    // A month with a rate but no index must be flagged provisional.
    const li = lastIdx(geo.yoy);
    const idx = geo.index['2015=100'];
    if (idx[li] == null) ok(d.flags?.[g]?.[d.months[li]] === 'p', `${f}: ${g} ${d.months[li]} has yoy but no index and is not flagged 'p'`);
  }
  ok(d.labels?.FI === 'Suomi' && d.labels?.EA === 'Euroalue', `${f}: labels FI/EA`);
  ok(isObj(d.flags), `${f}: flags must be an object`);
  for (const [g, m] of Object.entries(d.flags ?? {})) {
    for (const [ym, v] of Object.entries(m)) {
      ok(MONTH.test(ym) && typeof v === 'string', `${f}: flags.${g}.${ym}`);
    }
  }
  ok(d.months[lastIdx(d.geo.FI.yoy)] === meta.sources.ykhi.latest, `${f}: latest FI month ≠ meta.latest`);
  const zeros = d.geo.FI.index['2015=100'].filter((v) => v === 0).length;
  ok(zeros === 0, `${f}: FI index has zeros (old site bug)`);
});

contract('ykhi-annual', () => {
  const f = 'data/ykhi-annual.json';
  const d = load(f);
  periods(f, 'years', d.years, YEAR);
  for (const g of ['FI', 'EA', 'SE', 'DK', 'NO', 'DE', 'EE']) series(f, `geo.${g}`, d.geo?.[g], d.years.length, 1, { min: -5, max: 30 });
  ok(d.years.at(-1) === meta.sources.ykhiAnnual.latest, `${f}: last year ≠ meta.latest`);
});

contract('hyodykkeet', () => {
  const f = 'data/hyodykkeet.json';
  const d = load(f);
  ok(MONTH.test(d.latest) && d.latest === meta.sources.hyodykkeet.latest, `${f}: latest`);
  ok(d.base === '2025=100', `${f}: base must be '2025=100'`);
  ok(Array.isArray(d.items) && d.items.length > 50, `${f}: items`);
  const codes = new Set(d.items.map((i) => i.code));
  ok(codes.size === d.items.length, `${f}: duplicate item codes`);
  for (const it of d.items) {
    const where = `${f}: item ${it.code}`;
    ok(typeof it.code === 'string' && typeof it.name === 'string' && it.name.length > 0, `${where}: code/name`);
    ok(Number.isInteger(it.level) && it.level >= 0 && it.level <= 6, `${where}: level`);
    ok(it.level === 0 ? it.parent === null : codes.has(it.parent), `${where}: parent ${it.parent}`);
    ok(it.weight === null || (typeof it.weight === 'number' && it.weight >= 0), `${where}: weight`);
    for (const k of ['yoy', 'mom']) ok(it[k] === null || (Number.isFinite(it[k]) && decimals(it[k]) <= 1), `${where}: ${k} ${it[k]}`);
    ok(it.contribution === null || Number.isFinite(it.contribution), `${where}: contribution`);
    if (it.slug != null) ok(/^[a-z0-9-]+$/.test(it.slug), `${where}: slug ${it.slug}`);
  }
  const main = d.items.filter((i) => i.level === 1);
  ok(main.length >= 12 && main.length <= 13, `${f}: ${main.length} main groups (expected 12–13)`);
  const wsum = main.reduce((s, i) => s + (i.weight ?? 0), 0);
  ok(Math.abs(wsum - 1000) < 0.5, `${f}: main-group weights sum ${wsum}`);
  const csum = main.reduce((s, i) => s + (i.contribution ?? 0), 0);
  const total = d.items.find((i) => i.level === 0);
  ok(Math.abs(csum - total.yoy) <= 0.3, `${f}: contributions sum ${csum.toFixed(3)} vs total ${total.yoy}`);
  periods(f, 'groups.months', d.groups?.months, MONTH);
  ok(d.groups.months.length === 60, `${f}: groups.months should be the last 60 (${d.groups.months.length})`);
  ok(d.groups.months.at(-1) === d.latest, `${f}: groups.months ends at latest`);
  for (const [code, s] of Object.entries(d.groups.series ?? {})) {
    series(f, `groups.series.${code}.yoy`, s.yoy, 60, 1);
    series(f, `groups.series.${code}.contribution`, s.contribution, 60, 3);
  }
  const nseries = Object.keys(d.groups.series ?? {}).length;
  ok(nseries >= 12 && nseries <= 14, `${f}: groups.series has ${nseries} entries`);
});

contract('hyodykesarjat', () => {
  const f = 'data/hyodykesarjat.json';
  const d = load(f);
  const list = load('scripts/fetch/hyodykesivut.json');
  ok(isObj(d.items), `${f}: items must be an object`);
  const slugs = Object.keys(d.items ?? {});
  ok(slugs.length >= 50, `${f}: only ${slugs.length} items`);
  for (const row of list) ok(slugs.includes(row.slug), `${f}: missing slug ${row.slug} from hyodykesivut.json`);
  for (const [slug, it] of Object.entries(d.items ?? {})) {
    const where = `${f}: ${slug}`;
    ok(/^[a-z0-9-]+$/.test(slug), `${where}: slug format`);
    for (const k of ['code', 'name', 'category']) ok(typeof it[k] === 'string' && it[k], `${where}: ${k}`);
    periods(f, `${slug}.months`, it.months, MONTH);
    series(f, `${slug}.yoy`, it.yoy, it.months.length, 1, { min: -90, max: 500, allowNullOnly: true });
    series(f, `${slug}.index`, it.index, it.months.length, 2, { min: 0.01 });
    ok(it.months.at(-1) === d.latest, `${where}: last month ${it.months.at(-1)} ≠ latest ${d.latest}`);
  }
  const hy = load('data/hyodykkeet.json');
  const linked = hy.items.filter((i) => i.slug).map((i) => i.slug);
  for (const s of linked) ok(slugs.includes(s), `hyodykkeet.json slug ${s} has no series in ${f}`);
});

contract('polttoaineet', () => {
  const f = 'data/polttoaineet.json';
  const d = load(f);
  periods(f, 'months', d.months, MONTH);
  ok(d.unit === '€/l', `${f}: unit`);
  for (const [k, arr] of Object.entries(d.series ?? {})) {
    ok(/^[a-z0-9]+$/.test(k), `${f}: series key ${k} must be lower-case ascii`);
    series(f, `series.${k}`, arr, d.months.length, 3, { min: 0.2, max: 6 });
    ok(typeof d.labels?.[k] === 'string', `${f}: labels.${k}`);
  }
  for (const k of ['bensiini95', 'diesel']) ok(Array.isArray(d.series?.[k]), `${f}: series.${k} missing`);
  ok(d.months.at(-1) === meta.sources.polttoaineet.latest, `${f}: latest ≠ meta`);
});

contract('ansiot', () => {
  const f = 'data/ansiot.json';
  const d = load(f);
  ok(['Q', 'M', 'A'].includes(d.freq), `${f}: freq`);
  periods(f, 'periods', d.periods, d.freq === 'Q' ? QUARTER : d.freq === 'M' ? MONTH : YEAR);
  series(f, 'nominalYoy', d.nominalYoy, d.periods.length, 1, { min: -10, max: 25 });
  series(f, 'realYoy', d.realYoy, d.periods.length, 1, { min: -10, max: 25 });
  ok(d.periods.at(-1) === meta.sources.ansiot.latest, `${f}: latest ≠ meta`);
});

contract('korot', () => {
  const f = 'data/korot.json';
  const d = load(f);
  periods(f, 'months', d.months, MONTH);
  series(f, 'depositRate', d.depositRate, d.months.length, 2, { min: -2, max: 15 });
  series(f, 'euribor12', d.euribor12, d.months.length, 3, { min: -2, max: 15 });
  ok(Array.isArray(d.decisions) && d.decisions.length > 0, `${f}: decisions`);
  for (let i = 0; i < d.decisions.length; i++) {
    const x = d.decisions[i];
    ok(DATE.test(x.date) && Number.isFinite(x.depositRate), `${f}: decisions[${i}]`);
    if (i) ok(x.date > d.decisions[i - 1].date, `${f}: decisions not ascending at ${x.date}`);
  }
});

contract('muutosloki', () => {
  const f = 'data/muutosloki.json';
  const d = load(f);
  ok(Array.isArray(d), `${f}: must be an array`);
  for (let i = 0; i < d.length; i++) {
    const e = d[i];
    ok(DATE.test(e.date) && typeof e.source === 'string' && typeof e.period === 'string' && typeof e.text === 'string' && e.text.length > 10, `${f}: entry ${i}`);
    if (i) ok(e.date <= d[i - 1].date, `${f}: not newest first at ${i}`);
    ok(!/\d\.\d/.test(e.text.replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, '')), `${f}: entry ${i} uses a decimal point instead of comma: ${e.text}`);
  }
});

contract('julkaisukalenteri', () => {
  const f = 'src/content/julkaisukalenteri.json';
  const d = load(f);
  ok(Array.isArray(d), `${f}: must be an array`);
  for (let i = 0; i < d.length; i++) {
    const e = d[i];
    ok(DATE.test(e.date), `${f}: [${i}].date`);
    ok(['khi', 'ykhi-ennakko', 'ykhi'].includes(e.source), `${f}: [${i}].source ${e.source}`);
    ok(MONTH.test(e.period), `${f}: [${i}].period`);
    ok(typeof e.label === 'string' && e.label, `${f}: [${i}].label`);
    if (i) ok(e.date >= d[i - 1].date, `${f}: not sorted at ${i}`);
  }
});
