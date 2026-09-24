/**
 * Operations: nginx configuration, Docker image, Fly.io, GitHub workflows,
 * Dependabot, robots.txt and the service worker kill switch.
 *
 * The static checks run in every `npm test` (no network, no Docker).
 *
 * The "smoke: …" tests run only when SMOKE_URL is set. They check a running
 * server over HTTP: a local container, the Fly app or production.
 *
 *   docker run -d -p 8108:8080 --name inflaatio-local inflaatio-local
 *   SMOKE_URL=http://127.0.0.1:8108 node --test --test-name-pattern='^smoke' test/ops.test.js
 *
 * Options: SMOKE_PAGE (page to inspect, default '/'), SMOKE_EXPECT_LATEST=1
 * (the page must show the latest KHI month of data/meta.json). CI runs them
 * against the built image, deploy.yml / update-data.yml against the Fly app
 * after a deployment, and site-check.yml against https://inflaatio.fi.
 *
 * Only Node built-ins and dependency-free repository modules are imported, so
 * the smoke tests run without `npm ci`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHeadersConf, cacheControl, contentType, MIME, REDIRECTS, EMBED_PATHS } from '../scripts/serve.js';
import { monthName, monthShort } from '../src/js/lib/format.js';
import { PAGES } from '../src/site.config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

// ---------------------------------------------------------------------------
// A small nginx configuration parser (enough for deploy/nginx.conf).
// ---------------------------------------------------------------------------

/**
 * Tokenise nginx configuration text: words (quoted or bare), '{', '}', ';'.
 * Comments are dropped. Inside quotes only an escaped quote is unescaped.
 * @param {string} text
 * @returns {{t: string, v?: string}[]}
 */
export function nginxTokens(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '{' || ch === '}' || ch === ';') {
      tokens.push({ t: ch });
      i++;
    } else if (ch === '"' || ch === "'") {
      let v = '';
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === '\\' && text[j + 1] === ch) {
          v += ch;
          j += 2;
        } else v += text[j++];
      }
      if (j >= text.length) throw new Error('Unterminated string in nginx configuration');
      tokens.push({ t: 'word', v });
      i = j + 1;
    } else {
      let v = '';
      while (i < text.length && !/[\s;{}]/.test(text[i])) v += text[i++];
      tokens.push({ t: 'word', v });
    }
  }
  return tokens;
}

/**
 * Parse nginx configuration into directives { name, args, block? }.
 * @param {string} text
 */
export function parseNginx(text) {
  const tokens = nginxTokens(text);
  let pos = 0;
  const block = (nested) => {
    const out = [];
    while (pos < tokens.length) {
      if (tokens[pos].t === '}') {
        if (!nested) throw new Error('Unexpected "}"');
        pos++;
        return out;
      }
      const words = [];
      while (pos < tokens.length && tokens[pos].t === 'word') words.push(tokens[pos++].v);
      const end = tokens[pos++];
      if (!words.length || !end) throw new Error(`Malformed directive near "${words.join(' ')}"`);
      if (end.t === ';') out.push({ name: words[0], args: words.slice(1) });
      else if (end.t === '{') out.push({ name: words[0], args: words.slice(1), block: block(true) });
      else throw new Error(`Unexpected "${end.t}" after "${words.join(' ')}"`);
    }
    if (nested) throw new Error('Missing "}"');
    return out;
  };
  return block(false);
}

/** Depth-first visit of every directive. */
function visit(nodes, fn, parents = []) {
  for (const n of nodes) {
    fn(n, parents);
    if (n.block) visit(n.block, fn, [...parents, n]);
  }
}

const directive = (block, name) => block.find((d) => d.name === name);
const directives = (block, name) => block.filter((d) => d.name === name);

/**
 * Evaluate an nginx `map` like nginx does: exact strings first, then regular
 * expressions in order of appearance (captures substituted), then default.
 * @param {{name: string, args: string[]}[]} entries map block
 * @param {string} input
 */
export function evalMap(entries, input) {
  let fallback = '';
  const regexes = [];
  for (const e of entries) {
    if (e.name === 'default') fallback = e.args[0];
    else if (e.name.startsWith('~')) regexes.push(e);
    else if (e.name === input) return e.args[0];
  }
  for (const e of regexes) {
    const insensitive = e.name.startsWith('~*');
    const m = input.match(new RegExp(e.name.slice(insensitive ? 2 : 1), insensitive ? 'i' : ''));
    if (m) return e.args[0].replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? '');
  }
  return fallback;
}

const conf = parseNginx(read('deploy/nginx.conf'));
const servers = directives(conf, 'server');
const mainServer = servers.find((s) => directive(s.block, 'server_name')?.args[0] === '_');
const mapBlock = (variable) => conf.find((d) => d.name === 'map' && d.args[1] === variable)?.block;
const locations = [];
visit(conf, (n) => {
  if (n.name === 'location') locations.push(n);
});
const location = (...args) => locations.find((l) => l.args.join(' ') === args.join(' '));

// ---------------------------------------------------------------------------
// nginx: headers
// ---------------------------------------------------------------------------

test('nginx.conf parses; one default server on port 8080 (= fly.toml internal_port)', () => {
  assert.ok(mainServer, 'server with server_name _');
  assert.deepEqual(directive(mainServer.block, 'listen').args, ['8080', 'default_server']);
  const port = read('fly.toml').match(/^\s*internal_port\s*=\s*(\d+)/m)?.[1];
  assert.equal(port, '8080');
  for (const s of servers) assert.equal(directive(s.block, 'listen').args[0], port);
});

