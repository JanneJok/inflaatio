/**
 * / – etusivu (module home, owner HOME). SPEC §12, sections in this order:
 *  1 Nyt (hero: the latest KHI with month, change, lede, meta, 24-month sparkline)
 *  2 Tunnusluvut (global metric selector KHI | YKHI → KPI cards)
 *  3 Mikä nostaa hintoja? (main-group contributions, → /hinnat/)
 *  4 Kehitys (one Chart.js chart, SVG fallback, ranges, toggles, stats <dl>)
 *  5 Hintataso ("mitä 100 € on nyt", → /rahanarvo/)
 *  6 Vuosittain (official annual figures, bars + table, → /inflaatio/)
 *  7 KHI vai YKHI? (explainer)
 *  8 Laskurit   9 Ennusteet (only with content)   10 UKK   11 Lähteet ja päivitykset
 *
 * Every number is computed from ctx.latest / ctx.data at build time and the
 * page is complete without JavaScript. src/js/pages/home.js only switches the
 * metric / range (view state in ?mittari=…&jakso=…) and draws the interactive
 * charts; the texts of every metric × range combination are precomputed here
 * and shipped in the `etusivu-data` island, so the browser never builds
 * sentences of its own.
 *
 * Named exports (placeholders, richText, …) are used by test/home.test.js.
 */
import * as model from '../js/charts/home-model.js';
import * as format from '../js/lib/format.js';

const { NBSP } = format;
/** "%-yks." with a non-breaking hyphen when format.js provides it (never wraps at the hyphen). */
const PP = format.PP_UNIT ?? '%-yks.';

const PATH = '/';

const SRC = Object.freeze({
  khi: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' },
  ykhi: { name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'YKHI' },
  groups: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi, taulukot 15b5 ja 15bc' },
});

/** Genitive of the publisher (card notes). */
const SOURCE_GEN = Object.freeze({ khi: 'Tilastokeskuksen', ykhi: 'Eurostatin' });

/**
 * Open data files described in the Dataset JSON-LD (served by the `data`
 * page module, owner EXTRAS). Keep in sync with /data/.
 */
export const DATA_FILES = Object.freeze([
  { path: '/data/khi.csv', format: 'text/csv', name: 'Kuluttajahintaindeksi (KHI), kuukausittain, CSV' },
  { path: '/data/khi-vuosi.csv', format: 'text/csv', name: 'Kuluttajahintaindeksi (KHI), viralliset vuosimuutokset, CSV' },
  { path: '/data/ykhi.csv', format: 'text/csv', name: 'Yhdenmukaistettu kuluttajahintaindeksi (YKHI), Suomi ja euroalue, CSV' },
  { path: '/data/json/khi.json', format: 'application/json', name: 'Kuluttajahintaindeksi (KHI), kuukausittain, JSON' },
  { path: '/data/json/ykhi.json', format: 'application/json', name: 'Yhdenmukaistettu kuluttajahintaindeksi (YKHI), kuukausittain, JSON' },
]);

/* ================================================================ helpers */

/** "08:00" → "klo 8.00" (Finnish time notation, NBSP after "klo"). */
function clock(time) {
  const m = typeof time === 'string' ? time.match(/^(\d{1,2}):(\d{2})$/) : null;
  return m ? `klo${NBSP}${Number(m[1])}.${m[2]}` : '';
}

/** Release date text: "14.10.2026 klo 8.00". */
function releaseWhen(fmt, entry) {
  return [fmt.date(entry.date), clock(entry.time)].filter(Boolean).join(' ');
}

/** Year-quarter '2026-Q2' → '2. neljänneksellä 2026'. */
function quarterIn(period) {
  const m = typeof period === 'string' ? period.match(/^(\d{4})-Q([1-4])$/) : null;
  return m ? `${m[2]}. neljänneksellä ${m[1]}` : String(period ?? '');
}

/** Official annual rows { year, value } of a years/values pair (numbers only). */
function annualRows(fmt, years, values) {
  return (years ?? [])
    .map((y, i) => ({ year: Number(y), value: values?.[i] }))
    .filter((r) => fmt.isNum(r.value));
}

/** Latest value of a series with its month ({ value, month }) or null. */
function latestOf(stats, months, arr) {
  const i = stats.latestIndex(arr);
  return i >= 0 ? { value: arr[i], month: months[i] } : null;
}

/* =========================================================== placeholders */

/** "kolmin|kertaistuivat": stems of the multiples used in FAQ texts. */
const MULTIPLE_WORDS = Object.freeze({ 2: 'kaksin', 3: 'kolmin', 4: 'nelin', 5: 'viisin', 6: 'kuusin', 7: 'seitsen', 8: 'kahdeksan', 9: 'yhdeksän', 10: 'kymmen' });

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][\w.]*)(?::([^}]*?))?\s*\}\}/g;

/**
 * Resolvers for the {{placeholders}} of src/content/faq.json. Every value is
 * computed from ctx.data / ctx.latest; a resolver returns null when the data
 * is missing, which fails the build (no stale or invented numbers).
 * @param {any} ctx build context
 * @returns {Record<string, (arg?: string) => string|number|null>}
 */
