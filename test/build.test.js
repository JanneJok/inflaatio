import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, cspProblems, assertSafeOutDir, computeLatest, parseArgs, ROOT, themeBootScript, scriptHash, cspScriptHashes } from '../scripts/build.js';
import { checkLinks } from '../scripts/check-links.js';

let tmp;
let out;
let result;
let page;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-build-'));
  out = path.join(tmp, 'dist');
  result = await build({ out, only: ['tyylit'], quiet: true });
  page = await fs.readFile(path.join(out, 'tyylit', 'index.html'), 'utf8');
});

after(async () => {
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});

const list = async (dir) => (existsSync(dir) ? fs.readdir(dir) : []);

test('writes the page, hashed assets, fonts and static files', async () => {
  assert.deepEqual(result.pages, ['/tyylit/']);
  const assets = await list(path.join(out, 'assets'));
  assert.ok(assets.some((f) => /^main-[A-Z0-9]{8}\.css$/.test(f)), 'main.css hashed');
  assert.ok(assets.some((f) => /^site-[A-Z0-9]{8}\.js$/.test(f)), 'site.js hashed');
  assert.ok(!assets.some((f) => f.startsWith('theme-boot-')), 'theme-boot is inlined, not a separate file');
  assert.ok((await list(path.join(out, 'assets', 'pages'))).some((f) => /^tyylit-[A-Z0-9]{8}\.js$/.test(f)));
  const fonts = await list(path.join(out, 'fonts'));
  assert.ok(fonts.some((f) => /^inter-latin-wght-normal-[A-Z0-9]{8}\.woff2$/.test(f)));
  for (const f of ['favicon.ico', 'site.webmanifest', 'robots.txt', 'sitemap.xml', 'icons/apple-touch-icon.png', 'icons/maskable-512x512.png']) {
    assert.ok(existsSync(path.join(out, f)), `${f} exists`);
  }
  assert.equal(result.manifest.get('site.js')?.startsWith('/assets/site-'), true);
});

test('inline theme-boot is a classic script (no ESM syntax) and main.css bundles every import', async () => {
  const js = themeBootScript().code;
  assert.doesNotMatch(js, /^\s*(import|export)\b/m);
  assert.match(js, /localStorage/);
  const cssFile = (await list(path.join(out, 'assets'))).find((f) => f.endsWith('.css'));
  const css = await fs.readFile(path.join(out, 'assets', cssFile), 'utf8');
  assert.doesNotMatch(css, /@import/);
  assert.match(css, /\/fonts\/inter-latin-wght-normal-[A-Z0-9]{8}\.woff2/);
  assert.match(css, /--series-ykhi-text/);
});

test('sitemap excludes noindex / sitemap:false pages; robots points to it', async () => {
  const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.doesNotMatch(sitemap, /tyylit/);
  const robots = await fs.readFile(path.join(out, 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/inflaatio\.fi\/sitemap\.xml/);
  assert.match(robots, /User-agent: GPTBot/);
});

test('HTML is CSP-safe: no inline scripts, styles or handlers', () => {
  assert.deepEqual(cspProblems(page), []);
  // The only inline script is the theme script, allowed by its CSP hash.
  const inlineScript = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>/gi;
  assert.equal([...page.matchAll(inlineScript)].length, 1);
  assert.ok(page.includes(`<script>${themeBootScript().code}</script>`));
  assert.doesNotMatch(page, /<style[\s>]/i);
  assert.doesNotMatch(page, /<[^>]+\sstyle\s*=/i);
  assert.doesNotMatch(page, /<[^>]+\son[a-z]+\s*=/i);
  assert.doesNotMatch(page, /javascript:/i);
});

test('head metadata follows the layout contract', () => {
  assert.match(page, /^<!doctype html>\n<html lang="fi">/);
  const title = page.match(/<title>([^<]*)<\/title>/)[1];
  assert.ok(title.length <= 60, title);
  assert.match(title, /\| Inflaatio\.fi$/);
  const desc = page.match(/<meta name="description" content="([^"]*)">/)[1];
  assert.ok(desc.length <= 155);
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /<meta property="og:site_name" content="Inflaatio\.fi">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/inflaatio\.fi\/[^"]+">/);
  assert.match(page, /<meta name="theme-color" content="#F7F8FA" media="\(prefers-color-scheme: light\)">/);
  assert.match(page, /<link rel="manifest" href="\/site\.webmanifest">/);
  assert.match(page, /<link rel="preload" href="\/fonts\/inter-latin-wght-normal-[A-Z0-9]{8}\.woff2" as="font" type="font\/woff2" crossorigin>/);
  const boot = themeBootScript();
  assert.ok(page.includes(`<script>${boot.code}</script>`), 'theme-boot inlined verbatim');
  assert.match(page, /<script type="module" src="\/assets\/site-[A-Z0-9]{8}\.js"><\/script>/);
  // theme-boot runs before the stylesheet and the module scripts
  assert.ok(page.indexOf(boot.code) < page.indexOf('rel="stylesheet"'));
  for (const m of page.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)) JSON.parse(m[1]);
});

