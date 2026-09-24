/**
 * Calculators: rent index increase, value of money, savings in real terms,
 * personal inflation and real wage change (SPEC §2).
 *
 * ISOMORPHIC and pure: no DOM and no Node APIs. The build renders every
 * default result with these functions and the page scripts
 * (src/js/pages/{vuokrankorotus,rahanarvo,oma-inflaatio,ostovoima}.js) run the
 * same functions in the browser, so server-rendered and JS-updated numbers and
 * texts are identical.
 *
 * Index data model: an official point-figure series from data/*.json,
 * compacted to
 *   { id, family, kind: 'month'|'year', base, decimals, start, values }
 * where `start` is the first period with a published value ('YYYY-MM' or
 * 'YYYY') and `values` are contiguous from `start` (null = not published).
 * A `family` groups the monthly and annual series of the same base (e.g.
 * KHI 1972=100 monthly from table 11xs and its annual averages from 11xt).
 * Only official published points are used: a ratio is always taken inside
 * one base; nothing is chained or back-calculated.
 *
 * Functions return unrounded numbers (format them with format.js or with
 * `formatter(lang)` below) and `null` / `{ error }` for invalid input.
 */
import * as fmt from './format.js';

const { isNum, round, parseYm, ymAdd, ymDiff, DASH, MINUS, NBSP } = fmt;

/* ================================================================ periods */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_RE = /^\d{4}$/;

/** @param {unknown} p @returns {boolean} true for 'YYYY-MM' */
export const isMonth = (p) => typeof p === 'string' && MONTH_RE.test(p);
/** @param {unknown} p @returns {boolean} true for 'YYYY' */
export const isYear = (p) => typeof p === 'string' && YEAR_RE.test(p);

/**
 * Kind of a period string.
 * @param {unknown} p
 * @returns {'month'|'year'|null}
 */
export function periodKind(p) {
  if (isMonth(p)) return 'month';
  if (isYear(p)) return 'year';
  return null;
}

/** Calendar year of a period as a number. @param {string} p */
export const periodYear = (p) => Number(String(p).slice(0, 4));

/**
 * Add n steps (months or years) to a period of the same kind.
 * @param {string} p 'YYYY-MM' or 'YYYY'
 * @param {number} n
 */
export function periodAdd(p, n) {
  return isMonth(p) ? ymAdd(p, n) : String(periodYear(p) + n);
}

/**
 * Steps from a to b (b − a) for two periods of the same kind, else null.
 * @param {string} a
 * @param {string} b
 * @returns {number|null}
 */
export function periodDiff(a, b) {
  if (isMonth(a) && isMonth(b)) return ymDiff(a, b);
  if (isYear(a) && isYear(b)) return periodYear(b) - periodYear(a);
  return null;
}

/**
 * Months between two periods of any kind, a year taken at its middle
 * (a year → its July). Used for annualising a value-of-money change.
 * @param {string} a
 * @param {string} b
 */
export function monthsBetween(a, b) {
  const mid = (p) => (isMonth(p) ? p : `${p}-07`);
  return ymDiff(mid(a), mid(b));
}

/* ================================================================= series */

/** Finnish and English names of the index families (base in parentheses). */
const FAMILY_NAMES = {
  'eki-1951': { fi: 'Elinkustannusindeksi (1951:10=100)', en: 'Cost-of-living index (1951:10=100)', short: { fi: 'Elinkustannusindeksi', en: 'Cost-of-living index' } },
  'eki-1939': { fi: 'Elinkustannusindeksi (1938:8–1939:7=100)', en: 'Cost-of-living index (1938:8–1939:7=100)', short: { fi: 'Elinkustannusindeksi', en: 'Cost-of-living index' } },
  'eki-1914': { fi: 'Elinkustannusindeksi (1914:1–6=100)', en: 'Cost-of-living index (1914:1–6=100)', short: { fi: 'Elinkustannusindeksi', en: 'Cost-of-living index' } },
};

/** Statistics Finland tables of each family (for source lines). */
const FAMILY_TABLES = { 'eki-1951': '11xl, 11xm', 'eki-1939': '11xn', 'eki-1914': '11xy' };

/**
 * Display name of an index family or series.
 * @param {string} idOrFamily e.g. 'eki-1951', 'khi-2025', 'khi-1972-v'
 * @param {'fi'|'en'} [lang='fi']
 * @param {{short?: boolean}} [o] short = without the base
 * @returns {string}
 */
export function seriesName(idOrFamily, lang = 'fi', { short = false } = {}) {
  const family = familyOf(idOrFamily);
  const known = FAMILY_NAMES[family];
  if (known) return short ? known.short[lang] : known[lang];
  const m = family.match(/^khi-(\d{4})$/);
  if (m) {
    const name = lang === 'en' ? 'Consumer price index' : 'Kuluttajahintaindeksi';
    return short ? name : `${name} (${m[1]}=100)`;
  }
  return idOrFamily;
}

/** Family id of a series id ('khi-1972-v' → 'khi-1972'). @param {string} id */
export function familyOf(id) {
  return String(id).replace(/-v$/, '');
}

/**
 * Statistics Finland table ids of a family ('11xs, 11xt' for KHI).
 * @param {string} idOrFamily
 */
export function seriesTables(idOrFamily) {
  const family = familyOf(idOrFamily);
  return FAMILY_TABLES[family] ?? (family === 'khi-2025' ? '11xs, 15b5' : '11xs, 11xt');
}

/**
 * Base of a family as shown to users ('1951:10=100', '2025=100').
 * @param {string} idOrFamily
 */
export function seriesBase(idOrFamily) {
  const family = familyOf(idOrFamily);
  const m = family.match(/^khi-(\d{4})$/);
  if (m) return `${m[1]}=100`;
  return { 'eki-1951': '1951:10=100', 'eki-1939': '1938:8–1939:7=100', 'eki-1914': '1914:1–6=100' }[family] ?? '';
}

/**
 * Compact aligned periods/values into { start, values } without leading or
 * trailing nulls. Returns null when there is no value.
 * @param {string[]} periods ascending, contiguous
 * @param {(number|null)[]} values aligned with periods
 */
