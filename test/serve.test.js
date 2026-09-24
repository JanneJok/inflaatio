import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseHeadersConf, loadHeaderSets, cacheControl, contentType, createServer, parseServeArgs, nginxTokens, nginxMapEntries, nginxMap, nginxRules } from '../scripts/serve.js';
import { ROOT } from '../scripts/build.js';

const SPEC_CSP =
  "default-src 'self'; script-src 'self' 'sha256-jPKVHX9ljZgx69o9taZ79IjAj29CX8MPrJ/jNHqYzAc=' https://www.googletagmanager.com; connect-src 'self' https://ysuhexvvgjoizrcdrxso.supabase.co https://api.emailjs.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; img-src 'self' data: https://*.google-analytics.com https://www.googletagmanager.com; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests";

const readConf = async (f) => parseHeadersConf(await fs.readFile(path.join(ROOT, 'deploy', f), 'utf8'));
const asObject = (list) => Object.fromEntries(list.map((h) => [h.name, h.value]));

test('security-headers.conf is exactly SPEC §10', async () => {
  const h = asObject(await readConf('security-headers.conf'));
  assert.deepEqual(h, {
    'Content-Security-Policy': SPEC_CSP,
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
});

test('embed header set = main set with frame-ancestors * and no X-Frame-Options', async () => {
  const main = asObject(await readConf('security-headers.conf'));
  const embed = asObject(await readConf('security-headers-embed.conf'));
  const expected = { ...main, 'Content-Security-Policy': main['Content-Security-Policy'].replace("frame-ancestors 'none'", 'frame-ancestors *') };
  delete expected['X-Frame-Options'];
  assert.deepEqual(embed, expected);
});

test('parseHeadersConf rejects lines it does not understand', () => {
  assert.throws(() => parseHeadersConf('add_header Broken'), /Cannot parse/);
  assert.deepEqual(parseHeadersConf('# c\n\nadd_header X-A "b c" always;\nadd_header X-B d;'), [
    { name: 'X-A', value: 'b c' },
    { name: 'X-B', value: 'd' },
  ]);
});

test('cache and MIME rules', () => {
  assert.equal(cacheControl('/assets/site-ABCDEFGH.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('/fonts/inter-X.woff2'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControl('/hinnat/'), 'no-cache');
  assert.equal(cacheControl('/404.html'), 'no-cache');
  assert.equal(cacheControl('/data/khi.csv'), 'public, max-age=3600');
  assert.equal(cacheControl('/icons/apple-touch-icon.png'), 'public, max-age=604800');
  assert.equal(contentType('site.webmanifest'), 'application/manifest+json; charset=utf-8');
  assert.equal(contentType('sitemap.xml'), 'application/xml; charset=utf-8');
  assert.equal(contentType('feed.xml'), 'application/rss+xml; charset=utf-8');
  assert.equal(contentType('khi.csv'), 'text/csv; charset=utf-8');
  assert.equal(contentType('a.woff2'), 'font/woff2');
  assert.throws(() => parseServeArgs(['--port', 'x']), /Invalid --port/);
});

let tmp;
let server;
let base;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-serve-'));
  const w = async (rel, body) => {
    const f = path.join(tmp, ...rel.split('/'));
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, body);
  };
  await w('index.html', '<!doctype html><title>etusivu</title>');
  await w('404.html', '<!doctype html><title>Sivua ei löytynyt</title>');
  await w('hinnat/index.html', '<!doctype html><title>hinnat</title>');
  await w('upotus/index.html', '<!doctype html><title>upotus</title>');
  await w('assets/site-ABCDEFGH.js', 'export {};');
  await w('site.webmanifest', '{}');
  server = createServer({ dir: tmp, headers: await loadHeaderSets(), quiet: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

const get = (p, init = {}) => fetch(base + p, { redirect: 'manual', ...init });

test('serves pages with security headers (local CSP without upgrade-insecure-requests)', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const csp = res.headers.get('content-security-policy');
  assert.equal(csp, SPEC_CSP.replace('; upgrade-insecure-requests', ''));
  assert.match(await res.text(), /etusivu/);
});

test('redirects: /index.html, /terms-of-use.html, directory without slash', async () => {
  let res = await get('/index.html');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/');
  res = await get('/terms-of-use.html');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/kayttoehdot/');
  res = await get('/hinnat?mittari=ykhi');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/hinnat/?mittari=ykhi');
  res = await get('/hinnat/index.html');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/hinnat/');
});

test('404 page with 404 status; assets immutable; manifest MIME; HEAD; 405', async () => {
  let res = await get('/olematon-sivu/');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Sivua ei löytynyt/);
  assert.ok(res.headers.get('content-security-policy'));
  res = await get('/assets/site-ABCDEFGH.js');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const etag = res.headers.get('etag');
  await res.arrayBuffer();
  res = await get('/assets/site-ABCDEFGH.js', { headers: { 'If-None-Match': etag } });
  assert.equal(res.status, 304);
  res = await get('/site.webmanifest', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  res = await get('/', { method: 'POST' });
  assert.equal(res.status, 405);
  res = await get('/%2e%2e/%2e%2e/etc/passwd');
  assert.notEqual(res.status, 200);
});

test('the widget route may be framed; other routes may not', async () => {
  const res = await get('/upotus/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), null);
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors \*/);
  const other = await get('/hinnat/');
  assert.match(other.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('nginx map parsing: quoting, escapes, comments, flags, exact before regex', () => {
  const conf = String.raw`
# comment { ; }
map $uri $x_redirect {
    volatile;   # a flag, not an entry
    default "";
    /exact           /target/;
    "~^/img/((a|b)\.png)$"  /icons/$1;
    "~*^/CASE/"      /case/;
    '/q uoted'       "/with space";
}
map $uri $other { default 1; }
`;
  assert.deepEqual(nginxTokens('a "b\\"c" \'d\\.e\' {f;}').map((t) => t.word ?? t.punct), ['a', 'b"c', 'd\\.e', '{', 'f', ';', '}']);
  const entries = nginxMapEntries(conf, '$x_redirect');
  assert.deepEqual(entries[0], ['volatile']);
  assert.equal(nginxMapEntries(conf, '$missing'), null);
  const look = nginxMap(entries);
  assert.equal(look('/exact'), '/target/');
  assert.equal(look('/img/a.png'), '/icons/a.png');
  assert.equal(look('/img/aXpng'), '', 'the dot is escaped');
  assert.equal(look('/case/x'), '/case/', '~* is case-insensitive');
  assert.equal(look('/q uoted'), '/with space');
  assert.equal(look('/nothing'), '');
});

test('the old-site rules are read from deploy/nginx.conf (no second list to maintain)', () => {
  const r = nginxRules();
  assert.equal(r.redirect('/terms-of-use.html'), '/kayttoehdot/');
  assert.equal(r.redirect('/image/favicon.ico'), '/favicon.ico');
  assert.equal(r.redirect('/image/apple-touch-icon.png'), '/icons/apple-touch-icon.png');
  assert.equal(r.redirect('/hinnat/'), '');
  for (const old of ['/index.html.backup', '/inflation-site-optimized.min.js', '/docs/plans/ROADMAP.html', '/image/footer.webp', '/package.json']) assert.ok(r.gone(old), old);
  for (const route of ['/', '/hinnat/', '/healthz', '/404.html', '/data/khi.csv', '/assets/site-ABCDEFGH.js']) assert.equal(r.gone(route), false, route);
});

test('nginx parity: old URLs 301, old files 410 with the 404 page, /healthz, dotfiles, direct /404.html', async () => {
  let res = await get('/image/favicon.ico?v=2');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/favicon.ico?v=2');
  res = await get('/index.html.backup');
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.ok(res.headers.get('content-security-policy'));
  assert.match(await res.text(), /Sivua ei löytynyt/);
  res = await get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(res.headers.get('x-content-type-options'));
  assert.equal(await res.text(), 'ok\n');
  res = await get('/healthz', { method: 'HEAD' });
  assert.equal(res.status, 200);
  for (const p of ['/.git/config', '/.env', '/hinnat/.htaccess', '/404.html', '/assets/']) {
    res = await get(p);
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get('cache-control'), 'no-cache', p);
    assert.match(await res.text(), /Sivua ei löytynyt/, p);
  }
});
