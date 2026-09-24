/**
 * data/ykhi.json — Eurostat HICP (yhdenmukaistettu kuluttajahintaindeksi), monthly.
 *
 * Dataset prc_hicp_minr (ECOICOP ver.2, since 2026; replaced prc_hicp_manr/midx).
 *   geo.FI / geo.EA  yoy (RCH_A), mom (RCH_M), index '2025=100' (I25) and
 *                    '2015=100' (I15), coreYoy (TOT_X_NRG_FOOD, RCH_A)
 *   geo.SE/DK/NO/DE/EE/EU  yoy
 *   countries        last 25 months of yoy for the EU27 member states (ranking)
 *   flags            per geo: { 'YYYY-MM': 'p' } — Eurostat status flags ('e' is
 *                    stored as 'p' = ennakko), plus
 *                    'p' (flash estimate) for FI/EA months that have an annual
 *                    rate but no index yet (Eurostat publishes the flash rate
 *                    at the end of the month and the index ~2.5 weeks later)
 * EA = euro area with changing composition (Eurostat geo code EA).
 */
import { resolveDataset, fetchDataset, findDim, pickCode } from '../eurostat.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { monthsBetween, align, r1, r2, latestPeriod, isNum } from '../util.js';
import { genitive, pct } from '../../../src/js/lib/format.js';

export const DATASETS = ['prc_hicp_minr'];
export const TITLE = /^Harmonised index of consumer prices \(HICP\).*indices and rates of change, monthly data/i;