export function compactSeries(periods, values) {
  if (!Array.isArray(periods) || !Array.isArray(values)) return null;
  let a = 0;
  while (a < values.length && !isNum(values[a])) a++;
  let b = values.length - 1;
  while (b >= a && !isNum(values[b])) b--;
  if (a > b) return null;
  return { start: String(periods[a]), values: values.slice(a, b + 1).map((v) => (isNum(v) ? v : null)) };
}

/**
 * All official index series found in the data (ctx.data), compacted.
 * Monthly: elinkustannusindeksi 1951:10=100 (11xl) and 1938:8–1939:7=100
 * (11xn), KHI with every base of khi.json (11xs). Annual: elinkustannusindeksi
 * 1951:10=100 (11xm) and 1914:1–6=100 (11xy), KHI annual averages (11xt).
 * @param {{khi?: any, 'khi-annual'?: any, elinkustannusindeksi?: any}} data
 * @param {{ids?: string[]}} [o] keep only these series ids (in this order)
 * @returns {{id: string, family: string, kind: 'month'|'year', base: string, decimals: number, start: string, values: (number|null)[]}[]}
 */
export function buildSeries(data, { ids } = {}) {
  const out = [];
  const add = (id, kind, periods, values, decimals) => {
    const c = compactSeries(periods, values);
    if (c) out.push({ id, family: familyOf(id), kind, base: seriesBase(id), decimals, ...c });
  };
  const e = data?.elinkustannusindeksi;
  if (e?.monthly) add('eki-1951', 'month', e.monthly.months, e.monthly.values, 0);
  if (e?.annual) add('eki-1951-v', 'year', e.annual.years, e.annual.values, 0);
  if (e?.monthly1939) add('eki-1939', 'month', e.monthly1939.months, e.monthly1939.values, 0);
  if (e?.annual1914) add('eki-1914-v', 'year', e.annual1914.years, e.annual1914.values, 0);
  const k = data?.khi;
  if (k?.months && k.index) {
    const bases = Object.keys(k.index).sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)));
    for (const b of bases) add(`khi-${b.slice(0, 4)}`, 'month', k.months, k.index[b], 2);
  }
  const ka = data?.['khi-annual'];
  if (ka?.years && ka.index) {
    for (const b of Object.keys(ka.index)) add(`khi-${b.slice(0, 4)}-v`, 'year', ka.years, ka.index[b], 2);
  }
  if (!ids) return out;
  return ids.map((id) => out.find((s) => s.id === id)).filter(Boolean);
}

/**
 * Last period of a compact series.
 * @param {{start: string, values: unknown[]}} s
 */
export function lastPeriod(s) {
  return periodAdd(s.start, s.values.length - 1);
}

/**
 * Official point of a series in a period, or null (outside the series,
 * not published, or a period of the other kind).
 * @param {{kind: string, start: string, values: (number|null)[]}|null|undefined} s
 * @param {string} period
 * @returns {number|null}
 */
export function pointAt(s, period) {
  if (!s || periodKind(period) !== s.kind) return null;
  const i = periodDiff(s.start, period);
  if (i == null || i < 0 || i >= s.values.length) return null;
  const v = s.values[i];
  return isNum(v) ? v : null;
}

/** Latest period with a value in a series (null for an empty series). */
export function latestPeriod(s) {
  if (!s) return null;
  for (let i = s.values.length - 1; i >= 0; i--) if (isNum(s.values[i])) return periodAdd(s.start, i);
  return null;
}

/* ============================================================ rent increase */

/** Rounding modes of a new rent. */
export const ROUNDING = Object.freeze(['cent', 'euro', 'euro-up']);

/**
 * Round a euro amount: 'cent' (nearest cent, default), 'euro' (nearest
 * euro) or 'euro-up' (up to the next whole euro).
 * @param {number} v
 * @param {'cent'|'euro'|'euro-up'} [mode='cent']
 */
export function roundMoney(v, mode = 'cent') {
  if (!isNum(v)) return null;
  if (mode === 'euro') return round(v, 0);
  if (mode === 'euro-up') return Math.ceil(round(v, 6) - 1e-9);
  return round(v, 2);
}

/**
 * Rent index increase: new rent = rent × check index / base index, with
 * optional contract clauses (applied in this order): an extra increase in
 * %-points on top of the index change ("indeksin muutos + 1 %"), a minimum
 * ("kuitenkin vähintään 3 %"), a maximum ("enintään 5 %") and "the rent never
 * decreases".
 *
 * Example: rent 900, base 2334 (8/2025), check 2385 (8/2026) →
 * 900 × 2385 / 2334 = 919.67 (+2.19 %); with minimum 3 % → 927.00.
 *
 * @param {object} p
 * @param {number} p.rent current monthly rent, € (> 0)
 * @param {number} p.baseIndex point figure of the base month (perusindeksi, > 0)
 * @param {number} p.checkIndex point figure of the check month (tarkistusindeksi, > 0)
 * @param {'cent'|'euro'|'euro-up'} [p.rounding='cent']
 * @param {number|null} [p.minPct] minimum increase, %
 * @param {number|null} [p.maxPct] maximum increase, %
 * @param {number|null} [p.extraPct] %-points added to the index change
 * @param {boolean} [p.noDecrease=false] the rent never goes down
 * @returns {{rent: number, baseIndex: number, checkIndex: number, ratio: number,
 *   indexChangePct: number, appliedPct: number, rule: 'index'|'extra'|'minimum'|'maximum'|'noDecrease',
 *   newRentExact: number, newRent: number, increase: number, increaseYear: number, rounding: string}
 *   | {error: 'rent'|'baseIndex'|'checkIndex'|'minMax'}}
 */
