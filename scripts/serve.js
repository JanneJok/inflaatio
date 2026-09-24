#!/usr/bin/env node
/**
 * Local static server that behaves like production nginx (deploy/nginx.conf):
 * - security headers parsed from deploy/security-headers.conf (the single
 *   source), and deploy/security-headers-embed.conf for the widget /upotus/;
 * - the same cache rules, MIME types, redirects and 404 handling.
 *
 *   node scripts/serve.js [--dir dist] [--port 8080] [--host 127.0.0.1]
 *                         [--build] [--watch] [--only a,b] [--no-minify] [--strict-csp] [--quiet]
 *
 * --build runs scripts/build.js into --dir first; --watch rebuilds when src/,
 * data/ or scripts/lib/ change (reload the browser yourself).
 * On plain http://localhost the CSP directive `upgrade-insecure-requests` is
 * dropped (it would rewrite same-origin asset URLs to https and break the
 * page); --strict-csp keeps it.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Permanent redirects (same as nginx). */
export const REDIRECTS = Object.freeze({
  '/index.html': '/',
  '/terms-of-use.html': '/kayttoehdot/',
});

/** Routes served with the embeddable-widget header set. */
export const EMBED_PATHS = Object.freeze(['/upotus/', '/upotus/index.html']);

export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.rss': 'application/rss+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
});

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico']);

/**
 * Parse nginx `add_header Name "value" [always];` lines.
 * @param {string} text
 * @returns {{name: string, value: string}[]}
 */
export function parseHeadersConf(text) {
  const out = [];
  const re = /^\s*add_header\s+([A-Za-z0-9-]+)\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s;]+))(?:\s+always)?\s*;\s*(?:#.*)?$/;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(re);
    if (!m) throw new Error(`Cannot parse header line: ${line.trim()}`);
    out.push({ name: m[1], value: (m[2] ?? m[3] ?? m[4]).replace(/\\(.)/g, '$1') });
  }
  return out;
}

/**
 * Cache-Control for a URL path (mirror these rules in deploy/nginx.conf).
 * @param {string} urlPath decoded path, e.g. '/assets/site-ABC.js'
 * @param {boolean} [isHtml]
 */
export function cacheControl(urlPath, isHtml = false) {
  if (urlPath.startsWith('/assets/') || urlPath.startsWith('/fonts/')) return 'public, max-age=31536000, immutable';
  if (isHtml || urlPath.endsWith('/') || urlPath.endsWith('.html')) return 'no-cache';
  if (urlPath.startsWith('/data/')) return 'public, max-age=3600';
  // The share image is regenerated every month: a day, not a week.
  if (urlPath.startsWith('/og/')) return 'public, max-age=86400';
  if (IMAGE_EXT.has(path.extname(urlPath).toLowerCase())) return 'public, max-age=604800';
  return 'no-cache';
}

