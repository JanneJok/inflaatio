/**
 * Release calendar → src/content/julkaisukalenteri.json
 *   [{ date, time, source: 'khi'|'ykhi-ennakko'|'ykhi', period, label, publisher, url }]
 *
 * Sources (official calendars only, nothing guessed):
 *   - Tilastokeskus: the KHI statistic page https://stat.fi/fi/tilasto/khi embeds
 *     the upcoming releases (workingTitle + plannedReleaseDate) of the next
 *     ~2 months: "Kuluttajahintaindeksi 2026, syyskuu" and
 *     "Yhdenmukaistettu kuluttajahintaindeksi 2026, syyskuu, ennakko".
 *   - Eurostat: the release calendar JSON behind
 *     https://ec.europa.eu/eurostat/news/release-calendar (euro indicators):
 *     "Flash estimate inflation euro area" (flash, includes Finland) and
 *     "Inflation (HICP)" (full release), published for the calendar year.
 * The page scraping is best effort: a failure is reported as a warning and
 * the existing file is kept. Entries already in the file are kept unless an
 * official source gives a new date for the same (source, period).
 */
import { getText, getJson } from './http.js';
import { monthName, isoDate } from '../../src/js/lib/format.js';

export const STATFI_URL = 'https://stat.fi/fi/tilasto/khi';
export const EUROSTAT_CAL = 'https://ec.europa.eu/eurostat/o/calendars/eventsJson';
export const EUROSTAT_CAL_PAGE = 'https://ec.europa.eu/eurostat/news/release-calendar';

const FI_MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Helsinki local date and HH:MM of an ISO timestamp. */
export function helsinki(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export const LABELS = {
  khi: (p) => `Kuluttajahintaindeksi, ${monthName(p)}`,
  'ykhi-ennakko': (p) => `YKHI-ennakko, ${monthName(p)}`,
  ykhi: (p) => `YKHI, lopulliset luvut, ${monthName(p)}`,
};

/**
 * Parse the publications embedded in the stat.fi statistic page (Next.js
 * flight data with escaped quotes).
 * @param {string} html
 * @returns {{source: string, period: string, iso: string, title: string}[]}
 */
export function parseStatFi(html) {
  const text = String(html).replace(/\\"/g, '"');
  const re = /"workingTitle":"([^"]+)","published":(true|false)[^{}]*?"plannedReleaseDate":"([^"]+)"/g;
  const out = [];
  for (const m of text.matchAll(re)) {
    const [, title, published, iso] = m;
    if (published === 'true') continue;
    const k = title.match(/^Kuluttajahintaindeksi (\d{4}), ([a-zäö]+)$/i);
    const y = title.match(/^Yhdenmukaistettu kuluttajahintaindeksi (\d{4}), ([a-zäö]+), ennakko$/i);
    const hit = k ? ['khi', k] : y ? ['ykhi-ennakko', y] : null;
    if (!hit) continue;
    const mi = FI_MONTHS.indexOf(hit[1][2].toLowerCase());
    if (mi < 0) continue;
    out.push({ source: hit[0], period: `${hit[1][1]}-${String(mi + 1).padStart(2, '0')}`, iso, title });
  }
  return out;
}

/**
 * Parse Eurostat release-calendar events.
 * @param {any[]} events
 */
export function parseEurostat(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    const title = String(e.title ?? '').trim();
    const source = /^flash estimate inflation euro area$/i.test(title) ? 'ykhi-ennakko' : /^inflation \(hicp\)$/i.test(title) ? 'ykhi' : null;
    if (!source) continue;
    const pm = String(e.period ?? '').trim().match(/^([a-z]+)\s+(\d{4})$/i);
    const mi = pm ? EN_MONTHS.indexOf(pm[1].toLowerCase()) : -1;
    if (mi < 0 || !e.start) continue;
    out.push({ source, period: `${pm[2]}-${String(mi + 1).padStart(2, '0')}`, iso: e.start, title });
  }
  return out;
}

/**
 * Eurostat's calendar gives Luxembourg wall-clock time with a misleading 'Z'
 * ("2026-10-02T11:00Z" = 11:00 CET/CEST, the euro-indicator release time).
 * Helsinki is always one hour ahead of Luxembourg (same EU DST rules).
 */
export function luxembourgToHelsinki(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 1, +m[5]));
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`, time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}` };
}

/** Build a calendar entry. */
function entry(raw, publisher, url) {
  const h = publisher === 'Eurostat' ? luxembourgToHelsinki(raw.iso) : helsinki(raw.iso);
  if (!h) return null;
  return { date: h.date, time: h.time, source: raw.source, period: raw.period, label: LABELS[raw.source](raw.period), publisher, url };
}

/**
 * Merge fetched entries into the existing calendar. One entry per
 * (source, period): Eurostat wins for YKHI (our YKHI data comes from
 * Eurostat), Tilastokeskus for KHI. Entries older than `keepDays` are dropped.
 */
export function mergeCalendar(existing, fetched, { today = new Date(), keepDays = 60 } = {}) {
  const key = (e) => `${e.source}|${e.period}`;
  const map = new Map();
  for (const e of existing ?? []) map.set(key(e), e);
  const rank = (e) => (e.source.startsWith('ykhi') ? (e.publisher === 'Eurostat' ? 2 : 1) : e.publisher === 'Tilastokeskus' ? 2 : 1);
  const fresh = new Map();
  for (const e of fetched) {
    const k = key(e);
    if (!fresh.has(k) || rank(e) > rank(fresh.get(k))) fresh.set(k, e);
  }
  for (const [k, e] of fresh) map.set(k, e);
  const cutoff = isoDate(new Date(today.getTime() - keepDays * 86_400_000));
  return [...map.values()]
    .filter((e) => e.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.source.localeCompare(b.source));
}

/**
 * Fetch both official calendars. Returns entries and per-source errors.
 * @returns {Promise<{entries: any[], errors: string[]}>}
 */
export async function fetchCalendar({ today = new Date() } = {}) {
  const errors = [];
  const entries = [];
  const start = isoDate(today);
  const end = isoDate(new Date(today.getTime() + 400 * 86_400_000));
  const [statfi, eurostat] = await Promise.allSettled([
    getText(STATFI_URL, { label: 'stat.fi calendar', retries: 2 }),
    getJson(`${EUROSTAT_CAL}?${new URLSearchParams({ start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z`, theme: '', category: '', keywords: '', isEuroindicator: 'true', authorInclude: '', authorExclude: '', timeZone: 'Europe/Luxembourg' })}`, { label: 'Eurostat calendar', retries: 2 }),
  ]);
  if (statfi.status === 'fulfilled') {
    const rows = parseStatFi(statfi.value.text);
    if (!rows.some((r) => r.source === 'khi')) errors.push('stat.fi: no upcoming KHI release found on the page (layout changed?)');
    for (const r of rows) entries.push(entry(r, 'Tilastokeskus', STATFI_URL));
  } else errors.push(`stat.fi: ${statfi.reason?.message ?? statfi.reason}`);
  if (eurostat.status === 'fulfilled') {
    const rows = parseEurostat(eurostat.value);
    if (!rows.length) errors.push('Eurostat: no HICP releases in the calendar response');
    for (const r of rows) entries.push(entry(r, 'Eurostat', EUROSTAT_CAL_PAGE));
  } else errors.push(`Eurostat: ${eurostat.reason?.message ?? eurostat.reason}`);
  return { entries: entries.filter(Boolean).filter((e) => e.date >= start), errors };
}
