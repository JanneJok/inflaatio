/**
 * data/elinkustannusindeksi.json — Tilastokeskus elinkustannusindeksi (EKI).
 *
 *   monthly      1951:10=100, table 11xl (1951-01 →) — the series most rent
 *                and other index clauses refer to
 *   annual       1951:10=100, table 11xm (annual averages)
 *   monthly1939  1938:8–1939:7=100, table 11xn (1939-01 →) — longer history
 *   annual1914   1914:1–6=100, table 11xy (1860 →) — for the value-of-money
 *                calculator before 1939
 * Values are official point figures as published (no chaining by us).
 */
import { resolveTable, getMetadata, findVariable, findValues, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { monthsBetween, yearsBetween, align, r2, dataSpan, latestPeriod } from '../util.js';

const DB = 'khi';
export const TABLES = {
  monthly: { id: '11xl', title: /Elinkustannusindeksi \(1951:10=100\), kuukausitiedot/i },
  annual: { id: '11xm', title: /Elinkustannusindeksi \(1951:10=100\), vuositiedot/i },
  monthly1939: { id: '11xn', title: /Elinkustannusindeksi \(1938:8-1939:7=100\), kuukausitiedot/i },
  annual1914: { id: '11xy', title: /Elinkustannusindeksi \(1914:1-6=100\), vuositiedot/i },
};

/** '… (1951:10=100), …' → '1951:10=100'; en dash for ranges in the display label. */
export function baseFromTitle(text) {
  const m = String(text).match(/\((\d{4}:[\d:\-–]+=100)\)/);
  return m ? m[1].replace(/-/g, '–') : null;
}

async function fetchOne(spec, kind) {
  const t = await resolveTable(DB, spec);
  const meta = await getMetadata(t.url);
  const time = findVariable(meta, { time: true });
  const cont = findVariable(meta, { code: /content|tiedot/i });
  const val = findValues(cont, { text: /pisteluku/i })[0];
  const ds = await query(t.url, { [time.code]: time.values, [cont.code]: [val.code] }, { timeVar: time.code, label: `PxWeb ${t.id}` });
  const s = seriesOf(ds, time.code, { [cont.code]: val.code }, pxTime);
  const span = dataSpan(s.times, [s.values]);
  if (!span) throw new Error(`${t.id}: no data`);
  const periods = kind === 'M' ? monthsBetween(span.start, span.end) : yearsBetween(span.start, span.end);
  return {
    table: t,
    updated: ds.updated,
    base: baseFromTitle(t.text) ?? baseFromTitle(meta.title) ?? '?',
    periods,
    values: align(periods, s.times, s.values, r2),
  };
}

async function fetchEki() {
  const [m, a, m39, a14] = await Promise.all([
    fetchOne(TABLES.monthly, 'M'),
    fetchOne(TABLES.annual, 'A'),
    fetchOne(TABLES.monthly1939, 'M'),
    fetchOne(TABLES.annual1914, 'A'),
  ]);
  const data = {
    monthly: { base: m.base, months: m.periods, values: m.values },
    annual: { base: a.base, years: a.periods, values: a.values },
    monthly1939: { base: m39.base, months: m39.periods, values: m39.values },
    annual1914: { base: a14.base, years: a14.periods, values: a14.values },
  };
  return {
    data,
    meta: {
      table: [m, a, m39, a14].map((x) => x.table.id.replace('.px', '')).join(', '),
      url: tableWebUrl(DB, m.table.id),
      updated: [m, a, m39, a14].map((x) => x.updated).filter(Boolean).sort().at(-1) ?? null,
      latest: latestPeriod(m.periods, m.values),
    },
  };
}

function validateEki(data, prev) {
  return check('elinkustannusindeksi', (c) => {
    for (const [k, kind, key] of [['monthly', 'M', 'months'], ['annual', 'A', 'years'], ['monthly1939', 'M', 'months'], ['annual1914', 'A', 'years']]) {
      const s = data[k];
      if (!s) {
        c.fail(`elinkustannusindeksi.${k} missing`);
        continue;
      }
      if (typeof s.base !== 'string' || !/=100$/.test(s.base)) c.fail(`elinkustannusindeksi.${k}.base invalid: ${s.base}`);
      c.periods(`elinkustannusindeksi.${k}.${key}`, s[key], kind);
      c.values(`elinkustannusindeksi.${k}.values`, s.values, s[key]?.length ?? 0, { positive: true, max: 1e7 });
    }
    if (data.monthly?.base !== '1951:10=100') c.fail(`elinkustannusindeksi.monthly.base is ${data.monthly?.base}, expected 1951:10=100`);
    if (prev?.monthly) {
      c.notOlder('elinkustannusindeksi.monthly', latestPeriod(data.monthly.months, data.monthly.values), latestPeriod(prev.monthly.months, prev.monthly.values));
    }
  });
}

export default {
  key: 'elinkustannusindeksi',
  file: 'elinkustannusindeksi.json',
  name: 'Elinkustannusindeksi',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchEki,
  validate: validateEki,
  latest: (d) => latestPeriod(d.monthly.months, d.monthly.values),
};
