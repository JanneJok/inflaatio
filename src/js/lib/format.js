/**
 * Finnish (fi-FI) formatting of numbers, months and dates.
 *
 * ISOMORPHIC: pure ESM without DOM or Node-only APIs. The build (server-side
 * rendering) and the browser import the same module, so numbers look identical
 * in static HTML and after JS updates.
 *
 * Conventions:
 * - decimal comma, U+2212 minus sign, NBSP (U+00A0) as thousands separator and
 *   before the units `%`, `%-yks.` and `€`; the hyphen of `%-yks.` is the
 *   non-breaking hyphen U+2011 (PP_UNIT), so running text never breaks the
 *   unit into "%-" / "yks.";
 * - rounding is "half away from zero" on the decimal value (2,25 → 2,3), after
 *   removing binary float noise (2.1499999999999995 → 2,15 → 2,2);
 * - a rounded zero never shows a minus sign (−0,04 → "0,0");
 * - missing values (null, undefined, NaN, ±Infinity, non-numbers) render as an
 *   en dash "–";
 * - months are 'YYYY-MM' strings and are parsed without `new Date('YYYY-MM')`
 *   (that is UTC and shows the previous month west of Greenwich).
 */

/** En dash shown for missing values. */
export const DASH = '–';
/** No-break space (U+00A0). */
export const NBSP = ' ';
/** Typographic minus sign (U+2212). */
export const MINUS = '−';
/** Non-breaking hyphen (U+2011): looks like "-", but a line never breaks after it. */
export const NB_HYPHEN = '‑';
/** Unit of percentage points: '%-yks.' with NB_HYPHEN (output of pp()). */
export const PP_UNIT = `%${NB_HYPHEN}yks.`;

/** Month names, nominative. Index 0 = January. */
export const MONTHS = Object.freeze([
  'tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu',
  'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu',
]);

/** Short month names (compound stem). Index 0 = January. */
export const MONTHS_SHORT = Object.freeze([
  'tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä',
  'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu',
]);

/** ASCII URL slugs of the months (kesakuu, heinakuu …). Index 0 = January. */
export const MONTH_SLUGS = Object.freeze(MONTHS.map((m) => m.replace(/ä/g, 'a').replace(/ö/g, 'o')));

const HELSINKI = 'Europe/Helsinki';
const YM_RE = /^(\d{4})-(\d{2})$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {unknown} v @returns {v is number} true for finite numbers only */
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Round half away from zero to `decimals`, ignoring binary float noise.
 * @param {number} v
 * @param {number} [decimals=0]
 * @returns {number|null} null when `v` is not a finite number; never −0
 */
export function round(v, decimals = 0) {
  if (!isNum(v)) return null;
  const f = 10 ** decimals;
  let x = Math.abs(v) * f;
  // 12 significant digits removes noise such as 21.499999999999996 → 21.5
  if (x < 1e11) x = Number(x.toPrecision(12));
  const r = (Math.sign(v) * Math.round(x)) / f;
  return r === 0 ? 0 : r;
}

const nfCache = new Map();
/** Cached Intl.NumberFormat('fi-FI') with a fixed number of decimals. */
function nf(decimals) {
  let f = nfCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('fi-FI', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    nfCache.set(decimals, f);
  }
  return f;
}

/**
 * Core number formatter. The sign is added manually so every engine yields
 * the same characters (U+2212 minus, '+', '±' for a signed zero).
 * @param {unknown} v
 * @param {number} decimals
 * @param {boolean} sign show '+' for positive and '±' for zero
 */
function fmt(v, decimals, sign) {
  const r = round(/** @type {number} */ (v), decimals);
  if (r === null) return DASH;
  // Normalise any whitespace the engine uses for grouping to NBSP.
  const body = nf(decimals).format(Math.abs(r)).replace(/[\s ]/g, NBSP);
  const s = r < 0 ? MINUS : sign ? (r > 0 ? '+' : '±') : '';
  return s + body;
}

/**
 * Plain number: num(1234.5, 1) → "1 234,5".
 * @param {number} v
 * @param {number} [decimals=0]
 * @param {{sign?: boolean}} [opts]
 */
export function num(v, decimals = 0, { sign = false } = {}) {
  return fmt(v, decimals, sign);
}