test('every server and location block includes exactly one security header file (add_header is not inherited)', () => {
  const blocks = [];
  visit(conf, (n) => {
    if (n.name === 'server' || n.name === 'location') blocks.push(n);
  });
  assert.ok(blocks.length >= 7);
  for (const b of blocks) {
    const label = `${b.name} ${b.args.join(' ')}`.trim();
    const headerFiles = directives(b.block, 'include')
      .map((d) => path.posix.basename(d.args[0]))
      .filter((f) => f.startsWith('security-headers'));
    assert.equal(headerFiles.length, 1, `${label} must include one security header file`);
    assert.ok(['security-headers.conf', 'security-headers-embed.conf'].includes(headerFiles[0]), label);
    const hasCacheControl = directives(b.block, 'add_header').some((d) => d.args[0] === 'Cache-Control');
    const returnsEarly = directive(b.block, 'return');
    assert.ok(hasCacheControl || returnsEarly, `${label} sets Cache-Control`);
    for (const h of directives(b.block, 'add_header')) assert.equal(h.args.at(-1), 'always', `${label}: add_header ${h.args[0]} … always`);
  }
});

test('only the widget route /upotus/ uses the embed header set, served without an internal redirect', () => {
  const embed = locations.filter((l) => directives(l.block, 'include').some((d) => d.args[0].endsWith('security-headers-embed.conf')));
  assert.deepEqual(embed.map((l) => l.args.join(' ')), ['= /upotus/']);
  assert.deepEqual(directive(embed[0].block, 'try_files').args, ['/upotus/index.html', '=404']);
  assert.ok(EMBED_PATHS.includes('/upotus/'), 'scripts/serve.js uses the same route');
});

test('header include paths match where the Dockerfile copies the header files', () => {
  const dockerfile = read('Dockerfile');
  const copy = dockerfile.match(/^COPY\s+deploy\/security-headers\.conf\s+deploy\/security-headers-embed\.conf\s+(\S+)\s*$/m);
  assert.ok(copy, 'Dockerfile copies both header files');
  const dir = copy[1].replace(/\/$/, '');
  visit(conf, (n) => {
    if (n.name === 'include' && n.args[0].includes('security-headers')) assert.equal(path.posix.dirname(n.args[0]), dir);
  });
  assert.match(dockerfile, /^COPY\s+deploy\/nginx\.conf\s+\/etc\/nginx\/conf\.d\/\S+\.conf\s*$/m);
});