export function rentIncrease({ rent, baseIndex, checkIndex, rounding = 'cent', minPct = null, maxPct = null, extraPct = null, noDecrease = false }) {
  if (!isNum(rent) || rent <= 0) return { error: 'rent' };
  if (!isNum(baseIndex) || baseIndex <= 0) return { error: 'baseIndex' };
  if (!isNum(checkIndex) || checkIndex <= 0) return { error: 'checkIndex' };
  if (isNum(minPct) && isNum(maxPct) && minPct > maxPct) return { error: 'minMax' };
  const ratio = checkIndex / baseIndex;
  const indexChangePct = (ratio - 1) * 100;
  let pct = indexChangePct;
  let rule = 'index';
  if (isNum(extraPct) && extraPct !== 0) {
    pct += extraPct;
    rule = 'extra';
  }
  if (isNum(minPct) && pct < minPct) {
    pct = minPct;
    rule = 'minimum';
  }
  if (isNum(maxPct) && pct > maxPct) {
    pct = maxPct;
    rule = 'maximum';
  }
  if (noDecrease && pct < 0) {
    pct = 0;
    rule = 'noDecrease';
  }
  const mode = ROUNDING.includes(rounding) ? rounding : 'cent';
  // The plain index rule uses the ratio directly (no percentage round trip).
  const newRentExact = rule === 'index' ? rent * ratio : rent * (1 + pct / 100);
  const newRent = roundMoney(newRentExact, mode);
  const increase = round(newRent - rent, 2);
  return {
    rent,
    baseIndex,
    checkIndex,
    ratio,
    indexChangePct,
    appliedPct: pct,
    rule,
    newRentExact,
    newRent,
    increase,
    increaseYear: round(increase * 12, 2),
    rounding: mode,
  };
}

/* ========================================================== value of money */

/** Markka per euro (fixed conversion rate, 1.1.1999). */
export const MARKKA_PER_EURO = 5.94573;
/** The 1963 currency reform: 100 old markka = 1 new markka. */
export const CURRENCY_REFORM_YEAR = 1963;
/** First year of euro cash (markka amounts are accepted for earlier periods). */
export const EURO_CASH_YEAR = 2002;

/**
 * Convert an amount of a period's currency to euros: 'eur' as is, 'mk'
 * markka (old markka before 1963 are 1/100 of a new markka).
 * @param {number} amount
 * @param {'eur'|'mk'} currency
 * @param {string|number} period 'YYYY-MM', 'YYYY' or a year
 * @returns {number|null}
 */
export function toEuros(amount, currency, period) {
  if (!isNum(amount)) return null;
  if (currency !== 'mk') return amount;
  const y = typeof period === 'number' ? period : periodYear(period);
  return (y < CURRENCY_REFORM_YEAR ? amount / 100 : amount) / MARKKA_PER_EURO;
}

/**
 * Inverse of toEuros().
 * @param {number} euros
 * @param {'eur'|'mk'} currency
 * @param {string|number} period
 * @returns {number|null}
 */
export function fromEuros(euros, currency, period) {
  if (!isNum(euros)) return null;
  if (currency !== 'mk') return euros;
  const y = typeof period === 'number' ? period : periodYear(period);
  return euros * MARKKA_PER_EURO * (y < CURRENCY_REFORM_YEAR ? 100 : 1);
}

/**
 * Value of money: what `amount` at the index point `fromIdx` corresponds to
 * at `toIdx` (same series): amount × toIdx / fromIdx.
 * Example (KHI 1972=100): 100 € in 1/2000 (569.80) → 8/2026 (927.11) = 162.71 €.
 * @param {{amount: number, fromIdx: number, toIdx: number}} p
 * @returns {{value: number, factor: number, changePct: number}|null}
 */
export function valueOfMoney({ amount, fromIdx, toIdx }) {
  if (!isNum(amount) || !isNum(fromIdx) || !isNum(toIdx) || fromIdx <= 0 || toIdx <= 0) return null;
  const factor = toIdx / fromIdx;
  return { value: amount * factor, factor, changePct: (factor - 1) * 100 };
}

/**
 * Index families for value-of-money calculations in order of preference:
 * KHI 1972=100 (monthly 11xs + annual 11xt, 2 decimals), elinkustannusindeksi
 * 1938:8–1939:7=100 (monthly from 8/1939), 1951:10=100 (monthly 10/1951 and
 * annual 1952–) and 1914:1–6=100 (annual from 1860).
 */
export const MONEY_FAMILIES = Object.freeze(['khi-1972', 'eki-1939', 'eki-1951', 'eki-1914']);
/** Series ids needed by pickMoneySeries(). */
export const MONEY_SERIES_IDS = Object.freeze(['khi-1972', 'khi-1972-v', 'eki-1939', 'eki-1951', 'eki-1951-v', 'eki-1914-v']);

/**
 * Choose the official series for a value-of-money calculation between two
 * periods ('YYYY-MM' or 'YYYY' = annual average). The first family in
 * MONEY_FAMILIES that has a published point for both periods wins. If none
 * has (a period before 8/1939), the annual 1914:1–6=100 series is used with
 * the years of both periods; a year after its last published year is capped
 * to that year (`capped`).
 * @param {object[]} list output of buildSeries()
 * @param {string} from
 * @param {string} to
 * @returns {{family: string, fromSeries: object, toSeries: object, from: string, to: string,
 *   fromIdx: number, toIdx: number, annualFallback: boolean, capped: boolean}
 *   | {error: 'invalid'|'future'|'before'}}
 */
export function pickMoneySeries(list, from, to) {
  if (!periodKind(from) || !periodKind(to)) return { error: 'invalid' };
  const byId = new Map((list ?? []).map((s) => [s.id, s]));
  const series = (family, kind) => byId.get(kind === 'year' ? `${family}-v` : family) ?? null;
  // Newest published month / complete year over all series: later periods
  // (or the annual average of the current, incomplete year) are not published yet.
  const newest = (kind) => (list ?? []).filter((s) => s.kind === kind).map(latestPeriod).filter(Boolean).sort().at(-1) ?? null;
  const newestMonth = newest('month');
  const newestYear = newest('year');
  const future = (p) => (isMonth(p) ? newestMonth != null && p > newestMonth : newestYear != null && p > newestYear);
  if (future(from) || future(to)) return { error: 'future' };

  for (const family of MONEY_FAMILIES) {
    const fs = series(family, periodKind(from));
    const ts = series(family, periodKind(to));
    const fromIdx = pointAt(fs, from);
    const toIdx = pointAt(ts, to);
    if (fromIdx != null && toIdx != null) {
      return { family, fromSeries: fs, toSeries: ts, from, to, fromIdx, toIdx, annualFallback: false, capped: false };
    }
  }
  // Annual fallback (periods before the monthly series).
  const annual = byId.get('eki-1914-v');
  if (!annual) return { error: 'before' };
  const last = latestPeriod(annual);
  const yearOf = (p) => String(periodYear(p));
  let fy = yearOf(from);
  let ty = yearOf(to);
  let capped = false;
  if (fy > last) {
    fy = last;
    capped = true;
  }
  if (ty > last) {
    ty = last;
    capped = true;
  }
  const fromIdx = pointAt(annual, fy);
  const toIdx = pointAt(annual, ty);
  if (fromIdx == null || toIdx == null) return { error: 'before' };
  return { family: 'eki-1914', fromSeries: annual, toSeries: annual, from: fy, to: ty, fromIdx, toIdx, annualFallback: true, capped };
}

