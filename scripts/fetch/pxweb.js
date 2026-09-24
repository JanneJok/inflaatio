/**
 * Tilastokeskus PxWeb v1 client (https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/…).
 *
 * Tilastokeskus has renamed tables, variables and content codes before (2026:
 * long ids `statfin_khi_pxt_122p.px` → `122p.px`, `Kuukausi` → `timeperiod_m`,
 * `Tiedot` → `contentscode`). Therefore every query is built from metadata
 * discovered at run time:
 *   1. list the database folder (GET …/StatFin/khi/) and resolve the table by
 *      its id, falling back to a title pattern if the id disappeared;
 *   2. GET the table metadata and pick variables/values by code or label
 *      patterns (never by position);
 *   3. POST the query and parse the json-stat2 response.
 *
 * API limits (GET …/api/v1/fi/?config): 120 000 cells per query and 40 calls
 * per 60 s. All calls go through one shared limiter (30 calls / 60 s, two in
 * flight) and large queries are split automatically.
 */
import { getJson, postJson } from './http.js';
import { parseJsonStat, normaliseTime } from './jsonstat.js';

export const PXWEB_BASE = 'https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin';
export const MAX_CELLS = 100_000; // API limit is 120 000; keep a margin

/** Sliding-window rate limiter with a concurrency cap. */
export class RateLimiter {
  /** @param {{maxCalls?: number, windowMs?: number, concurrency?: number, now?: () => number, sleep?: (ms:number)=>Promise<void>}} [o] */
  constructor({ maxCalls = 30, windowMs = 60_000, concurrency = 2, now = Date.now, sleep } = {}) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.concurrency = concurrency;
    this.now = now;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.stamps = [];
    this.active = 0;
    this.queue = [];
  }

  /** Run `fn` when a slot is free. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  schedule(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.#pump();
    });
  }

  async #pump() {
    if (this.active >= this.concurrency || !this.queue.length) return;
    this.active++;
    const job = this.queue.shift();
    try {
      for (;;) {
        const t = this.now();
        this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
        if (this.stamps.length < this.maxCalls) break;
        await this.sleep(this.windowMs - (t - this.stamps[0]) + 50);
      }
      this.stamps.push(this.now());
      job.resolve(await job.fn());
    } catch (e) {
      job.reject(e);
    } finally {
      this.active--;
      this.#pump();
    }
  }
}

/** Shared limiter for every PxWeb call made by this process. */
export const pxLimiter = new RateLimiter();

const listCache = new Map();
const metaCache = new Map();

/**
 * List the tables of a database folder, e.g. listTables('khi').
 * @returns {Promise<{id: string, text: string, updated: string|null}[]>}
 */
export async function listTables(db, opts = {}) {
  const url = `${PXWEB_BASE}/${db}/`;
  if (!listCache.has(url)) {
    listCache.set(url, pxLimiter.schedule(() => getJson(url, { label: `PxWeb ${db}`, ...opts })).catch((e) => {
      listCache.delete(url);
      throw e;
    }));
  }
  const list = await listCache.get(url);
  if (!Array.isArray(list)) throw new Error(`PxWeb ${db}: unexpected table list response`);
  return list.filter((t) => t.type === 't' || /\.px$/i.test(t.id)).map((t) => ({ id: String(t.id), text: String(t.text ?? ''), updated: t.updated ?? null }));
}

/**
 * Resolve a table in `db` by id (e.g. '122p') or, if that id no longer
 * exists, by a title pattern. Throws with the list of available tables.
 * @param {string} db
 * @param {{id?: string, title?: RegExp}} spec
 * @returns {Promise<{id: string, text: string, updated: string|null, url: string, renamed: boolean}>}
 */
export async function resolveTable(db, { id, title }, opts = {}) {
  const tables = await listTables(db, opts);
  const want = id ? (id.endsWith('.px') ? id : `${id}.px`) : null;
  let t = want ? tables.find((x) => x.id.toLowerCase() === want.toLowerCase()) : null;
  let renamed = false;
  if (!t && title) {
    const hits = tables.filter((x) => title.test(x.text));
    if (hits.length > 1) throw new Error(`PxWeb ${db}: title ${title} matches several tables: ${hits.map((h) => h.id).join(', ')}`);
    t = hits[0];
    renamed = Boolean(t && want);
  }
  if (!t) {
    throw new Error(`PxWeb ${db}: table ${want ?? title} not found. Available: ${tables.map((x) => `${x.id} (${x.text.slice(0, 60)})`).join('; ')}`);
  }
  return { ...t, url: `${PXWEB_BASE}/${db}/${t.id}`, renamed };
}

/**
 * Table metadata (GET on the table URL).
 * @returns {Promise<{title: string, variables: {code: string, text: string, values: string[], valueTexts: string[], time?: boolean, elimination?: boolean}[]}>}
 */
export async function getMetadata(url, opts = {}) {
  if (!metaCache.has(url)) {
    metaCache.set(url, pxLimiter.schedule(() => getJson(url, { label: 'PxWeb metadata', ...opts })).then((meta) => {
      if (!Array.isArray(meta?.variables)) throw new Error(`PxWeb: no variables in metadata of ${url}`);
      return meta;
    }).catch((e) => {
      metaCache.delete(url);
      throw e;
    }));
  }
  return metaCache.get(url);
}

const matches = (pattern, s) => (pattern instanceof RegExp ? pattern.test(s) : s === pattern);

/**
 * Find a variable by `time: true`, a code pattern or a label pattern.
 * @param {{variables: any[]}} meta
 * @param {{time?: boolean, code?: RegExp|string, text?: RegExp|string}} spec
 */
