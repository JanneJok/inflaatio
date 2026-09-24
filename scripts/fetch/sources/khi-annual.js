/**
 * data/khi-annual.json — official annual KHI figures (complete years only).
 *
 *   yoy   official annual change (average inflation of the year), table 122q (1980 →)
 *   index official annual average indices per base, table 11xt ('1972=100' … '2015=100')
 *
 * The current (partial) year is NOT here; pages compute it from khi.json and
 * label it with its month span (SPEC §6).
 */
import { resolveTable, getMetadata, findVariable, findValues, findValue, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { yearsBetween, align, r1, r2, latestPeriod } from '../util.js';

const DB = 'khi';
export const TABLES = {
  yoy: { id: '122q', title: /vuosimuutos, vuositiedot/i },
  index: { id: '11xt', title: /kokonaisindeksit, vuositiedot/i },
};

async function fetchAnnual() {
  const [tY, tI] = await Promise.all([resolveTable(DB, TABLES.yoy), resolveTable(DB, TABLES.index)]);
  const [mY, mI] = await Promise.all([getMetadata(tY.url), getMetadata(tI.url)]);

  const timeY = findVariable(mY, { time: true });
  const contY = findVariable(mY, { code: /content|tiedot/i });
  const yoyVal = findValue(contY, { text: /vuosimuutos/i });

  const timeI = findVariable(mI, { time: true });
  const seriesVar = findVariable(mI, { text: /indeksisarja/i });
  const contI = findVariable(mI, { code: /content|tiedot/i });
  const ipVal = findValue(contI, { text: /pisteluku/i });
  const bases = findValues(seriesVar, { text: /\d{4}\s*=\s*100/ }).map((v) => ({ ...v, base: `${v.text.match(/(\d{4})\s*=\s*100/)[1]}=100` }));

  const [dsY, dsI] = await Promise.all([
    query(tY.url, { [timeY.code]: timeY.values, [contY.code]: [yoyVal.code] }, { timeVar: timeY.code, label: 'PxWeb 122q' }),
    query(tI.url, { [timeI.code]: timeI.values, [seriesVar.code]: bases.map((b) => b.code), [contI.code]: [ipVal.code] }, { timeVar: timeI.code, label: 'PxWeb 11xt' }),
  ]);

  const yS = seriesOf(dsY, timeY.code, { [contY.code]: yoyVal.code }, pxTime);
  const bS = bases.map((b) => ({ ...b, s: seriesOf(dsI, timeI.code, { [seriesVar.code]: b.code, [contI.code]: ipVal.code }, pxTime) }));
  const all = [...yS.times, ...bS.flatMap((b) => b.s.times)].sort();
  const years = yearsBetween(all[0], all.at(-1));
  const index = Object.fromEntries(bS.sort((a, b) => b.base.localeCompare(a.base)).map((b) => [b.base, align(years, b.s.times, b.s.values, r2)]));
  const yoy = align(years, yS.times, yS.values, r1);

  return {
    data: { years, yoy, index },
    meta: {
      table: `${tY.id.replace('.px', '')} (vuosimuutos), ${tI.id.replace('.px', '')} (vuosikeskiarvot)`,
      url: tableWebUrl(DB, tY.id),
      updated: [dsY.updated, dsI.updated].filter(Boolean).sort().at(-1) ?? null,
      latest: latestPeriod(years, yoy),
    },
  };
}

function validateAnnual(data, prev) {
  return check('khi-annual', (c) => {
    const n = data.years?.length ?? 0;
    c.periods('khi-annual.years', data.years, 'A');
    c.values('khi-annual.yoy', data.yoy, n, { min: -5, max: 30 });
    for (const [b, arr] of Object.entries(data.index ?? {})) c.values(`khi-annual.index['${b}']`, arr, n, { positive: true, max: 100_000 });
    const latest = latestPeriod(data.years ?? [], data.yoy ?? []);
    if (prev?.years) c.notOlder('khi-annual', latest, latestPeriod(prev.years, prev.yoy ?? []));
  });
}

export default {
  key: 'khiAnnual',
  file: 'khi-annual.json',
  name: 'Kuluttajahintaindeksi, vuositiedot',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchAnnual,
  validate: validateAnnual,
  latest: (d) => latestPeriod(d.years, d.yoy),
};
