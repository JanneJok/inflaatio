/**
 * Small pure helpers shared by the source modules and the orchestrator.
 */
import { round, isNum, ymAdd, ymDiff } from '../../src/js/lib/format.js';

export { round, isNum };

/** Round to 1/2/3 decimals keeping null for missing values. */
export const r1 = (v) => (isNum(v) ? round(v, 1) : null);
export const r2 = (v) => (isNum(v) ? round(v, 2) : null);
export const r3 = (v) => (isNum(v) ? round(v, 3) : null);

/** Contiguous months from `a` to `b` inclusive ('YYYY-MM'). */
export function monthsBetween(a, b) {
  const n = ymDiff(a, b);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => ymAdd(a, i));
}

/** Contiguous quarters 'YYYY-Qn' from `a` to `b` inclusive. */
export function quartersBetween(a, b) {
  const q = (s) => {
    const m = String(s).match(/^(\d{4})-Q([1-4])$/);
    if (!m) throw new RangeError(`Invalid quarter ${s}`);
    return Number(m[1]) * 4 + Number(m[2]) - 1;
  };
  const out = [];
  for (let t = q(a); t <= q(b); t++) out.push(`${Math.floor(t / 4)}-Q${(t % 4) + 1}`);
  return out;
}

/** Contiguous years as strings. */
export function yearsBetween(a, b) {
  const out = [];
  for (let y = Number(a); y <= Number(b); y++) out.push(String(y));
  return out;
}

/**
 * Align a (periods, values) pair onto `target` periods; absent → null.
 * @param {string[]} target
 * @param {string[]} periods
 * @param {(number|null)[]} values
 * @param {(v:number|null)=>number|null} [fn] rounding / transform
 */
export function align(target, periods, values, fn = (v) => v) {
  const m = new Map();
  periods.forEach((p, i) => m.set(p, values[i]));
  return target.map((p) => {
    const v = m.get(p);
    return isNum(v) ? fn(v) : null;
  });
}

/** First and last period where any of the arrays has a value (null when none). */
export function dataSpan(periods, arrays) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < periods.length; i++) {
    if (arrays.some((a) => isNum(a?.[i]))) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : { first, last, start: periods[first], end: periods[last] };
}

/** Last period where `arr` has a value, or null. */
export function latestPeriod(periods, arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i])) return periods[i];
  return null;
}

/** Last value of `arr`, or null. */
export function latestValue(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (isNum(arr[i])) return arr[i];
  return null;
}

/**
 * Deterministic JSON for data files: objects are indented, arrays whose items
 * are all primitives stay on one line (keeps files small and diffs readable).
 * @param {unknown} value
 * @param {number} [indent=2]
 */
export function stringifyData(value, indent = 2) {
  const pad = (n) => ' '.repeat(n * indent);
  const prim = (v) => v === null || typeof v !== 'object';
  const enc = (v, level) => {
    if (v === undefined) return 'null';
    if (prim(v)) {
      if (typeof v === 'number' && !Number.isFinite(v)) return 'null';
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every(prim)) return `[${v.map((x) => enc(x, 0)).join(',')}]`;
      return `[\n${v.map((x) => pad(level + 1) + enc(x, level + 1)).join(',\n')}\n${pad(level)}]`;
    }
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    return `{\n${entries.map(([k, x]) => `${pad(level + 1)}${JSON.stringify(k)}: ${enc(x, level + 1)}`).join(',\n')}\n${pad(level)}}`;
  };
  return `${enc(value, 0)}\n`;
}

/** Canonical form for change detection (formatting-independent). */
export const canonical = (value) => stringifyData(value);

/**
 * Deep equality of two JSON values after removing volatile keys (timestamps).
 * @param {unknown} a
 * @param {unknown} b
 * @param {string[]} [ignoreKeys]
 */
export function sameContent(a, b, ignoreKeys = ['generatedAt', 'fetchedAt']) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !ignoreKeys.includes(k)).map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  return canonical(strip(a)) === canonical(strip(b));
}

/** Uppercase PxWeb main-group names → sentence case ('ASUMINEN, VESI' → 'Asuminen, vesi'). */
export function sentenceCase(s) {
  const t = String(s).trim();
  if (t !== t.toUpperCase()) return t;
  const lower = t.toLocaleLowerCase('fi-FI');
  return lower.charAt(0).toLocaleUpperCase('fi-FI') + lower.slice(1);
}