/**
 * Percentage: pct(2.2) → "2,2 %", pct(2.2, {sign:true}) → "+2,2 %",
 * pct(-0.2) → "−0,2 %", pct(0, {sign:true}) → "±0,0 %".
 * @param {number} v
 * @param {{decimals?: number, sign?: boolean}} [opts]
 */
export function pct(v, { decimals = 1, sign = false } = {}) {
  const s = fmt(v, decimals, sign);
  return s === DASH ? DASH : `${s}${NBSP}%`;
}

/**
 * Percentage points (difference of two rates): pp(0.1) → "+0,1 %-yks.",
 * pp(-0.1) → "−0,1 %-yks.", pp(0) → "±0,0 %-yks.". Signed by default.
 * The unit is PP_UNIT (non-breaking hyphen), so prose never wraps it as
 * "%-" / "yks.".
 * @param {number} v
 * @param {{decimals?: number, sign?: boolean}} [opts]
 */
export function pp(v, { decimals = 1, sign = true } = {}) {
  const s = fmt(v, decimals, sign);
  return s === DASH ? DASH : `${s}${NBSP}${PP_UNIT}`;
}

/**
 * Index point value (pisteluku), 2 decimals: idx(125.15) → "125,15".
 * @param {number} v
 * @param {number} [decimals=2]
 */
export function idx(v, decimals = 2) {
  return fmt(v, decimals, false);
}

/**
 * Euro amount: eur(1234.56) → "1 234,56 €", eur(12, 0) → "12 €".
 * @param {number} v
 * @param {number} [decimals=2]
 * @param {{sign?: boolean}} [opts]
 */
export function eur(v, decimals = 2, { sign = false } = {}) {
  const s = fmt(v, decimals, sign);
  return s === DASH ? DASH : `${s}${NBSP}€`;
}

/* ------------------------------------------------------------------ months */

/**
 * Parse 'YYYY-MM'. Throws RangeError on malformed input (a programming or
 * data-contract error, not a missing value).
 * @param {string} ym
 * @returns {{y: number, m: number}} m is 1–12
 */
export function parseYm(ym) {
  const match = typeof ym === 'string' ? ym.match(YM_RE) : null;
  const m = match ? Number(match[2]) : 0;
  if (!match || m < 1 || m > 12) throw new RangeError(`Invalid month ${JSON.stringify(ym)}, expected 'YYYY-MM'`);
  return { y: Number(match[1]), m };
}

/**
 * Build 'YYYY-MM' from a year and a month number (1–12).
 * @param {number} y
 * @param {number} m
 */
export function toYm(y, m) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/**
 * Add `n` months (may be negative): ymAdd('2026-01', -1) → '2025-12'.
 * @param {string} ym
 * @param {number} n
 */
export function ymAdd(ym, n) {
  const { y, m } = parseYm(ym);
  const t = y * 12 + (m - 1) + n;
  return toYm(Math.floor(t / 12), (((t % 12) + 12) % 12) + 1);
}

/**
 * Number of months from `a` to `b` (b − a): ymDiff('2025-08', '2026-08') → 12.
 * Invariant: ymAdd(a, ymDiff(a, b)) === b.
 * @param {string} a
 * @param {string} b
 */
export function ymDiff(a, b) {
  const A = parseYm(a);
  const B = parseYm(b);
  return (B.y - A.y) * 12 + (B.m - A.m);
}

/** Year of a 'YYYY-MM' (or 'YYYY-MM-DD') string as a number. @param {string} ym */
export function yearOf(ym) {
  return parseYm(String(ym).slice(0, 7)).y;
}

/** ASCII route slug of the month: monthSlug('2026-06') → 'kesakuu'. @param {string} ym */
export function monthSlug(ym) {
  return MONTH_SLUGS[parseYm(ym).m - 1];
}

/**
 * Month number (1–12) from a route slug; accepts 'kesakuu' and 'kesäkuu',
 * case-insensitive. Returns null for unknown slugs.
 * @param {string} slug
 * @returns {number|null}
 */
export function monthFromSlug(slug) {
  if (typeof slug !== 'string') return null;
  const s = slug.trim().toLowerCase();
  let i = MONTH_SLUGS.indexOf(s);
  if (i < 0) i = MONTHS.indexOf(s);
  return i < 0 ? null : i + 1;
}