/**
 * Points for a value-of-money chart: `amount` rebased along the chosen
 * family between the two periods (monthly when the later period is a month
 * and the family has a monthly series, otherwise annual).
 * @param {object[]} list output of buildSeries()
 * @param {ReturnType<typeof pickMoneySeries>} pick a successful pick
 * @param {number} amount amount at the `from` period (in euros)
 * @returns {{kind: 'month'|'year', labels: string[], values: number[]}}
 */
export function moneyPath(list, pick, amount) {
  if (!pick || 'error' in pick) return { kind: 'month', labels: [], values: [] };
  const byId = new Map((list ?? []).map((s) => [s.id, s]));
  const monthly = byId.get(pick.family) ?? null;
  const annual = byId.get(`${pick.family}-v`) ?? null;
  const forward = monthsBetween(pick.from, pick.to) >= 0;
  const earlier = forward ? pick.from : pick.to;
  const later = forward ? pick.to : pick.from;
  const useMonths = Boolean(!pick.annualFallback && monthly && isMonth(later));
  const s = useMonths ? monthly : annual;
  if (!s) return { kind: useMonths ? 'month' : 'year', labels: [], values: [] };
  // A year on a monthly path starts in January; a month on an annual path is its year.
  const start = useMonths ? (isMonth(earlier) ? earlier : `${earlier}-01`) : String(periodYear(earlier));
  const end = useMonths ? later : String(periodYear(later));
  const labels = [];
  const values = [];
  for (let p = start, n = 0; periodDiff(p, end) >= 0 && n < 5000; p = periodAdd(p, 1), n++) {
    const v = pointAt(s, p);
    if (v == null) continue;
    labels.push(p);
    values.push((amount * v) / pick.fromIdx);
  }
  return { kind: useMonths ? 'month' : 'year', labels, values };
}

/* ================================================================ savings */

/**
 * Savings in real terms (Fisher): the nominal value with annual compounding
 * and its purchasing power in money of the start period.
 * Inflation comes either from two official index points (`fromIdx`, `toIdx`,
 * historical) or from an assumed annual rate (`assumedInflation`, %).
 *
 * Example: 10 000 € at 2.5 % for 60 months with 2.2 % inflation → nominal
 * 11 314.08 €, real 10 147.6 €, real return ≈ 0.29 % a year.
 *
 * @param {object} p
 * @param {number} p.amount start amount (> 0)
 * @param {number} [p.nominalRate=0] nominal annual interest, % (≥ −100)
 * @param {number} p.months holding period in months (≥ 0)
 * @param {number} [p.fromIdx] index point at the start
 * @param {number} [p.toIdx] index point at the end
 * @param {number} [p.assumedInflation] assumed annual inflation, %
 * @returns {{amount: number, months: number, years: number, nominalValue: number, realValue: number,
 *   priceFactor: number, nominalGain: number, realGain: number, nominalAnnualPct: number,
 *   inflationAnnualPct: number|null, realAnnualPct: number|null, purchasingPowerLossPct: number}
 *   (annual rates are null for periods under 12 months)
 *   | {error: 'amount'|'rate'|'months'|'inflation'}}
 */
export function savingsReal({ amount, nominalRate = 0, months, fromIdx, toIdx, assumedInflation }) {
  if (!isNum(amount) || amount <= 0) return { error: 'amount' };
  if (!isNum(nominalRate) || nominalRate <= -100) return { error: 'rate' };
  if (!isNum(months) || months < 0) return { error: 'months' };
  const years = months / 12;
  let priceFactor;
  if (isNum(fromIdx) && isNum(toIdx) && fromIdx > 0 && toIdx > 0) priceFactor = toIdx / fromIdx;
  else if (isNum(assumedInflation) && assumedInflation > -100) priceFactor = (1 + assumedInflation / 100) ** years;
  else return { error: 'inflation' };
  const nominalValue = amount * (1 + nominalRate / 100) ** years;
  const realValue = nominalValue / priceFactor;
  // Never annualise periods under 12 months (SPEC §6).
  const annual = (factor) => (months >= 12 ? (factor ** (1 / years) - 1) * 100 : null);
  return {
    amount,
    months,
    years,
    nominalValue,
    realValue,
    priceFactor,
    nominalGain: nominalValue - amount,
    realGain: realValue - amount,
    nominalAnnualPct: nominalRate,
    inflationAnnualPct: annual(priceFactor),
    realAnnualPct: annual(realValue / amount),
    purchasingPowerLossPct: (1 - 1 / priceFactor) * 100,
  };
}

/* ====================================================== personal inflation */

/**
 * Personal inflation: the weighted mean of group price changes with the
 * user's weights, normalised (Σ wᵢ·rᵢ / Σ wᵢ). Groups without a rate or with
 * a non-positive weight are left out of both sums.
 * @param {{weights: Record<string, number>, rates: Record<string, number|null>}} p
 * @returns {{rate: number, totalWeight: number,
 *   parts: {key: string, weight: number, share: number, rate: number|null, contribution: number}[]}|null}
 */
