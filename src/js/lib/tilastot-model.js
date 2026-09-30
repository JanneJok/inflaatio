/**
 * Data model, alert rules and CSV of the owner dashboard /tilastot/
 * (src/js/pages/tilastot.js). Pure functions without DOM access, so
 * test/tilastot.test.js can check them in Node.
 *
 * The data comes from the Supabase function public.inflaatio_stats()
 * (docs/supabase-tilastot.sql): `counters` = [{d, k, n}] per Helsinki day,
 * where k is 'pv' (all page loads), 'dev.<class>', 'src.<class>',
 * 'sec.<section>' or 'ev.<event>'. A key missing on a day means 0 from the
 * first day of data on; days before it are "not measured" (null, shown "–").
 */
import { OWN_EVENT_NAMES } from './tilastot-events.js';

export const TZ = 'Europe/Helsinki';

/** Sections of the site (SQL inflaatio_section) → label and chart group. */
export const SECTIONS = Object.freeze([
  { key: 'etusivu', label: 'Etusivu', group: 0 },
  { key: 'laskurit', label: 'Laskurit', group: 1 },
  { key: 'historia', label: 'Historia ja katsaukset', group: 2 },
  { key: 'hinnat', label: 'Hinnat ja polttoaineet', group: 3 },
  { key: 'vertailu', label: 'Vertailu ja korot', group: 4 },
  { key: 'en', label: 'Englanninkieliset', group: 5 },
  { key: 'muut', label: 'Muut sivut', group: 5 },
  { key: 'notfound', label: '404 (sivua ei löytynyt)', group: 5 },
]);

/** Stacked groups of the page-view chart (colours s1…s6). */
export const VIEW_GROUPS = Object.freeze(['Etusivu', 'Laskurit', 'Historia ja katsaukset', 'Hinnat', 'Vertailu ja korot', 'Muut']);

/** Traffic sources (SQL inflaatio_source_class), arrivals only (internal navigation excluded). */
export const SOURCES = Object.freeze([
  { key: 'search', label: 'Hakukoneet' },
  { key: 'ai', label: 'Tekoälypalvelut' },
  { key: 'social', label: 'Some' },
  { key: 'other', label: 'Muut sivustot' },
  { key: 'direct', label: 'Suora (ei viittaajaa)' },
]);

export const DEVICES = Object.freeze([
  { key: 'mobile', label: 'Puhelin' },
  { key: 'tablet', label: 'Tabletti' },
  { key: 'desktop', label: 'Tietokone' },
  { key: 'unknown', label: 'Ei tietoa' },
]);

export const SOURCE_LABEL = Object.freeze({ ...Object.fromEntries(SOURCES.map((s) => [s.key, s.label])), internal: 'Sivuston sisältä' });

/** Timeline markers (numbered vertical lines in the page-view chart). */
export const FIXED_MARKERS = Object.freeze([
  { date: '2026-09-24', text: 'Uusi sivusto: laitetyyppi kävijätilastoon, hakusanoja ei enää tallenneta' },
  { date: '2026-09-29', text: 'Oma tapahtumatilasto (vain suostumuksella) ja uusi evästekysely' },
  { date: '2026-09-30', text: 'Botit ja automaattiselaimet (esim. Googlebot, headless-selaimet) jätetään laskematta; aiemmat päivät voivat olla paisuneita' },
]);

export const WEEKDAYS = Object.freeze(['ma', 'ti', 'ke', 'to', 'pe', 'la', 'su']);
export const WEEKDAY_NAMES = Object.freeze(['maanantai', 'tiistai', 'keskiviikko', 'torstai', 'perjantai', 'lauantai', 'sunnuntai']);

/* ------------------------------------------------------------------ dates */

/** @param {unknown} d */
export const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const toUtc = (d) => new Date(`${d}T00:00:00Z`);

/** @param {string} d YYYY-MM-DD @param {number} n */
export function addDays(d, n) {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Days from a to b (b − a). */
export const dayDiff = (a, b) => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);

