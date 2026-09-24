/**
 * data/polttoaineet.json — Tilastokeskus average fuel prices, table 11xx
 * (monthly average consumer prices, €/l; not the pump price of a single day).
 *   { months, unit: '€/l', series: { bensiini95, bensiini98, diesel, polttooljy }, labels }
 * Only the per-litre series are kept (the table also has biogas in €/kg).
 */
import { resolveTable, getMetadata, findVariable, findValues, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { monthsBetween, align, r3, dataSpan, latestPeriod } from '../util.js';

const DB = 'khi';
export const TABLE = { id: '11xx', title: /Polttonesteiden keskihintoja, kuukausitiedot/i };

/** Output key → label pattern of the PxWeb value. */
export const SERIES = {
  bensiini95: /^bensiini\s*95/i,
  bensiini98: /^bensiini\s*98/i,
  diesel: /^diesel/i,
  polttooljy: /^kevyt polttoöljy/i,
};

async function fetchPolttoaineet({ log }) {
  const t = await resolveTable(DB, TABLE);
  const meta = await getMetadata(t.url);
  const time = findVariable(meta, { time: true });
  const item = findVariable(meta, { text: /hyödyke/i });
  const cont = findVariable(meta, { code: /content|tiedot/i });
  const price = findValues(cont, { text: /keskihinta/i })[0];

  const picks = {};
  for (const [key, re] of Object.entries(SERIES)) {
    const hits = findValues(item, { text: re, required: false }).filter((h) => /1\s*l\b/i.test(h.text));
    if (hits.length) picks[key] = hits[0];
    else log?.(`warning: 11xx has no series for ${key}`);
  }
  if (!picks.bensiini95 || !picks.diesel) throw new Error('11xx: petrol 95 or diesel series not found');

  const ds = await query(t.url, { [time.code]: time.values, [item.code]: Object.values(picks).map((p) => p.code), [cont.code]: [price.code] }, { timeVar: time.code, label: 'PxWeb 11xx' });
  const raw = Object.fromEntries(Object.entries(picks).map(([k, p]) => [k, seriesOf(ds, time.code, { [item.code]: p.code, [cont.code]: price.code }, pxTime)]));
  const span = dataSpan(raw.bensiini95.times, Object.values(raw).map((s) => s.values));
  const months = monthsBetween(span.start, span.end);
  const series = Object.fromEntries(Object.entries(raw).map(([k, s]) => [k, align(months, s.times, s.values, r3)]));
  const labels = Object.fromEntries(Object.entries(picks).map(([k, p]) => [k, p.text.replace(/,\s*1\s*l\s*$/i, '').trim()]));
  return {
    data: { months, unit: '€/l', series, labels },
    meta: { table: t.id.replace('.px', ''), url: tableWebUrl(DB, t.id), updated: ds.updated ?? null, latest: latestPeriod(months, series.bensiini95) },
  };
}

function validatePolttoaineet(data, prev) {
  return check('polttoaineet', (c) => {
    const n = data.months?.length ?? 0;
    c.periods('polttoaineet.months', data.months, 'M');
    if (data.unit !== '€/l') c.fail(`polttoaineet.unit is ${data.unit}`);
    for (const [k, arr] of Object.entries(data.series ?? {})) {
      if (!/^[a-z0-9]+$/.test(k)) c.fail(`polttoaineet: key ${k} is not lower-case ascii`);
      c.values(`polttoaineet.series.${k}`, arr, n, { positive: true, min: 0.2, max: 6 });
      if (!data.labels?.[k]) c.fail(`polttoaineet.labels.${k} missing`);
    }
    if (prev?.months) c.notOlder('polttoaineet', latestPeriod(data.months, data.series.bensiini95), latestPeriod(prev.months, prev.series?.bensiini95 ?? []));
  });
}

export default {
  key: 'polttoaineet',
  file: 'polttoaineet.json',
  name: 'Polttonesteiden keskihinnat',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchPolttoaineet,
  validate: validatePolttoaineet,
  latest: (d) => latestPeriod(d.months, d.series.bensiini95),
};