export function personalInflation({ weights, rates }) {
  if (!weights || !rates) return null;
  const keys = Object.keys(weights);
  let total = 0;
  for (const k of keys) if (isNum(weights[k]) && weights[k] > 0 && isNum(rates[k])) total += weights[k];
  if (!(total > 0)) return null;
  let rate = 0;
  const parts = keys.map((key) => {
    const w = isNum(weights[key]) && weights[key] > 0 ? weights[key] : 0;
    const r = isNum(rates[key]) ? rates[key] : null;
    const share = r == null ? 0 : w / total;
    const contribution = r == null ? 0 : share * r;
    rate += contribution;
    return { key, weight: w, share, rate: r, contribution };
  });
  return { rate, totalWeight: total, parts };
}

/**
 * What explains the difference between two baskets (e.g. yours vs. the
 * official weights): per group (share − base share) × rate, largest first.
 * The differences sum to personal − base.
 * @param {{weights: Record<string, number>, baseWeights: Record<string, number>, rates: Record<string, number|null>}} p
 * @returns {{personal: number, base: number, difference: number,
 *   drivers: {key: string, share: number, baseShare: number, rate: number, effect: number}[]}|null}
 */
export function inflationDifference({ weights, baseWeights, rates }) {
  const a = personalInflation({ weights, rates });
  const b = personalInflation({ weights: baseWeights, rates });
  if (!a || !b) return null;
  const baseShare = new Map(b.parts.map((p) => [p.key, p.share]));
  const drivers = a.parts
    .filter((p) => p.rate != null)
    .map((p) => {
      const bs = baseShare.get(p.key) ?? 0;
      return { key: p.key, share: p.share, baseShare: bs, rate: p.rate, effect: (p.share - bs) * p.rate };
    })
    .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
  return { personal: a.rate, base: b.rate, difference: a.rate - b.rate, drivers };
}

/* ============================================================ real wages */

/**
 * Real change of a wage between two months, deflated with a price index.
 * Example: 3 200 € → 3 300 € while the index rose 2334 → 2385: nominal
 * +3.13 %, prices +2.19 %, real +0.92 %; keeping the purchasing power would
 * have needed 3 269.92 €.
 * @param {{before: number, after: number, cpiFrom: number, cpiTo: number}} p
 * @returns {{nominalPct: number, pricePct: number, realPct: number, priceFactor: number,
 *   neededSalary: number, difference: number}|{error: 'before'|'after'|'cpi'}}
 */
export function realWageChange({ before, after, cpiFrom, cpiTo }) {
  if (!isNum(before) || before <= 0) return { error: 'before' };
  if (!isNum(after) || after <= 0) return { error: 'after' };
  if (!isNum(cpiFrom) || !isNum(cpiTo) || cpiFrom <= 0 || cpiTo <= 0) return { error: 'cpi' };
  const priceFactor = cpiTo / cpiFrom;
  const wageFactor = after / before;
  const neededSalary = before * priceFactor;
  return {
    nominalPct: (wageFactor - 1) * 100,
    pricePct: (priceFactor - 1) * 100,
    realPct: (wageFactor / priceFactor - 1) * 100,
    priceFactor,
    neededSalary,
    difference: after - neededSalary,
  };
}

/**
 * Average annual change (geometric) of a factor over `months`; null for
 * periods under 12 months (never annualise short periods, SPEC §6).
 * @param {number} factor e.g. 1.6271
 * @param {number} months
 * @returns {number|null} % a year
 */
export function annualRate(factor, months) {
  if (!isNum(factor) || factor <= 0 || !isNum(months) || Math.abs(months) < 12) return null;
  const f = months < 0 ? 1 / factor : factor;
  return (f ** (12 / Math.abs(months)) - 1) * 100;
}

/* ============================================================ input parsing */

/**
 * Parse a number typed by a user: '1 234,56', '1234.56', '850 €', '−2,5 %'.
 * Finnish (default): a comma or a single dot is the decimal separator.
 * English: the dot is the decimal separator and commas group thousands.
 * @param {unknown} input
 * @param {'fi'|'en'} [lang='fi']
 * @returns {number|null} null for empty or invalid input
 */
export function parseDecimal(input, lang = 'fi') {
  if (typeof input === 'number') return isNum(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input
    .replace(/[\s  ]/g, '')
    .replace(/[€%]/g, '')
    .replace(/(euroa|eur|mk)$/i, '')
    .replace(/[−–]/g, '-');
  if (!s) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Both present: the last one is the decimal separator.
    const dec = comma > dot ? ',' : '.';
    const group = dec === ',' ? '.' : ',';
    s = s.split(group).join('').replace(dec, '.');
  } else if (comma >= 0) {
    s = lang === 'en' ? s.split(',').join('') : s.split(',').length === 2 ? s.replace(',', '.') : '';
  } else if (dot >= 0 && s.split('.').length > 2) {
    s = s.split('.').join(''); // 1.234.567 → thousands
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/* ========================================================== locale formats */

const EN_MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const EN_MONTHS_SHORT = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

const enCache = new Map();
/** en-GB number body without sign. */
function enBody(v, decimals) {
  let f = enCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });
    enCache.set(decimals, f);
  }
  return f.format(Math.abs(v));
}

/** Signed en-GB number (U+2212 minus, '+'/'±' with `sign`). */
function enNum(v, decimals = 0, { sign = false } = {}) {
  const r = round(v, decimals);
  if (r === null) return DASH;
  const s = r < 0 ? MINUS : sign ? (r > 0 ? '+' : '±') : '';
  return s + enBody(r, decimals);
}

const monthPart = (ym, names) => {
  const { y, m } = parseYm(ym);
  return `${names[m - 1]} ${y}`;
};

/** Finnish formatters (format.js) + period phrases. */
const FI = Object.freeze({
  lang: 'fi',
  num: fmt.num,
  pct: fmt.pct,
  pp: fmt.pp,
  eur: fmt.eur,
  idx: fmt.idx,
  monthNames: fmt.MONTHS,
  /** 'elokuu 2026' / '2026' */
  period: (p) => (isMonth(p) ? fmt.monthName(p) : isYear(p) ? p : DASH),
  /** 'elokuussa 2026' / 'vuonna 2026' */
  periodIn: (p) => (isMonth(p) ? fmt.inessive(p) : isYear(p) ? `vuonna ${p}` : DASH),
  /** '8/2026' / '2026' */
  periodNumeric: (p) => (isMonth(p) ? `${parseYm(p).m}/${parseYm(p).y}` : isYear(p) ? p : DASH),
  /** 'elo 2026' / '2026' */
  periodShort: (p) => (isMonth(p) ? fmt.monthShort(p) : isYear(p) ? p : DASH),
  markka: (v, d = 2) => (v == null ? DASH : `${fmt.num(v, d)}${NBSP}mk`),
});