test('security header files: CSP identical except frame-ancestors; embed drops only X-Frame-Options', () => {
  const main = parseHeadersConf(read('deploy/security-headers.conf'));
  const embed = parseHeadersConf(read('deploy/security-headers-embed.conf'));
  const byName = (list) => Object.fromEntries(list.map((h) => [h.name, h.value]));
  const m = byName(main);
  const e = byName(embed);
  const directivesOf = (csp) => new Map(csp.split(';').map((s) => s.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d]));
  const cm = directivesOf(m['Content-Security-Policy']);
  const ce = directivesOf(e['Content-Security-Policy']);
  assert.deepEqual([...cm.keys()], [...ce.keys()], 'same CSP directives in the same order');
  for (const [name, value] of cm) {
    if (name === 'frame-ancestors') continue;
    assert.equal(ce.get(name), value, `CSP ${name}`);
  }
  assert.equal(cm.get('frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(ce.get('frame-ancestors'), 'frame-ancestors *');
  assert.equal(m['X-Frame-Options'], 'DENY');
  assert.equal(e['X-Frame-Options'], undefined);
  for (const name of Object.keys(m)) {
    if (name !== 'Content-Security-Policy' && name !== 'X-Frame-Options') assert.equal(e[name], m[name], name);
  }
  assert.deepEqual(Object.keys(e).sort(), Object.keys(m).filter((n) => n !== 'X-Frame-Options').sort());
  assert.doesNotMatch(m['Permissions-Policy'], /interest-cohort/, 'obsolete FLoC directive removed');
  for (const file of ['deploy/security-headers.conf', 'deploy/security-headers-embed.conf']) {
    for (const line of read(file).split(/\r?\n/).filter((l) => l.startsWith('add_header'))) {
      assert.match(line, /\salways;$/, `${file}: ${line.slice(0, 40)}… must use "always" (404/410 pages too)`);
    }
  }
});

// ---------------------------------------------------------------------------
// nginx: parity with scripts/serve.js (cache, MIME, redirects, 404)
// ---------------------------------------------------------------------------

test('Cache-Control rules are the same as cacheControl() in scripts/serve.js', () => {
  const map = mapBlock('$inflaatio_cache_control');
  assert.ok(map, 'map $uri $inflaatio_cache_control');
  assert.equal(conf.find((d) => d.name === 'map' && d.args[1] === '$inflaatio_cache_control').args[0], '$uri');
  // [request path, final $uri inside nginx (after the index / error_page redirect), served file is HTML]
  const samples = [
    ['/', '/index.html', true],
    ['/hinnat/', '/hinnat/index.html', true],
    ['/upotus/', '/upotus/index.html', true],
    ['/data/', '/data/index.html', true],
    ['/404.html', '/404.html', true],
    ['/assets/site-ABCDEFGH.js', '/assets/site-ABCDEFGH.js', false],
    ['/assets/chunks/chartjs-ZV7DODK2.js', '/assets/chunks/chartjs-ZV7DODK2.js', false],
    ['/assets/main-DZTKDWID.css', '/assets/main-DZTKDWID.css', false],
    ['/assets/logo.svg', '/assets/logo.svg', false],
    ['/fonts/inter-latin-wght-normal-ABCDEFGH.woff2', '/fonts/inter-latin-wght-normal-ABCDEFGH.woff2', false],
    ['/data/khi.csv', '/data/khi.csv', false],
    ['/data/json/khi.json', '/data/json/khi.json', false],
    ['/data/kuva.png', '/data/kuva.png', false],
    ['/icons/apple-touch-icon.png', '/icons/apple-touch-icon.png', false],
    ['/og/inflaatio.png', '/og/inflaatio.png', false],
    ['/favicon.ico', '/favicon.ico', false],
    ['/KUVA.JPG', '/KUVA.JPG', false],
    ['/sitemap.xml', '/sitemap.xml', false],
    ['/robots.txt', '/robots.txt', false],
    ['/feed.xml', '/feed.xml', false],
    ['/site.webmanifest', '/site.webmanifest', false],
    ['/service_worker.js', '/service_worker.js', false],
  ];
  for (const [request, finalUri, isHtml] of samples) {
    assert.equal(evalMap(map, finalUri), cacheControl(request, isHtml), request);
  }
  // The map is what the file-serving locations send.
  for (const l of [location('/'), location('=', '/upotus/'), location('=', '/feed.xml')]) {
    const cc = directives(l.block, 'add_header').find((d) => d.args[0] === 'Cache-Control');
    assert.equal(cc.args[1], '$inflaatio_cache_control', `location ${l.args.join(' ')}`);
  }
  const notFound = directives(location('=', '/404.html').block, 'add_header').find((d) => d.args[0] === 'Cache-Control');
  assert.equal(notFound.args[1], 'no-cache');
});

test('MIME types and charsets are the same as MIME / contentType() in scripts/serve.js', () => {
  const types = new Map();
  for (const d of directive(mainServer.block, 'types').block) for (const ext of d.args) types.set(ext, d.name);
  const charsetTypes = new Set(directive(mainServer.block, 'charset_types').args);
  assert.deepEqual(directive(mainServer.block, 'charset').args, ['utf-8']);
  const served = (type) => (type === 'text/html' || charsetTypes.has(type) ? `${type}; charset=utf-8` : type);
  for (const [ext, expected] of Object.entries(MIME)) {
    const type = types.get(ext.slice(1));
    assert.ok(type, `nginx types {} has ${ext}`);
    assert.equal(served(type), expected, ext);
  }
  for (const ext of types.keys()) assert.ok(MIME[`.${ext}`], `scripts/serve.js MIME has .${ext}`);
  const feed = location('=', '/feed.xml');
  assert.deepEqual(directive(feed.block, 'types').block, []);
  assert.equal(served(directive(feed.block, 'default_type').args[0]), contentType('feed.xml'));
});

test('redirects: …/index.html, old URLs of the previous site, relative Location', () => {
  const ifUri = directives(mainServer.block, 'if').find((d) => d.args[0] === '($request_uri');
  assert.ok(ifUri, 'if ($request_uri ~ …index.html…)');
  const re = new RegExp(ifUri.args[2]);
  assert.deepEqual(directive(ifUri.block, 'return').args, ['301', '$1$2']);
  const target = (uri) => {
    const m = uri.match(re);
    return m ? `${m[1]}${m[2] ?? ''}` : null;
  };
  assert.equal(target('/index.html'), '/');
  assert.equal(target('/hinnat/index.html'), '/hinnat/');
  assert.equal(target('/hinnat/index.html?mittari=ykhi'), '/hinnat/?mittari=ykhi');
  assert.equal(target('/index.html.backup'), null);
  assert.equal(target('/hinnat/'), null);

  const redirects = mapBlock('$inflaatio_redirect');
  for (const [from, to] of Object.entries(REDIRECTS)) {
    if (from.endsWith('/index.html')) assert.equal(target(from), to, from);
    else assert.equal(evalMap(redirects, from), to, `${from} (scripts/serve.js REDIRECTS)`);
  }
  assert.equal(evalMap(redirects, '/image/apple-touch-icon.png'), '/icons/apple-touch-icon.png');
  assert.equal(evalMap(redirects, '/image/android-chrome-512x512.png'), '/icons/android-chrome-512x512.png');
  assert.equal(evalMap(redirects, '/image/favicon.ico'), '/favicon.ico');
  // Static targets must exist (the others are page routes from the registry).
  for (const e of redirects) {
    const to = e.args[0];
    if (!to || to.includes('$')) continue;
    if (/\.(png|ico|webp)$/.test(to) && to !== '/og/inflaatio.png') assert.ok(fs.existsSync(path.join(ROOT, 'src', 'static', ...to.split('/'))), `src/static${to}`);
    else if (to.endsWith('/') || to === '/og/inflaatio.png') assert.ok(PAGES[to], `${to} is a registered route`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'static', 'icons', 'apple-touch-icon.png')));
  assert.deepEqual(directive(mainServer.block, 'absolute_redirect').args, ['off']);
  const redirectIf = directives(mainServer.block, 'if').find((d) => d.args[0] === '($inflaatio_redirect)');
  assert.deepEqual(directive(redirectIf.block, 'return').args, ['301', '$inflaatio_redirect$is_args$args']);
});