/** Monday = 0. @param {string} d */
export const weekday = (d) => (toUtc(d).getUTCDay() + 6) % 7;
/** @param {string} d */
export const weekStart = (d) => addDays(d, -weekday(d));

/** ISO week number. @param {string} d */
export function isoWeek(d) {
  const t = toUtc(d);
  t.setUTCDate(t.getUTCDate() - weekday(d) + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThursday.getTime()) / 86_400_000;
  return 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** 28.9.2026 or 28.9. @param {string} d @param {boolean} [year] */
export function fiDate(d, year = true) {
  const [y, m, day] = d.split('-');
  return year ? `${Number(day)}.${Number(m)}.${y}` : `${Number(day)}.${Number(m)}.`;
}

/**
 * Date and time in Helsinki.
 * @param {Date} [now]
 * @returns {{date: string, time: string}}
 */
export function helsinkiNow(now = new Date()) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const { type, value } of f.formatToParts(now)) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${Number(p.hour) % 24}.${p.minute}` };
}

/* ------------------------------------------------------------ the dataset */

/**
 * @typedef {{date: string, measured: boolean, values: Record<string, number>}} Day
 * @typedef {{
 *   days: Day[], keys: string[], first: string|null, from: string, to: string, today: string,
 *   pages: {p: string, n: number, e: number}[], referrers: {r: string, c: string, n: number}[],
 *   hours: {w: number, h: number, n: number}[], details: {e: string, x: string, n: number}[],
 *   eventPages: {e: string, p: string, n: number}[], generatedAt: string|null,
 * }} Dataset
 */

const KEY_GROUPS = ['pv', 'sec.', 'src.', 'dev.', 'ev.'];
const KNOWN_ORDER = [
  'pv',
  ...SECTIONS.map((s) => `sec.${s.key}`),
  'sec.upotus',
  ...SOURCES.map((s) => `src.${s.key}`),
  'src.internal',
  ...DEVICES.map((s) => `dev.${s.key}`),
  ...OWN_EVENT_NAMES.map((e) => `ev.${e}`),
];

/** Stable column order: groups, then the known order, then alphabetical. @param {string[]} keys */
export function sortKeys(keys) {
  const rank = (k) => {
    const g = KEY_GROUPS.findIndex((p) => (p === 'pv' ? k === 'pv' : k.startsWith(p)));
    const i = KNOWN_ORDER.indexOf(k);
    return [g < 0 ? KEY_GROUPS.length : g, i < 0 ? KNOWN_ORDER.length : i];
  };
  return [...keys].sort((a, b) => {
    const [ga, ia] = rank(a);
    const [gb, ib] = rank(b);
    return ga - gb || ia - ib || a.localeCompare(b);
  });
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
const list = (v) => (Array.isArray(v) ? v : []);

/**
 * The API response → contiguous days (from the first counter day, or the
 * requested start minus the history window, to `to`).
 * @param {any} raw
 * @returns {Dataset}
 */
export function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const today = isDate(r.today) ? r.today : helsinkiNow().date;
  const to = isDate(r.to) ? r.to : today;
  const from = isDate(r.from) ? r.from : to;
  const first = isDate(r.first) ? r.first : null;
  /** @type {Map<string, Record<string, number>>} */
  const byDate = new Map();
  const keys = new Set();
  let minDate = null;
  for (const c of list(r.counters)) {
    if (!c || !isDate(c.d) || typeof c.k !== 'string' || !c.k) continue;
    const n = num(c.n);
    if (!Number.isFinite(n)) continue;
    if (!byDate.has(c.d)) byDate.set(c.d, {});
    const v = byDate.get(c.d);
    v[c.k] = (v[c.k] ?? 0) + n;
    keys.add(c.k);
    if (!minDate || c.d < minDate) minDate = c.d;
  }
  const start = [minDate, addDays(from, -35)].filter(Boolean).sort()[0];
  const days = [];
  if (start && start <= to) {
    for (let d = start; d <= to; d = addDays(d, 1)) {
      days.push({ date: d, measured: first != null && d >= first, values: byDate.get(d) ?? {} });
    }
  }
  return {
    days,
    keys: sortKeys([...keys]),
    first,
    from,
    to,
    today,
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
    pages: list(r.pages).filter((x) => x && typeof x.p === 'string').map((x) => ({ p: x.p, n: num(x.n) || 0, e: num(x.e) || 0 })),
    referrers: list(r.referrers).filter((x) => x && typeof x.r === 'string').map((x) => ({ r: x.r, c: String(x.c ?? 'other'), n: num(x.n) || 0 })),
    hours: list(r.hours)
      .map((x) => ({ w: num(x?.w), h: num(x?.h), n: num(x?.n) || 0 }))
      .filter((x) => x.w >= 1 && x.w <= 7 && x.h >= 0 && x.h <= 23),
    details: list(r.details).filter((x) => x && typeof x.e === 'string').map((x) => ({ e: x.e, x: String(x.x ?? ''), n: num(x.n) || 0 })),
    eventPages: list(r.eventPages).filter((x) => x && typeof x.e === 'string').map((x) => ({ e: x.e, p: String(x.p ?? ''), n: num(x.n) || 0 })),
  };
}

/**
 * Counter value on a day: a number (0 when absent) from the first day of
 * data on; null ("not measured") before it.
 * @param {Day|undefined} day @param {string} key
 */
export function val(day, key) {
  if (!day || !day.measured) return null;
  return day.values[key] ?? 0;
}

/** Sum of counters on a day (null when not measured). @param {Day|undefined} day @param {string[]} keys */
export function sumOf(day, keys) {
  if (!day || !day.measured) return null;
  return keys.reduce((a, k) => a + (day.values[k] ?? 0), 0);
}

/** Sum over days (null when none was measured). @param {Day[]} days @param {(d: Day) => number|null} metric */
export function totalOf(days, metric) {
  let t = null;
  for (const d of days) {
    const v = metric(d);
    if (v != null) t = (t ?? 0) + v;
  }
  return t;
}

/** Page views of the site itself: all page loads minus loads of the embedded card (/upotus/). */
export const siteViews = (d) => (d && d.measured ? val(d, 'pv') - val(d, 'sec.upotus') : null);
/** Arrivals: site views that did not come from another page of the site. */
export const arrivals = (d) => (d && d.measured ? Math.max(0, siteViews(d) - val(d, 'src.internal')) : null);
/** Own events of the whitelist (old event types of the previous site excluded). */
export const ownEventsTotal = (d) => sumOf(d, OWN_EVENT_NAMES.map((e) => `ev.${e}`));

/** Section keys of each chart group. */
export function groupKeys() {
  return VIEW_GROUPS.map((_, i) => SECTIONS.filter((s) => s.group === i).map((s) => `sec.${s.key}`));
}

/* ------------------------------------------------------------- alert rules */

export const MEDIAN_DAYS = 28;
export const MEDIAN_MIN_DAYS = 7;
export const PAGE_VIEW_FACTOR = 5;
export const ERROR_FACTOR = 3;
export const ERROR_MIN = 5;
export const SILENT_MIN_MEDIAN = 20;
export const EVENTS_SILENT_MIN_MEDIAN = 10;
export const NOT_FOUND_MAX_SHARE = 0.05;
export const NOT_FOUND_MIN_VIEWS = 200;
const MAX_DAYS_LISTED = 5;

/** @param {number[]} xs non-empty */
export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/**
 * @typedef {{date: string, value: number|null}} Point
 * @typedef {{date: string, value: number, median: number}} Hit
 * @typedef {{id: string, title: string, text: string}} Alert
 */

/**
 * Days from `from` on (before `until`, if given) whose value passes `test`
 * against the median of the previous MEDIAN_DAYS measured days (at least
 * MEDIAN_MIN_DAYS of them).
 * @param {Point[]} series every day, oldest first, without gaps
 * @param {string} from
 * @param {(value: number, median: number) => boolean} test
 * @param {string} [until] exclusive
 * @returns {Hit[]}
 */
export function unusualDays(series, from, test, until) {
  const out = [];
  series.forEach((d, i) => {
    if (d.date < from || (until && d.date >= until) || d.value == null) return;
    const prev = series
      .slice(Math.max(0, i - MEDIAN_DAYS), i)
      .map((x) => x.value)
      .filter((v) => v != null);
    if (prev.length < MEDIAN_MIN_DAYS) return;
    const med = median(prev);
    if (test(d.value, med)) out.push({ date: d.date, value: d.value, median: med });
  });
  return out;
}

/** Page-view spikes (also the "!" marks of the chart). @param {Point[]} series @param {string} from */
export function pageViewSpikes(series, from) {
  return unusualDays(series, from, (v, m) => m >= 1 && v > PAGE_VIEW_FACTOR * m);
}

const nf1 = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('fi-FI', { style: 'percent', maximumFractionDigits: 1 });

function listDays(hits) {
  const newest = [...hits].reverse();
  const shown = newest.slice(0, MAX_DAYS_LISTED).map((s) => `${fiDate(s.date, false)} (${nf1.format(s.value)}; mediaani ${nf1.format(s.median)})`);
  const more = newest.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` ja ${more} muuta päivää` : ''}`;
}