/** English formatters (en-GB digits, U+2212 minus) + period phrases. */
const EN = Object.freeze({
  lang: 'en',
  num: enNum,
  pct: (v, { decimals = 1, sign = false } = {}) => {
    const s = enNum(v, decimals, { sign });
    return s === DASH ? DASH : `${s}%`;
  },
  pp: (v, { decimals = 1, sign = true } = {}) => {
    const s = enNum(v, decimals, { sign });
    return s === DASH ? DASH : `${s}${NBSP}pp`;
  },
  eur: (v, decimals = 2, { sign = false } = {}) => {
    const r = round(v, decimals);
    if (r === null) return DASH;
    const s = r < 0 ? MINUS : sign ? (r > 0 ? '+' : '±') : '';
    return `${s}€${enBody(r, decimals)}`;
  },
  idx: (v, decimals = 2) => enNum(v, decimals),
  monthNames: EN_MONTHS,
  period: (p) => (isMonth(p) ? monthPart(p, EN_MONTHS) : isYear(p) ? p : DASH),
  periodIn: (p) => (isMonth(p) ? `in ${monthPart(p, EN_MONTHS)}` : isYear(p) ? `in ${p}` : DASH),
  periodNumeric: (p) => (isMonth(p) ? `${parseYm(p).m}/${parseYm(p).y}` : isYear(p) ? p : DASH),
  periodShort: (p) => (isMonth(p) ? monthPart(p, EN_MONTHS_SHORT) : isYear(p) ? p : DASH),
  markka: (v, d = 2) => (v == null ? DASH : `${enNum(v, d)}${NBSP}mk`),
});

/**
 * Number, money and period formatters for a language.
 * @param {'fi'|'en'} [lang='fi']
 */
export function formatter(lang = 'fi') {
  return lang === 'en' ? EN : FI;
}

/* ================================================================ views */
/*
 * View models: every text of a result panel as strings, keyed like the
 * [data-out] elements of the page. Shared by the page modules (initial,
 * server-rendered state) and the page scripts (updates), so both render
 * exactly the same text.
 */

/** Index point with the series' decimals. */
const point = (F, v, decimals) => F.idx(v, decimals);

/** Euro amount without decimals when it is whole ('100 €'), else with cents. */
const money = (F, v) => (isNum(v) && Math.abs(round(v, 2) - Math.round(v)) < 1e-9 ? F.eur(v, 0) : F.eur(v));

/**
 * Result texts of the rent calculator.
 * @param {ReturnType<typeof rentIncrease>} r a successful result
 * @param {{series: {id: string, decimals: number}, base: string, check: string, lang?: 'fi'|'en'}} o
 * @returns {Record<string, string>}
 */
export function rentView(r, { series, base, check, lang = 'fi' }) {
  const F = formatter(lang);
  const d = series.decimals ?? 2;
  const name = seriesName(series.id, lang);
  const b = point(F, r.baseIndex, d);
  const c = point(F, r.checkIndex, d);
  const perMonth = lang === 'en' ? '/month' : '/kk';
  const formula = r.rule === 'index'
    ? `${F.eur(r.rent)} × ${c} / ${b} = ${F.eur(r.newRent)}`
    : `${F.eur(r.rent)} × (1 ${r.appliedPct < 0 ? MINUS : '+'} ${F.num(Math.abs(r.appliedPct), 2)} / 100) = ${F.eur(r.newRent)}`;
  const idxPct = F.pct(r.indexChangePct, { sign: true, decimals: 2 });
  const appliedPct = F.pct(r.appliedPct, { sign: true, decimals: 2 });
  const roundingNote = {
    fi: { cent: '', euro: ' Pyöristetty lähimpään euroon.', 'euro-up': ' Pyöristetty ylöspäin täyteen euroon.' },
    en: { cent: '', euro: ' Rounded to the nearest euro.', 'euro-up': ' Rounded up to the next whole euro.' },
  }[lang][r.rounding] ?? '';
  let rule;
  if (lang === 'en') {
    rule = {
      index: '',
      extra: `The contract adds ${F.pp(r.appliedPct - r.indexChangePct, { decimals: 2 })} to the index change (${idxPct}).`,
      minimum: `The index change (${idxPct}) is below the contract's minimum increase, so the increase is ${F.pct(r.appliedPct, { decimals: 2 })}.`,
      maximum: `The index change (${idxPct}) exceeds the contract's maximum increase, so the increase is capped at ${F.pct(r.appliedPct, { decimals: 2 })}.`,
      noDecrease: `The index fell (${idxPct}), but under the contract the rent does not decrease.`,
    }[r.rule];
  } else {
    rule = {
      index: '',
      extra: `Sopimuksen lisäkorotus ${F.pp(r.appliedPct - r.indexChangePct, { decimals: 2 })} on lisätty indeksin muutokseen (${idxPct}).`,
      minimum: `Indeksin muutos (${idxPct}) jää alle sopimuksen vähimmäiskorotuksen, joten korotus on ${F.pct(r.appliedPct, { decimals: 2 })}.`,
      maximum: `Indeksin muutos (${idxPct}) ylittää sopimuksen enimmäiskorotuksen, joten korotus rajataan ${F.pct(r.appliedPct, { decimals: 2 })}:iin.`,
      noDecrease: `Indeksi laski (${idxPct}), mutta sopimuksen mukaan vuokra ei laske.`,
    }[r.rule];
  }
  const notice = lang === 'en'
    ? `Under the index clause of the lease, the rent is revised. The ${name.charAt(0).toLowerCase()}${name.slice(1)} was ${b} in the base month (${F.period(base)}) and ${c} in the review month (${F.period(check)}). The new rent is ${r.rule === 'index' ? `${F.eur(r.rent)} × ${c} / ${b}` : `${F.eur(r.rent)} + ${F.pct(r.appliedPct, { decimals: 2 })}`} = ${F.eur(r.newRent)} per month. Source: Statistics Finland.`
    : `Vuokrasopimuksen indeksiehdon mukaisesti vuokra tarkistetaan. ${name.replace(/ \(/, 'n (')} pisteluku oli perusajankohtana (${F.period(base)}) ${b} ja tarkistusajankohtana (${F.period(check)}) ${c}. Uusi vuokra on ${r.rule === 'index' ? `${F.eur(r.rent)} × ${c} / ${b}` : `${F.eur(r.rent)} + ${F.pct(r.appliedPct, { decimals: 2 })}`} = ${F.eur(r.newRent)}/kk. Lähde: Tilastokeskus.`;
  return {
    newRent: F.eur(r.newRent),
    perMonth,
    increase: F.eur(r.increase, 2, { sign: true }),
    increaseYear: F.eur(r.increaseYear, 2, { sign: true }),
    appliedPct,
    indexChangePct: idxPct,
    formula: `${formula}${roundingNote}`,
    basePoint: `${b}`,
    checkPoint: `${c}`,
    baseMonth: F.period(base),
    checkMonth: F.period(check),
    seriesName: name,
    rule,
    notice,
  };
}

