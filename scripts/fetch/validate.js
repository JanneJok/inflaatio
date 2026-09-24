/**
 * Validation of fetched series before anything is written to data/.
 *
 * A source whose data fails validation is NOT written (the previous file is
 * kept) and the run exits with code 1. Rules (see docs/DATA.md):
 *   - periods are well-formed, strictly ascending and contiguous;
 *   - every array is aligned with its periods (same length);
 *   - values are finite numbers or null (never undefined/NaN/strings);
 *   - value ranges are sane (annual rates −5…30 %, indices > 0, prices > 0 …);
 *   - no zero used as "missing" (a 0 index, or a 0 rate where the index is missing);
 *   - the latest period never moves backwards compared with the previous file;
 *   - KHI and YKHI are fresh: latest month at most 75 days old.
 */
import { isNum, parseYm, ymDiff } from '../../src/js/lib/format.js';

export class ValidationError extends Error {
  /** @param {string} source @param {string[]} problems */
  constructor(source, problems) {
    const shown = problems.slice(0, 12);
    const more = problems.length > shown.length ? `\n  … and ${problems.length - shown.length} more` : '';
    super(`${source}: validation failed:\n  - ${shown.join('\n  - ')}${more}`);
    this.name = 'ValidationError';
    this.source = source;
    this.problems = problems;
  }
}

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const Q_RE = /^\d{4}-Q[1-4]$/;
const Y_RE = /^\d{4}$/;

/** Ordinal of a period for contiguity checks. */
function ordinal(p, kind) {
  if (kind === 'M') {
    const { y, m } = parseYm(p);
    return y * 12 + m - 1;
  }
  if (kind === 'Q') return Number(p.slice(0, 4)) * 4 + Number(p.slice(6)) - 1;
  return Number(p);
}

/** Accumulates problems for one source; `done()` throws if any. */
export class Checker {
  /** @param {string} source */
  constructor(source) {
    this.source = source;
    this.problems = [];
  }

  fail(msg) {
    this.problems.push(msg);
    return this;
  }

  /**
   * Periods well-formed, strictly ascending and contiguous.
   * @param {string} name
   * @param {unknown} periods
   * @param {'M'|'Q'|'A'} [kind='M']
   */
  periods(name, periods, kind = 'M') {
    if (!Array.isArray(periods) || !periods.length) return this.fail(`${name}: no periods`);
    const re = kind === 'M' ? YM_RE : kind === 'Q' ? Q_RE : Y_RE;
    const bad = periods.find((p) => typeof p !== 'string' || !re.test(p));
    if (bad !== undefined) return this.fail(`${name}: malformed period ${JSON.stringify(bad)} (expected ${kind === 'M' ? 'YYYY-MM' : kind === 'Q' ? 'YYYY-Qn' : 'YYYY'})`);
    for (let i = 1; i < periods.length; i++) {
      const d = ordinal(periods[i], kind) - ordinal(periods[i - 1], kind);
      if (d <= 0) return this.fail(`${name}: periods not strictly ascending at ${periods[i - 1]} → ${periods[i]}`);
      if (d !== 1) return this.fail(`${name}: gap between ${periods[i - 1]} and ${periods[i]} (periods must be contiguous)`);
    }
    return this;
  }

