#!/usr/bin/env node
/**
 * Static site build (SPEC §3).
 *
 *   node scripts/build.js [--out <dir>] [--only <page1,page2>] [--no-minify] [--strict] [--quiet]
 *
 * 1. Load data/*.json → ctx.data, src/content/*.json → ctx.content, src/site.config.js → ctx.site.
 * 2. Bundle CSS/JS with esbuild (content-hashed, ESM + code splitting; fonts → /fonts/)
 *    and build an asset manifest: ctx.asset('site.js') → '/assets/site-HASH.js'.
 * 3. Import every src/pages/*.js (or the --only subset); each default-exports
 *    async (ctx) => [{ path, html } | { path, body }]. Duplicate paths fail the build.
 * 4. Copy src/static/** to the output root.
 * 5. Write sitemap.xml (HTML pages without noindex / sitemap:false) and robots.txt
 *    unless a module or src/static provides them.
 * 6. Verify every HTML output is CSP-safe (no inline scripts/styles/handlers).
 */
import { build as esbuild } from 'esbuild';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import * as htmlLib from './lib/html.js';
import * as svg from './lib/svg.js';
import * as fmt from '../src/js/lib/format.js';
import * as stats from '../src/js/lib/stats.js';
import * as components from '../src/templates/components.js';
import { layout, crumbs } from '../src/templates/layout.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

/** Top-level directories an output directory must never be placed in. */
const PROTECTED = ['src', 'scripts', 'data', 'test', 'node_modules', '.git', 'deploy', 'docs', 'image', '.github', '.claude'];

/**
 * Refuse to wipe anything but a build directory.
 * @param {string} outDir absolute path
 */
export function assertSafeOutDir(outDir) {
  const rel = path.relative(ROOT, outDir);
  const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (inside) {
    const top = rel.split(path.sep)[0];
    if (PROTECTED.includes(top)) throw new Error(`Refusing to build into ${outDir} (inside ${top}/)`);
    return;
  }
  const tmpRel = path.relative(os.tmpdir(), outDir);
  if (tmpRel && !tmpRel.startsWith('..') && !path.isAbsolute(tmpRel)) return;
  throw new Error(`Refusing to build into ${outDir}: use a directory inside the repository (e.g. dist/ or .tmp/<name>) or the OS temp dir`);
}