test('old public files are 410 Gone, but no route of the new site is redirected or gone', () => {
  const gone = mapBlock('$inflaatio_gone');
  const redirects = mapBlock('$inflaatio_redirect');
  for (const old of ['/docs/plans/ROADMAP.html', '/docs/plans/google-apps-script.js', '/index.html.backup', '/inflation-site-optimized.min.js', '/inflation-site-optimized-backup.js', '/cookie-consent.js', '/update-all-data.js', '/SEO-CHECKLIST.md', '/SEO-CHECKLIST.html', '/calculate_yearly_averages.py', '/Dockerfile', '/fly.toml', '/package.json', '/related-articles-component.html', '/image/footer.webp', '/node_modules/terser/package.json']) {
    assert.equal(evalMap(gone, old), '1', old);
  }
  const fill = (p) => p.replace(':vuosi', '2024').replace(':kuukausi', 'elokuu').replace(':hyodyke', 'kahvi');
  const routes = [
    ...Object.keys(PAGES).map(fill),
    '/katsaus/2026-08/',
    '/assets/site-ABCDEFGH.js',
    '/fonts/inter-latin-wght-normal-ABCDEFGH.woff2',
    '/icons/apple-touch-icon.png',
    '/favicon.ico',
    '/data/khi.csv',
    '/robots.txt',
    '/sitemap.xml',
    '/site.webmanifest',
    '/service_worker.js',
    '/healthz',
  ];
  for (const r of routes) {
    assert.equal(evalMap(gone, r), '0', `${r} must not be gone`);
    assert.equal(evalMap(redirects, r), '', `${r} must not be redirected`);
  }
  assert.ok(directives(mainServer.block, 'if').some((d) => d.args[0] === '($inflaatio_gone)' && directive(d.block, 'return').args[0] === '410'));
});

test('no soft 404: real 404/410 status with /404.html, no fallback to a page', () => {
  const errorPage = directive(mainServer.block, 'error_page');
  assert.deepEqual(errorPage.args, ['404', '410', '/404.html']);
  assert.ok(directive(location('=', '/404.html').block, 'internal'), '/404.html is internal');
  visit(conf, (n) => {
    if (n.name === 'try_files') assert.match(n.args.at(-1), /^=\d{3}$/, `try_files ${n.args.join(' ')} must end in =404`);
  });
});

test('hardening, health check and compression', () => {
  const b = mainServer.block;
  assert.deepEqual(directive(b, 'server_tokens').args, ['off']);
  const healthz = location('=', '/healthz');
  assert.deepEqual(directive(healthz.block, 'return').args, ['200', 'ok\\n']); // nginx turns \n into a newline
  assert.equal(directive(healthz.block, 'default_type').args[0], 'text/plain');
  const dotfiles = location('~', '/\\.');
  assert.ok(dotfiles, 'dotfiles denied');
  assert.deepEqual(directive(dotfiles.block, 'return').args, ['404']);
  const method = directives(b, 'if').find((d) => d.args[0] === '($request_method');
  assert.deepEqual(directive(method.block, 'return').args, ['405']);
  for (const [name, value] of [['gzip', 'on'], ['gzip_static', 'on'], ['gzip_vary', 'on'], ['gzip_proxied', 'any']]) {
    assert.deepEqual(directive(b, name)?.args, [value], name);
  }
  const gzipTypes = directive(b, 'gzip_types').args;
  for (const t of ['text/css', 'text/javascript', 'application/json', 'application/xml', 'image/svg+xml', 'text/csv']) assert.ok(gzipTypes.includes(t), t);
  // Access log without personal data.
  const logFormat = conf.find((d) => d.name === 'log_format');
  assert.doesNotMatch(logFormat.args.slice(1).join(' '), /remote_addr|http_user_agent|http_referer|request_uri|args|x_forwarded|fly_client_ip/i);
  assert.deepEqual(directive(b, 'access_log').args, ['/dev/stdout', logFormat.args[0]]);
});

// ---------------------------------------------------------------------------
// Docker image and Fly.io
// ---------------------------------------------------------------------------

const dockerLines = read('Dockerfile')
  .replace(/\\\r?\n/g, ' ')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

test('Dockerfile: multi-stage, npm ci + build with committed data (no fetch), non-root nginx', () => {
  const from = dockerLines.filter((l) => /^FROM\s/i.test(l)).map((l) => l.slice(5).trim());
  assert.equal(from.length, 2);
  assert.match(from[0], /^node:24-alpine\s+AS\s+build$/i);
  assert.match(from[1], /^nginx:1\.\d*[02468]-alpine$/, 'nginx stable branch pinned to a minor version');
  const text = dockerLines.join('\n');
  assert.match(text, /^RUN npm ci\b/m);
  assert.match(text, /npm run build/);
  assert.doesNotMatch(text, /\bfetch\b|scripts\/fetch|\bcurl\b/i, 'the image never fetches data');
  assert.doesNotMatch(text, /^COPY\s+\.\s/m, 'no COPY of the whole context');
  const finalStage = dockerLines.slice(dockerLines.findIndex((l) => l.startsWith('FROM nginx')));
  const user = finalStage.filter((l) => l.startsWith('USER ')).at(-1);
  assert.ok(user && !/^USER\s+(root|0)\b/.test(user), 'final stage runs as a non-root user');
  assert.ok(finalStage.includes('RUN nginx -t'), 'configuration tested during the build');
  assert.match(text, /^COPY --from=build \/app\/dist \/usr\/share\/nginx\/html$/m);
  assert.match(text, /rm -rf \/usr\/share\/nginx\/html\b/, "the image's welcome page is removed");
  assert.match(text, /^EXPOSE 8080$/m);
  assert.match(text, /^HEALTHCHECK .*\/healthz/m);
  const root = directive(mainServer.block, 'root').args[0];
  assert.equal(root, '/usr/share/nginx/html');
});