/** @param {string} file */
export function contentType(file) {
  const base = path.basename(file);
  if (base === 'feed.xml') return 'application/rss+xml; charset=utf-8';
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Load both header sets.
 * @param {{strictCsp?: boolean}} [o]
 */
export async function loadHeaderSets({ strictCsp = false } = {}) {
  const read = async (f) => parseHeadersConf(await fsp.readFile(path.join(ROOT, 'deploy', f), 'utf8'));
  const adapt = (list) =>
    list.map((h) =>
      !strictCsp && h.name.toLowerCase() === 'content-security-policy'
        ? { ...h, value: h.value.replace(/;\s*upgrade-insecure-requests\s*(?=;|$)/, '').trim() }
        : h,
    );
  const main = adapt(await read('security-headers.conf'));
  const embedFile = path.join(ROOT, 'deploy', 'security-headers-embed.conf');
  const embed = fs.existsSync(embedFile) ? adapt(await read('security-headers-embed.conf')) : main;
  return { main, embed };
}

/**
 * Create the HTTP server.
 * @param {object} o
 * @param {string} o.dir absolute directory to serve
 * @param {{main: {name: string, value: string}[], embed: {name: string, value: string}[]}} o.headers
 * @param {boolean} [o.quiet=false]
 * @returns {http.Server}
 */
export function createServer({ dir, headers, quiet = false }) {
  const root = path.resolve(dir);
  return http.createServer(async (req, res) => {
    const t0 = Date.now();
    const done = (status) => {
      if (!quiet) console.log(`${req.method} ${req.url} ${status} ${Date.now() - t0}ms`);
    };
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      res.writeHead(400).end('Bad request');
      return done(400);
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = null;
    }
    const set = pathname && EMBED_PATHS.includes(pathname) ? headers.embed : headers.main;
    for (const h of set) res.setHeader(h.name, h.value);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }).end('Method not allowed');
      return done(405);
    }
    if (!pathname || pathname.includes('\0') || pathname.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bad request');
      return done(400);
    }
    const redirect = (to, status = 301) => {
      res.writeHead(status, { Location: to + url.search, 'Cache-Control': 'no-cache' }).end();
      done(status);
    };
    if (REDIRECTS[pathname]) return redirect(REDIRECTS[pathname]);
    if (pathname.endsWith('/index.html')) return redirect(pathname.slice(0, -'index.html'.length));

    const full = path.join(root, ...pathname.split('/').filter(Boolean));
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.writeHead(403).end('Forbidden');
      return done(403);
    }

    let file = full;
    let stat = await fsp.stat(file).catch(() => null);
    if (stat?.isDirectory()) {
      if (!pathname.endsWith('/')) return redirect(`${pathname}/`);
      file = path.join(full, 'index.html');
      stat = await fsp.stat(file).catch(() => null);
    }
    let status = 200;
    if (!stat?.isFile()) {
      status = 404;
      file = path.join(root, '404.html');
      stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }).end('404 Not Found');
        return done(404);
      }
    }

    const type = contentType(file);
    const isHtml = type.startsWith('text/html');
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', status === 404 ? 'no-cache' : cacheControl(pathname, isHtml));
    if (status === 200) {
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304).end();
        return done(304);
      }
    }
    res.setHeader('Content-Length', stat.size);
    res.writeHead(status);
    if (req.method === 'HEAD') {
      res.end();
      return done(status);
    }
    fs.createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res)
      .on('finish', () => done(status));
  });
}

/** Parse CLI arguments. @param {string[]} argv */
export function parseServeArgs(argv) {
  const o = { dir: 'dist', port: 8080, host: '127.0.0.1', build: false, watch: false, only: null, minify: true, strictCsp: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (v == null || v.startsWith('--')) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--dir' || a.startsWith('--dir=')) o.dir = val();
    else if (a === '--port' || a.startsWith('--port=')) o.port = Number(val());
    else if (a === '--host' || a.startsWith('--host=')) o.host = val();
    else if (a === '--only' || a.startsWith('--only=')) o.only = val();
    else if (a === '--build') o.build = true;
    else if (a === '--watch') o.watch = o.build = true;
    else if (a === '--no-minify') o.minify = false;
    else if (a === '--strict-csp') o.strictCsp = true;
    else if (a === '--quiet') o.quiet = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error('Invalid --port');
  return o;
}

/** Run the build in a child process (fresh module graph every time). */
function runBuild(o) {
  const args = [path.join(ROOT, 'scripts', 'build.js'), '--out', o.dir];
  if (o.only) args.push('--only', o.only);
  if (!o.minify) args.push('--no-minify');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
  });
}

function watch(o) {
  let timer = null;
  let running = false;
  let again = false;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      await runBuild(o);
      running = false;
      if (again) {
        again = false;
        trigger();
      }
    }, 150);
  };
  for (const d of ['src', 'data', path.join('scripts', 'lib'), 'deploy']) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full)) fs.watch(full, { recursive: true }, trigger);
  }
  console.log('Watching src/, data/, scripts/lib/ and deploy/ for changes…');
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  let o;
  try {
    o = parseServeArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const dir = path.resolve(ROOT, o.dir);
  if (o.build && !(await runBuild(o))) {
    if (!o.watch) process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.error(`Directory ${dir} does not exist. Run "npm run build" first (or use --build).`);
    process.exit(1);
  }
  const headers = await loadHeaderSets({ strictCsp: o.strictCsp });
  const server = createServer({ dir, headers, quiet: o.quiet });
  server.listen(o.port, o.host, () => {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    console.log(`Serving ${path.relative(ROOT, dir) || '.'} at http://${o.host === '0.0.0.0' ? 'localhost' : o.host}:${port}/`);
    if (!o.strictCsp) console.log('(CSP: upgrade-insecure-requests dropped for plain-http local serving; use --strict-csp to keep it)');
  });
  if (o.watch) watch(o);
}
