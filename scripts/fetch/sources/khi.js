/**
 * data/khi.json — Tilastokeskus kuluttajahintaindeksi (KHI), monthly.
 *
 *   yoy   official annual change, table 122p (1980-01 →)
 *   mom   official monthly change of the total index, table 15b5 (km, 2025=100);
 *         for months before 15b5 starts it is computed from the 1972=100
 *         index and rounded to 1 decimal (`momOfficialFrom` tells where the
 *         official series starts)
 *   index every official base published in table 11xs ('1972=100' … '2025=100');
 *         '2025=100' before 2025-01 comes from 15b5 (official, chained by
 *         Tilastokeskus). No base is back-calculated by us.
 */
import { resolveTable, getMetadata, findVariable, findValues, findValue, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { monthsBetween, align, r1, r2, latestPeriod, isNum } from '../util.js';
import { genitive, inessive, pct } from '../../../src/js/lib/format.js';

const DB = 'khi';
const BASE_RE = /(\d{4})\s*=\s*100/;

export const TABLES = {
  index: { id: '11xs', title: /kokonaisindeksit, kuukausitiedot/i },
  yoy: { id: '122p', title: /vuosimuutos, kuukausitiedot/i },
  detail: { id: '15b5', title: /^15b5|Kuluttajahintaindeksi \(2025=100\), kuukausitiedot/i },
};

/** Fetch the three tables and build the file. */
async function fetchKhi({ log }) {
  const [tIndex, tYoy, tDetail] = await Promise.all([
    resolveTable(DB, TABLES.index),
    resolveTable(DB, TABLES.yoy),
    resolveTable(DB, TABLES.detail),
  ]);
  for (const t of [tIndex, tYoy, tDetail]) if (t.renamed) log?.(`warning: ${t.url} was found by title (id changed)`);

  const [mIndex, mYoy, mDetail] = await Promise.all([getMetadata(tIndex.url), getMetadata(tYoy.url), getMetadata(tDetail.url)]);

  // 11xs: every "Pisteluku, YYYY=100" content.
  const timeI = findVariable(mIndex, { time: true });
  const contI = findVariable(mIndex, { code: /content|tiedot/i });
  const bases = findValues(contI, { text: /pisteluku.*\d{4}\s*=\s*100/i }).map((v) => ({ ...v, base: `${v.text.match(BASE_RE)[1]}=100` }));
  // 122p: annual change.
  const timeY = findVariable(mYoy, { time: true });
  const contY = findVariable(mYoy, { code: /content|tiedot/i });
  const yoyVal = findValue(contY, { text: /vuosimuutos/i });
  // 15b5: total index (2025=100) and official monthly change.
  const timeD = findVariable(mDetail, { time: true });
  const itemD = findVariable(mDetail, { text: /hyödyke/i });
  const contD = findVariable(mDetail, { code: /content|tiedot/i });
  const total = findValue(itemD, { code: /^(SSS|0)$/ });
  const ipD = findValue(contD, { text: /^indeksipisteluku.*KHI/i });
  const kmD = findValue(contD, { text: /^kuukausimuutos.*KHI/i });

  const [dsI, dsY, dsD] = await Promise.all([
    query(tIndex.url, { [timeI.code]: timeI.values, [contI.code]: bases.map((b) => b.code) }, { timeVar: timeI.code, label: 'PxWeb 11xs' }),
    query(tYoy.url, { [timeY.code]: timeY.values, [contY.code]: [yoyVal.code] }, { timeVar: timeY.code, label: 'PxWeb 122p' }),
    query(tDetail.url, { [timeD.code]: timeD.values, [itemD.code]: [total.code], [contD.code]: [ipD.code, kmD.code] }, { timeVar: timeD.code, label: 'PxWeb 15b5' }),
  ]);

  const yoyS = seriesOf(dsY, timeY.code, { [contY.code]: yoyVal.code }, pxTime);
  const ipS = seriesOf(dsD, timeD.code, { [itemD.code]: total.code, [contD.code]: ipD.code }, pxTime);
  const kmS = seriesOf(dsD, timeD.code, { [itemD.code]: total.code, [contD.code]: kmD.code }, pxTime);
  const baseS = bases.map((b) => ({ ...b, s: seriesOf(dsI, timeI.code, { [contI.code]: b.code }, pxTime) }));

  const allPeriods = [...yoyS.times, ...ipS.times, ...baseS.flatMap((b) => b.s.times)].sort();
  const months = monthsBetween(allPeriods[0], allPeriods.at(-1));

  const byBase = new Map(baseS.map((b) => [b.base, align(months, b.s.times, b.s.values, r2)]));
  // 2025=100 before 2025-01 from 15b5 (official), and cross-check the overlap.
  const ip2025 = align(months, ipS.times, ipS.values, r2);
  const from11xs = byBase.get('2025=100');
  let diff = 0;
  byBase.set('2025=100', ip2025.map((v, i) => {
    const w = from11xs?.[i];
    if (isNum(v) && isNum(w) && Math.abs(v - w) > 0.011) diff++;
    return isNum(w) ? w : v;
  }));
  if (diff) log?.(`warning: 11xs 2025=100 and 15b5 total index differ in ${diff} month(s)`);
  // Newest base first ('2025=100', '2015=100', … '1972=100').
  const index = Object.fromEntries([...byBase.entries()].sort((a, b) => b[0].localeCompare(a[0])));

  const yoy = align(months, yoyS.times, yoyS.values, r1);
  const momOfficial = align(months, kmS.times, kmS.values, r1);
  const momOfficialFrom = months.find((m, i) => isNum(momOfficial[i])) ?? null;
  const long = index['1972=100'] ?? Object.values(index).at(-1);
  const mom = momOfficial.map((v, i) => {
    if (isNum(v)) return v;
    if (momOfficialFrom && months[i] >= momOfficialFrom) return null; // official gap: keep missing
    const a = long?.[i - 1];
    const b = long?.[i];
    return isNum(a) && isNum(b) && a > 0 ? r1((b / a - 1) * 100) : null;
  });

  const data = { months, yoy, mom, momOfficialFrom, index };
  const updated = [dsY.updated, dsI.updated, dsD.updated].filter(Boolean).sort().at(-1) ?? null;
  return {
    data,
    meta: {
      table: `${tYoy.id.replace('.px', '')} (vuosimuutos), ${tIndex.id.replace('.px', '')} (pisteluvut), ${tDetail.id.replace('.px', '')} (2025=100, kuukausimuutos)`,
      url: tableWebUrl(DB, tYoy.id),
      updated,
      latest: latestPeriod(months, yoy),
    },
  };
}

/** @param {any} data @param {any} prev */
function validateKhi(data, prev) {
  return check('khi', (c) => {
    const n = data.months?.length ?? 0;
    c.periods('khi.months', data.months, 'M');
    c.values('khi.yoy', data.yoy, n, { min: -5, max: 30 });
    c.values('khi.mom', data.mom, n, { min: -5, max: 10 });
    const bases = Object.keys(data.index ?? {});
    if (!bases.includes('2025=100') || !bases.includes('2015=100')) c.fail(`khi.index: bases 2025=100 and 2015=100 required, got ${bases.join(', ')}`);
    for (const b of bases) {
      if (!/^\d{4}=100$/.test(b)) c.fail(`khi.index: bad base key ${b}`);
      c.values(`khi.index['${b}']`, data.index[b], n, { positive: true, max: 100_000 });
    }
    c.noZeroAsMissing('khi.yoy', data.yoy, data.index?.['2025=100']);
    c.consistent("khi.yoy vs index['2025=100']", data.months, data.yoy, data.index?.['2025=100'], 0.15);
    const latest = latestPeriod(data.months ?? [], data.yoy ?? []);
    const latestIdx = latestPeriod(data.months ?? [], data.index?.['2025=100'] ?? []);
    if (latest && latestIdx && latest !== latestIdx) c.fail(`khi: latest yoy ${latest} but latest 2025=100 index ${latestIdx}`);
    if (prev?.months) c.notOlder('khi', latest, latestPeriod(prev.months, prev.yoy ?? []));
  });
}

/** Changelog entry when a new month appears. */
function eventsKhi(data, prev) {
  const latest = latestPeriod(data.months, data.yoy);
  const prevLatest = prev?.months ? latestPeriod(prev.months, prev.yoy ?? []) : null;
  if (!latest || latest === prevLatest) return [];
  return [{ source: 'khi', period: latest, text: khiText(data, latest) }];
}

/** "Tilastokeskus julkaisi elokuun 2026 kuluttajahintaindeksin: inflaatio 2,2 % (heinäkuussa 2,1 %)." */
export function khiText(data, period) {
  const i = data.months.indexOf(period);
  const v = data.yoy[i];
  const p = data.yoy[i - 1];
  const prevPart = isNum(p) ? ` (${inessive(data.months[i - 1], { year: false })} ${pct(p)})` : '';
  return `Tilastokeskus julkaisi ${genitive(period)} kuluttajahintaindeksin: inflaatio ${pct(v)}${prevPart}.`;
}

export default {
  key: 'khi',
  file: 'khi.json',
  name: 'Kuluttajahintaindeksi (KHI)',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  freshness: true,
  fetch: fetchKhi,
  validate: validateKhi,
  latest: (d) => latestPeriod(d.months, d.yoy),
  events: eventsKhi,
};