test('.dockerignore is an allowlist that covers every COPY source', () => {
  const lines = read('.dockerignore')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  assert.equal(lines[0], '*', 'everything excluded by default');
  const allowed = new Set(lines.filter((l) => l.startsWith('!')).map((l) => l.slice(1).replace(/\/$/, '')));
  for (const l of dockerLines.filter((x) => x.startsWith('COPY ') && !x.includes('--from='))) {
    const sources = l.split(/\s+/).slice(1, -1);
    for (const s of sources) assert.ok(allowed.has(s.split('/')[0].replace(/\/$/, '')) || allowed.has(s), `.dockerignore allows ${s}`);
  }
  for (const never of ['node_modules', 'dist', '.tmp', '.git', 'docs', 'test']) assert.ok(!allowed.has(never), never);
});

test('fly.toml: app, region, HTTPS, health check on /healthz, deploy strategy', () => {
  const toml = read('fly.toml');
  const value = (key) => toml.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*(?:#.*)?$`, 'm'))?.[1];
  // The workflows read the app name from fly.toml (docs/OPERATIONS.md: another name if 'inflaatio' is taken).
  assert.match(value('app'), /^'[a-z0-9][a-z0-9-]*'$/);
  assert.equal(value('primary_region'), "'arn'");
  assert.equal(value('force_https'), 'true');
  assert.equal(value('auto_start_machines'), 'true');
  assert.match(value('min_machines_running'), /^\d+$/);
  assert.equal(value('kill_signal'), "'SIGQUIT'");
  assert.match(toml, /^\[deploy\]\s*\n(?:\s*#.*\n)*\s*strategy\s*=\s*'(bluegreen|rolling)'/m);
  assert.match(toml, /^\s*\[\[http_service\.checks\]\]/m);
  assert.equal(value('path'), "'/healthz'");
  assert.ok(location('=', '/healthz'), 'nginx answers /healthz');
});

// ---------------------------------------------------------------------------
// GitHub workflows and Dependabot
// ---------------------------------------------------------------------------

const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const workflows = Object.fromEntries(
  fs.readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => [f, fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')]),
);

test('workflows: the four expected files', () => {
  assert.deepEqual(Object.keys(workflows).sort(), ['ci.yml', 'deploy.yml', 'site-check.yml', 'update-data.yml']);
});

test('workflows: every action pinned to a full commit SHA with its version in a comment', () => {
  let count = 0;
  for (const [file, text] of Object.entries(workflows)) {
    for (const m of text.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)) {
      count++;
      const ref = m[1].trim();
      if (ref.startsWith('./')) continue;
      assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v?\d+(?:\.\d+)*\s*$/, `${file}: uses: ${ref}`);
    }
  }
  assert.ok(count >= 8);
});

test('workflows: least privilege, concurrency, timeouts, Node 24, pinned runner, no injection-prone contexts', () => {
  for (const [file, text] of Object.entries(workflows)) {
    assert.match(text, /^permissions:\s*$/m, `${file}: top-level permissions`);
    assert.match(text, /^\s*concurrency:/m, `${file}: concurrency`);
    const runsOn = [...text.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1].trim());
    const timeouts = text.match(/^\s*timeout-minutes:\s*\d+\s*$/gm) ?? [];
    assert.equal(timeouts.length, runsOn.length, `${file}: timeout-minutes on every job`);
    for (const r of runsOn) assert.equal(r, 'ubuntu-24.04', `${file}: runs-on`);
    for (const m of text.matchAll(/node-version:\s*(.+)$/gm)) assert.equal(m[1].trim(), "'24'", `${file}: node-version`);
    assert.doesNotMatch(text, /pull_request_target|workflow_run/, file);
    assert.doesNotMatch(text, /\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|head_commit|commits)|head_ref)/, `${file}: untrusted context in an expression`);
    for (const m of text.matchAll(/secrets\.(\w+)/g)) {
      assert.equal(m[1], 'FLY_API_TOKEN', `${file}: only the Fly deploy token is used`);
      assert.ok(['deploy.yml', 'update-data.yml'].includes(file), `${file} must not use secrets`);
    }
    const write = [...text.matchAll(/^\s*(contents|issues|pull-requests|packages|id-token|actions):\s*write\s*$/gm)].map((m) => m[1]);
    const allowed = { 'update-data.yml': ['contents'], 'site-check.yml': ['issues'] }[file] ?? [];
    for (const w of write) assert.ok(allowed.includes(w), `${file}: ${w}: write`);
  }
});

test('ci.yml: lint, tests, build, link check and a Docker build without push', () => {
  const t = workflows['ci.yml'];
  assert.match(t, /^\s*pull_request:/m);
  assert.match(t, /^\s*push:\s*\n\s*branches:\s*\[main\]/m);
  for (const cmd of ['npm ci', 'npm run lint', 'npm test', 'npm run build', 'node scripts/check-links.js', 'docker build']) assert.ok(t.includes(cmd), cmd);
  assert.doesNotMatch(t, /docker push|flyctl/);
});