/** Shared null handling for month formatters; `build(year, monthIndex0)`. */
function month(ym, build) {
  if (ym == null || ym === '') return DASH;
  const { y, m } = parseYm(ym);
  return build(y, m - 1);
}

/** Append the year unless `year` is false. */
const withYear = (s, y, year) => (year ? `${s} ${y}` : s);

/** monthName('2026-08') → 'elokuu 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function monthName(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(MONTHS[i], y, year));
}

/** monthNameOnly('2026-08') → 'elokuu'. @param {string} ym */
export function monthNameOnly(ym) {
  return monthName(ym, { year: false });
}

/** monthShort('2026-08') → 'elo 2026'; {year:false} → 'elo'. @param {string} ym @param {{year?: boolean}} [o] */
export function monthShort(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(MONTHS_SHORT[i], y, year));
}

/** Inessive ("in August"): inessive('2026-08') → 'elokuussa 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function inessive(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(`${MONTHS[i]}ssa`, y, year));
}

/** inessiveNoYear('2026-08') → 'elokuussa'. @param {string} ym */
export function inessiveNoYear(ym) {
  return inessive(ym, { year: false });
}

/** Elative ("from August"): elative('2026-08') → 'elokuusta 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function elative(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(`${MONTHS[i]}sta`, y, year));
}

/** Genitive ("of August"): genitive('2026-08') → 'elokuun 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function genitive(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(`${MONTHS[i]}n`, y, year));
}

/** Illative ("to August"): illative('2026-08') → 'elokuuhun 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function illative(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(`${MONTHS[i]}hun`, y, year));
}

const missing = (v) => v == null || v === '';

/**
 * Period between two months with years: monthRange('2025-09', '2026-08')
 * → 'syys 2025 – elo 2026'. A single month → 'elo 2026'.
 * @param {string} a
 * @param {string} b
 */
export function monthRange(a, b) {
  if (missing(a) || missing(b)) return DASH;
  return a === b ? monthShort(a) : `${monthShort(a)} ${DASH} ${monthShort(b)}`;
}

/**
 * Month span inside one year without the year: monthsSpan('2026-01', '2026-08')
 * → 'tammi–elo'; one month → 'tammi'. Spans across years fall back to monthRange().
 * @param {string} a
 * @param {string} b
 */
export function monthsSpan(a, b) {
  if (missing(a) || missing(b)) return DASH;
  const A = parseYm(a);
  const B = parseYm(b);
  if (A.y !== B.y) return monthRange(a, b);
  if (A.m === B.m) return MONTHS_SHORT[A.m - 1];
  return `${MONTHS_SHORT[A.m - 1]}${DASH}${MONTHS_SHORT[B.m - 1]}`;
}

/**
 * Label of a (possibly partial) year from its month span:
 * partialYear('2026-01', '2026-08') → '2026 (tammi–elo)'; a full year → '2026'.
 * @param {string} spanStart first month with data
 * @param {string} spanEnd last month with data
 */
export function partialYear(spanStart, spanEnd) {
  if (missing(spanStart) || missing(spanEnd)) return DASH;
  const A = parseYm(spanStart);
  const B = parseYm(spanEnd);
  if (A.y === B.y && A.m === 1 && B.m === 12) return String(A.y);
  return `${A.y} (${monthsSpan(spanStart, spanEnd)})`;
}