export function findVariable(meta, spec) {
  const v = meta.variables.find((x) =>
    (spec.time ? x.time === true || /^timeperiod|^(kuukausi|vuosi|vuosineljännes)$/i.test(x.code) : true)
    && (spec.code ? matches(spec.code, x.code) : true)
    && (spec.text ? matches(spec.text, x.text) : true));
  if (!v) {
    throw new Error(`PxWeb: variable ${JSON.stringify({ ...spec, code: String(spec.code ?? ''), text: String(spec.text ?? '') })} not found; variables: ${meta.variables.map((x) => `${x.code} (${x.text})`).join(', ')}`);
  }
  return v;
}

/**
 * Values of a variable whose code or label matches. With `required`, throws
 * when nothing matches (listing what exists).
 * @returns {{code: string, text: string}[]}
 */
export function findValues(variable, { code, text, required = true } = {}) {
  const out = [];
  variable.values.forEach((c, i) => {
    const t = variable.valueTexts?.[i] ?? c;
    if ((code ? matches(code, c) : true) && (text ? matches(text, t) : true)) out.push({ code: c, text: t });
  });
  if (required && !out.length) {
    throw new Error(`PxWeb: no value of ${variable.code} matches ${String(code ?? '')} ${String(text ?? '')}; values: ${variable.values.slice(0, 30).map((c, i) => `${c}=${variable.valueTexts?.[i]}`).join(', ')}`);
  }
  return out;
}

/** Exactly one matching value (throws otherwise). */
export function findValue(variable, spec) {
  const hits = findValues(variable, spec);
  if (hits.length !== 1) throw new Error(`PxWeb: expected one value of ${variable.code} for ${String(spec.code ?? spec.text)}, got ${hits.map((h) => h.code).join(', ')}`);
  return hits[0];
}

/**
 * Merge datasets that were split along `splitDim` into one reader.
 * @param {ReturnType<typeof parseJsonStat>[]} parts
 * @param {string} splitDim
 */
export function mergeParts(parts, splitDim) {
  if (parts.length === 1) return parts[0];
  const owner = new Map();
  for (const p of parts) for (const c of p.dims[splitDim].codes) owner.set(c, p);
  const first = parts[0];
  const codes = parts.flatMap((p) => p.dims[splitDim].codes);
  const labels = Object.assign({}, ...parts.map((p) => p.dims[splitDim].labels));
  return {
    ...first,
    updated: parts.map((p) => p.updated).filter(Boolean).sort().at(-1) ?? null,
    sizes: first.ids.map((id, k) => (id === splitDim ? codes.length : first.sizes[k])),
    dims: { ...first.dims, [splitDim]: { ...first.dims[splitDim], codes, labels, position: Object.fromEntries(codes.map((c, i) => [c, i])) } },
    get: (coords) => owner.get(coords[splitDim])?.get(coords) ?? null,
    statusAt: (coords) => owner.get(coords[splitDim])?.statusAt(coords) ?? null,
  };
}

/**
 * POST a query. `selections` maps variable code → array of value codes
 * (or {filter, values}). Queries above MAX_CELLS are split along the
 * largest non-time selection and merged transparently.
 * @param {string} url table URL
 * @param {Record<string, string[] | {filter: string, values: string[]}>} selections
 * @param {{maxCells?: number, timeVar?: string, label?: string}} [opts]
 * @returns {Promise<ReturnType<typeof parseJsonStat>>}
 */
export async function query(url, selections, opts = {}) {
  const { maxCells = MAX_CELLS, timeVar, label = 'PxWeb', ...httpOpts } = opts;
  const norm = Object.entries(selections).map(([code, sel]) => {
    const s = Array.isArray(sel) ? { filter: 'item', values: sel } : sel;
    return { code, selection: { filter: s.filter, values: s.values.map(String) } };
  });
  const countOf = (q) => (q.selection.filter === 'item' ? q.selection.values.length : q.selection.filter === 'top' ? Number(q.selection.values[0]) : Infinity);
  const cells = norm.reduce((n, q) => n * countOf(q), 1);

  const run = (q) => pxLimiter.schedule(() => postJson(url, { query: q, response: { format: 'json-stat2' } }, { label, ...httpOpts }))
    .then(parseJsonStat);

  if (!Number.isFinite(cells) || cells <= maxCells) return run(norm);

  // Split along the largest 'item' selection that is not the time variable.
  const splittable = norm.filter((q) => q.selection.filter === 'item' && q.code !== timeVar).sort((a, b) => b.selection.values.length - a.selection.values.length)[0];
  if (!splittable) throw new Error(`${label}: query of ${cells} cells exceeds ${maxCells} and cannot be split`);
  const per = Math.max(1, Math.floor(maxCells / (cells / splittable.selection.values.length)));
  const parts = [];
  for (let i = 0; i < splittable.selection.values.length; i += per) {
    const chunk = splittable.selection.values.slice(i, i + per);
    parts.push(await run(norm.map((q) => (q === splittable ? { code: q.code, selection: { filter: 'item', values: chunk } } : q))));
  }
  return mergeParts(parts, splittable.code);
}

/** PxWeb time code → contract period ('2026M08' → '2026-08', '2026Q2' → '2026-Q2'). */
export const pxTime = normaliseTime;

/**
 * Human-readable source URL of a table in the StatFin web UI.
 * @param {string} db e.g. 'khi'
 * @param {string} tableId e.g. '122p.px'
 */
export function tableWebUrl(db, tableId) {
  return `https://pxdata.stat.fi/PxWeb/pxweb/fi/StatFin/StatFin__${db}/${tableId.replace(/\.px$/i, '')}.px/`;
}

/** Reset caches (tests). */
export function _resetCaches() {
  listCache.clear();
  metaCache.clear();
}