/**
 * Result texts of the value-of-money calculator.
 * @param {{amount: number, currency: 'eur'|'mk', pick: object, value: number, factor: number, months: number}} m
 * @param {'fi'|'en'} [lang='fi']
 * @returns {Record<string, string>}
 */
export function moneyView({ amount, currency, pick, value, factor }, lang = 'fi') {
  const F = formatter(lang);
  const inAmount = currency === 'mk' ? F.markka(amount, Number.isInteger(amount) ? 0 : 2) : money(F, amount);
  const oldMarkka = currency === 'mk' && periodYear(pick.from) < CURRENCY_REFORM_YEAR;
  const inAmountLabel = oldMarkka ? (lang === 'en' ? `${inAmount} (old markka)` : `${inAmount} (vanhaa markkaa)`) : inAmount;
  const months = monthsBetween(pick.from, pick.to);
  const annual = annualRate(factor, months);
  const changePct = (factor - 1) * 100;
  const later = months >= 0;
  const toMarkka = periodYear(pick.to) < EURO_CASH_YEAR ? fromEuros(value, 'mk', pick.to) : null;
  const toOld = periodYear(pick.to) < CURRENCY_REFORM_YEAR;
  const markkaText = toMarkka == null ? '' : lang === 'en' ? ` (${F.markka(toMarkka)}${toOld ? ', old markka' : ''})` : ` (${F.markka(toMarkka)}${toOld ? ' vanhaa markkaa' : ''})`;
  const src = seriesName(pick.family, lang);
  const pts = `${F.idx(pick.fromIdx, pick.fromSeries.decimals)} → ${F.idx(pick.toIdx, pick.toSeries.decimals)}`;
  const amountEur = toEuros(amount, currency, pick.from);
  const reverse = factor > 0 ? amountEur / factor : null;
  let sentence;
  let change;
  let buys;
  if (lang === 'en') {
    sentence = `${inAmountLabel} ${F.periodIn(pick.from)} is equivalent to ${F.eur(value)}${markkaText} ${F.periodIn(pick.to)}.`;
    change = later
      ? `Prices ${changePct >= 0 ? 'rose' : 'fell'} by ${F.pct(Math.abs(changePct))}${annual != null ? ` (on average ${F.pct(annual, { sign: true, decimals: 2 })} a year)` : ''}.`
      : `Prices were ${F.pct(Math.abs(changePct))} ${changePct <= 0 ? 'lower' : 'higher'} ${F.periodIn(pick.to)}.`;
    buys = reverse != null && periodYear(pick.to) >= EURO_CASH_YEAR
      ? `Conversely, ${money(F, amountEur)} ${F.periodIn(pick.to)} bought as much as ${F.eur(reverse)} ${F.periodIn(pick.from)}.`
      : '';
  } else {
    sentence = `${inAmountLabel} ${F.periodIn(pick.from)} vastaa ostovoimaltaan ${F.eur(value)}${markkaText} ${F.periodIn(pick.to)}.`;
    change = later
      ? `Hinnat ${changePct >= 0 ? 'nousivat' : 'laskivat'} ${F.pct(Math.abs(changePct))}${annual != null ? ` (keskimäärin ${F.pct(annual, { sign: true, decimals: 2 })} vuodessa)` : ''}.`
      : `Hinnat olivat ${F.periodIn(pick.to)} ${F.pct(Math.abs(changePct))} ${changePct <= 0 ? 'alemmat' : 'korkeammat'}.`;
    buys = reverse != null && periodYear(pick.to) >= EURO_CASH_YEAR
      ? `Toisin päin: ${money(F, amountEur)} ${F.periodIn(pick.to)} vastaa ostovoimaltaan ${F.eur(reverse)} ${F.periodIn(pick.from)}.`
      : '';
  }
  const basis = `${money(F, amountEur)} × ${F.idx(pick.toIdx, pick.toSeries.decimals)} / ${F.idx(pick.fromIdx, pick.fromSeries.decimals)} = ${F.eur(value)}`;
  let note = '';
  if (pick.annualFallback) {
    note = lang === 'en'
      ? `Before August 1939 the calculation uses annual figures of the ${seriesName('eki-1914', 'en')}.${pick.capped ? ` Its latest year is ${pick.to}, so the calculation ends there.` : ''}`
      : `Ennen elokuuta 1939 laskelma tehdään vuositasolla: ${seriesName('eki-1914', 'fi').replace('Elinkustannusindeksi', 'elinkustannusindeksi')}.${pick.capped ? ` Sarjan viimeisin vuosi on ${pick.to}, joten laskelma päättyy siihen.` : ''}`;
  }
  return {
    value: F.eur(value),
    sentence,
    change,
    buys,
    basis,
    note,
    points: pts,
    seriesName: src,
    factor: F.num(factor, 4),
  };
}

