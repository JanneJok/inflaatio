/**
 * ECB Data Portal API client (https://data-api.ecb.europa.eu/service/data/<flow>/<key>).
 * Uses `format=csvdata&detail=dataonly`, which returns one row per
 * observation with the columns KEY, dimension codes, TIME_PERIOD, OBS_VALUE.
 * Series keys can be retired; callers pass candidate keys in order and the
 * first one that exists is used.
 */
import { getText, HttpError } from './http.js';

export const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data';

/**
 * RFC 4180-style CSV parser (quoted fields, doubled quotes, CRLF).
 * @param {string} text
 * @returns {Record<string,string>[]} rows keyed by the header
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * Fetch one series. Tries `keys` in order ('FM/B.U2.EUR.4F.KR.DFR.LEV', …).
 * @param {string[]} keys flow/key strings
 * @param {{startPeriod?: string}} [params]
 * @returns {Promise<{key: string, url: string, updated: string|null, observations: {period: string, value: number}[]}>}
 */
export async function fetchSeries(keys, params = {}, opts = {}) {
  const errors = [];
  for (const key of keys) {
    const sp = new URLSearchParams({ format: 'csvdata', detail: 'dataonly' });
    if (params.startPeriod) sp.set('startPeriod', params.startPeriod);
    const url = `${ECB_BASE}/${key}?${sp}`;
    try {
      const { text, headers } = await getText(url, { label: `ECB ${key}`, headers: { accept: 'text/csv' }, ...opts });
      const rows = parseCsv(text);
      if (!rows.length) throw new Error(`ECB ${key}: empty response`);
      if (!('TIME_PERIOD' in rows[0]) || !('OBS_VALUE' in rows[0])) {
        throw new Error(`ECB ${key}: unexpected CSV columns ${Object.keys(rows[0]).join(', ')}`);
      }
      const observations = rows
        .map((r) => ({ period: r.TIME_PERIOD.trim(), value: r.OBS_VALUE.trim() === '' ? null : Number(r.OBS_VALUE) }))
        .filter((o) => o.period && Number.isFinite(o.value))
        .sort((a, b) => a.period.localeCompare(b.period));
      const lm = headers?.get?.('last-modified');
      const updated = lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm).toISOString() : null;
      return { key, url: `${ECB_BASE}/${key}`, updated, observations };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        errors.push(`${key}: not found`);
        continue;
      }
      throw e;
    }
  }
  throw new Error(`ECB: no series found (${errors.join('; ')}). Look up the current key at https://data.ecb.europa.eu/`);
}