test('page chrome: landmarks, skip link, nav, dialogs, consent banner', () => {
  assert.match(page, /<a class="skip-link" href="#main">Siirry sisältöön<\/a>/);
  assert.match(page, /<main id="main"/);
  assert.match(page, /<nav class="site-nav" id="paavalikko" aria-label="Päävalikko">/);
  assert.match(page, /aria-controls="paavalikko" aria-label="Avaa valikko"/);
  assert.match(page, /aria-haspopup="menu"/);
  assert.equal((page.match(/role="menuitemradio"/g) ?? []).length, 3);
  assert.match(page, /<section class="consent-banner" id="evasteilmoitus" aria-labelledby="evasteilmoitus-otsikko" hidden>/);
  assert.match(page, />Vain välttämättömät<\/button>/);
  assert.match(page, />Salli analytiikka<\/button>/);
  assert.match(page, /href="\/kayttoehdot\/#evasteet"/);
  assert.match(page, /<dialog class="dialog" id="evasteasetukset"/);
  assert.match(page, /<dialog class="dialog" id="yhteydenotto"/);
  assert.match(page, /name="website" tabindex="-1"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /© \d{4} Inflaatio\.fi · Ylläpito: Opak Oy · Lähteet: Tilastokeskus \(KHI\), Eurostat \(YKHI\) · Päivitetty/);
  assert.match(page, /<nav class="breadcrumbs" aria-label="Murupolku">/);
  const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dup, [], 'duplicate ids');
});

