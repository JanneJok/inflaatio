/**
 * Eurostat Statistics API client (JSON-stat 2.0).
 * https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?format=JSON&lang=en&…
 *
 * Dimension names and codes have changed before (January 2026: ECOICOP ver.2,
 * `coicop` → `coicop18`, prc_hicp_manr/midx frozen and replaced by
 * prc_hicp_minr; EA composition EA20 → EA21). The client therefore:
 *   - probes the dataset with `lastTimePeriod=1` and reads the dimension ids
 *     and category codes/labels before the real query;
 *   - picks codes by exact code first and by label pattern as a fallback;
 *   - on "dataset not found" searches Eurostat's table of contents for a
 *     successor whose title matches a pattern (the newest one wins);
 *   - surfaces Eurostat's error label (e.g. "Dimension \"COICOP\" is not
 *     defined") in the thrown message.
 */
import { getJson, getText, HttpError } from './http.js';
import { parseJsonStat } from './jsonstat.js';

export const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
export const EUROSTAT_TOC = 'https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc/txt?lang=en';

/**
 * Build a data URL. Array values repeat the parameter (geo=FI&geo=EA).
 * @param {string} dataset
 * @param {Record<string, string|number|(string|number)[]|undefined>} params
 */
export function buildUrl(dataset, params = {}) {
  const sp = new URLSearchParams({ format: 'JSON', lang: 'en' });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    for (const x of Array.isArray(v) ? v : [v]) sp.append(k, String(x));
  }
  return `${EUROSTAT_BASE}/${encodeURIComponent(dataset)}?${sp}`;
}

/** Eurostat error label from an error body, if any. */
export function errorLabel(body) {
  try {
    const j = typeof body === 'string' ? JSON.parse(body) : body;
    const e = Array.isArray(j?.error) ? j.error[0] : j?.error;
    return e?.label ? String(e.label) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch and parse a dataset query.
 * @returns {Promise<ReturnType<typeof parseJsonStat> & {url: string}>}
 */
export async function fetchDataset(dataset, params, opts = {}) {
  const url = buildUrl(dataset, params);
  let json;
  try {
    json = await getJson(url, { label: `Eurostat ${dataset}`, ...opts });
  } catch (e) {
    if (e instanceof HttpError) {
      const label = errorLabel(e.body);
      if (label) e.message = `Eurostat ${dataset}: HTTP ${e.status}: ${label} (${url})`;
    }
    throw e;
  }
  if (json?.error) throw new Error(`Eurostat ${dataset}: ${errorLabel(json) ?? 'error'} (${url})`);
  return Object.assign(parseJsonStat(json), { url });
}

/** True when an error means "dataset does not exist". */
export const isNotFound = (e) => e instanceof HttpError && e.status === 404;

/**
 * Parse Eurostat's TOC text (tab-separated, quoted) into rows.
 * @param {string} text
 * @returns {{title: string, code: string, type: string, lastUpdate: string, dataStart: string, dataEnd: string}[]}
 */
export function parseToc(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const cells = line.split('\t').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cells.length < 7 || cells[2] !== 'dataset') continue;
    rows.push({ title: cells[0], code: cells[1], type: cells[2], lastUpdate: cells[3], dataStart: cells[5], dataEnd: cells[6] });
  }
  return rows;
}

/**
 * Find the successor of a retired dataset from the TOC: datasets whose title
 * matches `titlePattern`, newest data end first.
 */
export async function findSuccessor(titlePattern, opts = {}) {
  const { text } = await getText(EUROSTAT_TOC, { label: 'Eurostat TOC', ...opts });
  const hits = parseToc(text).filter((r) => titlePattern.test(r.title));
  hits.sort((a, b) => b.dataEnd.localeCompare(a.dataEnd));
  return hits[0]?.code ?? null;
}

/**
 * Resolve a dataset code: try the candidates in order, and if all are gone,
 * search the TOC. Returns the working code and a probe (lastTimePeriod=1)
 * restricted by `probeParams` so the response stays small.
 * @param {string[]} candidates
 * @param {{titlePattern?: RegExp, probeParams?: Record<string, any>}} [o]
 */
export async function resolveDataset(candidates, { titlePattern, probeParams = {} } = {}, opts = {}) {
  const tried = [];
  for (const code of candidates) {
    try {
      const probe = await fetchDataset(code, { ...probeParams, lastTimePeriod: 1 }, opts);
      return { code, probe, replaced: tried.length > 0 };
    } catch (e) {
      if (!isNotFound(e)) throw e;
      tried.push(code);
    }
  }
  if (titlePattern) {
    const code = await findSuccessor(titlePattern, opts);
    if (code && !tried.includes(code)) {
      const probe = await fetchDataset(code, { ...probeParams, lastTimePeriod: 1 }, opts);
      return { code, probe, replaced: true };
    }
  }
  throw new Error(`Eurostat: none of the datasets ${tried.join(', ')} exist and no successor matched ${titlePattern ?? '(no pattern)'}`);
}

/**
 * Find a dimension id by pattern (e.g. /^coicop/i).
 * @param {{ids: string[]}} ds
 * @param {RegExp} pattern
 */
export function findDim(ds, pattern) {
  const id = ds.ids.find((x) => pattern.test(x));
  if (!id) throw new Error(`Eurostat: no dimension matching ${pattern} (dimensions: ${ds.ids.join(', ')})`);
  return id;
}

/**
 * Pick a category code: exact `code` candidates first, then a `label` pattern.
 * @param {{dims: Record<string, {codes: string[], labels: Record<string,string>}>}} ds
 * @param {string} dim
 * @param {{codes?: string[], label?: RegExp, required?: boolean}} spec
 * @returns {string|null}
 */
export function pickCode(ds, dim, { codes = [], label, required = true }) {
  const d = ds.dims[dim];
  if (!d) throw new Error(`Eurostat: dimension ${dim} missing`);
  for (const c of codes) if (d.codes.includes(c)) return c;
  if (label) {
    const hit = d.codes.find((c) => label.test(d.labels[c]));
    if (hit) return hit;
  }
  if (!required) return null;
  throw new Error(`Eurostat: no ${dim} category ${codes.join('/')} ${label ?? ''}; available: ${d.codes.slice(0, 40).map((c) => `${c}=${d.labels[c]}`).join(', ')}`);
}

/** Eurostat observation flags (subset) — for documentation and labels. */
export const FLAG_LABELS = Object.freeze({
  p: 'provisional',
  e: 'estimated',
  b: 'break in time series',
  c: 'confidential',
  d: 'definition differs',
  u: 'low reliability',
  s: 'Eurostat estimate',
  f: 'forecast',
});