test('update-data.yml: off-the-hour schedule, fetch failure recorded, rebase before push, deploy in the same workflow', () => {
  const t = workflows['update-data.yml'];
  const crons = [...t.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(crons.length, 2);
  for (const c of crons) assert.notEqual(c.split(/\s+/)[0], '0', `${c} runs off the full hour`);
  assert.match(t, /workflow_dispatch:/);
  assert.match(t, /npm run fetch/);
  assert.match(t, /status=\$\?/, 'exit status of the fetch recorded');
  assert.match(t, /git status --porcelain -- data src\/content\/julkaisukalenteri\.json/);
  assert.match(t, /node --test test\/data-contract\.test\.js/);
  assert.match(t, /git pull -q --rebase origin main && git push -q origin HEAD:main/);
  assert.match(t, /github-actions\[bot\]/);
  assert.match(t, /subject="data: /);
  assert.match(t, /flyctl deploy --remote-only/);
  assert.match(t, /group: fly-deploy/);
  assert.match(t, /group: data-update/);
  assert.match(t, /FETCH_STATUS" != "0"[\s\S]*exit 1/, 'the run fails at the end when the fetch failed');
  assert.match(t, /GITHUB_STEP_SUMMARY/);
});

test('deploy.yml and site-check.yml', () => {
  const d = workflows['deploy.yml'];
  assert.match(d, /group: fly-deploy/);
  assert.match(d, /flyctl deploy --remote-only/);
  assert.match(d, /workflow_dispatch:/);
  for (const p of ['src/**', 'scripts/**', 'deploy/**', 'data/**', 'Dockerfile', 'fly.toml', 'package-lock.json']) assert.ok(d.includes(`'${p}'`), `deploy.yml paths: ${p}`);
  const s = workflows['site-check.yml'];
  assert.match(s, /cron:\s*'\d+ \*\/6 \* \* \*'/);
  assert.match(s, /issues: write/);
  assert.match(s, /--label site-check/);
  assert.match(s, /SMOKE_URL="\$SITE_URL"/);
  assert.match(s, /SITE_URL: https:\/\/inflaatio\.fi/);
});

test('dependabot.yml: npm and GitHub Actions, weekly, grouped', () => {
  const t = read('.github/dependabot.yml');
  assert.match(t, /^version:\s*2\s*$/m);
  const ecosystems = [...t.matchAll(/package-ecosystem:\s*(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(ecosystems.sort(), ['github-actions', 'npm']);
  assert.equal((t.match(/interval:\s*weekly/g) ?? []).length, 2);
  assert.equal((t.match(/^\s*groups:/gm) ?? []).length, 2);
});

// ---------------------------------------------------------------------------
// robots.txt and the service worker kill switch
// ---------------------------------------------------------------------------

/**
 * Parse robots.txt into groups (RFC 9309): consecutive user-agent lines
 * followed by their rules.
 * @param {string} text
 */
export function parseRobots(text) {
  const groups = [];
  const other = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (key === 'allow' || key === 'disallow') {
      if (current) current.rules.push({ type: key, path: value });
    } else other.push({ key, value });
  }
  return { groups, other };
}

test('robots.txt: search engines and answer engines allowed, AI training crawlers blocked', () => {
  const text = read('src/static/robots.txt');
  const { groups, other } = parseRobots(text);
  const groupFor = (agent) => groups.find((g) => g.agents.includes(agent.toLowerCase())) ?? groups.find((g) => g.agents.includes('*'));
  const blocked = (agent) => groupFor(agent).rules.some((r) => r.type === 'disallow' && r.path === '/');
  for (const bot of ['Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot', 'Google-Extended', 'GPTBot', 'meta-externalagent']) {
    assert.ok(blocked(bot), `${bot} blocked`);
  }
  for (const bot of ['Googlebot', 'Bingbot', 'DuckDuckBot', 'Applebot', 'OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot']) {
    assert.ok(!blocked(bot), `${bot} allowed`);
  }
  assert.ok(groups.some((g) => ['oai-searchbot', 'perplexitybot', 'claude-searchbot'].every((a) => g.agents.includes(a))), 'answer engines allowed explicitly');
  assert.doesNotMatch(text, /anthropic-ai|Claude-Web|\/api\/|Crawl-delay/i, 'obsolete lines removed');
  assert.deepEqual(other, [{ key: 'sitemap', value: 'https://inflaatio.fi/sitemap.xml' }]);
});

/** Load the kill switch with a fake service worker global scope. */
async function runKillSwitch({ failingCaches = false } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, deleted: [], unregister: 0, navigated: [], matchAll: [] };
  const scope = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {
      calls.skipWaiting++;
      return Promise.resolve();
    },
    caches: {
      keys: async () => {
        if (failingCaches) throw new Error('SecurityError');
        return ['inflaatio-v1.2', 'inflaatio-static-v1.2', 'inflaatio-dynamic-v1.2', 'toinen-sivusto'];
      },
      delete: async (name) => {
        calls.deleted.push(name);
        return true;
      },
    },
    registration: {
      unregister: async () => {
        calls.unregister++;
        return true;
      },
    },
    clients: {
      matchAll: async (options) => {
        calls.matchAll.push(options);
        return [
          { url: 'https://inflaatio.fi/', navigate: async (url) => calls.navigated.push(url) },
          { url: 'https://inflaatio.fi/#tunnusluvut', navigate: async () => Promise.reject(new TypeError('not controlled')) },
        ];
      },
    },
  };
  const hadSelf = Object.hasOwn(globalThis, 'self');
  const previous = globalThis.self;
  globalThis.self = scope;
  try {
    await import(`${pathToFileURL(path.join(ROOT, 'src', 'static', 'service_worker.js')).href}?run=${Math.random()}`);
    listeners.install?.({});
    let pending;
    listeners.activate?.({ waitUntil: (p) => (pending = p) });
    await pending;
  } finally {
    if (hadSelf) globalThis.self = previous;
    else delete globalThis.self;
  }
  return { listeners, calls };
}

test('service worker kill switch: activates at once, deletes inflaatio caches, unregisters, reloads its pages once', async () => {
  const source = read('src/static/service_worker.js');
  assert.doesNotMatch(source, /^\s*(import|export)\b/m, 'classic script');
  const { listeners, calls } = await runKillSwitch();
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'install'], 'no fetch handler');
  assert.equal(calls.skipWaiting, 1);
  assert.deepEqual(calls.deleted.sort(), ['inflaatio-dynamic-v1.2', 'inflaatio-static-v1.2', 'inflaatio-v1.2']);
  assert.equal(calls.unregister, 1);
  assert.deepEqual(calls.matchAll, [{ type: 'window' }]);
  assert.deepEqual(calls.navigated, ['https://inflaatio.fi/']);
});

test('service worker kill switch still unregisters when cache storage fails', async () => {
  const { calls } = await runKillSwitch({ failingCaches: true });
  assert.deepEqual(calls.deleted, []);
  assert.equal(calls.unregister, 1);
  assert.deepEqual(calls.navigated, ['https://inflaatio.fi/']);
});

// ---------------------------------------------------------------------------
// Smoke tests against a running server (SMOKE_URL)
// ---------------------------------------------------------------------------

const SMOKE_URL = (process.env.SMOKE_URL ?? '').replace(/\/+$/, '');
const SMOKE_PAGE = process.env.SMOKE_PAGE || '/';
const EXPECT_LATEST = process.env.SMOKE_EXPECT_LATEST === '1';
const smoke = SMOKE_URL ? {} : { skip: 'SMOKE_URL not set' };

/**
 * HTTP(S) request without redirects or automatic decompression surprises:
 * asks for gzip, decodes gzip/br, returns the raw status and headers.
 * @param {string} urlPath path (or absolute URL)
 * @param {{method?: string, headers?: Record<string, string>}} [o]
 */
async function request(urlPath, { method = 'GET', headers = {} } = {}) {
  const url = new URL(urlPath, `${SMOKE_URL}/`);
  const once = () =>
    new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        { method, timeout: 20000, headers: { 'user-agent': 'inflaatio-ops-smoke-test', 'accept-encoding': 'gzip', ...headers } },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let body = Buffer.concat(chunks);
            const encoding = res.headers['content-encoding'];
            try {
              if (!body.length) {
                // HEAD, 304 or an empty body: nothing to decode.
              } else if (encoding === 'gzip') body = zlib.gunzipSync(body);
              else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
            } catch (err) {
              reject(err);
              return;
            }
            resolve({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf8') });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error(`Timeout: ${url.href}`)));
      req.on('error', reject);
      req.end();
    });
  try {
    return await once();
  } catch {
    // One retry: a stopped Fly machine may drop the very first connection.
    await new Promise((r) => setTimeout(r, 2000));
    return once();
  }
}

const expectedHeaders = parseHeadersConf(read('deploy/security-headers.conf'));
const expectedEmbed = parseHeadersConf(read('deploy/security-headers-embed.conf'));

/** Assert the security header set (HSTS may be stricter, e.g. set again at the CDN). */
function assertSecurityHeaders(res, set, label) {
  for (const { name, value } of set) {
    const got = res.headers[name.toLowerCase()];
    if (name === 'Strict-Transport-Security') {
      assert.ok(got, `${label}: ${name}`);
      const maxAge = Number(got.match(/max-age=(\d+)/)?.[1]);
      assert.ok(maxAge >= 31536000 && /includeSubDomains/i.test(got), `${label}: ${name} ${got}`);
    } else {
      assert.equal(got, value, `${label}: ${name}`);
    }
  }
}

/** Same-origin URLs of stylesheets, scripts, preloads, icons and the manifest of a page. */
function pageAssets(doc) {
  const urls = new Set();
  for (const m of doc.matchAll(/<(link|script)\b([^>]*)>/gi)) {
    const attrs = m[2];
    const url = attrs.match(/\b(?:href|src)="([^"]+)"/)?.[1];
    if (!url) continue;
    if (m[1].toLowerCase() === 'link' && !/\brel="(?:stylesheet|modulepreload|preload|icon|apple-touch-icon|manifest)"/.test(attrs)) continue;
    const u = new URL(url.replace(/&amp;/g, '&'), `${SMOKE_URL}/`);
    if (u.origin === new URL(SMOKE_URL).origin) urls.add(u.pathname + u.search);
  }
  return [...urls];
}

