/**
 * Pure statistics helpers for monthly price-index data.
 *
 * ISOMORPHIC: pure ESM without DOM or Node-only APIs (build + browser).
 * Data contract (SPEC §7): `months` are ascending, contiguous 'YYYY-MM'
 * strings; value arrays are aligned with `months`; missing values are `null`.
 * Functions return raw (unrounded) numbers unless stated otherwise; format
 * them with format.js. Missing input yields `null`, never 0.
 */
import { isNum, round, ymAdd, ymDiff } from './format.js';

export { isNum, round };

/**
 * Chart/statistics ranges: key → length in months (null = whole series).
 * A range of n months has n + 1 points: '1v' = 13 points (same month a year
 * earlier → latest), '5v' = 61, '6kk' = 7.
 */
export const RANGES = Object.freeze({ '6kk': 6, '1v': 12, '3v': 36, '5v': 60, '10v': 120, kaikki: null });
/** Range keys in display order. */
export const RANGE_KEYS = Object.freeze(Object.keys(RANGES));
/** @param {unknown} key @returns {boolean} */
export const isRangeKey = (key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(RANGES, key);

/** Strip binary float noise from a computed value (2.1500000000000004 → 2.15). */
const clean = (v) => (isNum(v) ? Number(v.toPrecision(12)) : null);

/**
 * Value of `arr` at month `ym`, or null when the month is absent or missing.
 * O(1) for contiguous months, falls back to a search otherwise.
 * @param {string[]} months
 * @param {(number|null)[]} arr
 * @param {string} ym
 * @returns {number|null}
 */
export function seriesAt(months, arr, ym) {
  if (!months?.length || !arr || ym == null) return null;
  let i = ymDiff(months[0], ym);
  if (months[i] !== ym) i = months.indexOf(ym);
  const v = i >= 0 ? arr[i] : undefined;
  return isNum(v) ? v : null;
}

/**
 * Index of the last finite value, or -1.
 * @param {(number|null)[]} arr
 */
export function latestIndex(arr) {
  if (!arr) return -1;
  for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i])) return i;
  return -1;
}

/**
 * Index of the first finite value, or -1.
 * @param {(number|null)[]} arr
 */
export function firstIndex(arr) {
  if (!arr) return -1;
  for (let i = 0; i < arr.length; i++) if (isNum(arr[i])) return i;
  return -1;
}

/**
 * Slice aligned series to a range ending at the latest month where any series
 * has data (or at `opts.end`). Leading/trailing months where no series has
 * data are dropped. `arrays` may be one series, an array of series or an
 * object of series; the result keeps the same shape.
 *
 * @template T
 * @param {string[]} months
 * @param {T} arrays  (number|null)[] | (number|null)[][] | Record<string,(number|null)[]>
 * @param {string} [rangeKey='kaikki'] one of RANGE_KEYS
 * @param {{end?: string}} [opts] anchor month 'YYYY-MM' (clamped to the data)
 * @returns {{key: string, months: string[], series: T, start: number, end: number,
 *   intervals: number, complete: boolean, annualise: boolean}}
 *   `start`/`end` are indices into the input; `intervals` = months between first
 *   and last point; `complete` = the full requested range is covered;
 *   `annualise` = at least 12 intervals (shorter ranges show total change only).
 */
export function sliceRange(months, arrays, rangeKey = 'kaikki', { end: endYm } = {}) {
  if (!isRangeKey(rangeKey)) throw new RangeError(`Unknown range ${JSON.stringify(rangeKey)}`);
  const single = Array.isArray(arrays) && !arrays.some(Array.isArray);
  const list = single ? [arrays] : Array.isArray(arrays) ? arrays : Object.values(arrays ?? {});
  const hasData = (i) => list.some((a) => isNum(a?.[i]));

  let end = months.length - 1;
  if (endYm != null && months.length) end = Math.min(end, ymDiff(months[0], endYm));
  while (end >= 0 && !hasData(end)) end--;
  let first = 0;
  while (first <= end && !hasData(first)) first++;

  const span = RANGES[rangeKey];
  const start = end < 0 ? 0 : span == null ? first : Math.max(first, end - span);
  const pick = (a) => (end < 0 ? [] : (a ?? []).slice(start, end + 1));
  let series;
  if (single) series = pick(arrays);
  else if (Array.isArray(arrays)) series = arrays.map(pick);
  else series = Object.fromEntries(Object.entries(arrays ?? {}).map(([k, a]) => [k, pick(a)]));

  const intervals = end < 0 ? 0 : end - start;
  return {
    key: rangeKey,
    months: end < 0 ? [] : months.slice(start, end + 1),
    series: /** @type {any} */ (series),
    start,
    end,
    intervals,
    complete: end >= 0 && (span == null || intervals === span),
    annualise: intervals >= 12,
  };
}

/**
 * Arithmetic mean of the finite values; null when there are none.
 * @param {(number|null)[]} arr
 * @returns {number|null}
 */