export function placeholders(ctx) {
  const { fmt, stats } = ctx;
  const L = ctx.latest ?? {};
  const d = ctx.data ?? {};
  const khiRows = annualRows(fmt, d['khi-annual']?.years, d['khi-annual']?.yoy);
  const ykhiRows = annualRows(fmt, d['ykhi-annual']?.years, d['ykhi-annual']?.geo?.FI);
  const months = d.khi?.months ?? [];
  const yoy = d.khi?.yoy ?? [];
  const ym = d.ykhi?.months ?? [];
  const provisional = (l) => (l?.provisional ? ' (ennakko)' : '');
  const rowOf = (rows, y) => rows.find((r) => r.year === Number(y)) ?? null;
  const r1 = (v) => fmt.round(v, 1);

  /** Monthly values of KHI filtered by month predicate → { months, values }. */
  const monthly = (keep) => {
    const out = { months: [], values: [] };
    months.forEach((m, i) => {
      if (fmt.isNum(yoy[i]) && keep(m)) {
        out.months.push(m);
        out.values.push(yoy[i]);
      }
    });
    return out;
  };
  /** Core inflation of a geo with its month when it differs from the headline month. */
  const core = (geo, headline) => {
    const g = d.ykhi?.geo?.[geo];
    const l = latestOf(stats, ym, g?.coreYoy ?? []);
    if (!l) return null;
    return l.month === headline?.month ? fmt.pct(l.value) : `${fmt.pct(l.value)} (${fmt.monthName(l.month)})`;
  };

  return {
    'khi.nowSentence': () => (L.khi ? model.annualChangeSentence(L.khi.month, L.khi.yoy) : null),
    'khi.yoy': () => (L.khi ? fmt.pct(L.khi.yoy) : null),
    'khi.prevYoy': () => (fmt.isNum(L.khi?.prevYoy) ? fmt.pct(L.khi.prevYoy) : null),
    'khi.month': () => (L.khi ? fmt.monthName(L.khi.month) : null),
    'khi.monthIn': () => (L.khi ? fmt.inessive(L.khi.month) : null),
    'khi.released': () => (L.khi?.updated ? fmt.date(L.khi.updated) : null),
    'khi.firstYear': () => khiRows[0]?.year ?? null,
    'khi.year': (y) => {
      const r = rowOf(khiRows, y);
      return r ? fmt.pct(r.value) : null;
    },
    'khi.maxYear': () => {
      if (!khiRows.length) return null;
      const top = Math.max(...khiRows.map((r) => r1(r.value)));
      const years = khiRows.filter((r) => r1(r.value) === top).map((r) => String(r.year));
      return `${fmt.pct(top)} ${years.length > 1 ? `vuosina ${model.listText(years)}` : `vuonna ${years[0]}`}`;
    },
    'khi.maxMonth': () => {
      const m = stats.max(months, yoy);
      return m ? `${fmt.pct(m.value)} ${model.monthsInessive(m.months)}` : null;
    },
    'khi.maxMonthIn': (y) => {
      const s = monthly((m) => m.startsWith(`${y}-`));
      const m = stats.max(s.months, s.values);
      return m ? `${fmt.pct(m.value)} ${model.monthsInessive(m.months)}` : null;
    },
    'khi.minMonthSince': (y) => {
      const s = monthly((m) => m >= `${y}-01`);
      const m = stats.min(s.months, s.values);
      return m ? `${fmt.pct(m.value)} ${model.monthsInessive(m.months)}` : null;
    },
    'khi.higherSince': (y) => {
      const r = rowOf(khiRows, y);
      if (!r) return null;
      const before = khiRows.filter((x) => x.year < r.year && r1(x.value) >= r1(r.value));
      return before.length ? before.at(-1).year : null;
    },
    'khi.maxYearBetween': (range) => {
      const [a, b] = String(range).split('..').map(Number);
      const rows = khiRows.filter((r) => r.year >= a && r.year <= b);
      if (!rows.length) return null;
      const top = rows.reduce((best, r) => (r.value > best.value ? r : best));
      return `vuonna ${top.year} (${fmt.pct(top.value)})`;
    },
    // Largest change of the official annual averages (11xt, oldest base) before
    // the official annual changes (122q) begin. Computed by us, labelled so in faq.json.
    'khi.annualAvgMaxBefore': () => {
      const idx = d['khi-annual']?.index ?? {};
      const years = d['khi-annual']?.years ?? [];
      const first = khiRows[0]?.year;
      if (!first) return null;
      // The base with the earliest data covers the most years.
      const base = Object.keys(idx).sort((a, b) => stats.firstIndex(idx[a]) - stats.firstIndex(idx[b]))[0];
      const arr = idx[base] ?? [];
      let best = null;
      years.forEach((y, i) => {
        if (i === 0 || Number(y) >= first || !fmt.isNum(arr[i]) || !fmt.isNum(arr[i - 1])) return;
        const change = stats.totalChange(arr[i - 1], arr[i]);
        if (fmt.isNum(change) && (!best || change > best.change)) best = { year: y, change };
      });
      return best ? `${fmt.pct(best.change)} vuonna ${best.year}` : null;
    },
    'eki.base1914': () => d.elinkustannusindeksi?.annual1914?.base ?? null,
    // Largest annual rise of the cost-of-living index 1914:1–6=100 (11xy), as a multiple when ≥ 2×.
    'eki.maxRise1914': () => {
      const s = d.elinkustannusindeksi?.annual1914;
      let best = null;
      (s?.years ?? []).forEach((y, i) => {
        const a = s.values?.[i - 1];
        const b = s.values?.[i];
        if (i === 0 || !fmt.isNum(a) || !fmt.isNum(b) || a <= 0) return;
        if (!best || b / a > best.ratio) best = { year: y, ratio: b / a };
      });
      if (!best) return null;
      const times = Math.floor(best.ratio);
      const word = MULTIPLE_WORDS[times];
      if (times < 2 || !word) return `nousivat ${fmt.pct((best.ratio - 1) * 100)} vuonna ${best.year}`;
      return `${best.ratio > times ? 'yli ' : ''}${word}kertaistuivat vuonna ${best.year}`;
    },
    'khi.lastDeflationYear': () => {
      const r = khiRows.filter((x) => r1(x.value) < 0).at(-1);
      return r ? `vuonna ${r.year} (${fmt.pct(r.value)})` : null;
    },
    'khi.negativeMonths': (y) => {
      const s = monthly((m) => m >= `${y}-01`);
      const neg = s.months.filter((_, i) => r1(s.values[i]) < 0);
      return neg.length ? model.monthsInessive(neg) : null;
    },
    'khi.recentYears': () => {
      const [a, b] = khiRows.slice(-2);
      if (!a || !b) return null;
      let text = `Inflaatio oli ${fmt.pct(a.value)} vuonna ${a.year} ja ${fmt.pct(b.value)} vuonna ${b.year}.`;
      const cy = L.khi?.currentYear;
      if (cy && !cy.complete && cy.year > b.year) text += ` Vuoden ${cy.year} ${cy.span}kuun keskiarvo on ${fmt.pct(cy.value)}.`;
      return text;
    },
    'ykhi.yoy': () => (L.ykhi ? `${fmt.pct(L.ykhi.yoy)}${provisional(L.ykhi)}` : null),
    'ykhi.monthIn': () => (L.ykhi ? fmt.inessive(L.ykhi.month) : null),
    'ykhi.core': () => core('FI', L.ykhi),
    'ykhi.year': (y) => {
      const r = rowOf(ykhiRows, y);
      return r ? fmt.pct(r.value) : null;
    },
    'ykhi.rangeIn': (list) => {
      const fi = d.ykhi?.geo?.FI?.yoy;
      const vals = String(list)
        .split(',')
        .map((m) => stats.seriesAt(ym, fi, m.trim()));
      if (!vals.length || vals.some((v) => !fmt.isNum(v))) return null;
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      return r1(lo) === r1(hi) ? fmt.pct(lo) : `${fmt.num(lo, 1)}${fmt.DASH}${fmt.pct(hi)}`;
    },
    'ea.yoy': () =>
      L.ea ? `${fmt.pct(L.ea.yoy)}${provisional(L.ea)}${L.ea.month !== L.ykhi?.month ? ` (${fmt.monthName(L.ea.month)})` : ''}` : null,
    'ea.monthIn': () => (L.ea ? fmt.inessive(L.ea.month) : null),
    'ea.core': () => core('EA', L.ea),
    'eki.value': () => (L.elinkustannusindeksi ? fmt.num(L.elinkustannusindeksi.value, 0) : null),
    'eki.monthIn': () => (L.elinkustannusindeksi ? fmt.inessive(L.elinkustannusindeksi.month) : null),
    'eki.base': () => L.elinkustannusindeksi?.base ?? null,
    'korot.now': () => (fmt.isNum(L.korot?.rateNow) ? fmt.pct(L.korot.rateNow, { decimals: 2 }) : null),
    'korot.from': () => (L.korot?.rateNowFrom ? fmt.date(L.korot.rateNowFrom) : null),
    'next.khiSentence': () => {
      const n = L.nextRelease?.khi;
      return n ? `Seuraava kuluttajahintaindeksi (${fmt.monthName(n.period)}) julkaistaan ${releaseWhen(fmt, n)}.` : '';
    },
  };
}

/**
 * Replace {{name}} / {{name:arg}} placeholders. Unknown names and missing
 * data throw (the build fails instead of showing a wrong number).
 * @param {string} text
 * @param {ReturnType<typeof placeholders>} resolvers
 * @returns {string}
 */
