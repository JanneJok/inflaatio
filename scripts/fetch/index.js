#!/usr/bin/env node
/**
 * `npm run fetch` — fetch every data source, validate, and write data/*.json.
 *
 *   node scripts/fetch/index.js [--only khi,ykhi] [--dry-run] [--data-dir <dir>] [--no-calendar]
 *
 * Pipeline rules (docs/DATA.md):
 *   - all sources run in parallel (Promise.allSettled); a failing source never
 *     blocks the others and its previous file is kept untouched;
 *   - a data file is written only when its content changed;
 *   - meta.json: a source entry is refreshed when its data changed (updated =
 *     the source's own timestamp); generatedAt changes only when something changed;
 *   - muutosloki.json gets an entry when a source publishes a new period
 *     (and when a YKHI flash becomes final);
 *   - src/content/julkaisukalenteri.json is refreshed from the official calendars
 *     (best effort: problems are warnings);
 *   - exit code 1 if any source failed (fetch or validation) or KHI/YKHI is stale.
 */
import { readFile, writeFile, rename, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isoDate, date as fiDate } from '../../src/js/lib/format.js';
import { stringifyData, sameContent } from './util.js';
import { freshness } from './validate.js';
import { fetchCalendar, mergeCalendar } from './kalenteri.js';

import khi from './sources/khi.js';
import khiAnnual from './sources/khi-annual.js';
import elinkustannusindeksi from './sources/elinkustannusindeksi.js';
import ykhi from './sources/ykhi.js';
import ykhiAnnual from './sources/ykhi-annual.js';
import hyodykkeet from './sources/hyodykkeet.js';
import hyodykesarjat from './sources/hyodykesarjat.js';
import polttoaineet from './sources/polttoaineet.js';
import ansiot from './sources/ansiot.js';
import korot from './sources/korot.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCES = [khi, khiAnnual, elinkustannusindeksi, ykhi, ykhiAnnual, hyodykkeet, hyodykesarjat, polttoaineet, ansiot, korot];
export const CALENDAR_FILE = path.join('src', 'content', 'julkaisukalenteri.json');
const LOG_MAX = 300;

/** Path for messages: relative to the repo when inside it, forward slashes. */
const rel = (f) => {
  const r = path.relative(ROOT, f);
  return (r.startsWith('..') || path.isAbsolute(r) ? f : r).split(path.sep).join('/');
};

/** Parse CLI flags. */
export function parseArgs(argv) {
  const opts = { only: null, dryRun: false, dataDir: path.join(ROOT, 'data'), calendar: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--only') opts.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--only=')) opts.only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--data-dir') opts.dataDir = path.resolve(next());
    else if (a === '--no-calendar') opts.calendar = false;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return opts;
}