  /**
   * Array aligned with `periods`; values finite numbers or null; range rules.
   * @param {string} name
   * @param {unknown} arr
   * @param {number} length expected length
   * @param {{min?: number, max?: number, positive?: boolean, required?: boolean}} [rule]
   */
  values(name, arr, length, { min = -Infinity, max = Infinity, positive = false, required = true } = {}) {
    if (!Array.isArray(arr)) return this.fail(`${name}: not an array`);
    if (arr.length !== length) this.fail(`${name}: length ${arr.length} ≠ ${length} periods (arrays must be aligned)`);
    let n = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null) continue;
      if (!isNum(v)) {
        this.fail(`${name}[${i}]: ${JSON.stringify(v)} is not a finite number or null`);
        continue;
      }
      n++;
      if (positive && !(v > 0)) this.fail(`${name}[${i}]: ${v} must be > 0${v === 0 ? ' (zero used as missing? use null)' : ''}`);
      if (v < min || v > max) this.fail(`${name}[${i}]: ${v} outside ${min}…${max}`);
    }
    if (required && n === 0) this.fail(`${name}: no values`);
    return this;
  }

  /** A rate that is exactly 0 while the paired index is missing looks like zero-as-missing. */
  noZeroAsMissing(name, rates, index) {
    if (!Array.isArray(rates) || !Array.isArray(index)) return this;
    const hasIndex = index.some(isNum);
    if (!hasIndex) return this;
    rates.forEach((v, i) => {
      if (v === 0 && index[i] === null && isNum(index[i - 1])) this.fail(`${name}[${i}]: 0 while index is missing (zero used as missing?)`);
    });
    return this;
  }

  /** Latest period must not move backwards. */
  notOlder(name, latest, prevLatest) {
    if (latest && prevLatest && String(latest) < String(prevLatest)) {
      this.fail(`${name}: latest period ${latest} is older than the previous file's ${prevLatest}`);
    }
    return this;
  }

  /**
   * Annual rates consistent with the index (|computed − official| ≤ tol, pp).
   * Only months where both index values exist are compared.
   */
  consistent(name, months, yoy, index, tol = 0.2) {
    if (!Array.isArray(index) || !Array.isArray(yoy)) return this;
    let bad = 0;
    let example = '';
    for (let i = 12; i < months.length; i++) {
      const a = index[i - 12];
      const b = index[i];
      const r = yoy[i];
      if (!isNum(a) || !isNum(b) || !isNum(r) || a <= 0) continue;
      const computed = (b / a - 1) * 100;
      if (Math.abs(computed - r) > tol) {
        bad++;
        example ||= `${months[i]}: official ${r} vs index ${computed.toFixed(2)}`;
      }
    }
    if (bad) this.fail(`${name}: ${bad} month(s) where the annual rate and the index disagree by > ${tol} pp (e.g. ${example})`);
    return this;
  }

  done() {
    if (this.problems.length) throw new ValidationError(this.source, this.problems);
    return true;
  }
}

/** Convenience wrapper: `check(source, c => c.periods(…).values(…))`. */
export function check(source, fn) {
  const c = new Checker(source);
  fn(c);
  return c.done();
}

/**
 * Validate a monthly series object in one go.
 * @param {string} source
 * @param {{months: string[], arrays: Record<string, (number|null)[]>, rules?: Record<string, {min?: number, max?: number, positive?: boolean, required?: boolean}>,
 *   prevLatest?: string|null, latest?: string|null}} spec
 */
export function assertSeries(source, { months, arrays, rules = {}, prevLatest = null, latest = null }) {
  return check(source, (c) => {
    c.periods(`${source}.months`, months, 'M');
    for (const [k, arr] of Object.entries(arrays)) c.values(`${source}.${k}`, arr, months?.length ?? 0, rules[k] ?? {});
    c.notOlder(source, latest ?? months?.at(-1), prevLatest);
  });
}

/** Age in days of a 'YYYY-MM' month, measured from the 15th of that month (UTC). */
export function ageDays(ym, today = new Date()) {
  const { y, m } = parseYm(ym);
  return (today.getTime() - Date.UTC(y, m - 1, 15)) / 86_400_000;
}

/**
 * Freshness: the latest month may be at most `maxDays` old (default 75).
 * KHI for month M is published ~14th of M+1 and the YKHI flash at the end
 * of M, so in normal operation the age stays below ~62 days.
 * @returns {{ok: boolean, ageDays: number, message: string}}
 */
export function freshness(label, latestYm, { maxDays = 75, today = new Date() } = {}) {
  if (!latestYm) return { ok: false, ageDays: Infinity, message: `${label}: no data` };
  const age = ageDays(latestYm, today);
  const ok = age <= maxDays;
  return {
    ok,
    ageDays: Math.round(age),
    message: ok
      ? `${label}: latest ${latestYm} (${Math.round(age)} days)`
      : `${label}: latest month ${latestYm} is ${Math.round(age)} days old (limit ${maxDays}) — source stopped updating or the fetcher is broken`,
  };
}

/** Months between two 'YYYY-MM' strings (re-export for callers). */
export { ymDiff };