/**
 * Callouts for the selected range.
 * @param {{
 *   from: string, today: string,
 *   views: Point[], errors: Point[], events: Point[],
 *   totals: {views: number|null, notFound: number|null},
 * }} input views/errors/events: daily values of every loaded day, oldest first
 * @returns {Alert[]}
 */
export function computeAlerts({ from, today, views, errors, events, totals }) {
  /** @type {Alert[]} */
  const alerts = [];
  const silent = unusualDays(views, from, (v, m) => v === 0 && m >= SILENT_MIN_MEDIAN, today);
  if (silent.length) {
    alerts.push({
      id: 'no-page-views',
      title: 'Kävijätilasto ei ehkä toimi',
      text: `${listDays(silent)}: ei yhtään sivukatselua, vaikka tavallisesti niitä on kymmeniä. Tarkista, että sivusto toimii (https://inflaatio.fi/), ettei Supabase-projekti ole keskeytetty (Supabasen hallintapaneeli) ja ettei selaimen konsolissa ole virheitä.`,
    });
  }
  const spikes = pageViewSpikes(views, from);
  if (spikes.length) {
    alerts.push({
      id: 'page-view-spike',
      title: 'Epätavallisen paljon sivukatseluja',
      text: `${listDays(spikes)}: sivukatseluja yli ${PAGE_VIEW_FACTOR} kertaa edeltävän ${MEDIAN_DAYS} päivän mediaani (merkitty kaavioon ”!”). Syy voi olla näkyvyys jossain (katso lähteet ja viittaavat sivustot) tai botti. Botti näkyy usein yhtenä sivuna, laitteena tai suorana liikenteenä.`,
    });
  }
  const errorDays = unusualDays(errors, from, (v, m) => v >= ERROR_MIN && v > ERROR_FACTOR * m);
  if (errorDays.length) {
    alerts.push({
      id: 'client-errors',
      title: 'Selainvirheitä tavallista enemmän',
      text: `${listDays(errorDays)}: sivuston omia JavaScript-virheitä yli ${ERROR_FACTOR} kertaa edeltävän ${MEDIAN_DAYS} päivän mediaani. Jokin sivu voi olla rikki, varsinkin jos julkaisit juuri uuden version. Avaa sivusto selaimessa ja katso konsoli. Virheet lasketaan vain analytiikkasuostumuksen antaneilta.`,
    });
  }
  const quiet = unusualDays(events, from, (v, m) => v === 0 && m >= EVENTS_SILENT_MIN_MEDIAN, today);
  if (quiet.length) {
    alerts.push({
      id: 'no-events',
      title: 'Tapahtumat eivät ehkä tallennu',
      text: `${listDays(quiet)}: ei yhtään tapahtumaa, vaikka tavallisesti niitä tulee. Syy voi olla muuttunut tietokannan sallittujen tapahtumien lista (docs/supabase-tilastot.sql) tai rikki mennyt evästevalinta.`,
    });
  }
  const v = totals.views ?? 0;
  const nf = totals.notFound ?? 0;
  if (v >= NOT_FOUND_MIN_VIEWS && nf / v > NOT_FOUND_MAX_SHARE) {
    alerts.push({
      id: 'not-found',
      title: 'Paljon 404-sivuja',
      text: `${pct.format(nf / v)} valitun aikavälin sivukatseluista (${nf} kpl) päätyi 404-sivulle. Jokin linkki sivustolla tai muualla voi olla rikki. Tarkista sisäiset linkit (npm run check-links) ja Google Search Consolen 404-raportti. Tilasto ei tallenna mistä osoitteesta 404 tuli.`,
    });
  }
  return alerts;
}

