/**
 * data/ykhi-annual.json — official annual HICP rates (annual average rate of
 * change, RCH_A_AVG) from Eurostat prc_hicp_ainr, complete years only.
 *   { years, geo: { FI: [], EA: [], SE: [], DK: [], NO: [], DE: [], EE: [], EU: [] }, labels }
 */
import { resolveDataset, fetchDataset, findDim, pickCode } from '../eurostat.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { yearsBetween, align, r1, latestPeriod } from '../util.js';
import { GEOS, LABELS } from './ykhi.js';

export const DATASETS = ['prc_hicp_ainr'];
export const TITLE = /^Harmonised index of consumer prices \(HICP\).*indices and rates of change, annual data/i;

async function fetchYkhiAnnual({ log }) {
  const { code: dataset, probe, replaced } = await resolveDataset(DATASETS, { titlePattern: TITLE, probeParams: { geo: 'FI' } });
  if (replaced) log?.(`warning: Eurostat dataset replaced → ${dataset}`);
  const coicop = findDim(probe, /^coicop/i);
  const unit = findDim(probe, /^unit$/i);
  const geo = findDim(probe, /^geo$/i);
  const time = findDim(probe, /^time$/i);
  const total = pickCode(probe, coicop, { codes: ['TOTAL', 'CP00'], label: /^(total|all-items hicp)$/i });
  const avg = pickCode(probe, unit, { codes: ['RCH_A_AVG'], label: /^annual average rate of change$/i });

  const geoProbe = await fetchDataset(dataset, { [coicop]: total, [unit]: avg, lastTimePeriod: 1 });
  const geoCode = Object.fromEntries(Object.entries(GEOS).map(([k, spec]) => [k, pickCode(geoProbe, geo, spec)]));
  const ds = await fetchDataset(dataset, { [geo]: Object.values(geoCode), [coicop]: total, [unit]: avg });

  const series = Object.fromEntries(Object.entries(geoCode).map(([k, g]) => [k, seriesOf(ds, time, { [geo]: g, [coicop]: total, [unit]: avg })]));
  const all = Object.values(series).flatMap((s) => s.times.filter((t, i) => s.values[i] !== null)).sort();
  const years = yearsBetween(all[0], all.at(-1));
  const geoOut = Object.fromEntries(Object.entries(series).map(([k, s]) => [k, align(years, s.times, s.values, r1)]));
  return {
    data: { years, geo: geoOut, labels: { ...LABELS } },
    meta: {
      dataset,
      url: `https://ec.europa.eu/eurostat/databrowser/view/${dataset}/default/table?lang=en`,
      updated: ds.updated ?? null,
      latest: latestPeriod(years, geoOut.FI),
    },
  };
}

function validateYkhiAnnual(data, prev) {
  return check('ykhi-annual', (c) => {
    const n = data.years?.length ?? 0;
    c.periods('ykhi-annual.years', data.years, 'A');
    for (const key of Object.keys(GEOS)) c.values(`ykhi-annual.geo.${key}`, data.geo?.[key], n, { min: -5, max: 30 });
    const latest = latestPeriod(data.years ?? [], data.geo?.FI ?? []);
    if (prev?.years) c.notOlder('ykhi-annual', latest, latestPeriod(prev.years, prev.geo?.FI ?? []));
  });
}

export default {
  key: 'ykhiAnnual',
  file: 'ykhi-annual.json',
  name: 'Yhdenmukaistettu kuluttajahintaindeksi, vuositiedot',
  publisher: 'Eurostat',
  license: 'Eurostat reuse policy (CC BY 4.0)',
  fetch: fetchYkhiAnnual,
  validate: validateYkhiAnnual,
  latest: (d) => latestPeriod(d.years, d.geo.FI),
};