/**
 * Result texts of the savings calculators.
 * @param {ReturnType<typeof savingsReal>} r a successful result
 * @param {{kind: 'history'|'forecast', from?: string, to?: string, lang?: 'fi'|'en'}} o
 *   history: from/to months; forecast: years from r.years
 * @returns {Record<string, string>}
 */
export function savingsView(r, { kind, from, to, lang = 'fi' }) {
  const F = formatter(lang);
  const totalRealPct = (r.realValue / r.amount - 1) * 100;
  const years = F.num(r.years, Number.isInteger(r.years) ? 0 : 1);
  const realAnnual = r.realAnnualPct != null ? F.pct(r.realAnnualPct, { sign: true, decimals: 2 }) : null;
  if (lang === 'en') {
    if (kind === 'history') {
      const priceChange = (r.priceFactor - 1) * 100;
      return {
        real: F.eur(r.realValue),
        realLabel: `Purchasing power in money of ${F.period(from)}`,
        lead: `Nominally ${money(F, r.nominalValue)}, but prices ${priceChange >= 0 ? 'rose' : 'fell'} by ${F.pct(Math.abs(priceChange))} from ${F.period(from)} to ${F.period(to)}.`,
        realReturn: realAnnual ? `Real return ${realAnnual} a year (${F.pct(totalRealPct, { sign: true })} in total).` : `Real return ${F.pct(totalRealPct, { sign: true, decimals: 2 })} over the period.`,
        nominal: money(F, r.nominalValue),
        inflation: r.inflationAnnualPct != null ? `${F.pct(r.inflationAnnualPct, { decimals: 2 })} a year` : `${F.pct(priceChange, { decimals: 2 })} in total`,
      };
    }
    return {
      real: F.eur(r.realValue),
      realLabel: 'Purchasing power in today’s money',
      lead: `Nominally ${F.eur(r.nominalValue)} after ${years} years at ${F.pct(r.nominalAnnualPct, { decimals: 2 })} interest, with inflation of ${F.pct(r.inflationAnnualPct, { decimals: 1 })} a year.`,
      realReturn: realAnnual ? `Real return about ${realAnnual} a year.` : '',
      nominal: money(F, r.nominalValue),
      inflation: `${F.pct(r.inflationAnnualPct, { decimals: 1 })} a year`,
    };
  }
  if (kind === 'history') {
    const priceChange = (r.priceFactor - 1) * 100;
    return {
      real: F.eur(r.realValue),
      realLabel: `Ostovoima ${fmt.genitive(from)} rahassa`,
      lead: `Nimellisesti ${money(F, r.nominalValue)}, mutta hinnat ${priceChange >= 0 ? 'nousivat' : 'laskivat'} ${F.pct(Math.abs(priceChange))} ${fmt.elative(from)} ${fmt.illative(to)}.`,
      realReturn: realAnnual
        ? `Todellinen tuotto ${realAnnual} vuodessa (${F.pct(totalRealPct, { sign: true })} koko ajalta).`
        : `Todellinen tuotto ${F.pct(totalRealPct, { sign: true, decimals: 2 })} koko ajalta.`,
      nominal: money(F, r.nominalValue),
      inflation: r.inflationAnnualPct != null ? `${F.pct(r.inflationAnnualPct, { decimals: 2 })} vuodessa` : `${F.pct(priceChange, { decimals: 2 })} koko ajalta`,
    };
  }
  return {
    real: F.eur(r.realValue),
    realLabel: 'Ostovoima tämän päivän rahassa',
    lead: `Nimellisesti ${F.eur(r.nominalValue)} ${years} vuoden kuluttua, kun korko on ${F.pct(r.nominalAnnualPct, { decimals: 2 })} ja inflaatio ${F.pct(r.inflationAnnualPct, { decimals: 1 })} vuodessa.`,
    realReturn: realAnnual ? `Todellinen tuotto on noin ${realAnnual} vuodessa.` : '',
    nominal: money(F, r.nominalValue),
    inflation: `${F.pct(r.inflationAnnualPct, { decimals: 1 })} vuodessa`,
  };
}

/**
 * Result texts of the real wage calculator.
 * @param {ReturnType<typeof realWageChange>} r a successful result
 * @param {{before: number, after: number, from: string, to: string, lang?: 'fi'|'en'}} o
 * @returns {Record<string, string>}
 */
export function wageView(r, { before, after, from, to, lang = 'fi' }) {
  const F = formatter(lang);
  const up = r.realPct >= 0.05;
  const down = r.realPct <= -0.05;
  if (lang === 'en') {
    return {
      real: F.pct(r.realPct, { sign: true }),
      verdict: up ? 'Your purchasing power increased.' : down ? 'Your purchasing power decreased.' : 'Your purchasing power stayed about the same.',
      lead: `Your pay changed from ${money(F, before)} to ${money(F, after)} (${F.pct(r.nominalPct, { sign: true })}) from ${F.period(from)} to ${F.period(to)}. Prices ${r.pricePct >= 0 ? 'rose' : 'fell'} by ${F.pct(Math.abs(r.pricePct))} in the same period.`,
      needed: F.eur(r.neededSalary),
      difference: F.eur(r.difference, 2, { sign: true }),
      nominal: F.pct(r.nominalPct, { sign: true }),
      prices: F.pct(r.pricePct, { sign: true }),
    };
  }
  return {
    real: F.pct(r.realPct, { sign: true }),
    verdict: up ? 'Ostovoimasi kasvoi.' : down ? 'Ostovoimasi heikkeni.' : 'Ostovoimasi pysyi ennallaan.',
    lead: `Palkkasi muuttui ${money(F, before)} → ${money(F, after)} (${F.pct(r.nominalPct, { sign: true })}) ${fmt.elative(from)} ${fmt.illative(to)}. Hinnat ${r.pricePct >= 0 ? 'nousivat' : 'laskivat'} samana aikana ${F.pct(Math.abs(r.pricePct))}.`,
    needed: F.eur(r.neededSalary),
    difference: F.eur(r.difference, 2, { sign: true }),
    nominal: F.pct(r.nominalPct, { sign: true }),
    prices: F.pct(r.pricePct, { sign: true }),
  };
}
