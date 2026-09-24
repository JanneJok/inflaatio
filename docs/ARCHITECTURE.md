# Architecture

Inflaatio.fi is a static site. A daily job fetches official statistics into
`data/*.json`; our own build script (`scripts/build.js`) turns those files
into finished HTML with every number already written in; nginx on Fly.io
serves `dist/`. Browser JavaScript only enhances pages that already work
without it (theme menu, dialogs, calculators, interactive charts).

Related documents: [`DATA.md`](DATA.md) (sources, file formats, fetch
pipeline), `OPERATIONS.md` (deploy, schedules, owner tasks), the style guide
page `/tyylit/` (every component rendered with real data, light and dark).

## Contents

1. [Overview](#overview)
2. [Directory map](#directory-map)
3. [Build pipeline](#build-pipeline)
4. [Page modules](#page-modules) — including a complete minimal example
5. [ctx API reference](#ctx-api-reference)
6. [Component catalogue](#component-catalogue)
7. [Server-side SVG charts](#server-side-svg-charts)
8. [CSS conventions](#css-conventions)
9. [Browser JavaScript](#browser-javascript) — including interactive charts
10. [Security rules](#security-rules)
11. [Numbers, dates and data rules](#numbers-dates-and-data-rules)
12. [Testing, quality gates and parallel builds](#testing-quality-gates-and-parallel-builds)

## Overview

```
  Tilastokeskus PxWeb ─┐
  Eurostat API ────────┼─> scripts/fetch/index.js ──> data/*.json (committed)
  ECB Data API ────────┘   (daily GitHub Action)       src/content/julkaisukalenteri.json
                                                             │
  src/content/*.json (FAQ, events, forecasts) ───────────────┤
  src/site.config.js (constants, nav, page registry) ────────┤
                                                             v
                               scripts/build.js ── builds ctx ──> src/pages/*.js (page modules)
                               │   ├─ ctx.latest (computeLatest)        │ return [{ path, html } | { path, body }]
                               │   ├─ esbuild: src/css/main.css,        │ using ctx.layout / ctx.c / ctx.svg /
                               │   │   src/js/site.js, theme-boot.js,   │ ctx.fmt / ctx.stats / ctx.html
                               │   │   src/js/pages/*.js → hashed assets v
                               │   └─ checks: duplicate paths, CSP-safe HTML
                               v
                             dist/  (HTML, /assets/*-HASH.{js,css}, /fonts/, src/static/**, sitemap.xml, robots.txt)
                               │
             ┌─────────────────┴─────────────────┐
             v                                   v
   nginx on Fly.io (production)        scripts/serve.js (local, same headers,
   deploy/security-headers.conf        cache rules, redirects and 404)
             │
             v
   Browser: theme-boot.js (blocking, before paint) → main.css → site.js (module)
            → pages/<name>.js (module, optional) → lazy chunks (Chart.js, EmailJS)
```

Design decisions that shape everything else:

- **Numbers are rendered at build time.** A page must be complete and correct
  with JavaScript disabled; JS may only enhance (switch a metric, redraw a
  chart for another range, run a calculator).
- **One data contract.** Page modules read only `ctx.data` / `ctx.content`
  (loaded from JSON files) — never the network. The contract is SPEC §7 and
  `DATA.md`; `test/data-contract.test.js` enforces it on the committed files.
- **Strict CSP.** No inline scripts, styles or event handlers anywhere (see
  [Security rules](#security-rules)). The build fails if generated HTML breaks this.
- **Isomorphic libraries.** `src/js/lib/format.js`, `stats.js` (and `calc.js`)
  run both in the build and in the browser, so server-rendered numbers and
  JS-updated numbers are formatted and computed identically.

## Directory map

| Path | What it is | Owner / notes |
|---|---|---|
| `scripts/build.js` | the build (`node scripts/build.js`) | exports `build()`, `computeLatest()`, `cspProblems()` |
| `scripts/serve.js` | local static server mirroring nginx: headers, cache, MIME, `/healthz`, 404/410 pages, dotfile 404; the old-site redirects and the 410 list are parsed from the map blocks of `deploy/nginx.conf` (`nginxRules()`) | `--dir`, `--port`, `--build`, `--watch` |
| `scripts/check-links.js` | crawls a build dir: links, `#anchors`, `aria-controls`/`aria-labelledby`, sitemap | `--dir` |
| `scripts/lib/html.js` | `html` tagged template (escaping), `raw`, `attrs`, `classes`, `join`, `jsonLd`, `jsonScript`, `safeJson`, `escapeHtml`, `xmlEscape` (sitemap, RSS), `toHtml` | build only |
| `scripts/lib/svg.js` | server-side SVG charts: `lineChart`, `sparkline`, `barChart`, `hBarChart` | build only |
| `scripts/fetch/` | data fetchers + orchestrator | see `DATA.md` |
| `src/site.config.js` | site constants, `NAV`, `FOOTER`, `PAGES` registry, `pageName()` | isomorphic |
| `src/templates/layout.js` | document shell (`layout()`, `crumbs()`) | build only |
| `src/templates/components.js` | ~30 server-side components | build only |
| `src/pages/<name>.js` | page modules, auto-discovered | one owner per module |
| `src/content/*.json` | hand-maintained content (FAQ, events, forecasts) + release calendar (fetched) | |
| `src/css/main.css` | stylesheet entry: `@import`s tokens → base → layout → components → pages/* → print | |
| `src/css/tokens.css` | design tokens, light + dark, contrast table | |
| `src/css/base.css` | reset, fonts (`@font-face` Inter), typography, utilities | |
| `src/css/layout.css` | header, nav, theme menu, footer, consent banner, toast | |
| `src/css/components.css` | styles of `components.js` and `svg.js` output | |
| `src/css/pages/<name>.css` | page styles, one file per page module (already created, imported by main.css) | page owner |
| `src/css/print.css` | print stylesheet (last) | |
| `src/js/theme-boot.js` | blocking classic script: `.js` class + saved theme before first paint | |
| `src/js/site.js` | every page: initialises the `lib/` modules | |
| `src/js/lib/*.js` | browser modules (theme, nav, dom, consent, analytics, contact, copy, share, segmented, table-toggle, url-state) + isomorphic `format.js`, `stats.js`, `calc.js` | |
| `src/js/lib/calc-form.js` | form helpers shared by the calculator scripts: `byId`, `fill`, `messages`, `setError`, `readPeriod`/`setPeriod`, `render`, `showResult`, `wireRecalc` | CALC |
| `src/js/charts/setup.js` | themed, lazily loaded Chart.js (`createChart` …) | |
| `src/js/charts/chartjs.js` | the Chart.js parts we register (loaded only via `import()`) | |
| `src/js/pages/<name>.js` | optional page script, auto-discovered as an esbuild entry | page owner |
| `src/static/**` | copied verbatim to `dist/` (favicon.ico, icons, manifest) | |
| `deploy/security-headers.conf` | the single source of security headers + CSP (nginx `add_header` lines) | |
| `deploy/security-headers-embed.conf` | header set for the embeddable widget `/upotus/` (framing allowed) | |
| `data/*.json` | fetched data; written only by `npm run fetch` | |
| `test/*.test.js` | `node --test` suites | |
| `.tmp/` | scratch builds (gitignored) | |

## Build pipeline

```
node scripts/build.js [--out <dir>] [--only <mod1,mod2>] [--no-minify] [--strict] [--quiet]
```

| Flag | Effect |
|---|---|
| `--out <dir>` | output directory (default `dist`). Must be inside the repo (not in `src/`, `data/`, `scripts/` …) or the OS temp dir; it is wiped first. |
| `--only a,b` | build only these page modules (file names without `.js`); unknown names fail. Assets, static files, sitemap and robots are always produced. |
| `--no-minify` | readable output with linked source maps (used by `npm run dev`). |
| `--strict` | turn warnings (title > 60 chars, description > 155 chars) into errors. |
| `--quiet` | no summary. |

Steps (`build()` in `scripts/build.js`):

1. **Load data.** Every `data/*.json` → `ctx.data[basename]`, every
   `src/content/*.json` → `ctx.content[basename]` (invalid JSON fails the
   build), `src/site.config.js` → `ctx.site`. `ctx.latest` is computed from
   the data (see [ctx.latest](#ctxlatest)).
2. **Bundle assets with esbuild.** Entries: `src/css/main.css` → `/assets/main-HASH.css`,
   `src/js/site.js` → `/assets/site-HASH.js`, every `src/js/pages/*.js` →
   `/assets/pages/<name>-HASH.js` (ESM, code splitting: shared modules and
   dynamic imports become `/assets/chunks/*-HASH.js`), and
   `src/js/theme-boot.js` → `/assets/theme-boot-HASH.js` (separate IIFE build,
   runs as a classic blocking script). Fonts referenced from CSS are emitted
   as `/fonts/<name>-HASH.woff2`. Target `es2020`; minified unless `--no-minify`;
   `console.log`/`console.debug` are dropped in minified builds.
   A manifest maps logical names to URLs: `ctx.asset('site.js')`,
   `ctx.asset('main.css')`, `ctx.asset('pages/home.js')`,
   `ctx.asset('fonts/inter-latin-wght-normal.woff2')`.
3. **Run page modules.** Every `src/pages/*.js` (or the `--only` subset) is
   imported and its default export called with `ctx`. Each output must have a
   valid path (`/` + no `..`, `//`, `?`, `#`, spaces or backslashes). HTML
   outputs must end with `/` (written to `…/index.html`) or `.html`.
   **Duplicate paths fail the build** (also against `src/static/` and assets).
4. **CSP check.** Every HTML output is scanned (`cspProblems()`): any
   `<script>` without `src` (other than `application/ld+json` /
   `application/json`), `<style>`, `style=""`, `on*=""` or `javascript:` URL
   fails the build with the page and the problem.
5. **Write** outputs, then copy `src/static/**`.
6. **sitemap.xml** from HTML outputs, skipping `sitemap: false`, `noindex`
   pages and `/404.html` (`lastmod` = output `lastmod` or `ctx.latest.dataUpdated`;
   optional `priority`, `changefreq`), unless a module or `src/static` provides
   one. **robots.txt** (AI-training crawlers blocked, search allowed) unless provided.
7. **Summary**: modules, page count, asset sizes (raw + gzip), warnings.

Other scripts in `package.json`:

| Script | Command |
|---|---|
| `npm run fetch` | `node scripts/fetch/index.js` (see `DATA.md`) |
| `npm run build` | production build into `dist/` |
| `npm run serve` | `node scripts/serve.js` (serves `dist/` on :8080 with production headers) |
| `npm run dev` | build without minification, serve, rebuild on changes in `src/`, `data/`, `scripts/lib/` |
| `npm test` | `node --test "test/**/*.test.js"` |
| `npm run lint` | `eslint .` |
| `npm run check-links` | `node scripts/check-links.js` (on `dist/`) |
| `npm run check` | lint + test + build + check-links (what CI runs) |

## Page modules

A page module is `src/pages/<name>.js` with a default export
`async (ctx) => Output[]`. It owns only its own routes (SPEC §9 lists them;
`ctx.site.pages` is the registry used for names and breadcrumbs).

```js
/** @typedef {{ path: string, html: string, sitemap?: boolean, noindex?: boolean,
 *              priority?: number, changefreq?: string, lastmod?: string }} HtmlOutput */
/** @typedef {{ path: string, body: string | Buffer }} FileOutput   // CSV, JSON, XML, PNG… */
```

- `path` `'/hinnat/'` → `dist/hinnat/index.html`; `'/404.html'` → `dist/404.html`;
  `'/data/khi.csv'` with `body` → `dist/data/khi.csv`.
- A module may return many outputs (e.g. `/inflaatio/<yyyy>/` for every year).
- Use `sitemap: false` (and `layout({ noindex: true })`) for pages that must
  not be indexed.
- Throwing fails the build with `Page module "<name>" failed: …` — prefer
  failing loudly over rendering wrong numbers.

### Adding a page: complete minimal example

1. Register the route in `src/site.config.js` → `PAGES` (name for breadcrumbs,
   module, owner). Add it to `NAV`/`FOOTER` only if it belongs there.
2. `src/pages/esimerkki.js`:

```js
/**
 * /esimerkki/ – minimal page module: latest KHI with its month and source,
 * a 13-month SVG chart with a text alternative, and a page script.
 */
export default async function esimerkki(ctx) {
  const { html, fmt, stats, svg, c } = ctx;
  const path = '/esimerkki/';
  const k = ctx.latest.khi; // { month, yoy, prevYoy, delta, … } (see ctx.latest)
  if (!k) throw new Error('esimerkki: data/khi.json is missing (run npm run fetch)');

  const range = stats.sliceRange(ctx.data.khi.months, ctx.data.khi.yoy, '1v'); // 13 points
  const chart = c.chartFigure({
    id: 'esimerkki-kaavio',
    title: 'Inflaatio 12 kuukauden ajalta',
    subtitle: 'Vuosimuutos, %',
    legend: c.legend([{ cls: 'khi', label: 'KHI (Tilastokeskus)' }, { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true }]),
    chart: svg.lineChart({
      series: [{ values: range.series, cls: 'khi', label: 'KHI' }],
      labels: range.months,
      refLines: [{ value: 2, cls: 'target' }],
      ariaLabel: `Kuluttajahintojen vuosimuutos ${fmt.monthRange(range.months[0], k.month)}, viimeisin ${fmt.pct(k.yoy)}.`,
    }),
    summary: `Inflaatio oli ${fmt.inessive(k.month)} ${fmt.pct(k.yoy)}.`,
    table: c.dataTable({
      id: 'esimerkki-taulukko',
      caption: `Vuosimuutos kuukausittain, ${fmt.monthRange(range.months[0], k.month)}`,
      columns: [{ label: 'Kuukausi' }, { label: 'KHI', num: true }],
      rows: range.months.map((ym, i) => [fmt.monthShort(ym), fmt.pct(range.series[i])]).reverse(),
    }),
    source: c.sourceLine({ sources: [{ name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' }], updated: k.updated }),
  });

  const main = html`${c.pageHeader({
    eyebrow: `Kuluttajahintaindeksi · ${fmt.monthName(k.month)}`,
    title: 'Esimerkkisivu',
    lede: `Kuluttajahinnat olivat ${fmt.inessive(k.month)} ${fmt.pct(k.yoy)} korkeammat kuin vuotta aiemmin.`,
  })}
${c.section({
  id: 'luvut',
  title: 'Tunnusluvut',
  body: c.kpiGrid([
    c.kpiCard({ label: 'Inflaatio', value: fmt.pct(k.yoy), note: fmt.monthName(k.month) }),
    c.kpiCard({ label: 'Muutos edellisestä kuukaudesta', value: fmt.pp(k.delta), delta: stats.deltaClass(k.delta), note: `${fmt.capitalize(fmt.inessive(k.prevMonth))} ${fmt.pct(k.prevYoy)}` }),
  ]),
})}
${c.section({ id: 'kehitys', title: 'Kehitys', body: chart })}
${ctx.jsonScript('esimerkki-data', { months: range.months, khi: range.series })}`;

  return [
    {
      path,
      html: ctx.layout({
        title: 'Esimerkkisivu',                  // → "Esimerkkisivu | Inflaatio.fi" (≤ 60 chars)
        description: `Inflaatio ${fmt.monthName(k.month)}: ${fmt.pct(k.yoy)} (Tilastokeskus).`, // ≤ 155
        path,
        page: 'esimerkki',                       // <body data-page="esimerkki"> for CSS scoping
        scripts: ['pages/esimerkki.js'],         // src/js/pages/esimerkki.js (optional)
        breadcrumbs: ctx.crumbs(path, 'Esimerkkisivu'),
        main,
      }),
    },
  ];
}
```

3. `src/css/pages/esimerkki.css` (and add `@import './pages/esimerkki.css';`
   to `src/css/main.css`; every module of SPEC §9 already has its file):

```css
/* Page styles: /esimerkki/ (module esimerkki). Tokens only, scoped to the page. */
[data-page='esimerkki'] .kpi-grid {
  margin-top: var(--space-4);
}
```

4. Optional `src/js/pages/esimerkki.js` (auto-discovered as an entry):

```js
import { readDataIsland } from '../lib/dom.js';

const data = readDataIsland('esimerkki-data'); // { months, khi }
if (data) {
  // enhance the server-rendered page here (see "Browser JavaScript")
}
```

5. Build and look at it in isolation:

```sh
node scripts/build.js --out .tmp/esimerkki --only esimerkki
node scripts/serve.js --dir .tmp/esimerkki --port 8093
node scripts/check-links.js --dir .tmp/esimerkki   # links to pages outside the partial build are reported as missing
```

### Dynamic routes

Generate one output per item and keep the list data-driven:

```js
const years = ctx.data['khi-annual'].years;              // ['1972', …, '2025'] (strings)
return years.filter((y, i) => ctx.data['khi-annual'].yoy[i] != null).map((y) => ({
  path: `/inflaatio/${y}/`,
  html: ctx.layout({ /* … */ path: `/inflaatio/${y}/`, breadcrumbs: ctx.crumbs(`/inflaatio/${y}/`, y), main }),
}));
```

Month slugs: `fmt.monthSlug('2026-06')` → `'kesakuu'`, `fmt.monthFromSlug('kesakuu')` → `6`.
Breadcrumb names for pattern routes come from `ctx.crumbs(path, current, { '/inflaatio/2024/': '2024' })`.

## ctx API reference

| Member | Type | Description |
|---|---|---|
| `ctx.data` | object | `data/*.json` by basename: `ctx.data.khi`, `ctx.data['khi-annual']`, `ctx.data.ykhi`, `ctx.data.meta` … (shapes in `DATA.md`) |
| `ctx.content` | object | `src/content/*.json` by basename: `faq`, `tapahtumat`, `ennusteet`, `julkaisukalenteri` (missing files are simply absent) |
| `ctx.site` | object | `src/site.config.js` default export: `baseUrl`, `brand`, `operator`, `consent`, `gaId`, `supabase`, `emailjs`, `themeColors`, `ogImage`, `nav`, `footer`, `pages`, `pageName(path)` |
| `ctx.baseUrl` | string | `'https://inflaatio.fi'` |
| `ctx.buildDate` | string | build day `'YYYY-MM-DD'` (Helsinki). **Never use it for data periods** (see below). |
| `ctx.buildTime` | string | ISO timestamp of the build |
| `ctx.dev` | boolean | true with `--no-minify` |
| `ctx.only` | string[]\|null | the `--only` list |
| `ctx.latest` | object | latest values per source, see [ctx.latest](#ctxlatest) |
| `ctx.fmt` | module | `src/js/lib/format.js` (fi-FI formatting), see [format.js](#formatjs-ctxfmt) |
| `ctx.stats` | module | `src/js/lib/stats.js` (calculations), see [stats.js](#statsjs-ctxstats) |
| `ctx.html` | tag | `` html`<p>${text}</p>` `` → SafeString; every interpolation is escaped unless it is a SafeString; arrays are joined; `null`/`false`/`true` render nothing |
| `ctx.raw(markup)` | fn | mark trusted markup as safe (no escaping). Only for markup you produced yourself. |
| `ctx.attrs(obj)` | fn | attribute string: `true` → boolean attr, `null`/`false` → omitted, arrays → class lists, `{ data: { copyTarget: '#x' } }` → `data-copy-target="#x"`. Rejects `style` and `on*`. |
| `ctx.classes(...parts)` | fn | `classes('a', cond && 'b', { c: true })` → `'a b c'` |
| `ctx.jsonLd(obj)` | fn | `<script type="application/ld+json">` block (safe-escaped) |
| `ctx.jsonScript(id, data)` | fn | JSON data island `<script type="application/json" id>` for page JS (read with `readDataIsland(id)`) |
| `ctx.safeJson(data)` | fn | JSON escaped for embedding in a script element |
| `ctx.layout(opts)` | fn | full HTML document, see [layout options](#layout-options) |
| `ctx.crumbs(path, name, names?)` | fn | breadcrumb items from the page registry: `ctx.crumbs('/hinnat/kahvi/', 'Kahvi')` → Etusivu › Hinnat › Kahvi |
| `ctx.c` | module | components, see [Component catalogue](#component-catalogue) |
| `ctx.svg` | module | server-side SVG charts, see [Server-side SVG charts](#server-side-svg-charts) |
| `ctx.asset(name, { optional })` | fn | public URL of a bundled asset (`'site.js'`, `'main.css'`, `'pages/home.js'`); unknown names throw unless `optional` |
| `ctx.assetImports(name)` | fn | static chunk URLs of an entry (the layout emits `modulepreload` for them) |
| `ctx.warn(msg)` | fn | build warning (errors with `--strict`) |

### ctx.latest

Computed by `computeLatest(data, content)` in `scripts/build.js`. Every key is
absent when its data file is missing. All periods come from the data, never
from the clock.

```js
ctx.latest = {
  khi: {
    month: '2026-08', yoy: 2.2,            // latest annual change, %
    prevMonth: '2026-07', prevYoy: 2.1,
    delta: 0.1,                            // yoy − prevYoy, %-yks., rounded to 1 decimal (no float noise)
    mom: -0.2,                             // official monthly price change, %
    yearAgoYoy: 0.5, mean12: 1.00833…,     // 12-month mean of yoy (null unless all 12 exist)
    index2025: 101.95, index2015: 125.15,  // official point figures of the latest month
    currentYear: { year: 2026, value: 1.4625, months: 8, complete: false,
                   spanStart: '2026-01', spanEnd: '2026-08', span: 'tammi–elo', label: '2026 (tammi–elo)' },
    updated: '2026-09-14T05:00:00Z',       // source release timestamp (meta.json)
  },
  ykhi: { /* Finland, Eurostat HICP: same keys as khi */ coreYoy: 1.4, flag: null, provisional: false },
  ea:   { /* euro area: same shape as ykhi */ },
  khiAnnual:  { year: 2025, yoy: 0.3 },               // latest official complete year (122q)
  ykhiAnnual: { year: 2025, FI: 1.8, EA: 2.1 },
  elinkustannusindeksi: { month: '2026-08', value: 2385, base: '1951:10=100' },
  hyodykkeet: { month: '2026-08' },
  polttoaineet: { month: '2026-08', values: { bensiini95: 2.09, bensiini98: 2.19, diesel: 2.25, polttooljy: 1.78 } },
  ansiot: { period: '2026-Q2', nominalYoy: 3.4, realYoy: 1.6, preliminary: true },
  korot: { month: '2026-08', depositRate: 2.25, euribor12: 2.954, rateNow: 2.5, rateNowFrom: '2026-09-16' },
  nextRelease: {                         // julkaisukalenteri entries for periods we do not have yet (or null)
    khi: { date: '2026-10-14', time: '08:00', source: 'khi', period: '2026-09', label: '…', publisher, url },
    'ykhi-ennakko': { … }, ykhi: { … },  // ykhi: the final release of the flash month while provisional
  },
  updated: { khi: '2026-09-14T05:00:00Z', ykhi: '2026-09-17T11:00:00+02:00', … },
  dataUpdated: '2026-09-17',             // newest source update; footer "Päivitetty"
};
```

### format.js (`ctx.fmt`)

Isomorphic, pure. fi-FI: decimal comma, U+2212 minus, NBSP (U+00A0) before
`%`/`€` and as thousands separator. Missing values (`null`, `undefined`, NaN)
format as `'–'`.

| Function | Example |
|---|---|
| `pct(v, { decimals = 1, sign = false })` | `pct(2.2)` → `2,2 %`; `pct(-0.2)` → `−0,2 %`; `pct(0.4, { sign: true })` → `+0,4 %` |
| `pp(v, { decimals = 1, sign = true })` | `+0,1 %-yks.`, `−0,1 %-yks.`, `±0,0 %-yks.` — the unit is `PP_UNIT`, whose hyphen is U+2011 (non-breaking), so prose never wraps it as "%-" / "yks."; match it with `/%[-\u2011]yks\./` |
| `num(v, decimals = 0, { sign })` | `num(1234567)` → `1 234 567` |
| `idx(v, decimals = 2)` | `125,15` |
| `eur(v, decimals = 2, { sign })` | `1 234,56 €` |
| `monthName(ym, { year })` / `monthNameOnly` | `elokuu 2026` / `elokuu` |
| `monthShort(ym, { year })` | `elo 2026` / `elo` |
| `inessive` / `inessiveNoYear` | `elokuussa 2026` / `elokuussa` |
| `elative(ym, { year })` | `elokuusta 2026` |
| `genitive(ym, { year })` | `elokuun 2026` |
| `illative(ym, { year })` | `elokuuhun 2026` |
| `monthRange(a, b)` | `syys 2025 – elo 2026` |
| `monthsSpan(a, b)` | `tammi–elo` |
| `partialYear(a, b)` | `2026 (tammi–elo)`; a full year → `2026` |
| `date(v)` / `dateTime(v)` | `14.9.2026` / `14.9.2026 klo 8.00` (timestamps in Helsinki time) |
| `isoDate(v = now)` | `'2026-09-14'` (Helsinki); null for invalid input |
| `capitalize(s)` | `Elokuu 2026` |
| `parseYm`, `toYm`, `ymAdd`, `ymDiff(a, b)` (= b − a months), `yearOf`, `monthSlug`, `monthFromSlug` | month arithmetic without `Date` |
| `round(v, d)`, `isNum(v)` | helpers |
| `DASH`, `NBSP`, `MINUS`, `NB_HYPHEN`, `PP_UNIT`, `MONTHS`, `MONTHS_SHORT`, `MONTH_SLUGS` | constants |
| `enNum`, `enPct`, `enPp`, `enEur`, `enMonthName`, `enMonthShort`, `enDate`, `EN_MONTHS`, `EN_MONTHS_SHORT` | English pages and charts: `1,234.5`, `2.2%`, `+0.1 pp`, `€1,234.56`, `August 2026`, `Aug 2026`, `17 September 2026` (the single source for English month names) |

`parseYm` throws on malformed strings — a bad month is a bug, not a missing value.

Kept on purpose although no page uses them yet (they are tested and part of
the documented toolkit): `dateTime()` here, `stats.priceChangeFromIndex()` /
`stats.alignSeries()`, `html.toHtml()`. Remove a helper instead of leaving
it undocumented.

### stats.js (`ctx.stats`)

Isomorphic, pure; returns unrounded numbers (format with `fmt`), `null` for missing input.

| Function | Use |
|---|---|
| `RANGES`, `RANGE_KEYS` (`6kk, 1v, 3v, 5v, 10v, kaikki`), `isRangeKey(k)` | chart ranges; a range of n months has n + 1 points (`1v` = 13) |
| `sliceRange(months, arrays, key, { end })` | slice one series, an array or an object of series to a range ending at the latest month with data → `{ key, months, series, start, end, intervals, complete, annualise }` |
| `seriesAt(months, arr, ym)`, `latestIndex(arr)`, `firstIndex(arr)` | lookups |
| `mean(arr)`, `trailingMean(arr, n = 12, endIndex)` | means (trailing needs all n values) |
| `min(months, arr)`, `max(months, arr)` | `{ value, indices, months }` incl. every tied month |
| `cagr(first, last, intervalsInMonths)` | geometric average annual change, % (never annualise < 12 months) |
| `totalChange(a, b)`, `priceChangeFromIndex(i0, i1)`, `pctChangeSeries(arr, lag)` | % changes |
| `rebase(indexArr, startIdx, base = 100)` | price level "mitä 100 € on nyt" |
| `annualMeanOfMonthly(months, yoy)` | calendar-year means with month spans (for the partial current year only) |
| `LEVEL_BANDS`, `levelBand(v)` | `'deflation' | 'low' | 'elevated' | 'high'` (judged on the 1-decimal value) |
| `deltaClass(d)`, `ppChange(a, b)` | `'up' | 'down' | 'flat'` and the rounded %-yks. difference |
| `alignMany(list)`, `alignSeries(mA, a, mB, b)` | put series on one month axis |
| `rangeStats(months, yoy, index)` | mean/min/max/latest + total and average annual change for a chart range |

### Layout options

`ctx.layout({ … })` returns the document string. Options (SPEC §4):

| Option | Default | Notes |
|---|---|---|
| `title` | required | " \| Inflaatio.fi" is appended unless the title contains the brand; keep ≤ 60 chars (warning) |
| `description` | required | ≤ 155 chars (warning) |
| `path` | required | route; canonical = `baseUrl + path` |
| `lang` | `'fi'` | `<html lang>`, `og:locale`; `'en'` also switches the chrome to English (skip link, nav `site.navEn`, footer `site.footerEn`, breadcrumb label, consent banner and dialogs, live chip) |
| `alternates` | `[]` | `[{ hreflang: 'en', href: '/en/…' }]`; the page itself is added |
| `ogImage` | site default | string path or `{ path|url, width, height, alt }` (1200×630) |
| `ogType` | `'website'` | |
| `ogTitle`, `ogDescription` | title / description | |
| `jsonLd` | `[]` | schema.org objects; BreadcrumbList is added automatically |
| `scripts` | `[]` | page entries, e.g. `['pages/home.js']` (after `site.js`, with modulepreload of shared chunks) |
| `main` | required | SafeString (or array) |
| `noindex` | `false` | `<meta name="robots" content="noindex">`, no canonical; also return `sitemap: false` |
| `breadcrumbs` | `[]` | sub pages: visible trail + BreadcrumbList JSON-LD (use `ctx.crumbs`) |
| `page` | – | `<body data-page="…">` for CSS scoping |
| `bare` | `false` | no header/footer/banners/dialogs and no `site.js`; only the page's own `scripts` load (embeddable widget) |
| `head` | – | extra head markup (SafeString), e.g. `rel=prev/next` |

The layout renders: skip link, sticky header (brand, nav with
`aria-current`, live chip from `ctx.latest.khi`, theme menu, hamburger),
`<main id="main">`, footer (link columns, "© {latest data year} … Päivitetty
{dataUpdated}"), hidden consent banner, consent settings `<dialog>`, contact
`<dialog>` and the status toast (`#tilailmoitus`).

## Component catalogue

All in `src/templates/components.js`, available as `ctx.c`. Every function
returns a SafeString; strings you pass are escaped, SafeStrings are inserted
as they are. CSS lives in `src/css/components.css`. Interactive behaviour is
wired by `site.js` through `data-*` attributes, so no page JS is needed for it.
See `/tyylit/` for every component rendered.

### Structure

**`section({ id, title?, eyebrow?, intro?, controls?, body, className?, level = 2 })`** —
full-width `<section>` with container and section head; the heading gets
`${id}-otsikko` and labels the section. `className: 'section--tight' | 'section--flush-top'`.

```js
c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Inflaatio kuukausittain', intro: 'KHI ja YKHI vuosimuutoksena.', controls: c.segmented({ … }), body: figure })
```

**`sectionHead({ title, id?, eyebrow?, intro?, controls?, level = 2 })`** — the
heading row alone (eyebrow, heading, one-line intro, controls on the right,
full width on phones).

```js
c.sectionHead({ title: 'Tunnusluvut', id: 'tunnusluvut-otsikko', controls: metricSwitch })
```

**`pageHeader({ title, eyebrow?, lede?, meta?, aside? })`** — sub page header with the `<h1>`; `meta` is wrapped in a `<div>`, so it may be inline text or a `sourceLine()`.

```js
c.pageHeader({ eyebrow: 'Hinnat · elokuu 2026', title: 'Mikä kallistui?', lede: '…', meta: html`Päivitetty ${fmt.date(k.updated)} · Lähde: Tilastokeskus` })
```

**`toc(items, { title = 'Sisällys', sticky = true, scrollspy = true })`** — in-page
table of contents; `items = [{ id, label }]`. A sticky ToC needs a full-height grid cell.

```js
c.toc([{ id: 'kayttoehdot', label: 'Käyttöehdot' }, { id: 'tietosuoja', label: 'Tietosuoja' }])
```

**`breadcrumb(items, { label = 'Murupolku' })`** — visible trail (the layout renders it from `breadcrumbs`; use directly only elsewhere).

```js
c.breadcrumb([{ name: 'Etusivu', href: '/' }, { name: 'Hinnat', href: '/hinnat/' }, { name: 'Kahvi' }])
```

**`pager({ prev?, next?, label = 'Selaa' })`** — previous/next links (`rel=prev/next`).

```js
c.pager({ prev: { href: '/katsaus/2026-07/', label: 'Heinäkuu 2026' }, next: null })
```

**`cardGrid(cards, { headingLevel = 3, className? })`** — grid of link cards; the
whole card is clickable, the link name is the title. `cards = [{ href, title, text?, meta?, eyebrow?, lang? }]`.

```js
c.cardGrid([{ href: '/vuokrankorotus/', eyebrow: 'Laskuri', title: 'Vuokrankorotus', text: 'Uusi vuokra elinkustannusindeksillä.', meta: 'Laske' }])
```

### Numbers

**`kpiCard({ label, value, unit?, note?, delta?, deltaWords = 'pp', foot?, id?, field?, headingLevel = 3 })`** —
label (12 px caps), value (32 px tabular), note. A trailing NBSP unit in
`value` (`'2,2 %'`, `'+0,1 %-yks.'`) is split off automatically; the NBSP
stays at the end of `.kpi__number`, so copied text reads "2,2 %". In a
`kpiGrid` the values line up across a row (CSS subgrid, ≥ 641 px) even when
one label wraps to two lines. `delta:
'up'|'down'|'flat'` adds colour + arrow — **only for changes**, never for
levels. `deltaWords: 'pct'` reads nousi/laski instead of kiihtyi/hidastui.
`field` adds `data-kpi` for page JS updates.

```js
c.kpiCard({ label: 'Muutos edellisestä kuukaudesta', value: fmt.pp(k.delta), delta: stats.deltaClass(k.delta), note: `Heinäkuussa ${fmt.pct(k.prevYoy)}` })
```

**`kpiGrid(cards, { live = false, id?, className? })`** — 4 columns (3 and 5
supported), 2×2 on phones. `live: true` adds `aria-live="polite"` when JS updates values.

```js
c.kpiGrid([card1, card2, card3, card4], { live: true, id: 'tunnusluvut-kortit' })
```

**`deltaChip({ value, unit = 'pp', decimals = 1, context?, plain = false, showUnit = true })`** —
▲ red = kiihtyi/nousi, ▼ blue = hidastui/laski, grey = ennallaan (judged on
the rounded value). `unit: 'pct'` for price changes; `plain` for table cells;
`showUnit: false` when the column header names the unit.

```js
c.deltaChip({ value: k.delta, context: 'heinäkuusta' })
```

**`levelDot(valueOrBand, { srLabel = false })`** and **`levelLegend()`** — small
neutral level dot by band (<0, 0–2, 2–4, >4 %) and its legend.

```js
html`<span class="level">${c.levelDot(r.khi)}${fmt.pct(r.khi)}</span>`
```

**`numUnit(text)`** — wraps the unit of a formatted value in `<span class="unit">`
(use in tabular contexts so `%-yks.` does not get digit-wide hyphens).

```js
html`<td class="num">${c.numUnit(fmt.pp(0.1))}</td>`
```

**`statsList(items, { live = false, id?, className? })`** — `<dl>` row under a
chart: `items = [{ label, value, note?, id? }]`.

```js
c.statsList([{ label: 'Korkein', value: fmt.pct(s.max.value), note: s.max.months.map((m) => fmt.monthShort(m)).join(', ') }])
```

**`chip({ text, tone = 'neutral', series?, href?, title? })`** — small label;
`tone: 'brand' | 'provisional'` (dashed, for "ennakko"); `series` adds a colour swatch.

```js
c.chip({ text: 'ennakko', tone: 'provisional' })
```

### Controls

**`segmented({ name, label, options, value, id?, full = false, controls? })`** —
radiogroup of buttons (`aria-checked`, roving tabindex, arrow keys).
`options = [{ value, label, sub?, series? }]`. Selecting dispatches a
bubbling `segmentedchange` event `{ name, value, group }`. Render the default
state on the server. `full` = full width on phones; `controls` = id of the
region it updates.

```js
c.segmented({ name: 'mittari', label: 'Mittari', value: 'khi', options: [
  { value: 'khi', label: 'KHI', sub: 'Tilastokeskus', series: 'khi' },
  { value: 'ykhi', label: 'YKHI', sub: 'Eurostat', series: 'ykhi' },
] })
```

**`button({ label, variant = 'secondary', size?, href?, icon?, type = 'button', attrs?, className? })`** —
`variant: 'primary' | 'secondary' | 'ghost'`, `size: 'sm'`; with `href` an `<a>`.

```js
c.button({ label: 'Lataa kuva', icon: 'download', size: 'sm', className: 'js-only', attrs: { data: { chartDownload: 'kehitys' } } })
```

**`copyButton({ target?, text?, label = 'Kopioi', copiedLabel = 'Kopioitu', track?, variant, size })`** —
copies the value/text of `target` (CSS selector) or `text`; hidden without JS;
`track` sends a GA event after consent.

```js
c.copyButton({ target: '#upotuskoodi', label: 'Kopioi koodi', track: 'widget_code_copied' })
```

**`shareButton({ label = 'Kopioi linkki', mode = 'copy', track = 'share', variant, size })`** —
copies the current URL incl. view state; `mode: 'native'` opens the share sheet when available.

```js
c.shareButton({ size: 'sm' })
```

**`downloadLink({ href, label, format?, size?, track? })`** — download link with format/size meta.

```js
c.downloadLink({ href: '/data/khi.csv', label: 'Kuluttajahintaindeksi', format: 'CSV', size: '40 kt', track: 'csv_download' })
```

**`codeBlock({ id, code, label = 'Kopioi koodi', track? })`** — `<pre><code>` with a copy button.

```js
c.codeBlock({ id: 'upotuskoodi', code: '<iframe src="https://inflaatio.fi/upotus/" …></iframe>', track: 'widget_code_copied' })
```

**`icon(name, { className?, label? })`** and **`ICON_NAMES`** — inline 24×24
stroke icons (`sun, moon, auto, menu, close, check, copy, link, share, download,
external, info, alert, arrowRight, arrowLeft, chevronDown, rss, mail`);
decorative unless `label` is given.

```js
c.icon('external', { className: 'icon--sm' })
```

### Disclosure and text

**`details({ summary, body, open = false, id?, className?, headingLevel? })`** — native `<details>`; expanded in print.

```js
c.details({ summary: 'Mitä eroa on KHI:llä ja YKHI:llä?', body: html`<p>…</p>` })
```

**`accordion(items, { faq = false, headingLevel?, id? })`** — list of details
(`items = [{ id?, summary, body, open? }]`); `faq: true` for the UKK style.

```js
c.accordion(ctx.content.faq.map((f, i) => ({ id: f.id, summary: f.q, body: f.a, open: i === 0 })), { faq: true, headingLevel: 3 })
```

**`callout({ title?, body, tone = 'info', id? })`** — `tone: 'info' | 'warning' | 'note'`.

```js
c.callout({ tone: 'warning', title: 'Ennakkotieto', body: 'Eurostatin pikaennakko voi tarkentua.' })
```

**`sourceLine({ sources, updated?, note?, lang = 'fi' })`** — "Lähde: Tilastokeskus (kuluttajahintaindeksi) · Päivitetty 14.9.2026" (`lang: 'en'`: "Source: … · Updated 14 September 2026").
`sources = [{ name, href?, detail? }]`.

```js
c.sourceLine({ sources: [{ name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'YKHI' }], updated: ctx.latest.ykhi.updated })
```

### Tables and charts

**`dataTable({ id, caption, captionHidden = false, columns, rows, visibleRows?, toggleLabels?, note?, compact = false })`** —
semantic table (caption, `th scope`, numbers right-aligned via `num: true`)
in a keyboard-scrollable region. `rows` are arrays of cells or `{ cells,
className?, partial? }`. With `visibleRows` the rest is hidden with JS only
("Näytä kaikki", all rows without JS and in print).

```js
c.dataTable({
  id: 'vuositaulukko', caption: 'Inflaatio vuosittain 1980–2026',
  columns: [{ label: 'Vuosi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Muutos, %-yks.', num: true }],
  rows, visibleRows: 10,
  toggleLabels: { more: 'Näytä kaikki vuodet (1980–2026)', less: 'Näytä vain 10 viimeisintä vuotta' },
})
```

**`chartFigure({ id, title, subtitle?, headingLevel = 3, legend?, chart, summary, table?, tableLabel?, source?, actions?, live = false, className? })`** —
a chart with all its text alternatives: title + legend, the chart (SVG, or
an SVG fallback + `.chart-canvas` for Chart.js), a one-sentence summary, the
data table in a `<details>`, source line and actions.

```js
c.chartFigure({ id: 'kaavio', title: 'Inflaation kehitys', subtitle: 'Vuosimuutos, %', legend, chart: svgChart, summary: 'KHI oli elokuussa 2026 2,2 %.', table, source })
```

**`legend(items)`** — `items = [{ cls, label, dashed?, box?, hidden?, key? }]` (`hidden` renders the item hidden for page JS to show, `key` adds `data-series`); `cls` is a
series class (`khi, ykhi, ea, core, s3…s6, target, deflation, low, elevated, high`).
Name reference lines (2 % target) here rather than inside the plot.

```js
c.legend([{ cls: 'khi', label: 'KHI (Tilastokeskus)' }, { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true }])
```

### Forms

**`field({ id, label, as = 'input', type = 'text', name?, value?, hint?, error?, optional, required, suffix?, options?, attrs?, className?, lang = 'fi' })`** — `lang: 'en'` writes "(optional)" instead of "(valinnainen)";
label, hint and error wired with `aria-describedby`; `as: 'textarea' | 'select'`;
`suffix` shows a unit inside the input (`'€'`, `'%'`). Error text goes in
`#${id}-virhe` (set `aria-invalid` from JS).

```js
c.field({ id: 'vuokra', label: 'Nykyinen vuokra', suffix: '€', hint: 'Kuukausivuokra euroina.', attrs: { inputmode: 'decimal', autocomplete: 'off' } })
```

**`checkbox({ id, label, desc?, name?, checked = false, disabled = false })`**

```js
c.checkbox({ id: 'tapahtumat', label: 'Näytä tapahtumat', checked: true })
```

**`slugify(text)`** — ASCII id/slug from any Finnish text.

## Server-side SVG charts

`ctx.svg` (`scripts/lib/svg.js`) draws accessible, CSP-safe SVG at build
time: styling only through classes (colours follow the theme automatically),
`role="img"` and a required `ariaLabel`. Fixed pixel height, fluid width.

| Function | Main options |
|---|---|
| `lineChart({ series: [{ values, cls, label, endLabel? }], labels, ariaLabel, refLines?, yMin?, yMax?, height = 280, xTicks = 'auto', formatY?, formatValue?, endLabels = true })` | monthly lines, end labels with the latest value, nice y scale |
| `sparkline(values, { labels, refLines, ariaLabel, height = 64, cls })` | compact line without axes (hero) |
| `barChart({ bars: [{ label, value, cls?, partial?, title? }], ariaLabel, refLines?, height = 240, valueLabels? })` | annual bars; `cls` from `stats.levelBand()`; `partial` = lighter (current year) |
| `hBarChart({ bars: [{ label, value, cls?, title? }], ariaLabel, formatValue?, domain?, maxLabelChars = 36 })` | contributions by group; negative bars grow left |

Series classes (`SERIES_CLASSES`): `khi, ykhi, ea, core, s3, s4, s5, s6,
target, muted, deflation, low, elevated, high, pos, neg` — unknown classes throw.
Every chart needs a text alternative in the page: wrap it in
`c.chartFigure({ summary, table })`.

## CSS conventions

- **Tokens only.** Colours, spacing, radii, font sizes, durations come from
  `src/css/tokens.css` (`var(--space-4)`, `var(--text-2)`, `var(--series-khi)`
  …). No hex values in components or page CSS. The contrast table at the top
  of `tokens.css` is re-checked by `test/design.test.js`; add new colour
  tokens there with both themes.
- **Themes.** Bare `:root` = light; OS dark applies unless `data-theme="light"`;
  `[data-theme="dark"]` forces dark (also on a subtree: `.theme-scope`).
  Never write `@media (prefers-color-scheme)` rules in components — use tokens.
- **Colour semantics.** Inflation *level* is neutral text (optionally a level
  dot); arrows and colour only for *changes* (`--delta-up` red ▲ kiihtyi,
  `--delta-down` blue ▼ hidastui, `--delta-flat` grey). Never green for rising
  inflation. Series colours are fixed everywhere: KHI `--series-khi`, YKHI
  `--series-ykhi` (text: `--series-ykhi-text`), euro area `--series-ea`, core `--series-core`.
- **Page CSS** goes in `src/css/pages/<module>.css` (already imported by
  `main.css`, one file per module of SPEC §9), scoped to
  `[data-page='<module>']` (set by `layout({ page })`) or a page-specific
  class prefix. Don't restyle shared components globally from a page file.
- **Class naming**: BEM-like — block `kpi`, element `kpi__value`, modifier
  `kpi__value--up`; state via attributes (`[aria-checked]`, `[hidden]`,
  `[data-collapsed]`) or `is-*` classes.
- **Utilities** (`base.css`): `.container` (`--container` + `--gutter`),
  `.container--narrow`, `.stack` / `.stack-lg` (vertical rhythm), `.cluster`
  (wrapping row), `.measure` / `.prose` (68ch text column), `.muted`, `.subtle`,
  `.num` / `.tabular` (tabular figures), `.unit`, `.sr-only`, `.h1`–`.h3`,
  `.list-reset` (on `ul`/`ol`), `.js-only` (hidden until `theme-boot.js` adds
  `.js`), `.no-js-only`. Small shared pieces in `components.css`: `.eyebrow`,
  `.level` (value with a level dot), `.link-button`; `.icon-button` in `layout.css`.
- **Motion**: only 150–200 ms colour/opacity transitions (`var(--dur)`), no
  hover jumps; `prefers-reduced-motion` is respected globally.
- **Mobile first**: 16 px gutter, touch targets ≥ 40 px (`--tap`), no
  horizontal page scroll (wide tables scroll inside `.table-wrap`).
- **Print**: `print.css` hides chrome and buttons, expands details, prints URLs of external links.
- Dynamic sizes/positions from JS: `el.style.setProperty('--x', value)` (CSSOM
  is allowed by the CSP); never `style=""` in markup.

## Browser JavaScript

- **Entries.** `src/js/site.js` runs on every page (module script) and
  initialises `lib/theme`, `nav`, `dom` (dialogs), `consent`, `analytics`,
  `contact`, `copy`, `share`, `segmented`, `table-toggle` and print handling,
  each isolated in try/catch. `src/js/theme-boot.js` is the only classic
  script: it adds `.js` to `<html>` and applies the saved theme before first
  paint (no flash). A page adds its own entry with `layout({ scripts:
  ['pages/<name>.js'] })`; any file in `src/js/pages/` becomes an entry.
- **Shared modules are singletons.** With code splitting, a module imported by
  both `site.js` and a page entry lives in one shared chunk and is evaluated
  once, so importing `lib/analytics.js` in a page script is fine.
- **Data for scripts**: render it with `ctx.jsonScript(id, data)` and read it
  with `readDataIsland(id)` from `lib/dom.js`. Never fetch `data/*.json` at
  runtime for what the page shows.
- **DOM**: only `textContent`, `document.createElement` / `el()` from
  `lib/dom.js`, `<template>` + `cloneNode`, `setAttribute`, and toggling
  `hidden` on server-rendered markup. Announce JS-driven changes with
  `announce(message)` (toast + polite live region) or an `aria-live` region.
- **Events** (on `document`, bubbling):

| Event | detail | Dispatched by |
|---|---|---|
| `segmentedchange` | `{ name, value, group }` | `lib/segmented.js` on user selection |
| `themechange` | `{ mode: 'auto'\|'light'\|'dark', theme: 'light'\|'dark' }` | `lib/theme.js` (also when the OS scheme changes in auto mode) |
| `consentchange` | `{ analytics: boolean }` | `lib/consent.js` |

- **URL state**: `getParam(name, allowed)` / `setParams(values, { defaults })`
  from `lib/url-state.js` (`history.replaceState`, default values removed from
  the URL). Remember per-visitor preferences in `localStorage` inside try/catch.
- **Segmented controls**: `setSegmented(group, value)` (silent),
  `getSegmented(group)`; restore from the URL first, then listen for `segmentedchange`.
- **Analytics**: `track('calculator_used', { … })` from `lib/analytics.js`
  sends a GA event only with consent (and only on inflaatio.fi); or put
  `data-track="csv_download"` on a clickable element. The cookieless page-view
  counter needs nothing from pages. GA never loads on bare pages (the
  `/upotus/` widget, whose own entry `pages/upotus-kortti.js` only counts a
  page view, and not for `?esikatselu` previews), and GA receives page and
  referrer addresses without query string or hash (`gaPageUrl()`), so amounts
  typed into the calculators (kept in the URL) never reach Google.
- **Calculators**: the four calculator scripts share `lib/calc-form.js`
  (field errors, period inputs, result rendering, debounced recalculation) and
  compute with the isomorphic `lib/calc.js`. The value-of-money calculator
  (`/rahanarvo/`, `/en/value-of-money/`) offers KHI (default, the chained
  official series back to 1860) or YKHI (Eurostat HICP, monthly from 1996;
  `?indeksi=ykhi` / `?index=ykhi`).
- **Lazy work**: `onVisible(el, callback)` from `lib/dom.js` (IntersectionObserver,
  300 px margin). Heavy libraries are imported with `import()` so they get
  their own chunk (EmailJS in `contact.js`, Chart.js in `charts/setup.js`).

### Interactive charts (Chart.js)

`src/js/charts/setup.js` is the only way to draw Chart.js charts. It imports
`charts/chartjs.js` (Chart.js controllers + annotation plugin, tree-shaken)
with `import()`, so the ~70 kB (gzip) chunk is downloaded only when a chart
is created. It reads colours from the CSS tokens of the canvas' context,
re-themes live charts on `themechange` and OS colour-scheme changes, and
formats ticks/tooltips with `format.js` (tooltip "Elokuu 2026 / KHI: 2,2 %").
Line style follows the design: 2 px, straight segments, points only on hover,
horizontal grid only, the latest value at the end of each line, 2 % target as
a dashed annotation.

| Export | Description |
|---|---|
| `createChart(canvas, { type = 'line', months \| labels, datasets, annotations?, unit = '%', decimals?, locale = 'fi', yMin?, yMax?, beginAtZero?, lastValue = true, tooltipFooter?, options? })` | creates the chart (async); returns the Chart instance with `setMonths(months, [data…])` for range changes. `locale: 'en'` (English pages): English month names in ticks and tooltips, `2.2%` / `€1,234.50`. The right padding is sized to the widest end label, so labels are never clipped |
| `lineDataset({ series, label, data, dashed?, hidden?, fill?, decimals? })` | `series` = series key (`khi`, `ykhi`, `ea`, `core`, `s3`…); `decimals` overrides the chart's decimals for this line (tooltip + end label), e.g. KHI with 1 decimal next to 2-decimal interest rates |
| `barDataset({ series, label, data, partial? })` | `series` = one key or one per bar (e.g. `levelBand` results) |
| `targetLine(value = 2, label?)`, `eventLine(month, label)` | annotations (`src/content/tapahtumat.json` → `eventLine`) |
| `downloadPng(chart, filename, { title, source, legend = true })` | "Lataa kuva" with surface background, title, a legend of the visible series (+ the 2 % target) and source |
| `applyTheme(chart)`, `readTokens(el)`, `valueFormatter(unit, decimals, locale)`, `axisFormatter(unit, locale)`, `monthTicks(months, width, locale)`, `legendEntries(chart, tokens)`, `layoutLegend(…)`, `withAlpha(hex, a)` | lower-level helpers |

Pattern (see `src/pages/tyylit.js` + `src/js/pages/tyylit.js` for a working example):

```js
// Build: server SVG as the no-JS fallback + an empty, hidden canvas container + data.
html`<div data-chart-fallback>${svg.lineChart({ … })}</div>
<div class="chart-canvas" data-chart="kehitys" data-label="Vuosi-inflaatio kuukausittain" hidden></div>
${ctx.jsonScript('kehitys-data', { months, khi, ykhi })}`
```

```js
// Browser (src/js/pages/<name>.js)
import { onVisible, readDataIsland, announce } from '../lib/dom.js';
import { sliceRange } from '../lib/stats.js';
import { createChart, lineDataset, targetLine } from '../charts/setup.js';

const box = document.querySelector('[data-chart="kehitys"]');
const data = readDataIsland('kehitys-data');
if (box && data) {
  onVisible(box, async () => {
    const r = sliceRange(data.months, [data.khi, data.ykhi], '5v');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', box.dataset.label);
    box.append(canvas);
    box.hidden = false;
    try {
      const chart = await createChart(canvas, {
        months: r.months,
        datasets: [lineDataset({ series: 'khi', label: 'KHI', data: r.series[0] }), lineDataset({ series: 'ykhi', label: 'YKHI', data: r.series[1] })],
        annotations: { target: targetLine(2) },
      });
      document.querySelector('[data-chart-fallback]').hidden = true;
      // later: chart.setMonths(next.months, next.series); announce('…');
    } catch {
      box.hidden = true; // offline: keep the SVG
    }
  });
}
```

The `.chart-canvas` container has a fixed height (380 px, 280 px on phones);
the summary sentence and data table of `chartFigure()` remain the text
alternative, so update them (`aria-live`) when the range changes.

## Security rules

The CSP is defined once in `deploy/security-headers.conf` (nginx) and applied
identically by `scripts/serve.js`:

```
default-src 'self'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' <supabase> https://api.emailjs.com <google-analytics>;
img-src 'self' data: <google-analytics>; style-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
```

Consequences (the build fails on the first three):

- No inline `<script>` — JSON-LD and JSON data islands (`type="application/json"`) are fine.
- No `<style>` elements and no `style=""` attributes (`attrs()` refuses `style`).
  Set dynamic values from JS through the CSSOM (`el.style.setProperty`).
- No `on*=""` handler attributes and no `javascript:` URLs (`attrs()` refuses `on*`).
- No runtime CDNs: every library is an npm devDependency bundled by esbuild;
  fonts are self-hosted (`/fonts/`). New third-party origins need a CSP change
  in `deploy/security-headers.conf` (and `test/serve.test.js` compares it with SPEC §10).
- `/upotus/` (embeddable widget) uses `deploy/security-headers-embed.conf`
  (framing allowed); nginx needs a matching `location` block. Its document
  is `layout({ bare: true })`, which loads only the page's own `scripts`
  (no `site.js`: no consent, Google Analytics, contact or theme-menu code).

Caching (`cacheControl()` in `scripts/serve.js` = the `$inflaatio_cache_control`
map in `deploy/nginx.conf`): `/assets/*` and `/fonts/*` a year, immutable;
HTML `no-cache`; `/data/*` an hour; the share image `/og/*` a day (it is
regenerated every month); other images a week; everything else `no-cache`.

Forbidden APIs (ESLint + a local pre-write hook; SPEC §1): the HTML-string DOM
sinks (the element properties and methods that parse HTML strings, and the
document write methods), string evaluation (the global evaluator, the
function constructor, string timers) and `javascript:` URLs. Render markup on
the server with the escaping `html` template; in the browser build nodes.
The hook matches the names literally, even in comments, so don't write them.
It also flags a regular-expression method call spelled like the child-process
one — use `String.prototype.match` / `matchAll`.

Other rules: `ctx.raw()` only for markup you generated yourself (never for
data or content file strings); external links that leave the site get
`rel="noopener"` when they open a new tab (avoid new tabs in general); forms
post nowhere (`form-action 'self'`), JS sends them.

## Numbers, dates and data rules

- Format every number with `fmt` (decimal comma, U+2212, NBSP). Show every
  number with its month and source.
- "Muutos edellisestä kuukaudesta" = `ctx.latest.khi.delta` (difference of
  annual rates, `%-yks.`); "Hinnat kuukaudessa" = official monthly change
  `mom` (`%`).
- Average annual change = geometric (`stats.cagr`) over n − 1 intervals;
  ranges under 12 months show the total change instead.
- Complete years come from the official annual files (`khi-annual`,
  `ykhi-annual`); the current partial year is `ctx.latest.khi.currentYear`
  and is always labelled with its month span (`'2026 (tammi–elo)'`).
- **The current year and month come from the data** (`ctx.latest.*.month`),
  never from `ctx.buildDate` or `new Date()`.
- Indices always show their base (`2025=100` default). Provisional values
  (`ctx.latest.ykhi.provisional`, `data.ykhi.flags`, `ansiot.preliminary`) are
  labelled "ennakko".
- `ctx.content.faq` answers may use `{{placeholders}}` resolved from data at
  build time; no hard-coded figures in texts.

## Testing, quality gates and parallel builds

| Test file | Covers |
|---|---|
| `test/format.test.js`, `test/stats.test.js` | format.js and stats.js |
| `test/charts.test.js` | pure helpers of `charts/setup.js` (ticks, formatters, datasets) |
| `test/html.test.js`, `test/svg.test.js` | escaping template, SVG charts |
| `test/build.test.js` | build output, CSP check, head/landmarks, sitemap, `computeLatest` |
| `test/design.test.js` | token contrast in both themes |
| `test/serve.test.js`, `test/check-links.test.js` | local server parity with nginx/SPEC §10 (headers, nginx map parsing, redirects, 410, `/healthz`, dotfiles), link checker |
| `test/fetch.test.js` | fetch pipeline with fixtures (no network) |
| `test/data-contract.test.js` | committed `data/*.json` and release calendar against SPEC §7 |
| `test/home.test.js`, `test/calc.test.js`, `test/archive.test.js`, `test/topics.test.js`, `test/trust.test.js`, `test/extras.test.js` | page modules (built into a temp dir) and their calculations: home, calculators (`lib/calc.js`), archive/reviews/feed, prices/fuels/comparison/rates, terms/privacy/consent/contact, open data/OG image/English/widget/404 |
| `test/ops.test.js` | nginx config vs `serve.js`, Dockerfile/`.dockerignore`, `fly.toml`, workflows, robots.txt, service worker kill switch; HTTP smoke tests when `SMOKE_URL` is set |

Before finishing any change: `npm run lint`, `npm test`, build your modules
with `--only`, open them via `scripts/serve.js` and check the browser console
(no errors), light and dark, 390 px and 1280 px, and without JS. Add tests for
every calculation (`test/<area>.test.js`).

**Parallel agents / worktrees** build into their own directories and ports so
they never overwrite each other:

```sh
node scripts/build.js --out .tmp/<agent> --only <module1,module2>
node scripts/serve.js --dir .tmp/<agent> --port <unique port, e.g. 8093–8099>
node scripts/check-links.js --dir .tmp/<agent>
```

`.tmp/` is gitignored (as are `dist/` and `.playwright-mcp/`). The full check
(`npm run check`) builds everything into `dist/` and fails on any broken
internal link, so it only passes once every linked page module exists.