/** Contract geos → Eurostat code candidates / label fallback. */
export const GEOS = {
  FI: { codes: ['FI'], label: /^Finland$/i },
  EA: { codes: ['EA'], label: /^Euro area \((changing composition|EA11)/i },
  SE: { codes: ['SE'], label: /^Sweden$/i },
  DK: { codes: ['DK'], label: /^Denmark$/i },
  NO: { codes: ['NO'], label: /^Norway$/i },
  DE: { codes: ['DE'], label: /^Germany/i },
  EE: { codes: ['EE'], label: /^Estonia$/i },
  EU: { codes: ['EU27_2020'], label: /^European Union - 27 countries \(from 2020\)/i },
};

export const LABELS = { FI: 'Suomi', EA: 'Euroalue', SE: 'Ruotsi', DK: 'Tanska', NO: 'Norja', DE: 'Saksa', EE: 'Viro', EU: 'EU' };

/** EU27 member states (Eurostat codes) with Finnish names. */
export const EU27 = {
  AT: 'Itävalta', BE: 'Belgia', BG: 'Bulgaria', CY: 'Kypros', CZ: 'Tšekki', DE: 'Saksa', DK: 'Tanska',
  EE: 'Viro', EL: 'Kreikka', ES: 'Espanja', FI: 'Suomi', FR: 'Ranska', HR: 'Kroatia', HU: 'Unkari',
  IE: 'Irlanti', IT: 'Italia', LT: 'Liettua', LU: 'Luxemburg', LV: 'Latvia', MT: 'Malta', NL: 'Alankomaat',
  PL: 'Puola', PT: 'Portugali', RO: 'Romania', SE: 'Ruotsi', SI: 'Slovenia', SK: 'Slovakia',
};

const COUNTRY_MONTHS = 25;

async function fetchYkhi({ log }) {
  const { code: dataset, probe, replaced } = await resolveDataset(DATASETS, { titlePattern: TITLE, probeParams: { geo: 'FI' } });
  if (replaced) log?.(`warning: Eurostat dataset replaced → ${dataset}`);

  const coicop = findDim(probe, /^coicop/i);
  const unit = findDim(probe, /^unit$/i);
  const geo = findDim(probe, /^geo$/i);
  const time = findDim(probe, /^time$/i);
  const total = pickCode(probe, coicop, { codes: ['TOTAL', 'CP00'], label: /^(total|all-items hicp)$/i });
  const core = pickCode(probe, coicop, { codes: ['TOT_X_NRG_FOOD'], label: /excluding energy, food, alcohol and tobacco/i });
  const rchA = pickCode(probe, unit, { codes: ['RCH_A'], label: /^annual rate of change$/i });
  const rchM = pickCode(probe, unit, { codes: ['RCH_M'], label: /^monthly rate of change$/i });
  const i25 = pickCode(probe, unit, { codes: ['I25'], label: /^index,\s*2025\s*=\s*100$/i });
  const i15 = pickCode(probe, unit, { codes: ['I15'], label: /^index,\s*2015\s*=\s*100$/i, required: false });

  // Geo codes: probe all geos for one period.
  const geoProbe = await fetchDataset(dataset, { [coicop]: total, [unit]: rchA, lastTimePeriod: 1 });
  const geoCode = Object.fromEntries(Object.entries(GEOS).map(([k, spec]) => [k, pickCode(geoProbe, geo, spec)]));
  const euCodes = Object.keys(EU27).filter((c) => geoProbe.dims[geo].codes.includes(c));
  if (euCodes.length < 27) log?.(`warning: Eurostat geo list lacks ${Object.keys(EU27).filter((c) => !euCodes.includes(c)).join(', ')}`);

  const [main, rates] = await Promise.all([
    fetchDataset(dataset, { [geo]: [geoCode.FI, geoCode.EA], [coicop]: [total, core], [unit]: [rchA, rchM, i25, i15].filter(Boolean), sinceTimePeriod: '1996-01' }),
    fetchDataset(dataset, { [geo]: [...new Set([...Object.values(geoCode), ...euCodes])], [coicop]: total, [unit]: rchA, sinceTimePeriod: '1996-01' }),
  ]);

  const s = (ds, g, c, u) => seriesOf(ds, time, { [geo]: g, [coicop]: c, [unit]: u });
  const fiYoy = s(main, geoCode.FI, total, rchA);
  const lastWithData = [...main.dims[time].codes, ...rates.dims[time].codes].sort().at(-1);
  const months = monthsBetween('1996-01', lastWithData);

  const flags = {};
  const addFlags = (key, series, idxSeries) => {
    series.times.forEach((t, i) => {
      if (!isNum(series.values[i])) return;
      // 'p' = ennakko: Eurostat flags p (provisional) and e (estimated, used for
      // flash rates), or a FI/EA rate whose index is not published yet.
      let f = series.status[i];
      if (f === 'e') f = 'p';
      if (idxSeries && !isNum(idxSeries.values[idxSeries.times.indexOf(t)])) f = 'p';
      if (f) (flags[key] ??= {})[t] = f;
    });
  };

  const geoOut = {};
  for (const key of ['FI', 'EA']) {
    const g = geoCode[key];
    const yoyS = s(main, g, total, rchA);
    const i25S = s(main, g, total, i25);
    const index = { '2025=100': align(months, i25S.times, i25S.values, r2) };
    if (i15) {
      const i15S = s(main, g, total, i15);
      index['2015=100'] = align(months, i15S.times, i15S.values, r2);
    }
    const momS = s(main, g, total, rchM);
    const coreS = s(main, g, core, rchA);
    geoOut[key] = {
      yoy: align(months, yoyS.times, yoyS.values, r1),
      mom: align(months, momS.times, momS.values, r1),
      index,
      coreYoy: align(months, coreS.times, coreS.values, r1),
    };
    addFlags(key, yoyS, i25S);
  }
  for (const key of ['SE', 'DK', 'NO', 'DE', 'EE', 'EU']) {
    const yS = s(rates, geoCode[key], total, rchA);
    geoOut[key] = { yoy: align(months, yS.times, yS.values, r1) };
    addFlags(key, yS, null);
  }

  // EU27 ranking data: last COUNTRY_MONTHS months up to FI's latest month.
  const fiLatest = latestPeriod(fiYoy.times, fiYoy.values);
  const cMonths = months.slice(Math.max(0, months.indexOf(fiLatest) - COUNTRY_MONTHS + 1), months.indexOf(fiLatest) + 1);
  const countries = { months: cMonths, yoy: {}, labels: {}, flags: {} };
  for (const c of euCodes) {
    const yS = s(rates, c, total, rchA);
    countries.yoy[c] = align(cMonths, yS.times, yS.values, r1);
    countries.labels[c] = EU27[c];
    yS.times.forEach((t, i) => {
      if (cMonths.includes(t) && yS.status[i]) (countries.flags[c] ??= {})[t] = yS.status[i];
    });
  }
  if (!Object.keys(countries.flags).length) delete countries.flags;

  const data = {
    months,
    geo: geoOut,
    labels: { ...LABELS },
    flags,
    countries,
  };
  return {
    data,
    meta: {
      dataset,
      url: `https://ec.europa.eu/eurostat/databrowser/view/${dataset}/default/table?lang=en`,
      updated: main.updated ?? rates.updated ?? null,
      latest: fiLatest,
    },
  };
}

function validateYkhi(data, prev) {
  return check('ykhi', (c) => {
    const n = data.months?.length ?? 0;
    c.periods('ykhi.months', data.months, 'M');
    for (const key of Object.keys(GEOS)) {
      const g = data.geo?.[key];
      if (!g) {
        c.fail(`ykhi.geo.${key} missing`);
        continue;
      }
      c.values(`ykhi.geo.${key}.yoy`, g.yoy, n, { min: -5, max: 30 });
      if (key === 'FI' || key === 'EA') {
        c.values(`ykhi.geo.${key}.mom`, g.mom, n, { min: -5, max: 10 });
        c.values(`ykhi.geo.${key}.coreYoy`, g.coreYoy, n, { min: -5, max: 30 });
        for (const [b, arr] of Object.entries(g.index ?? {})) c.values(`ykhi.geo.${key}.index['${b}']`, arr, n, { positive: true, max: 10_000 });
        c.noZeroAsMissing(`ykhi.geo.${key}.yoy`, g.yoy, g.index?.['2025=100']);
        c.consistent(`ykhi.geo.${key}.yoy vs index`, data.months, g.yoy, g.index?.['2025=100'], 0.15);
      }
      if (!data.labels?.[key]) c.fail(`ykhi.labels.${key} missing`);
    }
    const cm = data.countries?.months ?? [];
    c.periods('ykhi.countries.months', cm, 'M');
    for (const [k, arr] of Object.entries(data.countries?.yoy ?? {})) c.values(`ykhi.countries.yoy.${k}`, arr, cm.length, { min: -10, max: 60, required: false });
    const latest = latestPeriod(data.months ?? [], data.geo?.FI?.yoy ?? []);
    if (prev?.months) c.notOlder('ykhi', latest, latestPeriod(prev.months, prev.geo?.FI?.yoy ?? []));
    // The latest FI index must not lag the rate by more than the flash month.
    const li = latestPeriod(data.months ?? [], data.geo?.FI?.index?.['2025=100'] ?? []);
    if (latest && li && latest > li && data.flags?.FI?.[latest] !== 'p') c.fail(`ykhi: FI rate ${latest} has no index but is not flagged provisional`);
  });
}

/** Flash ('ennakko') and final ('lopullinen') entries for the changelog. */
function eventsYkhi(data, prev) {
  const fi = data.geo.FI.yoy;
  const latest = latestPeriod(data.months, fi);
  if (!latest) return [];
  const prevLatest = prev?.months ? latestPeriod(prev.months, prev.geo?.FI?.yoy ?? []) : null;
  const flag = data.flags?.FI?.[latest] ?? null;
  const prevFlag = prev?.flags?.FI?.[latest] ?? null;
  const out = [];
  if (latest !== prevLatest) {
    out.push({ source: 'ykhi', period: latest, kind: flag === 'p' ? 'ennakko' : 'lopullinen', text: ykhiText(data, latest, flag === 'p' ? 'ennakko' : 'lopullinen') });
  } else if (prevFlag === 'p' && flag !== 'p') {
    const pi = prev.months.indexOf(latest);
    out.push({ source: 'ykhi', period: latest, kind: 'lopullinen', text: ykhiText(data, latest, 'lopullinen', prev.geo.FI.yoy[pi]) });
  }
  // A previous month finalised together with a new flash (both released on the same day).
  if (prevLatest && prevLatest !== latest && prev?.flags?.FI?.[prevLatest] === 'p' && data.flags?.FI?.[prevLatest] !== 'p') {
    const pi = prev.months.indexOf(prevLatest);
    out.push({ source: 'ykhi', period: prevLatest, kind: 'lopullinen', text: ykhiText(data, prevLatest, 'lopullinen', prev.geo.FI.yoy[pi]) });
  }
  return out;
}

/**
 * 'Eurostat julkaisi elokuun 2026 YKHI-ennakon: Suomi 2,4 %, euroalue 3,3 %.'
 * 'Eurostat julkaisi heinäkuun 2026 lopulliset YKHI-luvut: Suomi 2,5 % (ennakko 2,6 %), euroalue 2,9 %.'
 */
export function ykhiText(data, period, kind, flashValue = null) {
  const i = data.months.indexOf(period);
  const fi = data.geo.FI.yoy[i];
  const ea = data.geo.EA?.yoy?.[i];
  const eaPart = isNum(ea) ? `, euroalue ${pct(ea)}` : '';
  if (kind === 'ennakko') return `Eurostat julkaisi ${genitive(period)} YKHI-ennakon: Suomi ${pct(fi)}${eaPart}.`;
  const rev = isNum(flashValue) && flashValue !== fi ? ` (ennakko ${pct(flashValue)})` : '';
  return `Eurostat julkaisi ${genitive(period)} lopulliset YKHI-luvut: Suomi ${pct(fi)}${rev}${eaPart}.`;
}

export default {
  key: 'ykhi',
  file: 'ykhi.json',
  name: 'Yhdenmukaistettu kuluttajahintaindeksi (YKHI, HICP)',
  publisher: 'Eurostat',
  license: 'Eurostat reuse policy (CC BY 4.0)',
  freshness: true,
  fetch: fetchYkhi,
  validate: validateYkhi,
  latest: (d) => latestPeriod(d.months, d.geo.FI.yoy),
  events: eventsYkhi,
};