export function mean(arr) {
  let sum = 0;
  let n = 0;
  for (const v of arr ?? []) {
    if (isNum(v)) {
      sum += v;
      n++;
    }
  }
  return n ? clean(sum / n) : null;
}

/**
 * Mean of the last `n` values ending at `endIndex` (default: latest value).
 * Returns null unless all `n` values exist (e.g. "12 kk keskiarvo").
 * @param {(number|null)[]} arr
 * @param {number} [n=12]
 * @param {number} [endIndex]
 */
export function trailingMean(arr, n = 12, endIndex = latestIndex(arr)) {
  if (endIndex < n - 1) return null;
  const win = arr.slice(endIndex - n + 1, endIndex + 1);
  return win.every(isNum) ? mean(win) : null;
}

const EPS = 1e-9;
/** Shared min/max scan; `better(a, b)` is true when a beats b. */
function extreme(months, arr, better) {
  let value = null;
  let indices = [];
  (arr ?? []).forEach((v, i) => {
    if (!isNum(v)) return;
    if (value !== null && Math.abs(v - value) < EPS) indices.push(i);
    else if (value === null || better(v, value)) {
      value = v;
      indices = [i];
    }
  });
  if (value === null) return null;
  return { value, indices, months: months ? indices.map((i) => months[i]) : [] };
}

/**
 * Minimum and every month where it occurs (ties included, oldest first).
 * @param {string[]|null} months
 * @param {(number|null)[]} arr
 * @returns {{value: number, indices: number[], months: string[]}|null}
 */
export function min(months, arr) {
  return extreme(months, arr, (a, b) => a < b);
}

/**
 * Maximum and every month where it occurs (ties included, oldest first).
 * @param {string[]|null} months
 * @param {(number|null)[]} arr
 * @returns {{value: number, indices: number[], months: string[]}|null}
 */
export function max(months, arr) {
  return extreme(months, arr, (a, b) => a > b);
}

/**
 * Average annual growth in % (geometric, CAGR) between two index values that
 * are `intervalsInMonths` months apart: ((last/first)^(12/intervals) − 1) × 100.
 * Example: 32.06 → 125.15 over 559 months ≈ 2.97 %/v.
 * Callers must not annualise ranges shorter than 12 months (show totalChange).
 * @param {number} first
 * @param {number} last
 * @param {number} intervalsInMonths number of months between the points (points − 1)
 * @returns {number|null}
 */
export function cagr(first, last, intervalsInMonths) {
  if (!isNum(first) || !isNum(last) || first <= 0 || last <= 0) return null;
  if (!isNum(intervalsInMonths) || intervalsInMonths <= 0) return null;
  return clean((Math.pow(last / first, 12 / intervalsInMonths) - 1) * 100);
}

/**
 * Total change in %: (last / first − 1) × 100.
 * @param {number} first
 * @param {number} last
 * @returns {number|null}
 */
export function totalChange(first, last) {
  if (!isNum(first) || !isNum(last) || first === 0) return null;
  return clean((last / first - 1) * 100);
}

/**
 * Price change in % between two index values (e.g. the real month-on-month
 * change "Hinnat kuukaudessa" from 125.38 → 125.15 ≈ −0.18 %).
 * @param {number} i0 earlier index value
 * @param {number} i1 later index value
 */
export function priceChangeFromIndex(i0, i1) {
  return totalChange(i0, i1);
}

/**
 * Percentage change series with a lag: lag 1 = month-on-month, 12 = annual.
 * Values are unrounded; null where either end is missing.
 * @param {(number|null)[]} arr index values
 * @param {number} [lag=1]
 * @returns {(number|null)[]}
 */
export function pctChangeSeries(arr, lag = 1) {
  return arr.map((v, i) => (i >= lag ? totalChange(arr[i - lag], v) : null));
}

/**
 * Rebase an index so that `indexArr[startIdx]` equals `base` (price-level
 * charts, "what 100 € buys now"). Nulls stay null; if the base value is
 * missing or zero every value is null.
 * @param {(number|null)[]} indexArr
 * @param {number} startIdx
 * @param {number} [base=100]
 * @returns {(number|null)[]}
 */
export function rebase(indexArr, startIdx, base = 100) {
  const b = indexArr[startIdx];
  if (!isNum(b) || b === 0) return indexArr.map(() => null);
  return indexArr.map((v) => (isNum(v) ? (v / b) * base : null));
}

/**
 * Calendar-year means of monthly annual rates. Intended for the current,
 * partial year (complete years come from the official annual tables).
 * Arrays are aligned with `years`.
 * @param {string[]} months
 * @param {(number|null)[]} yoy
 * @returns {{years: number[], values: number[], monthsCount: number[],
 *   spanStart: string[], spanEnd: string[], complete: boolean[]}}
 */