/** Capitalise the first character: capitalize('elokuu 2026') → 'Elokuu 2026'. @param {string} s */
export function capitalize(s) {
  return typeof s === 'string' && s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------------- dates */

let dtfDate;
let dtfDateTime;
/** Calendar parts of a Date in Europe/Helsinki as numbers. */
function helsinkiParts(d, withTime = false) {
  if (withTime) {
    dtfDateTime ??= new Intl.DateTimeFormat('en-GB', {
      timeZone: HELSINKI, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    });
  } else {
    dtfDate ??= new Intl.DateTimeFormat('en-GB', {
      timeZone: HELSINKI, year: 'numeric', month: 'numeric', day: 'numeric',
    });
  }
  const out = {};
  for (const p of (withTime ? dtfDateTime : dtfDate).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return /** @type {{year:number, month:number, day:number, hour?:number, minute?:number}} */ (out);
}

/** Coerce a Date, epoch ms or ISO string into a valid Date, else null. */
function toDate(v) {
  if (missing(v)) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Finnish date 'D.M.YYYY'. 'YYYY-MM-DD' strings are taken as calendar dates
 * (no time zone shift); timestamps and Date objects are shown in Helsinki time:
 * date('2026-09-14') → '14.9.2026', date('2026-09-14T22:30:00Z') → '15.9.2026'.
 * @param {string|number|Date} v
 */
export function date(v) {
  const m = typeof v === 'string' ? v.match(DATE_ONLY_RE) : null;
  if (m) return `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
  const d = toDate(v);
  if (!d) return DASH;
  const p = helsinkiParts(d);
  return `${p.day}.${p.month}.${p.year}`;
}

/**
 * Finnish date and time in Helsinki time: '14.9.2026 klo 8.00'.
 * @param {string|number|Date} v
 */
export function dateTime(v) {
  const d = toDate(v);
  if (!d) return DASH;
  const p = helsinkiParts(d, true);
  return `${p.day}.${p.month}.${p.year} klo ${p.hour}.${String(p.minute).padStart(2, '0')}`;
}

/**
 * ISO calendar date 'YYYY-MM-DD' in Helsinki time (default: now).
 * 'YYYY-MM-DD' strings are returned as such. Invalid input → null.
 * @param {string|number|Date} [v]
 * @returns {string|null}
 */
export function isoDate(v = new Date()) {
  if (typeof v === 'string' && DATE_ONLY_RE.test(v)) return v;
  const d = toDate(v);
  if (!d) return null;
  const p = helsinkiParts(d);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/* --------------------------------------------------------- English (en-GB) */
/*
 * The few English pages (/en/, the English calculators, English chart
 * tooltips) use these: en-GB digits (decimal point, comma grouping), U+2212
 * minus, '2.2%', '+0.1 pp', '€1,234.56', 'August 2026', '17 September 2026'.
 * Same rounding and missing-value rules as the Finnish formatters.
 */

/** English month names. Index 0 = January. */
export const EN_MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

/** English month abbreviations. Index 0 = January. */
export const EN_MONTHS_SHORT = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

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

/**
 * English number: enNum(1234.5, 1) → '1,234.5'; enNum(-0.2, 1) → '−0.2'.
 * @param {number} v
 * @param {number} [decimals=0]
 * @param {{sign?: boolean}} [opts]
 */
export function enNum(v, decimals = 0, { sign = false } = {}) {
  const r = round(/** @type {number} */ (v), decimals);
  if (r === null) return DASH;
  const s = r < 0 ? MINUS : sign ? (r > 0 ? '+' : '±') : '';
  return s + enBody(r, decimals);
}

/** enPct(2.2) → '2.2%'. @param {number} v @param {{decimals?: number, sign?: boolean}} [opts] */
export function enPct(v, { decimals = 1, sign = false } = {}) {
  const s = enNum(v, decimals, { sign });
  return s === DASH ? DASH : `${s}%`;
}

/** enPp(0.1) → '+0.1 pp' (NBSP). Signed by default. @param {number} v @param {{decimals?: number, sign?: boolean}} [opts] */
export function enPp(v, { decimals = 1, sign = true } = {}) {
  const s = enNum(v, decimals, { sign });
  return s === DASH ? DASH : `${s}${NBSP}pp`;
}

/** enEur(1234.56) → '€1,234.56'. @param {number} v @param {number} [decimals=2] @param {{sign?: boolean}} [opts] */
export function enEur(v, decimals = 2, { sign = false } = {}) {
  const r = round(/** @type {number} */ (v), decimals);
  if (r === null) return DASH;
  const s = r < 0 ? MINUS : sign ? (r > 0 ? '+' : '±') : '';
  return `${s}€${enBody(r, decimals)}`;
}

/** enMonthName('2026-08') → 'August 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function enMonthName(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(EN_MONTHS[i], y, year));
}

/** enMonthShort('2026-08') → 'Aug 2026'. @param {string} ym @param {{year?: boolean}} [o] */
export function enMonthShort(ym, { year = true } = {}) {
  return month(ym, (y, i) => withYear(EN_MONTHS_SHORT[i], y, year));
}

/**
 * English date '17 September 2026' (same time-zone rules as date()).
 * @param {string|number|Date} v
 */
export function enDate(v) {
  const iso = missing(v) ? null : isoDate(v);
  if (!iso) return DASH;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}