/** Match `--only` names against key ('khiAnnual'), file base ('khi-annual') or 'kalenteri'. */
export function selectSources(sources, only) {
  if (!only) return { selected: sources, calendar: true };
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Set(only.map(norm));
  const selected = sources.filter((s) => wanted.has(norm(s.key)) || wanted.has(norm(s.file.replace(/\.json$/, ''))));
  const calendar = wanted.has('kalenteri') || wanted.has('julkaisukalenteri') || wanted.has('calendar');
  const known = new Set([...sources.flatMap((s) => [norm(s.key), norm(s.file.replace(/\.json$/, ''))]), 'kalenteri', 'julkaisukalenteri', 'calendar']);
  const unknown = [...wanted].filter((w) => !known.has(w));
  if (unknown.length) throw new Error(`Unknown source(s) for --only: ${unknown.join(', ')}. Known: ${sources.map((s) => s.file.replace(/\.json$/, '')).join(', ')}, kalenteri`);
  return { selected, calendar };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${file}: ${e.message}`, { cause: e });
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
async function writeAtomic(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

/**
 * Source timestamp as strict ISO 8601: Eurostat writes the offset without a
 * colon ('2026-09-17T11:00:00+0200'), which not every Date parser accepts.
 * @param {unknown} updated
 * @returns {string|null} e.g. '2026-09-17T11:00:00+02:00' (other values unchanged)
 */
export function isoTimestamp(updated) {
  if (updated == null || updated === '') return null;
  return String(updated).replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?[+-]\d{2})(\d{2})$/, '$1:$2');
}

/** Changelog date: the source's own release timestamp if recent, else today. */
export function eventDate(updated, today) {
  const t = updated ? Date.parse(isoTimestamp(updated)) : NaN;
  if (Number.isFinite(t) && t <= today.getTime() + 86_400_000 && today.getTime() - t < 10 * 86_400_000) return isoDate(new Date(t));
  return isoDate(today);
}

/**
 * Prepend new events to the changelog (newest first), skipping duplicates.
 * @param {any[]} log existing entries
 * @param {any[]} events new entries with date
 */
export function mergeLog(log, events, max = LOG_MAX) {
  const key = (e) => `${e.source}|${e.period}|${e.kind ?? ''}`;
  const seen = new Set((log ?? []).map(key));
  const fresh = events.filter((e) => !seen.has(key(e)) && seen.add(key(e)));
  if (!fresh.length) return { log: log ?? [], added: [] };
  const all = [...fresh, ...(log ?? [])];
  // Stable sort: date desc; same-day entries keep insertion order (new first).
  const sorted = all.map((e, i) => ({ e, i })).sort((a, b) => b.e.date.localeCompare(a.e.date) || a.i - b.i).map((x) => x.e);
  return { log: sorted.slice(0, max), added: fresh };
}

/** Normalise a meta entry for one source. */
function metaEntry(src, m) {
  const out = { name: src.name, publisher: src.publisher };
  if (m.table) out.table = m.table;
  if (m.dataset) out.dataset = m.dataset;
  Object.assign(out, { url: m.url, license: src.license, updated: isoTimestamp(m.updated), latest: m.latest ?? null });
  return out;
}

/** Order meta.sources like SOURCES, keeping unknown keys at the end. */
function orderSources(sources, obj) {
  const out = {};
  for (const s of sources) if (obj[s.key]) out[s.key] = obj[s.key];
  for (const [k, v] of Object.entries(obj)) if (!(k in out)) out[k] = v;
  return out;
}

/**
 * Run the pipeline.
 * @param {{only?: string[]|null, dryRun?: boolean, dataDir?: string, calendar?: boolean,
 *   today?: Date, sources?: any[], log?: (s: string) => void, calendarFile?: string,
 *   fetchCalendarImpl?: typeof fetchCalendar}} [o]
 */
export async function run(o = {}) {
  const {
    only = null,
    dryRun = false,
    dataDir = path.join(ROOT, 'data'),
    calendar: calendarOpt = true,
    today = new Date(),
    sources = SOURCES,
    log = (s) => console.log(s),
    calendarFile = path.join(ROOT, CALENDAR_FILE),
    fetchCalendarImpl = fetchCalendar,
  } = o;
  const { selected, calendar: calendarOnly } = selectSources(sources, only);
  const runCalendar = calendarOpt && (!only || calendarOnly);

  const prevMeta = (await readJson(path.join(dataDir, 'meta.json'))) ?? { generatedAt: null, sources: {} };
  const prevLog = (await readJson(path.join(dataDir, 'muutosloki.json'))) ?? [];
  const prev = Object.fromEntries(await Promise.all(sources.map(async (s) => [s.key, await readJson(path.join(dataDir, s.file))])));

  const t0 = Date.now();
  const settled = await Promise.allSettled(selected.map((s) => s.fetch({ log: (m) => log(`[${s.key}] ${m}`), today })));

  const results = [];
  const writes = [];
  let events = [];
  const newMetaSources = { ...(prevMeta.sources ?? {}) };
  selected.forEach((s, i) => {
    const r = settled[i];
    const res = { key: s.key, file: s.file, status: 'unchanged', latest: null, note: '' };
    results.push(res);
    const prevData = prev[s.key];
    if (r.status === 'rejected') {
      res.status = 'failed';
      res.note = r.reason?.message ?? String(r.reason);
      res.latest = prevData ? safeLatest(s, prevData) : null;
      return;
    }
    const { data, meta } = r.value;
    try {
      s.validate(data, prevData);
    } catch (e) {
      res.status = 'invalid';
      res.note = e.message;
      res.latest = prevData ? safeLatest(s, prevData) : null;
      return;
    }
    res.latest = s.latest(data);
    const changed = !sameContent(data, prevData);
    const entry = metaEntry(s, meta);
    if (changed) {
      res.status = prevData ? 'updated' : 'created';
      writes.push({ file: path.join(dataDir, s.file), text: stringifyData(data) });
      newMetaSources[s.key] = entry;
      if (prevData && s.events) {
        const date = eventDate(meta.updated, today);
        events = events.concat(s.events(data, prevData).map((e) => ({ date, ...e })));
      }
    } else if (
      !newMetaSources[s.key] ||
      ['name', 'publisher', 'table', 'dataset', 'url', 'license', 'latest'].some((k) => newMetaSources[s.key][k] !== entry[k]) ||
      isoTimestamp(newMetaSources[s.key].updated) !== newMetaSources[s.key].updated
    ) {
      // Data unchanged but the meta entry is missing, its static fields changed
      // or its timestamp predates isoTimestamp() normalisation.
      newMetaSources[s.key] = { ...entry, updated: isoTimestamp(newMetaSources[s.key]?.updated) ?? entry.updated };
    }
  });

  // Freshness of KHI and YKHI (checked on whatever data will be live).
  const fresh = [];
  for (const s of selected.filter((x) => x.freshness)) {
    const res = results.find((r) => r.key === s.key);
    const f = freshness(s.key, res.latest, { today });
    fresh.push(f);
    if (!f.ok) {
      res.note = [res.note, f.message].filter(Boolean).join(' | ');
      if (res.status === 'unchanged' || res.status === 'updated' || res.status === 'created') res.status = 'stale';
    }
  }

  const dataChanged = writes.length > 0;
  const newMeta = { generatedAt: prevMeta.generatedAt ?? null, sources: orderSources(sources, newMetaSources) };
  const metaChanged = !sameContent(newMeta, prevMeta, ['generatedAt']);
  if (dataChanged || metaChanged || !prevMeta.generatedAt) newMeta.generatedAt = today.toISOString();
  if (dataChanged || metaChanged || !prevMeta.generatedAt) writes.push({ file: path.join(dataDir, 'meta.json'), text: stringifyData(newMeta) });

  const { log: newLog, added } = mergeLog(prevLog, events);
  if (added.length) writes.push({ file: path.join(dataDir, 'muutosloki.json'), text: stringifyData(newLog) });

  // Release calendar (soft).
  const warnings = [];
  let calendarStatus = 'skipped';
  if (runCalendar) {
    try {
      const prevCal = (await readJson(calendarFile)) ?? [];
      const { entries, errors } = await fetchCalendarImpl({ today });
      warnings.push(...errors.map((e) => `kalenteri: ${e}`));
      const merged = mergeCalendar(prevCal, entries, { today });
      if (!sameContent(merged, prevCal)) {
        writes.push({ file: calendarFile, text: stringifyData(merged) });
        calendarStatus = 'updated';
      } else calendarStatus = 'unchanged';
    } catch (e) {
      warnings.push(`kalenteri: ${e.message}`);
      calendarStatus = 'failed (warning)';
    }
  }

  if (!dryRun) for (const w of writes) await writeAtomic(w.file, w.text);

  const failed = results.filter((r) => ['failed', 'invalid', 'stale'].includes(r.status));
  const summary = formatSummary({ results, added, warnings, calendarStatus, dryRun, writes, seconds: (Date.now() - t0) / 1000, today });
  log(summary.text);
  if (process.env.GITHUB_STEP_SUMMARY && !o.noStepSummary) {
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.markdown, 'utf8');
    } catch (e) {
      log(`warning: could not write GITHUB_STEP_SUMMARY: ${e.message}`);
    }
  }
  return { exitCode: failed.length ? 1 : 0, results, writes: writes.map((w) => rel(w.file)), added, warnings, fresh };
}

function safeLatest(s, d) {
  try {
    return s.latest(d);
  } catch {
    return null;
  }
}

/** Console text + GitHub step summary markdown. */
export function formatSummary({ results, added, warnings, calendarStatus, dryRun, writes, seconds, today }) {
  const pad = (s, n) => String(s ?? '').padEnd(n);
  const lines = [
    '',
    `Data fetch ${dryRun ? '(dry run, nothing written) ' : ''}— ${fiDate(today)} — ${seconds.toFixed(1)} s`,
    `${pad('source', 22)}${pad('status', 11)}${pad('latest', 10)}note`,
    ...results.map((r) => `${pad(r.key, 22)}${pad(r.status, 11)}${pad(r.latest ?? '–', 10)}${r.note.split('\n')[0]}`),
    `${pad('julkaisukalenteri', 22)}${calendarStatus}`,
  ];
  for (const r of results.filter((x) => x.note.includes('\n'))) lines.push('', r.note);
  if (added.length) lines.push('', 'Muutosloki:', ...added.map((e) => `  ${e.date} ${e.text}`));
  if (warnings.length) lines.push('', 'Warnings:', ...warnings.map((w) => `  ${w}`));
  lines.push('', writes.length ? `${dryRun ? 'Would write' : 'Wrote'}: ${writes.map((w) => rel(w.file)).join(', ')}` : 'No changes.');

  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const md = [
    `### Datapäivitys ${fiDate(today)}${dryRun ? ' (dry run)' : ''}`,
    '',
    '| Lähde | Tila | Uusin | Huomio |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.key} | ${r.status} | ${r.latest ?? '–'} | ${esc(r.note).slice(0, 300)} |`),
    `| julkaisukalenteri | ${calendarStatus} | | |`,
    '',
    ...(added.length ? ['**Muutosloki:**', '', ...added.map((e) => `- ${e.date}: ${e.text}`), ''] : []),
    ...(warnings.length ? ['**Varoitukset:**', '', ...warnings.map((w) => `- ${esc(w)}`), ''] : []),
    writes.length ? `Kirjoitetut tiedostot: ${writes.map((w) => `\`${rel(w.file)}\``).join(', ')}` : 'Ei muutoksia.',
    '',
  ];
  return { text: lines.join('\n'), markdown: md.join('\n') };
}

const HELP = `Usage: node scripts/fetch/index.js [--only <src,…>] [--dry-run] [--data-dir <dir>] [--no-calendar]
Sources: ${SOURCES.map((s) => s.file.replace(/\.json$/, '')).join(', ')}, kalenteri`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    selectSources(SOURCES, opts.only);
  } catch (e) {
    console.error(`${e.message}\n${HELP}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  run(opts).then((r) => {
    process.exitCode = r.exitCode;
  }, (e) => {
    console.error(e.stack ?? e);
    process.exitCode = 1;
  });
}