/* -------------------------------------------------------------------- CSV */

/**
 * CSV of the days (comma separated, header row of counter keys).
 * @param {Day[]} days
 * @param {string[]} keys
 * @returns {string}
 */
export function toCsv(days, keys) {
  const lines = [['date', 'site_views', 'arrivals', ...keys].join(',')];
  for (const d of days) {
    const cell = (v) => (v == null ? '' : String(v));
    lines.push([d.date, cell(siteViews(d)), cell(arrivals(d)), ...keys.map((k) => cell(val(d, k)))].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------- auth */

/**
 * @typedef {{accessToken: string, refreshToken: string, expiresAt: number, email: string}} Session
 */

/**
 * Session from a Supabase Auth token response, or null when malformed.
 * @param {any} body
 * @param {number} [nowSec]
 * @returns {Session|null}
 */
export function sessionFromToken(body, nowSec = Math.floor(Date.now() / 1000)) {
  if (!body || typeof body.access_token !== 'string' || !body.access_token || typeof body.refresh_token !== 'string') return null;
  const expiresAt = Number.isFinite(body.expires_at) ? body.expires_at : nowSec + (Number(body.expires_in) || 3600);
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt, email: String(body.user?.email ?? '') };
}

/** True when the access token expires within `skew` seconds. @param {Session|null} s @param {number} [nowSec] */
export function needsRefresh(s, nowSec = Math.floor(Date.now() / 1000), skew = 60) {
  return !s || s.expiresAt - nowSec <= skew;
}

/**
 * Message for a failed login (Supabase Auth /token).
 * @param {number} status @param {any} [body]
 */
export function loginMessage(status, body) {
  const code = String(body?.error_code ?? body?.error ?? '');
  if (status === 429 || code === 'over_request_rate_limit') return 'Liian monta kirjautumisyritystä. Odota hetki ja yritä sitten uudelleen.';
  if (code === 'email_not_confirmed') return 'Sähköpostiosoitetta ei ole vahvistettu. Vahvista käyttäjä Supabasessa (Authentication → Users).';
  if (status === 400 || status === 401 || code === 'invalid_credentials' || code === 'invalid_grant') return 'Sähköposti tai salasana on väärin.';
  return `Kirjautuminen epäonnistui (${status}). Yritä hetken päästä uudelleen.`;
}

/**
 * Message for a failed statistics request (PostgREST rpc).
 * @param {number} status @param {any} [body]
 */
export function statsMessage(status, body) {
  const code = String(body?.code ?? '');
  if (code === '42501' || status === 403) return 'Tunnuksellasi ei ole oikeutta tilastoihin. Lisää käyttäjä tauluun inflaatio_stats_admins (docs/supabase-tilastot.sql, kohta 4).';
  if (code === 'PGRST202' || status === 404) return 'Tilastofunktiota ei löydy tietokannasta. Aja docs/supabase-tilastot.sql Supabasen SQL Editorissa.';
  if (status === 401) return 'Istunto vanhentui. Kirjaudu uudelleen.';
  return `Tilastoja ei saatu haettua (${status}). Yritä hetken päästä uudelleen.`;
}