const locationOf = (res) => {
  const loc = res.headers.location ?? '';
  return loc.startsWith(SMOKE_URL) ? loc.slice(SMOKE_URL.length) : loc;
};

test('smoke: /healthz answers "ok"', smoke, async () => {
  const res = await request('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.text.trim(), 'ok');
  assert.match(res.headers['content-type'], /^text\/plain/);
});

test('smoke: page has every security header, no-cache and gzip; server version hidden', smoke, async () => {
  const res = await request(SMOKE_PAGE);
  assert.equal(res.status, 200, SMOKE_PAGE);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-cache');
  assertSecurityHeaders(res, expectedHeaders, SMOKE_PAGE);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.match(res.headers.vary ?? '', /accept-encoding/i);
  assert.doesNotMatch(res.headers.server ?? '', /\d/, 'no version number in Server');
  assert.match(res.text, /<html lang="(fi|en)"/);
});

test('smoke: key assets load (CSS, JS, fonts, icons, manifest) with the right caching', smoke, async () => {
  const page = await request(SMOKE_PAGE);
  const assets = pageAssets(page.text);
  assert.ok(assets.some((a) => /^\/assets\/.+\.css$/.test(a)), 'a stylesheet');
  assert.ok(assets.some((a) => /^\/assets\/.+\.js$/.test(a)), 'a script');
  for (const a of assets) {
    const res = await request(a);
    assert.equal(res.status, 200, a);
    assert.equal(res.headers['cache-control'], cacheControl(a), `${a} Cache-Control`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', a);
    if (/\.(css|js)$/.test(a) && res.body.length >= 1024) assert.equal(res.headers['content-encoding'], 'gzip', `${a} compressed`);
  }
});

test('smoke: unknown page → 404 page with status 404; old files → 410', smoke, async () => {
  const res = await request(`/ei-ole-olemassa-${Date.now()}/`);
  assert.equal(res.status, 404);
  assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-cache');
  assertSecurityHeaders(res, expectedHeaders, '404');
  const gone = await request('/index.html.backup');
  assert.equal(gone.status, 410);
  assertSecurityHeaders(gone, expectedHeaders, '410');
  const dotfile = await request('/.git/config');
  assert.ok([403, 404].includes(dotfile.status), `/.git/config → ${dotfile.status}`); // 403: a CDN firewall may answer first
});

test('smoke: redirects keep the query string and use the public host', smoke, async () => {
  let res = await request('/index.html');
  assert.equal(res.status, 301);
  assert.equal(locationOf(res), '/');
  res = await request('/terms-of-use.html?x=1');
  assert.equal(res.status, 301);
  assert.equal(locationOf(res), '/kayttoehdot/?x=1');
  res = await request('/image/favicon.ico');
  assert.equal(res.status, 301);
  assert.equal(locationOf(res), '/favicon.ico');
  // A directory without its trailing slash: the first sub page linked from
  // the page that exists in this build.
  const page = await request(SMOKE_PAGE);
  const candidates = [...new Set([...page.text.matchAll(/href="(\/[a-z0-9-]+\/)"/g)].map((m) => m[1]))];
  let dir = null;
  for (const candidate of candidates.slice(0, 12)) {
    if ((await request(candidate, { method: 'HEAD' })).status === 200) {
      dir = candidate;
      break;
    }
  }
  assert.ok(dir, 'a linked sub page for the trailing-slash redirect');
  res = await request(`${dir.slice(0, -1)}?mittari=ykhi`);
  assert.equal(res.status, 301, dir);
  assert.equal(locationOf(res), `${dir}?mittari=ykhi`);
  assert.doesNotMatch(res.headers.location, /:8080/);
  res = await request('/', { method: 'POST' });
  assert.ok([403, 405].includes(res.status), `POST / → ${res.status}`);
});

test('smoke: the widget /upotus/ may be framed, other pages may not', smoke, async (t) => {
  const res = await request('/upotus/');
  if (res.status === 404) {
    t.skip('/upotus/ is not in this build');
    return;
  }
  assert.equal(res.status, 200);
  assertSecurityHeaders(res, expectedEmbed, '/upotus/');
  assert.equal(res.headers['x-frame-options'], undefined);
  const other = await request(SMOKE_PAGE);
  assert.equal(other.headers['x-frame-options'], 'DENY');
});

test('smoke: robots.txt, sitemap.xml, manifest and the service worker kill switch', smoke, async () => {
  const robots = await request('/robots.txt');
  assert.equal(robots.status, 200);
  assert.equal(robots.headers['content-type'], 'text/plain; charset=utf-8');
  assert.match(robots.text, /^Sitemap: https:\/\/inflaatio\.fi\/sitemap\.xml$/m);
  const sitemap = await request('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.equal(sitemap.headers['content-type'], 'application/xml; charset=utf-8');
  const manifest = await request('/site.webmanifest');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers['content-type'], 'application/manifest+json; charset=utf-8');
  const sw = await request('/service_worker.js');
  assert.equal(sw.status, 200);
  assert.equal(sw.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(sw.headers['cache-control'], 'no-cache');
  assert.match(sw.text, /unregister\(\)/);
});

test('smoke: the page shows the latest KHI month of data/meta.json', { skip: !SMOKE_URL ? 'SMOKE_URL not set' : !EXPECT_LATEST ? 'SMOKE_EXPECT_LATEST not set' : false }, async () => {
  const latest = JSON.parse(read('data/meta.json')).sources.khi.latest;
  const res = await request(SMOKE_PAGE);
  assert.equal(res.status, 200);
  const variants = [monthName(latest), monthShort(latest)];
  assert.ok(
    variants.some((v) => res.text.includes(v)),
    `${SMOKE_URL}${SMOKE_PAGE} does not show the latest KHI month ${latest} ("${variants.join('" / "')}") – is the latest data deployed?`,
  );
});