test('all same-page references (#id, aria-*) resolve; asset links exist', async () => {
  const { errors } = await checkLinks({ dir: out });
  // Links to pages outside this partial build (/, /hinnat/ …) are expected to be missing here.
  const assetErrors = errors.filter((e) => /"\/(assets|fonts|icons)\/|favicon|webmanifest/.test(e));
  const fragmentErrors = errors.filter((e) => / not found on /.test(e));
  assert.deepEqual(assetErrors, []);
  assert.deepEqual(fragmentErrors, []);
});

test('duplicate output paths fail the build', async () => {
  const pagesDir = path.join(tmp, 'pages');
  await fs.mkdir(pagesDir, { recursive: true });
  const mod = "export default async (ctx) => [{ path: '/sama/', html: ctx.layout({ title: 'A', description: 'B', path: '/sama/', main: ctx.html`<p>x</p>` }) }];\n";
  await fs.writeFile(path.join(pagesDir, 'a.js'), mod);
  await fs.writeFile(path.join(pagesDir, 'b.js'), mod);
  await assert.rejects(build({ out: path.join(tmp, 'dup'), pagesDir, quiet: true }), /Duplicate output path \/sama\//);
});

test('CSP violations in page output fail the build', async () => {
  const pagesDir = path.join(tmp, 'bad-pages');
  await fs.mkdir(pagesDir, { recursive: true });
  await fs.writeFile(
    path.join(pagesDir, 'bad.js'),
    "export default async (ctx) => [{ path: '/bad/', html: ctx.layout({ title: 'A', description: 'B', path: '/bad/', main: ctx.raw('<script>1</script>') }) }];\n",
  );
  await assert.rejects(build({ out: path.join(tmp, 'bad'), pagesDir, quiet: true }), /CSP violations[\s\S]*inline <script>/);
});

test('inline theme script: hash allowed by both CSP files, other inline scripts are not', async () => {
  const boot = themeBootScript();
  assert.equal(boot.hash, scriptHash(boot.code));
  for (const f of ['security-headers.conf', 'security-headers-embed.conf']) {
    const hashes = cspScriptHashes(await fs.readFile(path.join(ROOT, 'deploy', f), 'utf8'));
    assert.ok(hashes.has(boot.hash), `${f} allows '${boot.hash}'`);
  }
  assert.deepEqual(cspProblems(`<script>${boot.code}</script>`), []);
  assert.match(cspProblems(`<script>${boot.code};</script>`)[0], /inline <script>/);
  assert.deepEqual(cspProblems('<script>x</script>', new Set([scriptHash('x')])), []);
});

test('cspProblems detects each forbidden pattern', () => {
  assert.deepEqual(cspProblems('<script type="application/ld+json">{}</script><script src="/a.js"></script>'), []);
  assert.deepEqual(cspProblems('<script type="application/json" id="d">[1]</script>'), []);
  assert.match(cspProblems('<script>x</script>')[0], /inline <script>/);
  assert.match(cspProblems('<style>p{}</style>')[0], /<style>/);
  assert.match(cspProblems('<p style="color:red">')[0], /style=""/);
  assert.match(cspProblems('<button onclick="x()">')[0], /onclick/);
  assert.match(cspProblems('<a href="javascript:void(0)">')[0], /javascript: URL/);
});

test('output directory guard and argument parsing', () => {
  assert.throws(() => assertSafeOutDir(path.join(ROOT, 'src')), /Refusing/);
  assert.throws(() => assertSafeOutDir(ROOT), /Refusing/);
  assert.throws(() => assertSafeOutDir(path.parse(ROOT).root), /Refusing/);
  assert.doesNotThrow(() => assertSafeOutDir(path.join(ROOT, '.tmp', 'x')));
  assert.deepEqual(parseArgs(['--out', '.tmp/a', '--only=tyylit,home', '--no-minify']), {
    out: '.tmp/a',
    only: ['tyylit', 'home'],
    minify: false,
    strict: false,
    quiet: false,
  });
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
});

test('computeLatest tolerates missing data and picks the latest values', () => {
  assert.deepEqual(computeLatest({}), { nextRelease: { khi: null, 'ykhi-ennakko': null, ykhi: null }, updated: {}, dataUpdated: null });
  const calendar = [
    { date: '2026-09-01', source: 'ykhi-ennakko', period: '2026-08', label: 'x' },
    { date: '2026-09-14', source: 'khi', period: '2026-08', label: 'x' },
    { date: '2026-09-17', source: 'ykhi', period: '2026-08', label: 'x' },
    { date: '2026-10-02', source: 'ykhi-ennakko', period: '2026-09', label: 'x' },
    { date: '2026-10-14', source: 'khi', period: '2026-09', label: 'x' },
    { date: '2026-10-16', source: 'ykhi', period: '2026-09', label: 'x' },
  ];
  const l = computeLatest(
    {
      khi: { months: ['2025-12', '2026-01', '2026-02'], yoy: [2.0, 2.1, 2.3], mom: [0.1, 0.2, -0.2], index: { '2025=100': [101, 102, 101.9] } },
      ykhi: {
        months: ['2026-07', '2026-08'],
        geo: { FI: { yoy: [2.3, null], coreYoy: [1.1, null] }, EA: { yoy: [2.0, 2.1], index: { '2025=100': [102, null] } } },
        flags: { EA: { '2026-08': 'p' } },
      },
      'khi-annual': { years: ['2024', '2025'], yoy: [1.6, 0.3] },
      korot: { months: ['2026-07', '2026-08'], depositRate: [2.25, 2.25], euribor12: [2.9, 2.954], decisions: [{ date: '2026-09-16', depositRate: 2.5 }] },
      meta: { sources: { khi: { updated: '2026-09-14T05:00:00Z' }, ykhi: { updated: '2026-09-17T11:00:00+02:00' } } },
    },
    { julkaisukalenteri: calendar },
  );
  assert.equal(l.khi.month, '2026-02');
  assert.equal(l.khi.yoy, 2.3);
  assert.equal(l.khi.prevYoy, 2.1);
  assert.equal(l.khi.delta, 0.2, 'difference of annual rates without float noise');
  assert.equal(l.khi.mom, -0.2);
  assert.equal(l.khi.index2025, 101.9);
  assert.equal(l.khi.index2015, null);
  assert.equal(l.khi.mean12, null, 'needs 12 months');
  assert.deepEqual(
    { year: l.khi.currentYear.year, value: l.khi.currentYear.value, label: l.khi.currentYear.label, complete: l.khi.currentYear.complete },
    { year: 2026, value: 2.2, label: '2026 (tammi–helmi)', complete: false },
    'current year from the latest data month, never the clock',
  );
  assert.equal(l.ykhi.month, '2026-07');
  assert.equal(l.ykhi.coreYoy, 1.1);
  assert.equal(l.ykhi.provisional, false);
  assert.equal(l.ea.flag, 'p');
  assert.equal(l.ea.provisional, true);
  assert.deepEqual(l.khiAnnual, { year: 2025, yoy: 0.3 });
  assert.deepEqual(l.korot, { month: '2026-08', depositRate: 2.25, euribor12: 2.954, rateNow: 2.5, rateNowFrom: '2026-09-16' });
  assert.equal(l.nextRelease.khi.date, '2026-09-14', 'first KHI release after 2026-02');
  assert.equal(l.nextRelease['ykhi-ennakko'].period, '2026-08');
  assert.equal(l.nextRelease.ykhi.period, '2026-08');
  assert.equal(l.dataUpdated, '2026-09-17');
});