export function annualMeanOfMonthly(months, yoy) {
  const acc = new Map();
  months.forEach((ym, i) => {
    const v = yoy[i];
    if (!isNum(v)) return;
    const y = Number(ym.slice(0, 4));
    const a = acc.get(y) ?? { sum: 0, n: 0, first: ym, last: ym };
    a.sum += v;
    a.n++;
    a.last = ym;
    acc.set(y, a);
  });
  const years = [...acc.keys()].sort((a, b) => a - b);
  const rows = years.map((y) => acc.get(y));
  return {
    years,
    values: rows.map((a) => clean(a.sum / a.n)),
    monthsCount: rows.map((a) => a.n),
    spanStart: rows.map((a) => a.first),
    spanEnd: rows.map((a) => a.last),
    complete: rows.map((a) => a.n === 12),
  };
}

/** Inflation level bands for the neutral level dot (SPEC §5). */
export const LEVEL_BANDS = Object.freeze([
  { key: 'deflation', label: 'alle 0 %' },
  { key: 'low', label: '0–2 %' },
  { key: 'elevated', label: '2–4 %' },
  { key: 'high', label: 'yli 4 %' },
]);

/**
 * Level band of an inflation rate, judged on the value rounded to 1 decimal
 * so that the band matches the displayed number (1.96 → "2,0 %" → elevated).
 * < 0 deflation, < 2 low, < 4 elevated, otherwise high.
 * @param {number} v
 * @returns {'deflation'|'low'|'elevated'|'high'|null}
 */
export function levelBand(v) {
  const r = round(v, 1);
  if (r === null) return null;
  if (r < 0) return 'deflation';
  if (r < 2) return 'low';
  if (r < 4) return 'elevated';
  return 'high';
}

/**
 * Direction class of a change in %-points, judged on the value rounded to
 * 1 decimal (|d| < 0.05 → flat), so the class matches pp() output.
 * @param {number} d
 * @returns {'up'|'down'|'flat'|null} up = kiihtyi, down = hidastui
 */
export function deltaClass(d) {
  const r = round(d, 1);
  if (r === null) return null;
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
}

/**
 * Change of an annual rate in %-points, rounded without float noise:
 * ppChange(2.2, 2.1) → 0.1 (not 0.10000000000000009).
 * @param {number} latest
 * @param {number} prev
 * @param {number} [decimals=1]
 * @returns {number|null}
 */
export function ppChange(latest, prev, decimals = 1) {
  if (!isNum(latest) || !isNum(prev)) return null;
  return round(latest - prev, decimals);
}

/**
 * Align any number of monthly series onto one contiguous month axis covering
 * all of them (union); gaps are null.
 * @param {{months: string[], values: (number|null)[]}[]} list
 * @returns {{months: string[], values: (number|null)[][]}}
 */
export function alignMany(list) {
  const withData = list.filter((s) => s?.months?.length);
  if (!withData.length) return { months: [], values: list.map(() => []) };
  let start = withData[0].months[0];
  let end = withData[0].months[withData[0].months.length - 1];
  for (const s of withData) {
    if (s.months[0] < start) start = s.months[0];
    if (s.months[s.months.length - 1] > end) end = s.months[s.months.length - 1];
  }
  const n = ymDiff(start, end) + 1;
  const months = Array.from({ length: n }, (_, i) => ymAdd(start, i));
  const values = list.map((s) => {
    const out = new Array(n).fill(null);
    (s?.months ?? []).forEach((ym, i) => {
      const v = s.values?.[i];
      if (isNum(v)) out[ymDiff(start, ym)] = v;
    });
    return out;
  });
  return { months, values };
}

/**
 * Align two monthly series onto one contiguous month axis (union of months).
 * @param {string[]} monthsA
 * @param {(number|null)[]} arrA
 * @param {string[]} monthsB
 * @param {(number|null)[]} arrB
 * @returns {{months: string[], a: (number|null)[], b: (number|null)[]}}
 */
export function alignSeries(monthsA, arrA, monthsB, arrB) {
  const r = alignMany([
    { months: monthsA, values: arrA },
    { months: monthsB, values: arrB },
  ]);
  return { months: r.months, a: r.values[0], b: r.values[1] };
}

/**
 * Summary of one (already sliced) range for the chart stats list:
 * mean/min/max of the annual rates and total + average annual price change
 * from the index. `annual` is null for ranges under 12 months.
 * @param {string[]} months
 * @param {(number|null)[]} yoy annual rates
 * @param {(number|null)[]} [index] index values (same alignment)
 */
export function rangeStats(months, yoy, index) {
  const li = latestIndex(yoy);
  const i0 = firstIndex(index);
  const i1 = latestIndex(index);
  const intervals = i0 >= 0 && i1 > i0 ? i1 - i0 : 0;
  const total = intervals > 0 ? totalChange(index[i0], index[i1]) : null;
  return {
    start: months[0] ?? null,
    end: months[months.length - 1] ?? null,
    points: months.length,
    mean: mean(yoy),
    min: min(months, yoy),
    max: max(months, yoy),
    latest: li >= 0 ? { value: yoy[li], month: months[li] } : null,
    indexStart: i0 >= 0 ? months[i0] : null,
    indexEnd: i1 >= 0 ? months[i1] : null,
    intervals,
    total,
    annual: intervals >= 12 ? cagr(index[i0], index[i1], intervals) : null,
  };
}
