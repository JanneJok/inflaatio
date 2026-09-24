#!/usr/bin/env node
/**
 * Internal link checker for the built site.
 *
 *   node scripts/check-links.js [--dir dist] [--base https://inflaatio.fi]
 *
 * Crawls every *.html under --dir and checks each internal href / src /
 * srcset / poster / og:image / canonical / manifest icon reference:
 * - the target file exists (directories need a trailing slash → index.html);
 * - #fragment targets exist as id (or name) on the target page;
 * - absolute URLs on the site's own origin are treated as internal;
 * - javascript: URLs are errors.
 * Also verifies sitemap.xml locations. Prints a report and exits 1 on any
 * broken reference (warnings, e.g. links that rely on a redirect, do not fail).
 */
import fs from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Paths the server redirects (see scripts/serve.js / nginx). */
const REDIRECTED = new Set(['/index.html', '/terms-of-use.html']);

const TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const decodeEntities = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[e]);

/** List *.html files under dir (posix relative paths). */
async function htmlFiles(dir, base = dir) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await htmlFiles(full, base)));
    else if (ent.name.endsWith('.html')) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/** URL path of a built HTML file ('tyylit/index.html' → '/tyylit/'). */
const pagePath = (rel) => `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;

/**
 * Extract references and ids from an HTML document.
 * @param {string} doc
 * @returns {{refs: {attr: string, tag: string, value: string}[], ids: Set<string>}}
 */
export function scan(doc) {
  const refs = [];
  const ids = new Set();
  // Ignore JSON-LD / data islands and code samples in <pre>.
  const cleaned = doc.replace(/<script\b[^>]*type="application\/(?:ld\+)?json"[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const m of cleaned.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase();
    const attrs = {};
    for (const a of (m[2] ?? '').matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    if (attrs.id) ids.add(attrs.id);
    if (tag === 'a' && attrs.name) ids.add(attrs.name);
    for (const attr of ['href', 'src', 'poster', 'action', 'data-copy-target']) {
      if (attrs[attr] == null) continue;
      if (attr === 'data-copy-target') {
        // selector of an element on the same page: only '#id' selectors are checked
        if (/^#[\w-]+$/.test(attrs[attr])) refs.push({ attr, tag, value: attrs[attr] });
        continue;
      }
      if (tag === 'link' && /\b(preconnect|dns-prefetch)\b/.test(attrs.rel ?? '')) continue;
      refs.push({ attr, tag, value: attrs[attr] });
    }
    if (attrs.srcset) {
      for (const part of attrs.srcset.split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u) refs.push({ attr: 'srcset', tag, value: u });
      }
    }
    if (tag === 'meta' && /^(og:image|og:url|twitter:image)$/.test(attrs.property ?? attrs.name ?? '') && attrs.content) {
      refs.push({ attr: attrs.property ?? attrs.name, tag, value: attrs.content });
    }
    for (const aria of ['aria-controls', 'aria-labelledby', 'aria-describedby']) {
      if (attrs[aria]) for (const id of attrs[aria].split(/\s+/)) refs.push({ attr: aria, tag, value: `#${id}` });
    }
  }
  return { refs, ids };
}

/**
 * Resolve a reference to an internal URL path + fragment, or null for external.
 * @param {string} value
 * @param {string} fromPath page URL path
 * @param {string} base site origin
 */
export function resolveRef(value, fromPath, base) {
  const v = value.trim();
  if (!v || /^(mailto|tel|data|blob|sms):/i.test(v)) return null;
  if (/^javascript:/i.test(v)) return { error: 'forbidden script URL' };
  let url;
  try {
    url = new URL(v, `${base}${fromPath}`);
  } catch {
    return { error: 'unparseable URL' };
  }
  if (url.origin !== new URL(base).origin) return null;
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return { error: 'bad percent-encoding' };
  }
  return { path: p, hash: url.hash ? decodeURIComponent(url.hash.slice(1)) : '' };
}

/**
 * Check a built site.
 * @param {{dir: string, base?: string}} o
 * @returns {Promise<{errors: string[], warnings: string[], pages: number, refs: number}>}
 */
export async function checkLinks({ dir, base = 'https://inflaatio.fi' }) {
  const root = path.resolve(dir);
  const files = await htmlFiles(root);
  const pages = new Map();
  for (const rel of files) pages.set(pagePath(rel), scan(await fs.readFile(path.join(root, rel), 'utf8')));

  const errors = [];
  const warnings = [];
  let count = 0;
  const targetOf = (p) => {
    const full = path.join(root, ...p.split('/').filter(Boolean));
    if (p.endsWith('/')) return existsSync(path.join(full, 'index.html')) ? { file: path.join(full, 'index.html'), page: p } : null;
    if (!existsSync(full)) return null;
    if (statSync(full).isDirectory()) return existsSync(path.join(full, 'index.html')) ? { file: full, page: `${p}/`, redirect: true } : null;
    return { file: full, page: p.endsWith('.html') ? p : null };
  };

  for (const [from, { refs }] of pages) {
    for (const ref of refs) {
      count++;
      const r = resolveRef(ref.value, from, base);
      if (!r) continue;
      const where = `${from}: <${ref.tag} ${ref.attr}="${ref.value}">`;
      if (r.error) {
        errors.push(`${where} – ${r.error}`);
        continue;
      }
      if (REDIRECTED.has(r.path)) {
        warnings.push(`${where} – relies on a redirect`);
        continue;
      }
      const t = targetOf(r.path);
      if (!t) {
        errors.push(`${where} – target not found`);
        continue;
      }
      if (t.redirect) warnings.push(`${where} – directory without trailing slash (redirect)`);
      if (r.hash) {
        const page = pages.get(t.page ?? '') ?? (t.page === null ? null : undefined);
        if (page && !page.ids.has(r.hash)) errors.push(`${where} – #${r.hash} not found on ${t.page}`);
      }
    }
  }

  const sitemap = path.join(root, 'sitemap.xml');
  if (existsSync(sitemap)) {
    const xml = await fs.readFile(sitemap, 'utf8');
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      count++;
      const r = resolveRef(decodeEntities(m[1]), '/', base);
      if (!r || r.error || !targetOf(r.path)) errors.push(`sitemap.xml: ${m[1]} – target not found`);
    }
  }
  return { errors, warnings, pages: pages.size, refs: count };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
    if (i < 0) return def;
    return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1];
  };
  const dir = path.resolve(ROOT, get('--dir', 'dist'));
  if (!existsSync(dir)) {
    console.error(`Directory ${dir} does not exist. Run the build first.`);
    process.exit(1);
  }
  const { errors, warnings, pages, refs } = await checkLinks({ dir, base: get('--base', 'https://inflaatio.fi') });
  for (const w of warnings) console.log(`warning  ${w}`);
  for (const e of errors) console.log(`BROKEN   ${e}`);
  console.log(`\nChecked ${refs} references on ${pages} pages: ${errors.length} broken, ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}
