/**
 * data/korot.json — ECB Data Portal.
 *   depositRate  deposit facility rate in force on the last day of each month
 *                (derived from the official change dates, FM.B.U2.EUR.4F.KR.DFR.LEV)
 *   euribor12    12-month Euribor, monthly average (FM.M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA)
 *   decisions    [{ date, depositRate }] — dates the rate took EFFECT (not the
 *                Governing Council decision dates); the first row (1999-01-01) is
 *                the initial level
 * Months run from 1999-01 to the last complete month (or the latest Euribor month).
 */
import { fetchSeries } from '../ecb.js';
import { check } from '../validate.js';
import { monthsBetween, align, r2, r3, latestPeriod, isNum } from '../util.js';
import { ymAdd, date as fiDate, pct, isoDate } from '../../../src/js/lib/format.js';

export const DEPOSIT_KEYS = ['FM/B.U2.EUR.4F.KR.DFR.LEV', 'FM/D.U2.EUR.4F.KR.DFR.LEV'];
export const EURIBOR_KEYS = ['FM/M.U2.EUR.RT.MM.EURIBOR1YD_.HSTA'];
const START = '1999-01';

/**
 * Rate in force at the end of each month from a list of (date, rate) changes.
 * @param {string[]} months
 * @param {{date: string, depositRate: number}[]} changes ascending
 */
export function monthEndRates(months, changes) {
  let j = -1;
  return months.map((m) => {
    const end = `${ymAdd(m, 1)}-01`; // first day of the next month (exclusive)
    while (j + 1 < changes.length && changes[j + 1].date < end) j++;
    return j >= 0 ? changes[j].depositRate : null;
  });
}

/** Collapse daily observations into change points (keeps B-series change dates as they are). */
export function changePoints(observations) {
  const out = [];
  for (const o of observations) {
    if (!out.length || out.at(-1).depositRate !== o.value) out.push({ date: o.period.slice(0, 10), depositRate: r3(o.value) });
  }
  return out;
}

async function fetchKorot({ today = new Date() } = {}) {
  const [dep, eur] = await Promise.all([fetchSeries(DEPOSIT_KEYS), fetchSeries(EURIBOR_KEYS, { startPeriod: START })]);
  const decisions = changePoints(dep.observations);
  const eurMonths = eur.observations.map((o) => o.period);
  const lastComplete = ymAdd(isoDate(today).slice(0, 7), -1);
  const end = [lastComplete, eurMonths.at(-1)].sort().at(-1);
  const months = monthsBetween(START, end);
  const euribor12 = align(months, eurMonths, eur.observations.map((o) => o.value), r3);
  const depositRate = monthEndRates(months, decisions).map((v) => (isNum(v) ? r2(v) : null));
  return {
    data: { months, depositRate, euribor12, decisions },
    meta: {
      dataset: `${dep.key.replace('/', '.')}, ${eur.key.replace('/', '.')}`,
      url: 'https://data.ecb.europa.eu/data/datasets/FM',
      updated: [dep.updated, eur.updated].filter(Boolean).sort().at(-1) ?? null,
      latest: latestPeriod(months, euribor12),
    },
  };
}

function validateKorot(data, prev) {
  return check('korot', (c) => {
    const n = data.months?.length ?? 0;
    c.periods('korot.months', data.months, 'M');
    c.values('korot.depositRate', data.depositRate, n, { min: -2, max: 15 });
    c.values('korot.euribor12', data.euribor12, n, { min: -2, max: 15 });
    const d = data.decisions ?? [];
    if (!d.length) c.fail('korot.decisions empty');
    d.forEach((x, i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) c.fail(`korot.decisions[${i}].date ${x.date}`);
      if (i && x.date <= d[i - 1].date) c.fail(`korot.decisions not ascending at ${x.date}`);
      if (!isNum(x.depositRate) || x.depositRate < -2 || x.depositRate > 15) c.fail(`korot.decisions[${i}].depositRate ${x.depositRate}`);
    });
    if (prev?.months) c.notOlder('korot', latestPeriod(data.months, data.euribor12), latestPeriod(prev.months, prev.euribor12 ?? []));
  });
}

/** "EKP:n talletuskorko 2,50 % 16.9.2026 alkaen (aiemmin 2,25 %)." */
function eventsKorot(data, prev) {
  if (!prev?.decisions) return [];
  const known = new Set(prev.decisions.map((x) => x.date));
  return data.decisions
    .map((x, i) => ({ x, before: data.decisions[i - 1] }))
    .filter(({ x }) => !known.has(x.date))
    .map(({ x, before }) => ({
      source: 'korot',
      period: x.date,
      text: `EKP:n talletuskorko ${pct(x.depositRate, { decimals: 2 })} ${fiDate(x.date)} alkaen${before ? ` (aiemmin ${pct(before.depositRate, { decimals: 2 })})` : ''}.`,
    }));
}

export default {
  key: 'korot',
  file: 'korot.json',
  name: 'EKP:n talletuskorko ja 12 kk euribor',
  publisher: 'Euroopan keskuspankki (EKP)',
  license: 'ECB statistics reuse policy (lähde mainittava)',
  fetch: fetchKorot,
  validate: validateKorot,
  latest: (d) => latestPeriod(d.months, d.euribor12),
  events: eventsKorot,
};