/** Parse CLI arguments. @param {string[]} argv */
export function parseArgs(argv) {
  const o = { out: 'dist', only: null, minify: true, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (v == null || v.startsWith('--')) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--out' || a.startsWith('--out=')) o.out = val();
    else if (a === '--only' || a.startsWith('--only=')) o.only = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--no-minify') o.minify = false;
    else if (a === '--strict') o.strict = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return o;
}

/** Read every *.json in a directory into { basename: data }. */
async function loadJsonDir(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of (await fs.readdir(dir)).sort()) {
    if (!f.endsWith('.json')) continue;
    const file = path.join(dir, f);
    try {
      out[f.slice(0, -5)] = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid JSON in ${path.relative(ROOT, file)}: ${err.message}`, { cause: err });
    }
  }
  return out;
}

/** Recursively list files (relative paths with forward slashes). */
async function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(full, base)));
    else if (ent.isFile() && ent.name !== '.gitkeep') out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

const toPosix = (p) => p.split(path.sep).join('/');
const HASHED = /^(.*)-[A-Z0-9]{8}(\.[a-z0-9]+)$/;

/**
 * Bundle CSS and JS with esbuild and build the manifest.
 * @param {string} outDir
 * @param {{minify: boolean}} opts
 */
async function bundleAssets(outDir, { minify }) {
  const pageEntries = (await walk(path.join(SRC, 'js', 'pages'))).filter((f) => f.endsWith('.js') && !f.includes('/'));
  /** logical name → source path (relative to ROOT) */
  const entries = {
    'main.css': 'src/css/main.css',
    'site.js': 'src/js/site.js',
    ...Object.fromEntries(pageEntries.map((f) => [`pages/${f}`, `src/js/pages/${f}`])),
  };
  const common = {
    absWorkingDir: ROOT,
    bundle: true,
    outdir: outDir,
    minify,
    target: ['es2020'],
    metafile: true,
    write: true,
    logLevel: 'silent',
    charset: 'utf8',
    legalComments: minify ? 'eof' : 'inline',
    sourcemap: minify ? false : 'linked',
    publicPath: '/',
    define: { 'process.env.NODE_ENV': '"production"' },
    drop: minify ? ['debugger'] : [],
    pure: minify ? ['console.log', 'console.debug'] : [],
  };
  const main = await esbuild({
    ...common,
    entryPoints: Object.fromEntries(Object.entries(entries).map(([name, src]) => [`assets/${name.replace(/\.(js|css)$/, '')}`, src])),
    entryNames: '[dir]/[name]-[hash]',
    chunkNames: 'assets/chunks/[name]-[hash]',
    assetNames: 'fonts/[name]-[hash]',
    format: 'esm',
    splitting: true,
    loader: { '.woff2': 'file', '.woff': 'file' },
  });
  // The theme script (src/js/theme-boot.js) is not bundled: the layout inlines
  // it into <head> and the CSP allows it by hash (themeBootScript()).

  const bySource = new Map(Object.entries(entries).map(([name, src]) => [src, name]));
  const manifest = new Map();
  const imports = new Map();
  const files = [];
  const outputs = { ...main.metafile.outputs };
  const urlOf = (p) => `/${toPosix(path.relative(outDir, path.resolve(ROOT, p)))}`;
  for (const [outPath, info] of Object.entries(outputs)) {
    const url = urlOf(outPath);
    if (url.endsWith('.map')) continue;
    files.push({ url, bytes: info.bytes, file: path.resolve(ROOT, outPath) });
    if (info.entryPoint && bySource.has(toPosix(info.entryPoint))) {
      const name = bySource.get(toPosix(info.entryPoint));
      if (!(name.endsWith('.css') && url.endsWith('.js'))) manifest.set(name, url);
      imports.set(
        name,
        (info.imports ?? []).filter((i) => i.kind === 'import-statement' && !i.external).map((i) => urlOf(i.path)),
      );
    } else if (url.startsWith('/fonts/')) {
      const m = path.posix.basename(url).match(HASHED);
      if (m) manifest.set(`fonts/${m[1]}${m[2]}`, url);
    }
  }
  return { manifest, imports, files };
}

const numOrNull = (v) => (fmt.isNum(v) ? v : null);

/**
 * The (possibly partial) calendar year of `month`: mean of the available
 * monthly annual rates, labelled with its month span (SPEC §6).
 * @param {string[]} months
 * @param {(number|null)[]} yoy
 * @param {string} month latest month 'YYYY-MM' (the year is derived from data, never the clock)
 */
function yearToDate(months, yoy, month) {
  const year = fmt.yearOf(month);
  const a = stats.annualMeanOfMonthly(months, yoy);
  const i = a.years.indexOf(year);
  if (i < 0) return null;
  return {
    year,
    value: a.values[i],
    months: a.monthsCount[i],
    complete: a.complete[i],
    spanStart: a.spanStart[i],
    spanEnd: a.spanEnd[i],
    span: fmt.monthsSpan(a.spanStart[i], a.spanEnd[i]),
    label: fmt.partialYear(a.spanStart[i], a.spanEnd[i]),
  };
}

/**
 * Latest values of one monthly rate series (+ optional aligned extras).
 * @param {string[]} months
 * @param {(number|null)[]} yoy
 */
function monthlyLatest(months, yoy) {
  const i = stats.latestIndex(yoy);
  if (i < 0) return null;
  const prevYoy = numOrNull(yoy[i - 1]);
  return {
    i,
    month: months[i],
    yoy: yoy[i],
    prevMonth: months[i - 1] ?? null,
    prevYoy,
    delta: stats.ppChange(yoy[i], prevYoy),
    yearAgoYoy: numOrNull(yoy[i - 12]),
    mean12: stats.trailingMean(yoy, 12, i),
    currentYear: yearToDate(months, yoy, months[i]),
  };
}

/** First release-calendar entry of `source` whose period is after `afterPeriod`. */
function nextRelease(calendar, source, afterPeriod, inclusive = false) {
  if (!Array.isArray(calendar) || !afterPeriod) return null;
  return calendar.find((e) => e.source === source && (inclusive ? e.period >= afterPeriod : e.period > afterPeriod)) ?? null;
}

/**
 * Convenience values for templates (ctx.latest, SPEC §3). Every key is
 * optional: a data file may be missing (e.g. in tests) and the key is then
 * absent. Month/period strings come straight from the data files; nothing is
 * derived from the clock.
 *
 *   khi:   { month, yoy, prevMonth, prevYoy, delta (%-yks.), mom, yearAgoYoy, mean12,
 *            index2025, index2015, currentYear: { year, value, months, complete, span, label, … }, updated }
 *   ykhi:  same as khi (Finland, Eurostat HICP) + { coreYoy, flag, provisional }
 *   ea:    euro area, same shape as ykhi
 *   khiAnnual: { year, yoy }            ykhiAnnual: { year, FI, EA }
 *   elinkustannusindeksi: { month, value, base }
 *   hyodykkeet: { month }               polttoaineet: { month, values: { bensiini95, diesel, … } }
 *   ansiot: { period, nominalYoy, realYoy, preliminary }
 *   korot:  { month, depositRate, euribor12, rateNow, rateNowFrom }
 *   nextRelease: { khi, 'ykhi-ennakko', ykhi } — julkaisukalenteri entries or null
 *   updated: { <meta source key>: ISO timestamp }, dataUpdated: 'YYYY-MM-DD' (newest source update)
 *
 * @param {Record<string, any>} data ctx.data
 * @param {Record<string, any>} [content] ctx.content (release calendar)
 */
export function computeLatest(data, content = {}) {
  const latest = {};
  const meta = data.meta?.sources ?? {};

  const khi = data.khi;
  if (khi?.months && khi?.yoy) {
    const l = monthlyLatest(khi.months, khi.yoy);
    if (l) {
      const { i, ...rest } = l;
      latest.khi = {
        ...rest,
        mom: numOrNull(khi.mom?.[i]),
        index2025: numOrNull(khi.index?.['2025=100']?.[i]),
        index2015: numOrNull(khi.index?.['2015=100']?.[i]),
        updated: meta.khi?.updated ?? null,
      };
    }
  }

  const y = data.ykhi;
  for (const [key, code] of [['ykhi', 'FI'], ['ea', 'EA']]) {
    const g = y?.geo?.[code];
    if (!g?.yoy || !y.months) continue;
    const l = monthlyLatest(y.months, g.yoy);
    if (!l) continue;
    const { i, ...rest } = l;
    const flag = y.flags?.[code]?.[l.month] ?? null;
    latest[key] = {
      ...rest,
      mom: numOrNull(g.mom?.[i]),
      coreYoy: numOrNull(g.coreYoy?.[i]),
      index2025: numOrNull(g.index?.['2025=100']?.[i]),
      index2015: numOrNull(g.index?.['2015=100']?.[i]),
      flag,
      provisional: flag === 'p',
      updated: meta.ykhi?.updated ?? null,
    };
  }

  const ka = data['khi-annual'];
  if (ka?.years?.length) {
    const i = stats.latestIndex(ka.yoy);
    if (i >= 0) latest.khiAnnual = { year: Number(ka.years[i]), yoy: ka.yoy[i] };
  }
  const ya = data['ykhi-annual'];
  if (ya?.years?.length && ya.geo?.FI) {
    const i = stats.latestIndex(ya.geo.FI);
    if (i >= 0) latest.ykhiAnnual = { year: Number(ya.years[i]), FI: ya.geo.FI[i], EA: numOrNull(ya.geo.EA?.[i]) };
  }

  const eki = data.elinkustannusindeksi?.monthly;
  if (eki?.months?.length) {
    const i = stats.latestIndex(eki.values);
    if (i >= 0) latest.elinkustannusindeksi = { month: eki.months[i], value: eki.values[i], base: eki.base };
  }

  if (data.hyodykkeet?.latest) latest.hyodykkeet = { month: data.hyodykkeet.latest };

  const pa = data.polttoaineet;
  if (pa?.months?.length && pa.series) {
    const i = Math.max(...Object.values(pa.series).map((s) => stats.latestIndex(s)));
    if (i >= 0) latest.polttoaineet = { month: pa.months[i], values: Object.fromEntries(Object.entries(pa.series).map(([k, s]) => [k, numOrNull(s[i])])) };
  }

  const an = data.ansiot;
  if (an?.periods?.length) {
    const i = stats.latestIndex(an.nominalYoy);
    if (i >= 0) {
      const period = an.periods[i];
      latest.ansiot = { period, nominalYoy: an.nominalYoy[i], realYoy: numOrNull(an.realYoy?.[i]), preliminary: (an.preliminary ?? []).includes(period) };
    }
  }

  const ko = data.korot;
  if (ko?.months?.length) {
    const i = stats.latestIndex(ko.depositRate);
    const now = ko.decisions?.at(-1) ?? null;
    latest.korot = {
      month: i >= 0 ? ko.months[i] : null,
      depositRate: i >= 0 ? ko.depositRate[i] : null,
      euribor12: i >= 0 ? numOrNull(ko.euribor12?.[i]) : null,
      rateNow: now ? now.depositRate : null,
      rateNowFrom: now ? now.date : null,
    };
  }

  // Next releases: the first announced release of a period we do not have yet.
  const cal = content.julkaisukalenteri;
  latest.nextRelease = {
    khi: nextRelease(cal, 'khi', latest.khi?.month),
    'ykhi-ennakko': nextRelease(cal, 'ykhi-ennakko', latest.ykhi?.month),
    // While the latest YKHI month is a flash estimate its final release is still due.
    ykhi: nextRelease(cal, 'ykhi', latest.ykhi?.month, latest.ykhi?.provisional),
  };

  latest.updated = Object.fromEntries(Object.entries(meta).map(([k, s]) => [k, s?.updated ?? null]));
  const dates = Object.values(latest.updated).filter((d) => typeof d === 'string' && !Number.isNaN(Date.parse(d)));
  const newest = dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  latest.dataUpdated = newest ? fmt.isoDate(newest) : data.meta?.generatedAt ? fmt.isoDate(data.meta.generatedAt) : null;
  return latest;
}

/** Validate an output path from a page module. */
function checkOutputPath(p, moduleName) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.includes('..') || p.includes('\\') || p.includes('//') || /[?#\s]/.test(p)) {
    throw new Error(`Page module "${moduleName}" returned an invalid path ${JSON.stringify(p)}`);
  }
}

/** Output path → file inside outDir. */
function fileFor(outDir, p) {
  const rel = p.endsWith('/') ? `${p}index.html` : p;
  return path.join(outDir, ...rel.split('/').filter(Boolean));
}

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const DATA_SCRIPT_TYPES = new Set(['application/ld+json', 'application/json']);

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** CSP source expression for an inline script: `sha256-<base64>` (without quotes). */
export function scriptHash(code) {
  return `sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}`;
}

/**
 * The blocking theme script, inlined into <head> by the layout (one
 * render-blocking request less). Its leading comment block is dropped; the
 * CSP must allow the returned hash in script-src (checked by build()).
 * @returns {{code: string, hash: string}}
 */
export function themeBootScript() {
  const src = readFileSync(path.join(ROOT, 'src', 'js', 'theme-boot.js'), 'utf8');
  const code = src.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trim();
  if (/<\/script/i.test(code)) throw new Error('src/js/theme-boot.js must not contain "</script"');
  return { code, hash: scriptHash(code) };
}

/**
 * Inline-script hashes allowed by the script-src of a headers conf file.
 * @param {string} confText contents of deploy/security-headers*.conf
 * @returns {Set<string>} e.g. 'sha256-…' (without quotes)
 */
export function cspScriptHashes(confText) {
  const csp = confText.match(/Content-Security-Policy\s+"([^"]*)"/)?.[1] ?? '';
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
  return new Set([...scriptSrc.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));
}

let confHashes;
/** Hashes allowed by deploy/security-headers.conf (read once). */
function allowedScriptHashes() {
  confHashes ??= cspScriptHashes(readFileSync(path.join(ROOT, 'deploy', 'security-headers.conf'), 'utf8'));
  return confHashes;
}

/**
 * Find CSP violations in generated HTML (SPEC §10): inline scripts (other than
 * JSON-LD / JSON data islands and scripts whose hash the CSP allows),
 * <style> elements, style="" and on*="" attributes and javascript: URLs.
 * @param {string} doc
 * @param {Set<string>} [allowed] inline-script hashes allowed by the CSP
 * @returns {string[]} problems (empty when safe)
 */
export function cspProblems(doc, allowed = allowedScriptHashes()) {
  const problems = [];
  for (const m of doc.matchAll(INLINE_SCRIPT_RE)) {
    const attrs = {};
    for (const a of (m[1] ?? '').matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    if ('src' in attrs || DATA_SCRIPT_TYPES.has((attrs.type ?? '').toLowerCase())) continue;
    if (allowed.has(scriptHash(m[2]))) continue;
    problems.push(`inline <script${attrs.type ? ` type="${attrs.type}"` : ''}>`);
  }
  for (const m of doc.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    const attrs = {};
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    if (tag === 'style') problems.push('<style> element');
    for (const [name, value] of Object.entries(attrs)) {
      if (name === 'style') problems.push(`style="" on <${tag}>`);
      else if (name.startsWith('on')) problems.push(`${name}="" handler on <${tag}>`);
      if ((name === 'href' || name === 'src' || name === 'action' || name === 'formaction') && /^\s*javascript:/i.test(value)) {
        problems.push(`javascript: URL in ${name} on <${tag}>`);
      }
    }
  }
  return [...new Set(problems)];
}

const isNoindex = (doc) => /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(doc);
const { xmlEscape } = htmlLib;

/** Default robots.txt (PSA-29): AI training crawlers blocked, search allowed. */
function robotsTxt(baseUrl) {
  return `# Inflaatio.fi – robots.txt
# Linja: tekoälymallien koulutukseen dataa keräävät botit estetään.
# Hakukoneet ja hakuvastauspalvelut (esim. OAI-SearchBot, PerplexityBot,
# Claude-SearchBot) saavat indeksoida sivuston.

User-agent: GPTBot
User-agent: CCBot
User-agent: Google-Extended
User-agent: ClaudeBot
User-agent: Applebot-Extended
User-agent: Bytespider
User-agent: meta-externalagent
Disallow: /

User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

/**
 * Run the build.
 * @param {object} [options]
 * @param {string} [options.out='dist'] output directory (relative to the repo root or absolute)
 * @param {string[]|null} [options.only] page module names to build
 * @param {boolean} [options.minify=true]
 * @param {boolean} [options.strict=false] treat warnings as errors
 * @param {boolean} [options.quiet=false]
 * @param {string} [options.pagesDir] page modules directory (tests)
 * @returns {Promise<{outDir: string, pages: string[], files: string[], warnings: string[], manifest: Map<string,string>}>}
 */
export async function build(options = {}) {
  const t0 = performance.now();
  const opts = { out: 'dist', only: null, minify: true, strict: false, quiet: false, pagesDir: path.join(SRC, 'pages'), ...options };
  const outDir = path.resolve(ROOT, opts.out);
  assertSafeOutDir(outDir);
  const log = opts.quiet ? () => {} : (...a) => console.log(...a);
  const warnings = [];

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const data = await loadJsonDir(path.join(ROOT, 'data'));
  const content = await loadJsonDir(path.join(SRC, 'content'));
  const site = (await import(pathToFileURL(path.join(SRC, 'site.config.js')).href)).default;
  const assets = await bundleAssets(outDir, opts);

  // The inline theme script must be allowed by every CSP variant.
  const themeBoot = themeBootScript();
  for (const f of ['security-headers.conf', 'security-headers-embed.conf']) {
    const hashes = cspScriptHashes(await fs.readFile(path.join(ROOT, 'deploy', f), 'utf8'));
    if (!hashes.has(themeBoot.hash)) {
      throw new Error(`deploy/${f}: script-src does not allow the inline theme script (src/js/theme-boot.js changed?). Add '${themeBoot.hash}' to script-src.`);
    }
  }

  const ctx = {
    /** Inline blocking theme script for <head> ({code, hash}). */
    themeBoot,
    site,
    baseUrl: site.baseUrl,
    buildDate: fmt.isoDate(),
    buildTime: new Date().toISOString(),
    dev: !opts.minify,
    only: opts.only,
    data,
    content,
    latest: computeLatest(data, content),
    fmt,
    stats,
    svg,
    c: components,
    html: htmlLib.html,
    raw: htmlLib.raw,
    attrs: htmlLib.attrs,
    classes: htmlLib.classes,
    jsonLd: htmlLib.jsonLd,
    jsonScript: htmlLib.jsonScript,
    safeJson: htmlLib.safeJson,
    /** Public URL of a bundled asset ('site.js', 'main.css', 'pages/home.js', 'fonts/…woff2'). */
    asset(name, { optional = false } = {}) {
      const url = assets.manifest.get(name);
      if (!url && !optional) {
        throw new Error(`Unknown asset "${name}". Known: ${[...assets.manifest.keys()].join(', ')}`);
      }
      return url ?? null;
    },
    /** Static chunk URLs imported by an entry (for <link rel="modulepreload">). */
    assetImports: (name) => assets.imports.get(name) ?? [],
    warn: (msg) => warnings.push(msg),
  };
  ctx.layout = (a, b) => (b === undefined ? layout(ctx, a) : layout(a, b));
  ctx.crumbs = (...args) => crumbs(ctx, ...args);

  // Page modules
  const available = (await walk(opts.pagesDir)).filter((f) => f.endsWith('.js') && !f.includes('/')).map((f) => f.slice(0, -3));
  if (opts.only) {
    const unknown = opts.only.filter((n) => !available.includes(n));
    if (unknown.length) throw new Error(`--only: unknown page module(s) ${unknown.join(', ')}. Available: ${available.join(', ') || '(none)'}`);
  }
  const selected = opts.only ? available.filter((n) => opts.only.includes(n)) : available;
  /** @type {Map<string, {module: string, html?: string, body?: string|Buffer, meta: object}>} */
  const outputs = new Map();
  for (const name of selected) {
    const mod = await import(pathToFileURL(path.join(opts.pagesDir, `${name}.js`)).href);
    if (typeof mod.default !== 'function') throw new Error(`Page module "${name}" must default-export async (ctx) => outputs`);
    let result;
    try {
      result = await mod.default(ctx);
    } catch (err) {
      err.message = `Page module "${name}" failed: ${err.message}`;
      throw err;
    }
    for (const o of result ?? []) {
      checkOutputPath(o?.path, name);
      if (outputs.has(o.path)) throw new Error(`Duplicate output path ${o.path} (modules "${outputs.get(o.path).module}" and "${name}")`);
      if (o.html != null) {
        if (!o.path.endsWith('/') && !o.path.endsWith('.html')) throw new Error(`HTML output ${o.path} (module "${name}") must end with "/" or ".html"`);
        outputs.set(o.path, { module: name, html: String(o.html), meta: o });
      } else if (o.body != null) {
        outputs.set(o.path, { module: name, body: o.body, meta: o });
      } else throw new Error(`Output ${o.path} (module "${name}") has neither html nor body`);
    }
  }

  // CSP check before writing anything
  const cspErrors = [];
  for (const [p, o] of outputs) {
    if (o.html == null) continue;
    for (const problem of cspProblems(o.html)) cspErrors.push(`${p}: ${problem}`);
  }
  if (cspErrors.length) throw new Error(`CSP violations in generated HTML:\n  ${cspErrors.join('\n  ')}`);

  // Static files
  const staticDir = path.join(SRC, 'static');
  const staticFiles = await walk(staticDir);
  for (const rel of staticFiles) {
    const p = `/${rel}`;
    if (outputs.has(p)) throw new Error(`Duplicate output path ${p} (module "${outputs.get(p).module}" and src/static)`);
    if (assets.files.some((f) => f.url === p)) throw new Error(`Duplicate output path ${p} (bundled asset and src/static)`);
  }

  // Write
  for (const [p, o] of outputs) {
    const file = fileFor(outDir, p);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, o.html ?? o.body);
  }
  for (const rel of staticFiles) {
    const dest = path.join(outDir, ...rel.split('/'));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(staticDir, ...rel.split('/')), dest);
  }

  // Sitemap + robots
  const htmlPages = [...outputs].filter(([, o]) => o.html != null);
  const indexable = htmlPages
    .filter(([p, o]) => o.meta.sitemap !== false && !o.meta.noindex && !isNoindex(o.html) && p !== '/404.html')
    .map(([p]) => p)
    .sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
  const has = (p) => outputs.has(p) || staticFiles.includes(p.slice(1));
  const defaultLastmod = ctx.latest.dataUpdated ?? ctx.buildDate;
  if (!has('/sitemap.xml')) {
    const urls = indexable.map((p) => {
      const m = outputs.get(p).meta;
      const extra = `${m.changefreq ? `<changefreq>${xmlEscape(m.changefreq)}</changefreq>` : ''}${m.priority != null ? `<priority>${xmlEscape(m.priority)}</priority>` : ''}`;
      return `  <url><loc>${xmlEscape(ctx.baseUrl + p)}</loc><lastmod>${xmlEscape(m.lastmod ?? defaultLastmod)}</lastmod>${extra}</url>`;
    });
    await fs.writeFile(
      path.join(outDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    );
  }
  if (!has('/robots.txt')) await fs.writeFile(path.join(outDir, 'robots.txt'), robotsTxt(ctx.baseUrl));

  if (opts.strict && warnings.length) throw new Error(`Build warnings (--strict):\n  ${warnings.join('\n  ')}`);

  // Summary
  const ms = Math.round(performance.now() - t0);
  const rel = toPosix(path.relative(ROOT, outDir)) || '.';
  log(`\nInflaatio.fi build → ${rel}  (${opts.minify ? 'minified' : 'dev, not minified'})`);
  log(`  modules   ${selected.length ? selected.join(', ') : '(none)'}`);
  log(`  pages     ${htmlPages.length} HTML, ${outputs.size - htmlPages.length} other files`);
  const shown = assets.files.filter((f) => !f.url.startsWith('/fonts/')).sort((a, b) => a.url.localeCompare(b.url));
  for (const f of shown) {
    const gz = gzipSync(await fs.readFile(f.file)).length;
    log(`  asset     ${f.url.padEnd(48)} ${kb(f.bytes).padStart(9)}  gzip ${kb(gz).padStart(8)}`);
  }
  const fonts = assets.files.filter((f) => f.url.startsWith('/fonts/'));
  log(`  fonts     ${fonts.length} file(s), ${kb(fonts.reduce((s, f) => s + f.bytes, 0))}`);
  log(`  static    ${staticFiles.length} file(s) from src/static`);
  log(`  sitemap   ${has('/sitemap.xml') ? 'provided' : `${indexable.length} URL(s)`} · robots.txt ${has('/robots.txt') ? 'provided' : 'generated'}`);
  for (const w of warnings) log(`  WARNING   ${w}`);
  log(`  done in ${ms} ms\n`);

  return {
    outDir,
    pages: htmlPages.map(([p]) => p),
    files: [...outputs.keys()],
    warnings,
    manifest: assets.manifest,
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.help) {
    console.log('Usage: node scripts/build.js [--out <dir>] [--only <page1,page2>] [--no-minify] [--strict] [--quiet]');
    process.exit(0);
  }
  build(args).catch((err) => {
    console.error(`\nBuild failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}