export function resolvePlaceholders(text, resolvers) {
  const out = String(text).replace(PLACEHOLDER_RE, (whole, name, arg) => {
    const fn = resolvers[name];
    if (typeof fn !== 'function') throw new Error(`Tuntematon paikkamerkki ${whole}`);
    const v = fn(arg?.trim());
    if (v == null) throw new Error(`Paikkamerkin ${whole} arvoa ei löydy datasta`);
    return String(v);
  });
  if (/\{\{|\}\}/.test(out)) throw new Error(`Virheellinen paikkamerkki tekstissä: ${text.slice(0, 80)}…`);
  return out.replace(/ {2,}/g, ' ').replace(/ +(\n|$)/g, '$1');
}

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_HREF = /^(\/(?!\/)|#|https:\/\/)/;

/**
 * Plain content text → paragraphs (blank line = new paragraph) with
 * `[text](/path/)` links. Every text piece is escaped by the html template;
 * only links to site paths, #anchors or https URLs are allowed.
 * @param {(strings: TemplateStringsArray, ...v: unknown[]) => any} html
 * @param {string} text
 */
export function richText(html, text) {
  const paragraphs = String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return html`${paragraphs.map((p) => {
    const parts = [];
    let last = 0;
    for (const m of p.matchAll(LINK_RE)) {
      if (!SAFE_HREF.test(m[2])) throw new Error(`Linkki ei ole sallittu: ${m[2]}`);
      parts.push(p.slice(last, m.index), html`<a href="${m[2]}">${m[1]}</a>`);
      last = m.index + m[0].length;
    }
    parts.push(p.slice(last));
    return html`<p>${parts}</p>`;
  })}`;
}

/**
 * FAQ items with resolved answers.
 * @param {any} ctx
 * @returns {{id: string, q: string, a: string}[]}
 */
export function faqItems(ctx) {
  const list = Array.isArray(ctx.content?.faq) ? ctx.content.faq : [];
  const resolvers = placeholders(ctx);
  return list.map((f, i) => {
    if (!f?.q || !f?.a) throw new Error(`faq.json: kohta ${i + 1} tarvitsee kentät q ja a`);
    return { id: f.id ?? `ukk-${i + 1}`, q: resolvePlaceholders(f.q, resolvers), a: resolvePlaceholders(f.a, resolvers) };
  });
}

/* ============================================================ view model */

/**
 * Everything the sections need, computed once.
 * @param {any} ctx
 */
function prepare(ctx) {
  const { fmt, stats } = ctx;
  const L = ctx.latest ?? {};
  const d = ctx.data ?? {};
  if (!L.khi || !d.khi?.months?.length) throw new Error('data/khi.json puuttuu tai on tyhjä (aja npm run fetch)');
  if (!L.ykhi || !d.ykhi?.months?.length) throw new Error('data/ykhi.json puuttuu tai on tyhjä (aja npm run fetch)');
  const khi = d.khi;
  const y = d.ykhi;
  const fi = y.geo?.FI ?? {};
  const ea = y.geo?.EA ?? {};

  // One month axis from the first KHI annual rate to the newest month of any series.
  const start = khi.months[stats.firstIndex(khi.yoy)];
  const end = [L.khi.month, L.ykhi.month, L.ea?.month].filter(Boolean).sort().at(-1);
  const months = model.monthAxis(start, fmt.ymDiff(start, end) + 1);
  const on = (src, arr) => months.map((m) => stats.seriesAt(src, arr, m));
  const series = {
    khi: on(khi.months, khi.yoy),
    ykhi: on(y.months, fi.yoy),
    ea: on(y.months, ea.yoy),
    coreFi: on(y.months, fi.coreYoy),
    coreEa: on(y.months, ea.coreYoy),
    khiIdx: on(khi.months, khi.index?.['2025=100']),
    ykhiIdx: on(y.months, fi.index?.['2025=100']),
  };

  // Official index for average annual changes and the price level: the newest
  // base that covers the range start (e.g. 1977=100 for "Kaikki" from 1980).
  const indexSets = { khi: { src: khi.months, index: khi.index ?? {} }, ykhi: { src: y.months, index: fi.index ?? {} } };
  const baseFor = (metric, fromYm) => {
    const { src, index } = indexSets[metric];
    return Object.keys(index).find((b) => fmt.isNum(stats.seriesAt(src, index[b], fromYm))) ?? null;
  };
  const indexOn = (metric, base) => (base ? on(indexSets[metric].src, indexSets[metric].index[base]) : months.map(() => null));

  const text = { trend: {}, stats: { khi: {}, ykhi: {} }, level: { khi: {}, ykhi: {} } };
  /** Index series of the price level per metric and base (only the bases in use; shipped to the browser). */
  const levelIndex = { khi: {}, ykhi: {} };
  for (const key of stats.RANGE_KEYS) {
    const r = stats.sliceRange(months, [series.khi, series.ykhi], key);
    const period = fmt.monthRange(r.months[0], r.months.at(-1));
    text.trend[key] = {
      period,
      summary: {},
      aria: `Vuosi-inflaatio kuukausittain ${period}: KHI ja YKHI, vuosimuutos prosentteina. EKP:n tavoite 2 % katkoviivana.`,
    };
    for (const metric of model.METRICS) {
      const m = stats.sliceRange(months, series[metric], key);
      const base = baseFor(metric, m.months[0]);
      const index = indexOn(metric, base);
      text.stats[metric][key] = model.rangeStatItems({ months: m.months, yoy: m.series, index: index.slice(m.start, m.end + 1) });
      // The summary describes the selected metric (same months as its statistics row).
      text.trend[key].summary[metric] = model.trendSummary({
        metric,
        self: L[metric],
        other: L[metric === 'khi' ? 'ykhi' : 'khi'],
        months: m.months,
        yoy: m.series,
      });
      // Price level from the same official base as the statistics row.
      const levelBase = base ?? model.DEFAULT_BASE;
      levelIndex[metric][levelBase] ??= base ? index : series[`${metric}Idx`];
      text.level[metric][key] = {
        ...model.priceLevelText(model.priceLevel(months, levelIndex[metric][levelBase], key), metric, levelBase),
        base: levelBase,
      };
    }
  }

  const events = (Array.isArray(ctx.content?.tapahtumat) ? ctx.content.tapahtumat : [])
    .filter((e) => typeof e?.month === 'string' && /^\d{4}-\d{2}$/.test(e.month) && e.label && e.month >= start && e.month <= end)
    .map((e) => ({ month: e.month, label: String(e.label), text: String(e.text ?? '') }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const flagged = (geo) =>
    Object.entries(y.flags?.[geo] ?? {})
      .filter(([, f]) => f === 'p')
      .map(([m]) => m);

  const encodeAll = (obj) => Object.fromEntries(Object.entries(obj).map(([k, a]) => [k, model.encodeSeries(a)]));
  const island = {
    start,
    n: months.length,
    // Annual rates of the main chart (index series travel in `lvl`).
    s: encodeAll(Object.fromEntries(Object.entries(series).filter(([k]) => !k.endsWith('Idx')))),
    // Price-level index series per metric and official base (text.level[m][range].base picks one).
    lvl: { khi: encodeAll(levelIndex.khi), ykhi: encodeAll(levelIndex.ykhi) },
    flags: { ykhi: flagged('FI'), ea: flagged('EA') },
    events,
    text,
  };

  return { L, d, months, series, levelIndex, text, events, island, updated: newest(fmt, [L.khi.updated, L.ykhi.updated]) };
}

/** Newest of ISO timestamps (for "Päivitetty"). */
function newest(fmt, list) {
  const valid = list.filter((v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)));
  return valid.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

/* =============================================================== sections */

/** 1 Nyt – the answer to "paljonko inflaatio on nyt". */
function heroSection(ctx, vm) {
  const { html, fmt, stats, svg, c } = ctx;
  const k = vm.L.khi;
  const yk = vm.L.ykhi;
  const ea = vm.L.ea;
  const next = vm.L.nextRelease?.khi;

  const all = stats.sliceRange(vm.months, vm.series.khi, 'kaikki');
  const sMonths = all.months.slice(-24);
  const sValues = all.series.slice(-24);
  const lo = stats.min(sMonths, sValues);
  const hi = stats.max(sMonths, sValues);
  const sparkAria = `Vuosi-inflaatio ${fmt.monthRange(sMonths[0], sMonths.at(-1))} (KHI): alin ${fmt.pct(lo?.value)}, korkein ${fmt.pct(hi?.value)}, viimeisin ${fmt.pct(k.yoy)}. Vaakaviivat: 0 % ja EKP:n tavoite 2 %.`;
  const spark = (height, cls) =>
    svg.sparkline(sValues, {
      labels: sMonths,
      refLines: [
        { value: 0, cls: 'muted' },
        { value: 2, cls: 'target' },
      ],
      ariaLabel: sparkAria,
      height,
      className: cls,
    });

  const yearDiff = fmt.yearOf(k.prevMonth ?? k.month) !== fmt.yearOf(k.month);
  const chip = fmt.isNum(k.delta) ? c.deltaChip({ value: k.delta, context: fmt.elative(k.prevMonth, { year: yearDiff }) }) : '';
  // 'heinäkuussa 2,1 %'; across a year 'vuoden 2025 joulukuussa 0,2 %' (the year never runs into the value).
  const prevWhen = k.prevMonth ? `${yearDiff ? `vuoden ${fmt.yearOf(k.prevMonth)} ` : ''}${fmt.inessive(k.prevMonth, { year: false })}` : '';
  const prevText = fmt.isNum(k.prevYoy) ? ` (${prevWhen} ${fmt.pct(k.prevYoy)})` : '';
  const first = model.annualChangeSentence(k.month, k.yoy).replace(/\.$/, `${prevText}.`);
  const ykNotes = [yk.month === k.month ? null : fmt.monthName(yk.month), yk.provisional ? 'ennakko' : null].filter(Boolean);
  const second = `EU-maiden vertailuun käytettävällä yhdenmukaistetulla kuluttajahintaindeksillä (YKHI) inflaatio oli ${fmt.pct(yk.yoy)}${ykNotes.length ? ` (${ykNotes.join(', ')})` : ''}.`;
  const [num, unit] = fmt.pct(k.yoy).split(fmt.NBSP);

  const facts = c.statsList(
    [
      { label: 'YKHI, Suomi', value: html`${fmt.pct(yk.yoy)}${yk.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`, note: `${fmt.monthName(yk.month)} · Eurostat` },
      ea ? { label: 'Euroalue', value: fmt.pct(ea.yoy), note: `${fmt.monthName(ea.month)} · Eurostat` } : null,
      fmt.isNum(yk.coreYoy)
        ? { label: 'Pohjainflaatio', value: fmt.pct(yk.coreYoy), note: `${fmt.monthName(yk.month)} · Eurostat (ilman energiaa, ruokaa, alkoholia ja tupakkaa)` }
        : null,
    ].filter(Boolean),
    { className: 'home-hero__facts' },
  );

  return html`<section class="home-hero" id="nyt" aria-labelledby="nyt-otsikko">
  <span class="home-anchor" id="home"></span>
  <div class="container home-hero__grid">
    <div class="home-hero__main">
      <p class="eyebrow">Inflaatio Suomessa · ${fmt.monthName(k.month)}</p>
      <h1 class="home-hero__title" id="nyt-otsikko">Inflaatio Suomessa nyt</h1>
      <p class="home-hero__figure"><span class="home-hero__value">${num}<span class="home-hero__unit">${fmt.NBSP}${unit}</span></span>${chip}</p>
      <p class="home-hero__lede">${first} ${second}</p>
      <p class="home-hero__meta">${
        k.updated ? html`Päivitetty <time datetime="${fmt.isoDate(k.updated)}">${fmt.date(k.updated)}</time> · ` : ''
      }${next ? html`Seuraava julkaisu <time datetime="${next.date}">${fmt.date(next.date)}</time> · ` : ''}<a href="#lahteet">Lähteet</a>: Tilastokeskus (KHI), Eurostat (YKHI)</p>
    </div>
    <div class="home-hero__side">
      <figure class="home-hero__spark" aria-labelledby="nyt-kaavio-otsikko">
        <figcaption class="home-hero__spark-head">
          <span class="home-hero__spark-title" id="nyt-kaavio-otsikko">Vuosi-inflaatio 24 kk (KHI)</span>
          ${c.legend([
            { cls: 'khi', label: 'KHI' },
            { cls: 'target', label: 'Tavoite 2 %', dashed: true },
            { cls: 'muted', label: '0 %' },
          ])}
        </figcaption>
        ${spark(112, 'home-spark home-spark--wide')}${spark(64, 'home-spark home-spark--narrow')}
        <p class="home-hero__spark-axis" aria-hidden="true"><span>${fmt.monthShort(sMonths[0])}</span><span>${fmt.monthShort(sMonths.at(-1))}</span></p>
      </figure>
      ${facts}
    </div>
  </div>
</section>`;
}

/** KPI cards of one metric (server-rendered for both; JS shows the selected one). */
function kpiPanel(ctx, vm, metric) {
  const { html, fmt, stats, c } = ctx;
  const l = vm.L[metric];
  const info = model.METRIC_INFO[metric];
  const cy = l.currentYear;
  const official = metric === 'khi' ? vm.L.khiAnnual : vm.L.ykhiAnnual && { year: vm.L.ykhiAnnual.year, yoy: vm.L.ykhiAnnual.FI };

  let yearCard;
  if (cy && !cy.complete) {
    yearCard = c.kpiCard({
      label: `Vuosi ${cy.year} (${cy.span})`,
      value: fmt.pct(cy.value),
      note: `${fmt.capitalize(cy.span)}kuun keskiarvo. ${model.PARTIAL_YEAR_NOTE}`,
    });
  } else if (cy && official?.year === cy.year) {
    yearCard = c.kpiCard({ label: `Vuosi ${cy.year}`, value: fmt.pct(official.yoy), note: `${SOURCE_GEN[metric]} virallinen vuosimuutos.` });
  } else if (cy) {
    yearCard = c.kpiCard({ label: `Vuosi ${cy.year}`, value: fmt.pct(cy.value), note: 'Kuukausien keskiarvo. Virallinen vuosimuutos julkaistaan myöhemmin.' });
  }
  const from12 = fmt.ymAdd(l.month, -11);
  const cards = [
    c.kpiCard({ label: 'Hinnat kuukaudessa', value: fmt.pct(l.mom, { sign: true }), note: model.momNote(l.prevMonth, l.month, l.mom) }),
    c.kpiCard({
      label: 'Muutos edellisestä kuukaudesta',
      value: fmt.pp(l.delta),
      delta: stats.deltaClass(l.delta),
      note: model.deltaNote(l.prevMonth, l.prevYoy, l.month, l.yoy),
    }),
    c.kpiCard({ label: '12 kk keskiarvo', value: fmt.pct(l.mean12), note: `Vuosi-inflaation keskiarvo ${fmt.elative(from12)} ${fmt.illative(l.month)}.` }),
    yearCard,
    c.kpiCard({ label: 'Vuosi sitten', value: fmt.pct(l.yearAgoYoy), note: model.yearAgoNote(l.month, l.yoy, l.yearAgoYoy) }),
  ].filter(Boolean);

  const core = metric === 'ykhi' && fmt.isNum(l.coreYoy) ? html` · pohjainflaatio ${fmt.pct(l.coreYoy)}` : '';
  return html`<div class="home-panel" data-metric-panel="${metric}" id="tunnusluvut-${metric}">
  <p class="home-panel__head"><span class="home-panel__name">${fmt.capitalize(info.name)} (${info.short})</span> · ${info.source} · ${fmt.monthName(l.month)} · vuosi-inflaatio <strong class="num">${fmt.pct(l.yoy)}</strong>${core}${
    l.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''
  }</p>
  ${c.kpiGrid(cards)}
</div>`;
}

/** 2 Tunnusluvut with the global metric selector. */
function kpiSection(ctx, vm) {
  const { html, c } = ctx;
  const switcher = html`<div class="home-switch js-only">${c.segmented({
    name: 'mittari',
    label: 'Mittari',
    value: model.DEFAULT_METRIC,
    full: true,
    controls: 'tunnusluvut-khi tunnusluvut-ykhi vuosittain-khi vuosittain-ykhi kehitys-tilastot hintataso-kaavio-alue hintataso-taulukko',
    options: [
      { value: 'khi', label: 'KHI', sub: 'Tilastokeskus', series: 'khi' },
      { value: 'ykhi', label: 'YKHI', sub: 'Eurostat', series: 'ykhi' },
    ],
  })}</div>`;
  return c.section({
    id: 'tunnusluvut',
    eyebrow: `${ctx.fmt.capitalize(ctx.fmt.monthName(vm.L.khi.month))} · KHI ja YKHI`,
    title: 'Tunnusluvut',
    intro: html`Kuluttajahintaindeksi (KHI) on Suomen virallinen inflaatiomittari, YKHI on tarkoitettu EU-maiden vertailuun. <a href="#khi-vai-ykhi">Mitä eroa niillä on?</a>`,
    controls: switcher,
    body: html`${kpiPanel(ctx, vm, 'khi')}${kpiPanel(ctx, vm, 'ykhi')}`,
  });
}

/** 3 Mikä nostaa hintoja? – contributions of the main groups (Tilastokeskus 15b5). */
function driversSection(ctx, vm) {
  const { html, fmt, svg, c } = ctx;
  const h = vm.d.hyodykkeet;
  if (!h?.items?.length) return '';
  const byCode = new Map(h.items.map((it) => [it.code, it]));
  const total = byCode.get('SSS');
  const groups = (h.groups?.codes ?? [])
    .filter((code) => code !== 'SSS')
    .map((code) => byCode.get(code))
    .filter((it) => it && fmt.isNum(it.contribution));
  if (!groups.length) return '';
  const month = h.latest ?? vm.L.hyodykkeet?.month ?? vm.L.khi.month;
  const name = (it) => it.shortName ?? it.name;
  const sorted = [...groups].sort((a, b) => b.contribution - a.contribution);
  const top = [...groups]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 6)
    .sort((a, b) => b.contribution - a.contribution);

  const biggest = sorted[0];
  const lowest = sorted.at(-1);
  const share = fmt.isNum(total?.contribution) && total.contribution > 0 && biggest.contribution > 0 ? (biggest.contribution / total.contribution) * 100 : null;
  const yoyWord = (v) => (ctx.stats.deltaClass(v) === 'down' ? `laskivat vuodessa ${fmt.pct(Math.abs(v))}` : ctx.stats.deltaClass(v) === 'up' ? `nousivat vuodessa ${fmt.pct(v)}` : 'pysyivät vuoden takaisella tasolla');
  let summary =
    biggest.contribution > 0
      ? `Suurin nostaja oli pääryhmä ${name(biggest)}: vaikutus ${fmt.pp(biggest.contribution, { decimals: 2 })}${
          share != null ? ` eli noin ${fmt.pct(share, { decimals: 0 })} koko inflaatiosta (${fmt.pct(total.yoy)})` : ''
        }. Ryhmän hinnat ${yoyWord(biggest.yoy)}.`
      : `Kaikkien pääryhmien vaikutus oli ${fmt.inessive(month)} nolla tai negatiivinen.`;
  if (lowest.contribution < 0) summary += ` Eniten inflaatiota hillitsi pääryhmä ${name(lowest)} (${fmt.pp(lowest.contribution, { decimals: 2 })}).`;

  const chart = svg.hBarChart({
    bars: top.map((it) => ({
      label: name(it),
      value: it.contribution,
      title: `${it.name}: vaikutus ${fmt.pp(it.contribution, { decimals: 2 })}, vuosimuutos ${fmt.pct(it.yoy)}`,
    })),
    ariaLabel: `Pääryhmien vaikutus vuosi-inflaatioon ${fmt.inessive(month)}, prosenttiyksikköä: ${top
      .map((it) => `${name(it)} ${fmt.pp(it.contribution, { decimals: 2 })}`)
      .join(', ')}`,
  });
  const table = c.dataTable({
    id: 'hinnat-taulukko',
    caption: `Pääryhmien hintamuutos ja vaikutus inflaatioon, ${fmt.monthName(month)}`,
    columns: [
      { label: 'Pääryhmä' },
      { label: 'Vuosimuutos', num: true },
      { label: 'Kuukausimuutos', num: true },
      { label: html`Paino, <abbr title="promillea">‰</abbr>`, num: true },
      { label: `Vaikutus, ${PP}`, num: true },
    ],
    rows: sorted.map((it) => [
      name(it),
      c.numUnit(fmt.pct(it.yoy)),
      c.numUnit(fmt.pct(it.mom, { sign: true })),
      fmt.isNum(it.weight) ? fmt.num(it.weight, 1) : fmt.DASH,
      fmt.num(it.contribution, 2, { sign: true }),
    ]),
    note: `Painot vuodelta ${h.weightYear ?? fmt.yearOf(month)}. Pääryhmien vaikutukset yhteensä ${fmt.num(
      groups.reduce((s, it) => s + it.contribution, 0),
      2,
      { sign: true },
    )} ${PP}; kokonaisindeksin vuosimuutos ${fmt.pct(total?.yoy)}.`,
    compact: true,
  });

  return c.section({
    id: 'mika-nostaa',
    eyebrow: `Hyödykeryhmät · ${fmt.monthName(month)}`,
    title: 'Mikä nostaa hintoja?',
    intro: 'Pääryhmien vaikutus kuluttajahintojen vuosimuutokseen prosenttiyksikköinä. Vaikutus riippuu hintamuutoksesta ja ryhmän painosta.',
    body: c.chartFigure({
      id: 'hinnat-kaavio',
      title: `Suurimmat vaikutukset, ${fmt.monthName(month)}`,
      subtitle: `Prosenttiyksikköä · ${top.length} suurinta ${groups.length} pääryhmästä · kaikki taulukossa`,
      chart,
      summary,
      table,
      source: c.sourceLine({ sources: [SRC.groups], updated: vm.L.updated?.hyodykkeet }),
      actions: c.button({ label: 'Katso, mikä kallistui ja halpeni', href: '/hinnat/', icon: 'arrowRight' }),
    }),
  });
}

/** 4 Kehitys – the main chart. */
function trendSection(ctx, vm) {
  const { html, fmt, stats, svg, c } = ctx;
  const key = model.DEFAULT_RANGE;
  const r = stats.sliceRange(vm.months, [vm.series.khi, vm.series.ykhi], key);
  const t = vm.text.trend[key];
  const summary = t.summary[model.DEFAULT_METRIC];
  const fallback = (height, cls) =>
    svg.lineChart({
      series: [
        { values: r.series[0], cls: 'khi', label: 'KHI' },
        { values: r.series[1], cls: 'ykhi', label: 'YKHI' },
      ],
      labels: r.months,
      refLines: [{ value: 2, cls: 'target' }],
      height,
      className: cls,
      ariaLabel: `${t.aria} ${summary}`,
    });

  // Optional series are rendered hidden; the page script shows them with the toggles (data-series = key).
  const legend = c.legend(
    [
      { cls: 'khi', label: 'KHI (Tilastokeskus)' },
      { cls: 'ykhi', label: 'YKHI (Eurostat)' },
      { cls: 'ea', label: 'Euroalue (YKHI)', key: 'ea', hidden: true },
      { cls: 'core', label: 'Pohjainflaatio, Suomi', dashed: true, key: 'core', hidden: true },
      { cls: 'ea', label: 'Pohjainflaatio, euroalue', dashed: true, key: 'core-ea', hidden: true },
      vm.events.length ? { cls: 'muted', label: 'Tapahtuma', key: 'events', hidden: true } : null,
      { cls: 'target', label: `EKP:n tavoite 2${fmt.NBSP}%`, dashed: true },
    ].filter(Boolean),
  );

  // Event markers are off by default: a 5-year range has a dozen of them.
  const toggles = html`<fieldset class="home-toggles js-only no-print">
  <legend class="home-toggles__legend">Näytä myös</legend>
  ${c.checkbox({ id: 'kehitys-euroalue', label: 'Euroalue' })}
  ${c.checkbox({ id: 'kehitys-pohja', label: 'Pohjainflaatio' })}
  ${vm.events.length ? c.checkbox({ id: 'kehitys-tapahtumat', label: 'Tapahtumat' }) : ''}
</fieldset>`;

  const statsRow = c.statsList(
    vm.text.stats[model.DEFAULT_METRIC][key].map((it, i) => ({ ...it, id: `kehitys-tilasto-${i}` })),
    { id: 'kehitys-tilastot', className: 'home-stats' },
  );

  // Server default = 5 v; the page script rebuilds the rows for the selected range.
  const table = c.dataTable({
    id: 'kehitys-taulukko',
    caption: `Vuosi-inflaatio kuukausittain, ${t.period}`,
    columns: [{ label: 'Kuukausi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }],
    rows: r.months.map((m, i) => [fmt.monthShort(m), fmt.pct(r.series[0][i]), fmt.pct(r.series[1][i])]).reverse(),
    visibleRows: model.TABLE_ROWS,
    toggleLabels: model.trendTableLabels(r.months.length),
    note: html`Koko aikasarja: <a href="/inflaatio/">inflaatio vuosittain ja kuukausittain</a>.`,
    compact: true,
  });

  const figure = c.chartFigure({
    id: 'kehitys-kaavio',
    title: 'Kuluttajahintojen vuosimuutos',
    subtitle: html`%, kuukausittain · <span id="kehitys-jakso">${t.period}</span>`,
    legend,
    chart: html`${toggles}
<div class="home-chart" id="kehitys-kaavio-alue">
  <div class="home-chart__fallback" data-chart-fallback>${fallback(380, 'home-chart__svg home-chart__svg--wide')}${fallback(280, 'home-chart__svg home-chart__svg--narrow')}</div>
  <div class="chart-canvas" data-chart="kehitys" data-label="${t.aria}" hidden></div>
</div>
<p class="home-stats__caption" id="kehitys-tilastot-mittari">${model.statsCaption(model.DEFAULT_METRIC)}</p>
${statsRow}`,
    // Not a live region: the page script announces view changes once (lib/dom.js announce()).
    summary: html`<span id="kehitys-yhteenveto">${summary}</span>`,
    table,
    source: c.sourceLine({
      sources: [
        { ...SRC.khi, detail: 'KHI' },
        { ...SRC.ykhi, detail: 'YKHI, euroalue ja pohjainflaatio' },
      ],
      updated: vm.updated,
    }),
    actions: html`${c.button({ label: 'Lataa kuva', icon: 'download', size: 'sm', className: 'js-only', attrs: { disabled: true, data: { chartDownload: 'kehitys' } } })}${c.shareButton({ size: 'sm' })}`,
  });

  const eventList = vm.events.length
    ? c.details({
        summary: 'Kaavion tapahtumamerkinnät',
        className: 'disclosure--plain home-events',
        body: html`<ul class="home-events__list">${vm.events.map(
          (e) => html`<li><time datetime="${e.month}">${fmt.monthShort(e.month)}</time> <strong>${e.label}.</strong> ${e.text}</li>`,
        )}</ul>`,
      })
    : '';

  return c.section({
    id: 'kehitys',
    eyebrow: 'Kehitys',
    title: 'Inflaatio kuukausittain',
    intro: 'KHI ja YKHI samassa kuvassa. Valitse aikaväli; tilastot, taulukko ja hintataso seuraavat valintaa.',
    controls: html`<div class="home-switch js-only">${c.segmented({
      name: 'jakso',
      label: 'Aikaväli',
      value: key,
      full: true,
      controls: 'kehitys-kaavio-alue kehitys-tilastot kehitys-taulukko hintataso-kaavio-alue hintataso-taulukko',
      options: stats.RANGE_KEYS.map((k) => ({ value: k, label: model.RANGE_LABELS[k] })),
    })}</div>`,
    body: html`<span class="home-anchor" id="analytiikka"></span>${figure}${eventList}`,
  });
}

/** 5 Hintataso – price level rebased to the range start. */
function levelSection(ctx, vm) {
  const { html, fmt, svg, c } = ctx;
  const key = model.DEFAULT_RANGE;
  const metric = model.DEFAULT_METRIC;
  const t = vm.text.level[metric][key];
  const pl = model.priceLevel(vm.months, vm.levelIndex[metric][t.base], key);
  const eur100 = `100${fmt.NBSP}€`;
  const fallback = (height, cls) =>
    svg.lineChart({
      series: [{ values: pl.values, cls: 'khi', label: 'Hintataso (KHI)' }],
      labels: pl.months,
      refLines: [{ value: 100, cls: 'target' }],
      height,
      className: cls,
      formatY: (v, step) => `${fmt.num(v, step < 1 ? 1 : 0)}${fmt.NBSP}€`,
      formatValue: (v) => fmt.eur(v),
      ariaLabel: `${t.aria} ${t.summary}`,
    });

  // Text alternative: the level at the same month of each year of the range
  // (the page script rebuilds it for the selected metric and range).
  const table = c.dataTable({
    id: 'hintataso-taulukko',
    caption: model.priceLevelCaption(pl, metric),
    columns: [{ label: 'Kuukausi' }, { label: 'Hintataso', num: true }, { label: `Pisteluku (${t.base})`, num: true }],
    rows: model.priceLevelRows(pl),
    compact: true,
  });

  return c.section({
    id: 'hintataso',
    eyebrow: 'Rahan arvo',
    title: `Hintataso: mitä ${eur100} on nyt?`,
    intro: `Mitä jakson alussa ${eur100} maksaneet ostokset maksoivat jakson lopussa. Aikaväli ja mittari ovat samat kuin yllä.`,
    body: c.chartFigure({
      id: 'hintataso-kaavio',
      title: `Hintataso, jakson alku = ${eur100}`,
      // The base follows the range: the newest official base that covers its start (as in the statistics row).
      subtitle: html`<span id="hintataso-jakso">${t.period}</span> · virallisista pisteluvuista (<span id="hintataso-perusta">${t.base}</span>)`,
      legend: c.legend([
        { cls: 'khi', label: 'Hintataso, KHI', key: 'level-khi' },
        { cls: 'ykhi', label: 'Hintataso, YKHI', key: 'level-ykhi', hidden: true },
        { cls: 'target', label: `Jakson alku ${eur100}`, dashed: true },
      ]),
      chart: html`<div class="home-chart home-chart--level" id="hintataso-kaavio-alue">
  <div class="home-chart__fallback" data-chart-fallback>${fallback(300, 'home-chart__svg home-chart__svg--wide')}${fallback(240, 'home-chart__svg home-chart__svg--narrow')}</div>
  <div class="chart-canvas" data-chart="hintataso" data-label="${t.aria}" hidden></div>
</div>`,
      summary: html`<span id="hintataso-yhteenveto">${t.summary}</span>`,
      table,
      source: c.sourceLine({
        sources: [
          { ...SRC.khi, detail: 'KHI, pisteluvut' },
          { ...SRC.ykhi, detail: 'YKHI, pisteluvut' },
        ],
        updated: vm.updated,
      }),
      actions: c.button({ label: 'Laske rahan arvo', href: '/rahanarvo/', icon: 'arrowRight' }),
    }),
  });
}

/** Annual rows of one metric: official complete years + the partial current year. */
function annualSeries(ctx, rows, current) {
  const out = rows.map((r) => ({ ...r, partial: null }));
  const last = out.at(-1)?.year ?? 0;
  if (current && current.year > last) {
    out.push({ year: current.year, value: current.value, partial: current.complete ? null : current });
  }
  return out;
}

/** 6 Vuosittain – official annual figures. */
function annualSection(ctx, vm) {
  const { html, fmt, stats, svg, c } = ctx;
  const khiRows = annualSeries(ctx, annualRows(fmt, vm.d['khi-annual']?.years, vm.d['khi-annual']?.yoy), vm.L.khi.currentYear);
  const ykhiRows = annualSeries(ctx, annualRows(fmt, vm.d['ykhi-annual']?.years, vm.d['ykhi-annual']?.geo?.FI), vm.L.ykhi.currentYear);
  if (!khiRows.length) return '';

  const panel = (metric, rows) => {
    if (!rows.length) return '';
    const info = model.METRIC_INFO[metric];
    const complete = rows.filter((r) => !r.partial);
    const hi = complete.reduce((b, r) => (r.value > b.value ? r : b), complete[0]);
    const lo = complete.reduce((b, r) => (r.value < b.value ? r : b), complete[0]);
    const partial = rows.find((r) => r.partial);
    const span = `${rows[0].year}–${rows.at(-1).year}`;
    const chart = svg.barChart({
      bars: rows.map((r) => ({
        label: String(r.year),
        value: r.value,
        cls: stats.levelBand(r.value) ?? metric,
        partial: Boolean(r.partial),
        title: `${r.partial ? r.partial.label : r.year}: ${fmt.pct(r.value)}`,
      })),
      refLines: [{ value: 2, cls: 'target' }],
      height: 260,
      valueLabels: false,
      ariaLabel: `${info.short}-inflaatio vuosittain ${span}. Korkein ${fmt.pct(hi.value)} vuonna ${hi.year}, matalin ${fmt.pct(lo.value)} vuonna ${lo.year}.${
        partial ? ` ${partial.partial.label}: ${fmt.pct(partial.value)}.` : ''
      }`,
    });
    return html`<div class="home-panel" data-metric-panel="${metric}" id="vuosittain-${metric}">${c.chartFigure({
      id: `vuosittain-kaavio-${metric}`,
      title: `${info.short}-inflaatio vuosittain ${span}`,
      subtitle: `Vuosimuutos, % · ${info.source}${partial ? ` · ${partial.partial.label} vaaleampana` : ''}`,
      legend: c.legend([
        { cls: 'deflation', label: 'alle 0 %', box: true },
        { cls: 'low', label: '0–2 %', box: true },
        { cls: 'elevated', label: '2–4 %', box: true },
        { cls: 'high', label: 'yli 4 %', box: true },
        { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
      ]),
      chart,
      summary: `Korkein vuosi-inflaatio oli ${fmt.pct(hi.value)} vuonna ${hi.year} ja matalin ${fmt.pct(lo.value)} vuonna ${lo.year}.${
        partial ? ` Vuoden ${partial.year} luku (${fmt.pct(partial.value)}) on ${partial.partial.span}kuun keskiarvo.` : ''
      } Pylvään väri kertoo inflaation tason (alle 0 %, 0–2 %, 2–4 % tai yli 4 %).`,
    })}</div>`;
  };

  const ykhiBy = new Map(ykhiRows.map((r) => [r.year, r]));
  const desc = [...khiRows].reverse();
  const partialKhi = khiRows.find((r) => r.partial);
  const table = c.dataTable({
    id: 'vuositaulukko',
    caption: `Inflaatio vuosittain ${khiRows[0].year}–${khiRows.at(-1).year}`,
    columns: [
      { label: 'Vuosi' },
      { label: 'KHI', num: true },
      { label: 'YKHI', num: true },
      { label: `KHI:n muutos, ${PP}`, num: true },
    ],
    rows: desc.map((r, i) => {
      const prev = desc[i + 1]?.value;
      const ch = stats.ppChange(r.value, prev);
      const yr = ykhiBy.get(r.year);
      return {
        partial: Boolean(r.partial),
        cells: [
          html`${r.year}${r.partial ? html`<span class="data-table__partial">${r.partial.span}</span>` : ''}`,
          html`<span class="level">${c.levelDot(r.value)}${fmt.pct(r.value)}</span>`,
          yr ? fmt.pct(yr.value) : fmt.DASH,
          ch == null ? fmt.DASH : c.deltaChip({ value: ch, plain: true, showUnit: false }),
        ],
      };
    }),
    visibleRows: 10,
    toggleLabels: {
      more: `Näytä kaikki vuodet (${khiRows[0].year}–${khiRows.at(-1).year})`,
      less: 'Näytä vain 10 viimeisintä vuotta',
    },
    note: `Lähteet: Tilastokeskus, kuluttajahintaindeksi (taulukko 122q); Eurostat, YKHI (prc_hicp_ainr). ${
      partialKhi ? `Vuoden ${partialKhi.year} luku on ${partialKhi.partial.span}kuun keskiarvo. ${model.PARTIAL_YEAR_NOTE}` : ''
    }`,
  });

  return c.section({
    id: 'vuosittain',
    eyebrow: 'Vuosittain',
    title: `Inflaatio vuosittain ${khiRows[0].year}–${khiRows.at(-1).year}`,
    intro: 'Päättyneiden vuosien luvut ovat Tilastokeskuksen ja Eurostatin virallisia vuosimuutoksia. Kuluvan vuoden luku on tähän mennessä julkaistujen kuukausien keskiarvo.',
    body: html`${panel('khi', khiRows)}${panel('ykhi', ykhiRows)}
<div class="home-annual-table">${table}</div>
<p class="home-more">${c.button({ label: 'Kaikki vuodet ja kuukaudet', href: '/inflaatio/', icon: 'arrowRight' })}</p>`,
  });
}

/** 7 KHI vai YKHI? */
function explainerSection(ctx, vm) {
  const { html, fmt, c } = ctx;
  const khiRows = annualRows(fmt, vm.d['khi-annual']?.years, vm.d['khi-annual']?.yoy);
  const ykhiRows = annualRows(fmt, vm.d['ykhi-annual']?.years, vm.d['ykhi-annual']?.geo?.FI);
  const at = (rows, y) => rows.find((r) => r.year === y)?.value ?? null;
  const years = [2025, 2023].filter((y) => at(khiRows, y) != null && at(ykhiRows, y) != null);
  const k = vm.L.khi;
  const yk = vm.L.ykhi;
  const rows = [
    [html`${fmt.capitalize(fmt.monthName(k.month))}${yk.month !== k.month ? ` / ${fmt.monthName(yk.month)}` : ''}`, fmt.pct(k.yoy), `${fmt.pct(yk.yoy)}${yk.provisional ? ' (ennakko)' : ''}`],
    ...years.map((y) => [`Vuosi ${y}`, fmt.pct(at(khiRows, y)), fmt.pct(at(ykhiRows, y))]),
  ];
  const body = html`<div class="prose">
  <p>Kuluttajahintaindeksi (KHI) on Tilastokeskuksen virallinen inflaatiomittari. Kun uutisissa kerrotaan Suomen inflaatiosta, tarkoitetaan yleensä sitä, ja sen pohjalta lasketaan myös elinkustannusindeksi, johon monet vuokrasopimukset on sidottu.</p>
  <p>Yhdenmukaistettu kuluttajahintaindeksi (YKHI, engl. HICP) lasketaan kaikissa EU-maissa samalla tavalla, ja sillä Euroopan keskuspankki seuraa 2&nbsp;%:n inflaatiotavoitettaan.</p>
  <p>Suurin ero on asumisessa: KHI sisältää omistusasumisen kuluja, kuten asuntolainojen korot, YKHI ei. Siksi korkojen nousu nosti KHI:tä vuonna 2023 ja korkojen lasku painoi sitä vuonna 2025.</p>
</div>
${c.dataTable({
  id: 'khi-ykhi-taulukko',
  caption: 'KHI ja YKHI rinnakkain (vuosimuutos)',
  columns: [{ label: 'Ajankohta' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }],
  rows,
  note: 'Lähteet: Tilastokeskus (KHI), Eurostat (YKHI). Vuosiluvut ovat virallisia vuosimuutoksia.',
  compact: true,
})}
<p><a href="/menetelmat/">Lue lisää menetelmistä</a></p>`;
  return c.section({
    id: 'khi-vai-ykhi',
    eyebrow: 'Mittarit',
    title: 'KHI vai YKHI?',
    intro: 'Kaksi virallista mittaria eri tarkoituksiin.',
    className: 'section--tight',
    body: c.details({ id: 'khi-vai-ykhi-selite', summary: 'Mitä eroa on kuluttajahintaindeksillä ja yhdenmukaistetulla kuluttajahintaindeksillä?', body }),
  });
}

/** 8 Laskurit. */
function calculatorsSection(ctx, vm) {
  const { html, fmt, c } = ctx;
  const eki = vm.L.elinkustannusindeksi;
  const an = vm.L.ansiot;
  const cards = [
    {
      href: '/vuokrankorotus/',
      eyebrow: 'Laskuri',
      title: 'Vuokrankorotus',
      text: `Uusi vuokra elinkustannusindeksillä tai kuluttajahintaindeksillä.${eki ? ` Elinkustannusindeksi ${fmt.monthName(eki.month)}: ${fmt.num(eki.value, 0)} (Tilastokeskus).` : ''}`,
      meta: 'Laske',
    },
    { href: '/rahanarvo/', eyebrow: 'Laskuri', title: 'Rahan arvo', text: 'Paljonko jonkin kuukauden 100 € on nykyrahassa? Laskenta perustuu Tilastokeskuksen virallisiin pistelukuihin.', meta: 'Laske' },
    { href: '/oma-inflaatio/', eyebrow: 'Laskuri', title: 'Oma inflaatio', text: 'Painota hintojen muutokset omalla kulutuksellasi ja vertaa virallisiin lukuihin.', meta: 'Laske' },
    {
      href: '/ostovoima/',
      eyebrow: 'Laskuri',
      title: 'Ostovoima',
      text: `Nousivatko ansiot hintoja nopeammin?${
        an && fmt.isNum(an.realYoy) ? ` Reaaliansioiden vuosimuutos ${quarterIn(an.period)}: ${fmt.pct(an.realYoy, { sign: true })}${an.preliminary ? ' (ennakko)' : ''}, Tilastokeskus.` : ''
      }`,
      meta: 'Laske',
    },
  ];
  return c.section({
    id: 'laskurit',
    eyebrow: 'Laskurit',
    title: 'Laske inflaation vaikutus',
    intro: html`Vuokrankorotus, rahan arvo, säästöt ja palkan ostovoima virallisilla luvuilla. <a href="/laskurit/">Kaikki laskurit</a>`,
    body: c.cardGrid(cards),
  });
}

/** 9 Ennusteet (src/content/ennusteet.json; hidden when missing or empty). */
function forecastSection(ctx) {
  const { html, fmt, c } = ctx;
  const list = (Array.isArray(ctx.content?.ennusteet) ? ctx.content.ennusteet : []).filter(
    (f) => f?.org && f?.values && typeof f.values === 'object' && Object.values(f.values).some(fmt.isNum),
  );
  if (!list.length) return '';
  const years = [...new Set(list.flatMap((f) => Object.keys(f.values)))].filter((y) => /^\d{4}$/.test(y)).sort();
  const table = c.dataTable({
    id: 'ennusteet-taulukko',
    caption: 'Inflaatioennusteet, vuosimuutos %',
    columns: [{ label: 'Ennustaja' }, { label: 'Ennuste' }, ...years.map((y) => ({ label: y, num: true })), { label: 'Julkaistu', num: true }],
    rows: list.map((f) => [
      f.url && /^https:\/\//.test(f.url) ? html`<a href="${f.url}">${f.org}</a>` : f.org,
      f.label ?? ([f.area === 'EA' ? 'Euroalue' : 'Suomi', f.measure].filter(Boolean).join(', ') || fmt.DASH),
      ...years.map((y) => fmt.pct(f.values[y])),
      f.published ? html`<time datetime="${f.published}">${fmt.date(f.published)}</time>` : fmt.DASH,
    ]),
    note: 'Ennusteet ovat laitosten omia arvioita, eivät Inflaatio.fi:n. Linkit vievät alkuperäiseen julkaisuun.',
    compact: true,
  });
  return c.section({
    id: 'ennusteet',
    eyebrow: 'Ennusteet',
    title: 'Mitä inflaatiolle ennustetaan?',
    intro: `Viimeisimmät julkaistut ennusteet: ${model.listText([...new Set(list.map((f) => String(f.org)))])}.`,
    body: table,
  });
}

/** 10 UKK. */
function faqSection(ctx) {
  const { html, c } = ctx;
  const items = faqItems(ctx);
  if (!items.length) return '';
  const accordion = c.accordion(
    items.map((f, i) => ({ id: f.id, summary: f.q, body: richText(html, f.a), open: i === 0 })),
    { faq: true, headingLevel: 3, id: 'ukk-lista' },
  );
  return html`<section class="section home-faq" id="ukk" aria-labelledby="ukk-otsikko">
  <span class="home-anchor" id="faq"></span><span class="home-anchor" id="tietoa"></span>
  <div class="container home-faq__grid">
    <div class="home-faq__intro">${c.sectionHead({
      title: 'Usein kysyttyä',
      id: 'ukk-otsikko',
      eyebrow: 'UKK',
      intro: html`Vastausten luvut päivittyvät automaattisesti uusimmista tilastoista. Tarkemmin laskentatavoista: <a href="/menetelmat/">menetelmät</a>.`,
    })}</div>
    <div>${accordion}</div>
  </div>
</section>`;
}

/** 11 Lähteet ja päivitykset. */
function sourcesSection(ctx, vm) {
  const { html, fmt, c } = ctx;
  const L = vm.L;
  const cal = Array.isArray(ctx.content?.julkaisukalenteri) ? ctx.content.julkaisukalenteri : [];
  const upcoming = cal
    .filter((e) => {
      if (e.source === 'khi') return e.period > L.khi.month;
      if (e.source === 'ykhi-ennakko') return e.period > L.ykhi.month;
      if (e.source === 'ykhi') return e.period > L.ykhi.month || (L.ykhi.provisional && e.period === L.ykhi.month);
      return false;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 4);
  const log = (Array.isArray(vm.d.muutosloki) ? vm.d.muutosloki : []).slice(0, 5);

  const releases = upcoming.length
    ? html`<ul class="home-list">${upcoming.map(
        (e) => html`<li><time datetime="${e.date}">${fmt.date(e.date)}</time><span>${e.label}${e.time ? ` (${clock(e.time)})` : ''} · ${e.publisher}</span></li>`,
      )}</ul>`
    : html`<p class="muted">Seuraavia julkaisupäiviä ei ole vielä ilmoitettu.</p>`;
  const changes = log.length
    ? html`<ul class="home-list">${log.map((e) => html`<li><time datetime="${e.date}">${fmt.date(e.date)}</time><span>${e.text}</span></li>`)}</ul>`
    : html`<p class="muted">Ei päivityksiä.</p>`;

  return c.section({
    id: 'lahteet',
    eyebrow: 'Lähteet',
    title: 'Lähteet ja päivitykset',
    intro:
      'Luvut perustuvat Tilastokeskuksen, Eurostatin ja EKP:n virallisiin tilastoihin; sivuston itse laskemat luvut, kuten keskiarvot, on merkitty. Sivusto tarkistaa uudet luvut kahdesti päivässä, joten uusi kuukausi näkyy yleensä jo julkaisupäivänä.',
    body: html`<div class="home-sources">
  <div class="home-sources__col">
    <h3 class="home-sources__title">Seuraavat julkaisut</h3>
    ${releases}
    <p class="home-sources__note">Päivämäärät Tilastokeskuksen ja Eurostatin julkaisukalentereista.</p>
  </div>
  <div class="home-sources__col">
    <h3 class="home-sources__title">Viimeisimmät päivitykset</h3>
    ${changes}
  </div>
  <div class="home-sources__col">
    <h3 class="home-sources__title">Lataa ja seuraa</h3>
    <ul class="download-list home-downloads">
      <li>${c.downloadLink({ href: '/data/khi.csv', label: 'KHI kuukausittain', format: 'CSV', track: 'csv_download' })}</li>
      <li>${c.downloadLink({ href: '/data/ykhi.csv', label: 'YKHI kuukausittain', format: 'CSV', track: 'csv_download' })}</li>
    </ul>
    <ul class="home-links">
      <li><a href="/data/">Avoin data</a> – kaikki luvut CSV- ja JSON-tiedostoina</li>
      <li><a href="/feed.xml">RSS-syöte</a> – ilmoitus uusista luvuista</li>
      <li><a href="/pisteluvut/">Pisteluvut</a> – kuukausittaiset indeksipisteluvut</li>
      <li><a href="/menetelmat/">Menetelmät</a> – miten luvut lasketaan</li>
      <li><a href="${SRC.khi.href}">Tilastokeskus: kuluttajahintaindeksi</a></li>
      <li><a href="${SRC.ykhi.href}">Eurostat: yhdenmukaistettu kuluttajahintaindeksi</a></li>
    </ul>
  </div>
</div>
${c.sourceLine({
  sources: [
    { ...SRC.khi, detail: 'kuluttajahintaindeksi, CC BY 4.0' },
    { ...SRC.ykhi, detail: 'YKHI' },
  ],
  updated: vm.updated,
})}`,
  });
}

/* ================================================================ SEO */

/** Meta description (≤ 155 characters) with the latest figure. */
export function pageDescription(fmt, month, yoy, firstYear) {
  const candidates = [
    `${fmt.capitalize(fmt.inessive(month))} Suomen inflaatio oli ${fmt.pct(yoy)} (Tilastokeskus). Katso uusin luku, kehitys vuodesta ${firstYear} ja EU-vertailu (YKHI) kuvaajina ja taulukkona.`,
    `${fmt.capitalize(fmt.inessive(month))} Suomen inflaatio oli ${fmt.pct(yoy)} (Tilastokeskus). Uusin luku, kehitys vuodesta ${firstYear} ja EU-vertailu kuvaajina.`,
  ];
  return candidates.find((d) => d.length <= 155) ?? candidates.at(-1);
}

/** JSON-LD graph: Organization, WebSite, WebPage, Dataset (no FAQPage). */
function structuredData(ctx, vm, { title, description }) {
  const { fmt } = ctx;
  const base = ctx.baseUrl;
  const url = `${base}/`;
  const modified = newest(fmt, Object.values(vm.L.updated ?? {})) ?? vm.L.dataUpdated;
  const org = { '@id': `${base}/#organisaatio` };
  const firstMonth = vm.months[ctx.stats.firstIndex(vm.series.khi)];
  const lastMonth = vm.months.at(-1);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org['@id'],
        name: ctx.site.brand,
        url,
        logo: { '@type': 'ImageObject', url: `${base}/icons/android-chrome-512x512.png`, width: 512, height: 512 },
        parentOrganization: {
          '@type': 'Organization',
          name: ctx.site.operator.name,
          identifier: { '@type': 'PropertyValue', propertyID: 'Y-tunnus', value: ctx.site.operator.businessId },
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#sivusto`,
        url,
        name: ctx.site.brand,
        description: 'Suomen viralliset inflaatioluvut (Tilastokeskus ja Eurostat) kuvaajina, taulukkoina ja laskureina.',
        inLanguage: 'fi',
        publisher: org,
      },
      {
        '@type': 'WebPage',
        '@id': `${base}/#sivu`,
        url,
        name: title,
        description,
        inLanguage: 'fi',
        isPartOf: { '@id': `${base}/#sivusto` },
        about: { '@id': `${base}/#data` },
        primaryImageOfPage: { '@type': 'ImageObject', url: `${base}${ctx.site.ogImage.path}` },
        dateModified: modified,
      },
      {
        '@type': 'Dataset',
        '@id': `${base}/#data`,
        name: 'Inflaatio Suomessa: kuluttajahintaindeksi (KHI) ja yhdenmukaistettu kuluttajahintaindeksi (YKHI) kuukausittain',
        description:
          'Suomen kuluttajahintojen vuosimuutokset ja pisteluvut kuukausittain: Tilastokeskuksen kuluttajahintaindeksi (KHI) ja Eurostatin yhdenmukaistettu kuluttajahintaindeksi (YKHI), sekä euroalueen vertailuluvut.',
        url,
        inLanguage: 'fi',
        keywords: ['inflaatio', 'kuluttajahintaindeksi', 'KHI', 'YKHI', 'HICP', 'CPI', 'Suomi'],
        isAccessibleForFree: true,
        license: 'https://creativecommons.org/licenses/by/4.0/',
        creator: [
          { '@type': 'Organization', name: 'Tilastokeskus', url: 'https://stat.fi/' },
          { '@type': 'Organization', name: 'Eurostat', url: 'https://ec.europa.eu/eurostat' },
        ],
        publisher: org,
        temporalCoverage: `${firstMonth}/${lastMonth}`,
        spatialCoverage: { '@type': 'Place', name: 'Suomi' },
        variableMeasured: ['Kuluttajahintaindeksin vuosimuutos (%)', 'YKHI:n vuosimuutos (%)', 'Pisteluku (2025=100)'],
        dateModified: modified,
        distribution: DATA_FILES.map((f) => ({ '@type': 'DataDownload', name: f.name, encodingFormat: f.format, contentUrl: `${base}${f.path}` })),
      },
    ],
  };
}

/* ================================================================== page */

/** @param {any} ctx */
export default async function home(ctx) {
  const { html, fmt } = ctx;
  const vm = prepare(ctx);
  const k = vm.L.khi;
  const firstYear = fmt.yearOf(vm.months[0]);
  const title = model.pageTitle(k.month, k.yoy);
  const description = pageDescription(fmt, k.month, k.yoy, firstYear);
  const dir = ctx.stats.deltaClass(k.yoy);
  const ogDescription = `Kuluttajahinnat ${dir === 'down' ? 'laskivat' : dir === 'up' ? 'nousivat' : 'pysyivät'} vuodessa${
    dir === 'flat' ? ' ennallaan' : ` ${fmt.pct(Math.abs(k.yoy))}`
  } (${fmt.monthName(k.month)}). Katso kehitys vuodesta ${firstYear}, vuosittaiset luvut ja EU-vertailu.`;

  const main = html`<div class="home" data-home data-mittari="${model.DEFAULT_METRIC}">
${heroSection(ctx, vm)}
${kpiSection(ctx, vm)}
${driversSection(ctx, vm)}
${trendSection(ctx, vm)}
${levelSection(ctx, vm)}
${annualSection(ctx, vm)}
${explainerSection(ctx, vm)}
${calculatorsSection(ctx, vm)}
${forecastSection(ctx)}
${faqSection(ctx)}
${sourcesSection(ctx, vm)}
${ctx.jsonScript('etusivu-data', vm.island)}
</div>`;

  const doc = ctx.layout({
    title,
    description,
    path: PATH,
    page: 'home',
    ogDescription,
    alternates: [{ hreflang: 'en', href: '/en/' }, { hreflang: 'x-default', href: '/' }],
    scripts: ['pages/home.js'],
    jsonLd: [structuredData(ctx, vm, { title, description })],
    main,
  });
  return [{ path: PATH, html: doc, priority: 1, changefreq: 'daily', lastmod: vm.L.dataUpdated ?? undefined }];
}
