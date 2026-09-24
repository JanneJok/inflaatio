/**
 * Inflation archive (owner ARCHIVE):
 *   /inflaatio/                    overview: every year 1980 → (official annual
 *                                  figures), decades, records, events, changelog
 *   /inflaatio/<yyyy>/             one page per year 1980 → latest data year
 *   /inflaatio/<yyyy>/<kuukausi>/  one page per month 2015-01 → latest month
 *
 * Also exports the shared archive model (routes, month/year view models and
 * Finnish text helpers) used by katsaus.js and feed.js, so every archive page
 * computes its numbers the same way. All numbers come from ctx.data at build
 * time; nothing is derived from the clock (SPEC §6).
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';

/* ----------------------------------------------------------------- routes */

/** First year with an annual KHI change (122q / 122p start 1980). */
export const FIRST_YEAR = 1980;
/** First month with its own page. */
export const MONTH_PAGES_FROM = '2015-01';
/** First month with a monthly review (/katsaus/<yyyy-mm>/). */
export const KATSAUS_FROM = '2024-01';

/** @param {number|string} y */
export const yearPath = (y) => `/inflaatio/${y}/`;
/** @param {string} ym 'YYYY-MM' → '/inflaatio/2026/elokuu/' */
export const monthPath = (ym) => `/inflaatio/${ym.slice(0, 4)}/${fmt.monthSlug(ym)}/`;
/** @param {string} ym 'YYYY-MM' → '/katsaus/2026-08/' */
export const katsausPath = (ym) => `/katsaus/${ym}/`;

/* ------------------------------------------------------------ text helpers */

/** Finnish list: ['a', 'b', 'c'] → 'a, b ja c'. @param {string[]} items */
export function listFi(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} ja ${a.at(-1)}`;
}

/** Lower-case the first character (group names inside a sentence). @param {string} s */
export const lowerFirst = (s) => (typeof s === 'string' && s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * Number in running text with the word "prosenttiin/prosentissa":
 * rateWord(2.2, 'illative') → '2,2 prosenttiin'.
 * @param {number} v
 * @param {'illative'|'inessive'} form
 */
export function rateWord(v, form) {
  return `${fmt.num(v, 1)} ${form === 'illative' ? 'prosenttiin' : 'prosentissa'}`;
}

/**
 * Direction verb of a change of the annual rate (judged on the rounded value).
 * @param {number|null} delta %-points
 * @returns {'kiihtyi'|'hidastui'|'pysyi ennallaan'|null}
 */
export function deltaVerb(delta) {
  const c = stats.deltaClass(delta);
  return c === 'up' ? 'kiihtyi' : c === 'down' ? 'hidastui' : c === 'flat' ? 'pysyi ennallaan' : null;
}

/**
 * "Kuluttajahinnat olivat elokuussa 2026 2,2 % korkeammat kuin vuotta aiemmin."
 * @param {string} ym
 * @param {number} yoy
 */
export function levelSentence(ym, yoy) {
  const r = fmt.round(yoy, 1);
  if (r === 0) return `Kuluttajahinnat olivat ${fmt.inessive(ym)} samalla tasolla kuin vuotta aiemmin (vuosimuutos ${fmt.pct(0)}).`;
  const dir = r > 0 ? 'korkeammat' : 'matalammat';
  return `Kuluttajahinnat olivat ${fmt.inessive(ym)} ${fmt.pct(Math.abs(r))} ${dir} kuin vuotta aiemmin.`;
}

/**
 * "Inflaatio kiihtyi heinäkuusta 0,1 %-yks. (heinäkuussa 2,1 %)."
 * @param {string} prevYm
 * @param {number|null} prevYoy
 * @param {number|null} delta
 */
export function deltaSentence(prevYm, prevYoy, delta) {
  const verb = deltaVerb(delta);
  if (!verb || !fmt.isNum(prevYoy)) return '';
  const from = fmt.elative(prevYm, { year: fmt.yearOf(prevYm) !== fmt.yearOf(fmt.ymAdd(prevYm, 1)) });
  const prev = `${fmt.inessive(prevYm, { year: false })} ${fmt.pct(prevYoy)}`;
  if (verb === 'pysyi ennallaan') return `Inflaatio pysyi ${from} ennallaan (${prev}).`;
  return `Inflaatio ${verb} ${from} ${fmt.pp(Math.abs(delta), { sign: false })} (${prev}).`;
}

/**
 * "Hintataso laski kuukaudessa 0,2 %." from the official monthly change.
 * @param {number|null} mom
 */
export function momSentence(mom) {
  if (!fmt.isNum(mom)) return '';
  const r = fmt.round(mom, 1);
  if (r === 0) return 'Hintataso pysyi kuukauden aikana ennallaan.';
  return `Hintataso ${r > 0 ? 'nousi' : 'laski'} kuukaudessa ${fmt.pct(Math.abs(r))}.`;
}

/** Keep a meta description ≤ 155 characters by dropping trailing parts. @param {string[]} parts */
export function fitDescription(parts, max = 155) {
  const p = parts.filter(Boolean);
  while (p.length > 1 && p.join(' ').length > max) p.pop();
  const s = p.join(' ');
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/* ------------------------------------------------------------------ model */

const cache = new WeakMap();

/**
 * Archive view model (memoised per build context).
 * @param {any} ctx
 */
export function archive(ctx) {
  let m = cache.get(ctx);
  if (!m) {
    m = buildArchive(ctx);
    cache.set(ctx, m);
  }
  return m;
}

/** Source descriptors for sourceLine() (URLs from meta.json when present). */
function sources(ctx) {
  const meta = ctx.data.meta?.sources ?? {};
  return {
    khi: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' },
    khiAnnual: { name: 'Tilastokeskus', href: meta.khiAnnual?.url ?? 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksin vuosimuutos' },
    ykhi: { name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'YKHI' },
    eki: { name: 'Tilastokeskus', href: meta.elinkustannusindeksi?.url ?? 'https://stat.fi/tilasto/khi', detail: 'elinkustannusindeksi' },
    groups: { name: 'Tilastokeskus', href: meta.hyodykkeet?.url ?? 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksin hyödykeryhmät' },
  };
}

function buildArchive(ctx) {
  const d = ctx.data;
  const khi = d.khi;
  if (!khi?.months?.length || !khi.yoy || !ctx.latest?.khi) throw new Error('inflaatio: data/khi.json puuttuu (aja npm run fetch)');
  const months = khi.months;
  const latestMonth = ctx.latest.khi.month;
  const latestYear = fmt.yearOf(latestMonth);
  const at = (arr, ym) => (arr ? stats.seriesAt(months, arr, ym) : null);

  const y = d.ykhi;
  const ygeo = (geo) => y?.geo?.[geo];
  const yAt = (geo, key, ym) => (ygeo(geo)?.[key] && y?.months ? stats.seriesAt(y.months, ygeo(geo)[key], ym) : null);
  const flagAt = (geo, ym) => y?.flags?.[geo]?.[ym] ?? null;

  const eki = d.elinkustannusindeksi?.monthly;
  const ekiAt = (ym) => (eki?.months ? stats.seriesAt(eki.months, eki.values, ym) : null);

  // Official annual figures.
  const ka = d['khi-annual'];
  const annualKhi = new Map();
  ka?.years?.forEach((yr, i) => fmt.isNum(ka.yoy?.[i]) && annualKhi.set(Number(yr), ka.yoy[i]));
  const annualIndex = (base, yr) => {
    const i = ka?.years?.indexOf(String(yr)) ?? -1;
    const v = i >= 0 ? ka.index?.[base]?.[i] : null;
    return fmt.isNum(v) ? v : null;
  };
  const ya = d['ykhi-annual'];
  const annualY = (geo, yr) => {
    const i = ya?.years?.indexOf(String(yr)) ?? -1;
    const v = i >= 0 ? ya.geo?.[geo]?.[i] : null;
    return fmt.isNum(v) ? v : null;
  };

  // Monthly means (partial current year, or a complete year whose official
  // figure is not published yet).
  const meanKhi = stats.annualMeanOfMonthly(months, khi.yoy);
  const meanOf = (geo) => (ygeo(geo)?.yoy ? stats.annualMeanOfMonthly(y.months, ygeo(geo).yoy) : null);
  const meanFi = meanOf('FI');
  const meanEa = meanOf('EA');
  const meanRow = (mm, yr) => {
    const i = mm ? mm.years.indexOf(yr) : -1;
    if (i < 0) return null;
    return { value: mm.values[i], months: mm.monthsCount[i], spanStart: mm.spanStart[i], spanEnd: mm.spanEnd[i], complete: mm.complete[i] };
  };
  /** Official annual value or a labelled monthly mean. */
  const yearValue = (official, mean) => {
    if (fmt.isNum(official)) return { value: official, official: true, partial: false, span: null, label: null };
    if (!mean) return null;
    return {
      value: mean.value,
      official: false,
      partial: !mean.complete,
      months: mean.months,
      spanStart: mean.spanStart,
      spanEnd: mean.spanEnd,
      span: fmt.monthsSpan(mean.spanStart, mean.spanEnd),
      label: fmt.partialYear(mean.spanStart, mean.spanEnd),
    };
  };

  const years = [];
  for (let yr = FIRST_YEAR; yr <= latestYear; yr++) {
    const k = yearValue(annualKhi.get(yr), meanRow(meanKhi, yr));
    if (!k) continue;
    years.push({
      year: yr,
      khi: k,
      ykhi: yearValue(annualY('FI', yr), meanRow(meanFi, yr)),
      ea: yearValue(annualY('EA', yr), meanRow(meanEa, yr)),
    });
  }
  const yearMap = new Map(years.map((r) => [r.year, r]));

  // Changelog lookups (release dates).
  const log = Array.isArray(d.muutosloki) ? d.muutosloki : [];
  const releaseDate = (source, period, kind) => log.find((e) => e.source === source && e.period === period && (kind === undefined || (e.kind ?? null) === kind))?.date ?? null;

  // Events.
  const events = (Array.isArray(ctx.content.tapahtumat) ? ctx.content.tapahtumat : [])
    .filter((e) => typeof e?.month === 'string' && /^\d{4}-\d{2}$/.test(e.month))
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  // Main groups (hyodykkeet): names and contributions for the last 60 months.
  const h = d.hyodykkeet;
  const groupNames = new Map((h?.items ?? []).filter((it) => it.level === 1).map((it) => [it.code, it.shortName ?? it.name]));
  const groupsAt = (ym) => {
    const g = h?.groups;
    const i = g?.months?.indexOf(ym) ?? -1;
    if (i < 0) return null;
    const all = (g.codes ?? [])
      .filter((code) => code !== 'SSS')
      .map((code) => ({ code, name: groupNames.get(code) ?? code, yoy: g.series?.[code]?.yoy?.[i] ?? null, contribution: g.series?.[code]?.contribution?.[i] ?? null }));
    // Contributions (%-points) when published for the month, otherwise the
    // groups' own annual changes (%).
    const withContribution = all.filter((r) => fmt.isNum(r.contribution));
    if (withContribution.length) {
      return { mode: 'contribution', rows: withContribution.sort((a, b) => b.contribution - a.contribution), total: g.series?.SSS?.contribution?.[i] ?? null };
    }
    const withYoy = all.filter((r) => fmt.isNum(r.yoy));
    if (!withYoy.length) return null;
    return { mode: 'yoy', rows: withYoy.sort((a, b) => b.yoy - a.yoy), total: null };
  };
  const contributionsFrom = (() => {
    const g = h?.groups;
    const i = g?.series?.SSS?.contribution ? stats.firstIndex(g.series.SSS.contribution) : -1;
    return i >= 0 ? g.months[i] : null;
  })();

  const monthPages = months.filter((ym) => ym >= MONTH_PAGES_FROM && ym <= latestMonth && fmt.isNum(at(khi.yoy, ym)));

  /** Month view model. @param {string} ym */
  const month = (ym) => {
    const prevYm = fmt.ymAdd(ym, -1);
    const yoy = at(khi.yoy, ym);
    const prevYoy = at(khi.yoy, prevYm);
    const index = {};
    for (const [base, arr] of Object.entries(khi.index ?? {})) {
      const v = at(arr, ym);
      if (fmt.isNum(v)) index[base] = v;
    }
    const fiFlag = flagAt('FI', ym);
    const eaFlag = flagAt('EA', ym);
    return {
      ym,
      yoy,
      prevYm,
      prevYoy,
      delta: stats.ppChange(yoy, prevYoy),
      mom: at(khi.mom, ym),
      momOfficial: ym >= (khi.momOfficialFrom ?? '1995-02'),
      yearAgoYoy: at(khi.yoy, fmt.ymAdd(ym, -12)),
      index,
      eki: ekiAt(ym),
      ekiBase: eki?.base ?? '1951:10=100',
      ykhi: { yoy: yAt('FI', 'yoy', ym), mom: yAt('FI', 'mom', ym), core: yAt('FI', 'coreYoy', ym), flag: fiFlag, provisional: fiFlag === 'p' },
      ea: { yoy: yAt('EA', 'yoy', ym), flag: eaFlag, provisional: eaFlag === 'p' },
      groups: groupsAt(ym),
      events: events.filter((e) => e.month === ym),
      released: releaseDate('khi', ym),
      ykhiFinalReleased: releaseDate('ykhi', ym, 'lopullinen'),
      ykhiFlashReleased: releaseDate('ykhi', ym, 'ennakko'),
      hasPage: ym >= MONTH_PAGES_FROM && ym <= latestMonth,
      hasKatsaus: ym >= KATSAUS_FROM && ym <= latestMonth,
    };
  };

  /** Monthly rows of a year (only months with a KHI value). @param {number} yr */
  const monthsOfYear = (yr) =>
    Array.from({ length: 12 }, (_, i) => fmt.toYm(yr, i + 1)).filter((ym) => ym <= latestMonth && fmt.isNum(at(khi.yoy, ym)));

  // Records (official annual figures; monthly rates since 1980).
  const official = years.filter((r) => r.khi.official);
  const officialYears = official.map((r) => String(r.year));
  const officialValues = official.map((r) => r.khi.value);
  const from1980 = stats.sliceRange(months, khi.yoy, 'kaikki');
  const records = {
    yearMax: stats.max(officialYears, officialValues),
    yearMin: stats.min(officialYears, officialValues),
    monthMax: stats.max(from1980.months, from1980.series),
    monthMin: stats.min(from1980.months, from1980.series),
    firstOfficial: official[0]?.year ?? null,
    lastOfficial: official.at(-1)?.year ?? null,
    monthStart: from1980.months[0] ?? null,
  };

  return {
    ctx,
    months,
    latestMonth,
    latestYear,
    years,
    yearMap,
    records,
    events,
    log,
    monthPages,
    month,
    monthsOfYear,
    annualIndex,
    khiAt: (arr, ym) => at(arr, ym),
    index1972At: (ym) => at(khi.index?.['1972=100'], ym),
    groupsAt,
    contributionsFrom,
    releaseDate,
    sources: sources(ctx),
  };
}

/**
 * Decade summaries from the official annual figures. The average annual
 * change is geometric, from the official annual average index (1972=100):
 * (I_last / I_before)^(1/n) − 1.
 * @param {ReturnType<typeof archive>} A
 */
export function decades(A) {
  const out = [];
  const first = Math.floor(FIRST_YEAR / 10) * 10;
  for (let d0 = first; d0 <= A.latestYear; d0 += 10) {
    const rows = A.years.filter((r) => r.year >= d0 && r.year <= d0 + 9);
    if (!rows.length) continue;
    const off = rows.filter((r) => r.khi.official);
    let avg = null;
    if (off.length) {
      const last = off.at(-1).year;
      const i0 = A.annualIndex('1972=100', off[0].year - 1);
      const i1 = A.annualIndex('1972=100', last);
      const n = last - (off[0].year - 1);
      if (fmt.isNum(i0) && fmt.isNum(i1) && n > 0) avg = (Math.pow(i1 / i0, 1 / n) - 1) * 100;
    }
    const ys = off.map((r) => String(r.year));
    const vs = off.map((r) => r.khi.value);
    out.push({
      decade: d0,
      label: `${d0}-luku`,
      rows,
      officialFrom: off[0]?.year ?? null,
      officialTo: off.at(-1)?.year ?? null,
      avg,
      max: stats.max(ys, vs),
      min: stats.min(ys, vs),
    });
  }
  return out;
}

/**
 * Which earlier year was the last one at least as high (or as low)?
 * rankSince(rows, 2022, 'high') → { year: 1984, value: 7.1 } (null = highest since the start).
 * @param {{year: number, khi: {value: number, official: boolean}}[]} rows ascending
 * @param {number} year
 * @param {'high'|'low'} kind
 */
export function rankSince(rows, year, kind) {
  const idx = rows.findIndex((r) => r.year === year);
  if (idx < 0) return undefined;
  const v = fmt.round(rows[idx].khi.value, 1);
  for (let i = idx - 1; i >= 0; i--) {
    const w = fmt.round(rows[i].khi.value, 1);
    if (kind === 'high' ? w >= v : w <= v) return { year: rows[i].year, value: rows[i].khi.value };
  }
  return null;
}

/* ---------------------------------------------------------------- shared UI */

/**
 * Inline source attribution for pageHeader({ meta }) (the header wraps meta
 * in a <p>, so c.sourceLine(), itself a <p>, must not be used there).
 * @param {any} ctx
 * @param {{name: string, href?: string, detail?: string}[]} list
 * @param {string} [updated] ISO timestamp
 */
export function sourceMeta(ctx, list, updated) {
  const { html } = ctx;
  return html`${list.length > 1 ? 'Lähteet' : 'Lähde'}: ${list.map(
    (s, i) => html`${i ? ', ' : ''}${s.href ? html`<a href="${s.href}">${s.name}</a>` : s.name}${s.detail ? ` (${s.detail})` : ''}`,
  )}${updated ? html` · Päivitetty <time datetime="${String(updated).slice(0, 10)}">${fmt.date(updated)}</time>` : ''}`;
}

/** Formatted index point: KHI bases 2 decimals, elinkustannusindeksi whole points. */
export function points(v, base) {
  return String(base).startsWith('1951') || base === 'eki' ? fmt.num(v, 0) : fmt.idx(v);
}

/** Label of a year value ('2026 (tammi–elo)' for a partial year). */
const yearLabel = (r) => (r.khi.official || !r.khi.partial ? String(r.year) : r.khi.label);

/**
 * List of events (tapahtumat.json) with month links.
 * @param {any} ctx
 * @param {{month: string, label: string, text: string}[]} events
 * @param {{link?: 'month'|'year'}} [o]
 */
export function eventList(ctx, events, { link = 'month' } = {}) {
  const { html } = ctx;
  const A = archive(ctx);
  return html`<ol class="archive-events" role="list">${events.map((e) => {
    const when = fmt.capitalize(fmt.monthName(e.month));
    const href = link === 'year' ? (A.yearMap.has(fmt.yearOf(e.month)) ? yearPath(fmt.yearOf(e.month)) : null) : e.month >= MONTH_PAGES_FROM && e.month <= A.latestMonth ? monthPath(e.month) : null;
    return html`<li class="archive-events__item">
  <p class="archive-events__when"><time datetime="${e.month}">${href ? html`<a href="${href}">${when}</a>` : when}</time></p>
  <p class="archive-events__label">${e.label}</p>
  <p class="archive-events__text">${e.text}</p>
</li>`;
  })}</ol>`;
}

/** Stable id of a changelog entry ('muutos-khi-2026-08', 'muutos-ykhi-2026-08-ennakko'). */
export function logId(e) {
  return `muutos-${[e.source, e.period, e.kind].filter(Boolean).join('-')}`.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Finnish label of a changelog entry's source. */
export function logSourceLabel(e) {
  if (e.source === 'khi') return 'KHI';
  if (e.source === 'ykhi') return e.kind === 'ennakko' ? 'YKHI-ennakko' : 'YKHI';
  if (e.source === 'ansiot') return 'Ansiot';
  if (e.source === 'korot') return 'Korot';
  return String(e.source ?? '').toUpperCase();
}

/**
 * Internal page for a changelog entry (month page for KHI/YKHI, topic pages otherwise).
 * @param {ReturnType<typeof archive>} A
 * @param {{source: string, period: string}} e
 */
export function logHref(A, e) {
  if ((e.source === 'khi' || e.source === 'ykhi') && /^\d{4}-\d{2}$/.test(e.period ?? '') && e.period >= MONTH_PAGES_FROM && e.period <= A.latestMonth) {
    return monthPath(e.period);
  }
  if (e.source === 'ansiot') return '/ostovoima/';
  if (e.source === 'korot') return '/korot/';
  return null;
}

/* ============================================================ page module */

/** @param {any} ctx */
export default async function inflaatio(ctx) {
  const A = archive(ctx);
  const out = [overviewPage(ctx, A)];
  for (const r of A.years) out.push(yearPage(ctx, A, r));
  for (const ym of A.monthPages) out.push(monthPage(ctx, A, ym));
  return out;
}

/* ---------------------------------------------------------------- overview */

function overviewPage(ctx, A) {
  const { html, c, svg, stats: st } = ctx;
  const path = '/inflaatio/';
  const first = A.years[0];
  const last = A.years.at(-1);
  const span = `${first.year}–${last.year}`;
  const R = A.records;
  const partial = last.khi.official ? null : last;
  const lastOfficial = A.years.filter((r) => r.khi.official).at(-1);
  const srcAnnual = A.sources.khiAnnual;

  // KPIs
  const kpis = c.kpiGrid([
    c.kpiCard({
      label: `Vuosi ${lastOfficial.year}`,
      value: fmt.pct(lastOfficial.khi.value),
      note: 'Tilastokeskuksen virallinen vuosimuutos',
    }),
    partial
      ? c.kpiCard({
          label: `Vuosi ${partial.khi.label}`,
          value: fmt.pct(partial.khi.value),
          note: partial.khi.partial ? `${fmt.capitalize(partial.khi.span)}kuun keskiarvo, tarkentuu vuoden aikana` : 'Kuukausien keskiarvo; virallinen vuosiluku ei vielä aineistossa',
        })
      : null,
    c.kpiCard({ label: 'Korkein vuosi', value: fmt.pct(R.yearMax?.value), note: listFi(R.yearMax?.months ?? []) }),
    c.kpiCard({ label: 'Alin vuosi', value: fmt.pct(R.yearMin?.value), note: listFi(R.yearMin?.months ?? []) }),
  ].filter(Boolean));

  // Bar chart + table
  const bars = A.years.map((r) => ({
    label: String(r.year),
    value: r.khi.value,
    cls: st.levelBand(r.khi.value) ?? 'khi',
    partial: !r.khi.official && r.khi.partial,
    title: `${yearLabel(r)}: ${fmt.pct(r.khi.value)}`,
  }));
  const chart = svg.barChart({
    bars,
    refLines: [{ value: 2, cls: 'target' }],
    height: 280,
    ariaLabel: `Inflaatio vuosittain ${span}. Korkein ${fmt.pct(R.yearMax?.value)} vuonna ${listFi(R.yearMax?.months ?? [])}, alin ${fmt.pct(R.yearMin?.value)} vuonna ${listFi(R.yearMin?.months ?? [])}.`,
  });
  const desc = [...A.years].reverse();
  const table = c.dataTable({
    id: 'vuodet-taulukko',
    caption: `Inflaatio vuosittain ${span}: kuluttajahintaindeksi (KHI) ja yhdenmukaistettu kuluttajahintaindeksi (YKHI)`,
    columns: [{ label: 'Vuosi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Euroalue', num: true }, { label: 'Muutos, %-yks.', num: true }],
    rows: desc.map((r, i) => {
      const prev = desc[i + 1];
      const ch = prev ? st.ppChange(r.khi.value, prev.khi.value) : null;
      return {
        partial: !r.khi.official,
        cells: [
          html`<a href="${yearPath(r.year)}">${r.year}</a>${!r.khi.official && r.khi.partial ? html`<span class="data-table__partial">${r.khi.span}</span>` : ''}`,
          html`<span class="level">${c.levelDot(r.khi.value)}${c.numUnit(fmt.pct(r.khi.value))}</span>`,
          r.ykhi ? c.numUnit(fmt.pct(r.ykhi.value)) : fmt.DASH,
          r.ea ? c.numUnit(fmt.pct(r.ea.value)) : fmt.DASH,
          ch == null ? fmt.DASH : c.deltaChip({ value: ch, plain: true, showUnit: false }),
        ],
      };
    }),
    visibleRows: 15,
    toggleLabels: { more: `Näytä kaikki vuodet (${span})`, less: 'Näytä vain 15 viimeisintä vuotta' },
    note: html`KHI: Tilastokeskuksen virallinen vuosimuutos${partial ? html` (vuosi ${partial.khi.label} on kuukausien vuosimuutosten keskiarvo)` : ''}. YKHI ja euroalue: Eurostatin virallinen vuosimuutos vuodesta ${A.years.find((r) => r.ykhi)?.year ?? 1997} alkaen. Muutos = KHI:n ero edelliseen vuoteen.`,
  });
  const figure = c.chartFigure({
    id: 'vuodet-kaavio',
    title: `Inflaatio vuosittain ${span}`,
    subtitle: `Kuluttajahintaindeksin vuosimuutos, %${partial ? ` · ${partial.khi.label} haalealla` : ''}`,
    legend: c.legend([
      { cls: 'deflation', label: 'alle 0 %', box: true },
      { cls: 'low', label: '0–2 %', box: true },
      { cls: 'elevated', label: '2–4 %', box: true },
      { cls: 'high', label: 'yli 4 %', box: true },
      { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
    ]),
    chart,
    summary: `Inflaatio oli korkeimmillaan ${fmt.pct(R.yearMax?.value)} vuonna ${listFi(R.yearMax?.months ?? [])} ja matalimmillaan ${fmt.pct(R.yearMin?.value)} vuonna ${listFi(R.yearMin?.months ?? [])}. Vuonna ${lastOfficial.year} inflaatio oli ${fmt.pct(lastOfficial.khi.value)}.`,
    table,
    tableLabel: 'Näytä vuodet taulukkona',
    source: c.sourceLine({ sources: [srcAnnual, A.sources.ykhi], updated: ctx.latest.updated?.khiAnnual ?? ctx.latest.khi.updated }),
  });

  // Decades
  const dec = decades(A);
  const decadeList = html`<ul class="archive-decades" role="list">${dec.map((d) => {
    const range = d.officialFrom === d.officialTo ? String(d.officialFrom) : `${d.officialFrom}–${d.officialTo}`;
    return html`<li class="archive-decade">
  <h3 class="archive-decade__title">${d.label}</h3>
  ${d.avg != null
    ? c.statsList([
        { label: 'Keskimäärin vuodessa', value: c.numUnit(fmt.pct(d.avg)), note: range },
        { label: 'Korkein', value: c.numUnit(fmt.pct(d.max?.value)), note: listFi(d.max?.months ?? []) },
        { label: 'Alin', value: c.numUnit(fmt.pct(d.min?.value)), note: listFi(d.min?.months ?? []) },
      ], { className: 'archive-decade__stats' })
    : html`<p class="muted">Vuoden ${d.rows[0].year} virallinen vuosimuutos julkaistaan, kun kaikki kuukaudet ovat valmiina.</p>`}
  <ul class="archive-years" role="list" aria-label="${`Vuodet, ${d.label}`}">${d.rows.map((r) => html`<li><a href="${yearPath(r.year)}">${r.year}</a></li>`)}</ul>
</li>`;
  })}</ul>
<p class="table-note">Keskimääräinen vuosimuutos on laskettu geometrisesti Tilastokeskuksen virallisista vuosikeskiarvoindekseistä (1972=100), esimerkiksi ${dec[0].officialFrom}–${dec[0].officialTo}: (indeksi ${dec[0].officialTo} / indeksi ${dec[0].officialFrom - 1})^(1/${dec[0].officialTo - dec[0].officialFrom + 1}) − 1.${partial ? ` Kuluvaa vuotta ${partial.year} ei ole mukana.` : ''}</p>`;

  // Records
  const records = c.statsList([
    { label: 'Korkein vuosi', value: c.numUnit(fmt.pct(R.yearMax?.value)), note: listFi(R.yearMax?.months ?? []) },
    { label: 'Alin vuosi', value: c.numUnit(fmt.pct(R.yearMin?.value)), note: listFi(R.yearMin?.months ?? []) },
    { label: 'Korkein kuukausi', value: c.numUnit(fmt.pct(R.monthMax?.value)), note: listFi((R.monthMax?.months ?? []).map((m) => fmt.monthShort(m))) },
    { label: 'Alin kuukausi', value: c.numUnit(fmt.pct(R.monthMin?.value)), note: listFi((R.monthMin?.months ?? []).map((m) => fmt.monthShort(m))) },
  ]);
  const recordsNote = html`<p class="table-note">Vuodet: Tilastokeskuksen viralliset vuosimuutokset ${R.firstOfficial}–${R.lastOfficial}. Kuukaudet: kuluttajahintojen vuosimuutos kuukausittain ${fmt.monthRange(R.monthStart, A.latestMonth)}.</p>`;

  // Changelog
  const changelog = A.log.length
    ? html`<ol class="archive-log" role="list">${A.log.map((e) => {
        const href = logHref(A, e);
        return html`<li class="archive-log__item" id="${logId(e)}">
  <p class="archive-log__meta"><time datetime="${e.date}">${fmt.date(e.date)}</time> ${c.chip({ text: logSourceLabel(e), tone: e.kind === 'ennakko' ? 'provisional' : 'neutral' })}</p>
  <p class="archive-log__text">${href ? html`<a href="${href}">${e.text}</a>` : e.text}</p>
</li>`;
      })}</ol>`
    : html`<p class="muted">Muutoslokissa ei ole vielä merkintöjä.</p>`;

  const main = html`${c.pageHeader({
    eyebrow: `Kuluttajahintaindeksi · ${span}`,
    title: `Inflaatio Suomessa vuosittain ${span}`,
    lede: `Kuluttajahintojen vuosimuutos Tilastokeskuksen virallisina vuosilukuina vuodesta ${first.year} alkaen. Jokaisella vuodella ja vuodesta ${fmt.yearOf(MONTH_PAGES_FROM)} alkaen jokaisella kuukaudella on oma sivunsa.${partial ? ` Vuoden ${partial.year} luku on ${partial.khi.span}kuun keskiarvo.` : ''}`,
    meta: sourceMeta(ctx, [srcAnnual, A.sources.ykhi], ctx.latest.khi.updated),
  })}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--tight', body: kpis })}
${c.section({
  id: 'vuodet',
  eyebrow: 'Vuosittain',
  title: `Inflaatio vuosina ${span}`,
  intro: 'Päättyneet vuodet ovat Tilastokeskuksen virallisia vuosimuutoksia, eivät kuukausilukujen keskiarvoja.',
  body: figure,
})}
${c.section({ id: 'vuosikymmenet', eyebrow: 'Vuosikymmenet', title: 'Inflaatio vuosikymmenittäin', intro: 'Valitse vuosi nähdäksesi sen kuukausiluvut.', body: decadeList })}
${c.section({ id: 'ennatykset', eyebrow: 'Ennätykset', title: 'Korkein ja alin inflaatio', body: html`${records}${recordsNote}` })}
${A.events.length ? c.section({ id: 'tapahtumat', eyebrow: 'Taustaa', title: 'Tapahtumia, jotka näkyvät inflaatiossa', intro: 'Poimintoja tapahtumista, jotka ovat vaikuttaneet Suomen kuluttajahintoihin.', body: eventList(ctx, [...A.events].reverse(), { link: 'year' }) }) : ''}
${c.section({
  id: 'lisaa',
  title: 'Lisää arkistossa',
  body: c.cardGrid([
    { href: '/katsaus/', eyebrow: 'Kuukausittain', title: 'Inflaatiokatsaukset', text: 'Kuukauden luvut, hintoja nostaneet ryhmät ja vertailu euroalueeseen.', meta: 'Lue' },
    { href: '/pisteluvut/', eyebrow: 'Indeksit', title: 'Pisteluvut', text: 'Kuluttajahintaindeksin ja elinkustannusindeksin pisteluvut kaikilla perusvuosilla.', meta: 'Katso' },
    { href: '/rahanarvo/', eyebrow: 'Laskuri', title: 'Rahan arvo', text: 'Paljonko vanha summa on nykyrahassa.', meta: 'Laske' },
  ]),
})}
${c.section({
  id: 'muutosloki',
  eyebrow: 'Päivitykset',
  title: 'Muutosloki',
  intro: 'Uudet luvut sitä mukaa kuin Tilastokeskus ja Eurostat julkaisevat ne. Sama loki on tilattavissa RSS-syötteenä.',
  controls: c.button({ label: 'RSS-syöte', icon: 'rss', size: 'sm', href: '/feed.xml' }),
  body: changelog,
})}`;

  const description = fitDescription([
    `Suomen inflaatio vuosittain ${span}: Tilastokeskuksen viralliset vuosimuutokset, vuosikymmenet, ennätykset ja jokaisen vuoden sekä kuukauden oma sivu.`,
  ]);
  return {
    path,
    priority: 0.9,
    changefreq: 'monthly',
    html: ctx.layout({
      title: `Inflaatio vuosittain ${span}`,
      description,
      path,
      page: 'inflaatio',
      breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Inflaatio vuosittain'),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: `Inflaatio Suomessa vuosittain ${span}`,
          description: `Kuluttajahintaindeksin (KHI) virallinen vuosimuutos ${first.year}–${lastOfficial.year} ja yhdenmukaistetun kuluttajahintaindeksin (YKHI) vuosimuutos Suomessa ja euroalueella.`,
          url: ctx.baseUrl + path,
          inLanguage: 'fi',
          isAccessibleForFree: true,
          temporalCoverage: `${first.year}/${last.year}`,
          spatialCoverage: { '@type': 'Place', name: 'Suomi' },
          variableMeasured: ['Kuluttajahintaindeksin vuosimuutos (%)', 'Yhdenmukaistetun kuluttajahintaindeksin vuosimuutos (%)'],
          creator: [
            { '@type': 'Organization', name: 'Tilastokeskus', url: 'https://stat.fi/' },
            { '@type': 'Organization', name: 'Eurostat', url: 'https://ec.europa.eu/eurostat' },
          ],
          license: 'https://creativecommons.org/licenses/by/4.0/',
          dateModified: ctx.latest.dataUpdated ?? undefined,
        },
      ],
      main,
    }),
  };
}

/* -------------------------------------------------------------- year page */

/**
 * Generated description of a year (2–4 sentences).
 * @param {ReturnType<typeof archive>} A
 * @param {object} r year row
 * @returns {string[]} sentences
 */
export function yearText(A, r) {
  const out = [];
  const v = r.khi.value;
  const prev = A.yearMap.get(r.year - 1);
  const ms = A.monthsOfYear(r.year);
  const yoys = ms.map((ym) => A.month(ym).yoy);
  const hi = stats.max(ms, yoys);
  const lo = stats.min(ms, yoys);
  const monthsIn = (list) => listFi(list.map((m) => fmt.inessive(m, { year: false })));

  if (r.khi.official) {
    const rv = fmt.round(v, 1);
    if (rv === 0) out.push(`Kuluttajahinnat pysyivät vuonna ${r.year} keskimäärin edellisvuoden tasolla (${fmt.pct(0)}).`);
    else out.push(`Kuluttajahinnat ${rv > 0 ? 'nousivat' : 'laskivat'} vuonna ${r.year} keskimäärin ${fmt.pct(Math.abs(rv))} edellisvuodesta (Tilastokeskus, virallinen vuosimuutos).`);
  } else {
    out.push(
      r.khi.partial && r.khi.months === 1
        ? `Vuoden ${r.year} ensimmäinen kuukausiluku on julkaistu: ${fmt.inessive(r.khi.spanStart)} inflaatio oli ${fmt.pct(v)}. Vuoden luku tarkentuu, kun loput kuukaudet julkaistaan.`
        : r.khi.partial
        ? `Vuoden ${r.year} ${r.khi.span}kuun kuukausittaisten vuosimuutosten keskiarvo on ${fmt.pct(v)}. Luku tarkentuu, kun vuoden loput kuukaudet julkaistaan.`
        : `Vuoden ${r.year} kuukausittaisten vuosimuutosten keskiarvo on ${fmt.pct(v)}. Tilastokeskuksen virallinen vuosimuutos ei ole vielä aineistossa.`,
    );
  }
  if (prev) {
    const d = stats.ppChange(v, prev.khi.value);
    const verb = deltaVerb(d);
    if (!r.khi.official && verb) {
      // Partial (or not yet official) year: compare the mean without calling it a full-year change.
      const cmp = verb === 'kiihtyi' ? `${fmt.pp(Math.abs(d), { sign: false })} korkeampi kuin` : verb === 'hidastui' ? `${fmt.pp(Math.abs(d), { sign: false })} matalampi kuin` : 'sama kuin';
      out.push(`Keskiarvo on ${cmp} vuoden ${prev.year} inflaatio (${fmt.pct(prev.khi.value)}).`);
    } else if (verb === 'pysyi ennallaan') out.push(`Inflaatio pysyi edellisvuoden tasolla (${prev.year}: ${fmt.pct(prev.khi.value)}).`);
    else if (verb) out.push(`Inflaatio ${verb} edellisvuodesta ${fmt.pp(Math.abs(d), { sign: false })} (${prev.year}: ${fmt.pct(prev.khi.value)}).`);
  }
  if (r.khi.official) {
    const official = A.years.filter((x) => x.khi.official);
    const i = official.findIndex((x) => x.year === r.year);
    if (i > 1) {
      const high = rankSince(official, r.year, 'high');
      const low = rankSince(official, r.year, 'low');
      if (high === null) out.push(`Vuosi-inflaatio oli siihen mennessä korkein vuodesta ${official[0].year} alkaen.`);
      else if (high && high.year < r.year - 1) out.push(`Vuosi-inflaatio oli korkein sitten vuoden ${high.year} (${fmt.pct(high.value)}).`);
      else if (low === null) out.push(`Vuosi-inflaatio oli siihen mennessä matalin vuodesta ${official[0].year} alkaen.`);
      else if (low && low.year < r.year - 1) out.push(`Vuosi-inflaatio oli matalin sitten vuoden ${low.year} (${fmt.pct(low.value)}).`);
    }
  }
  if (hi && lo && ms.length > 1) {
    out.push(`Kuukausittainen vuosimuutos oli korkeimmillaan ${fmt.pct(hi.value)} ${monthsIn(hi.months)} ja matalimmillaan ${fmt.pct(lo.value)} ${monthsIn(lo.months)}.`);
  }
  return out;
}

/**
 * "100 € then is X € now" from the official 1972=100 figures (annual average
 * of the year → latest month). Null for the current year or missing data.
 */
export function priceLevelNow(A, year) {
  if (year >= A.latestYear) return null;
  const i0 = A.annualIndex('1972=100', year);
  const i1 = A.index1972At(A.latestMonth);
  if (!fmt.isNum(i0) || !fmt.isNum(i1)) return null;
  return { from: i0, to: i1, change: stats.totalChange(i0, i1), eur100: (100 * i1) / i0 };
}

function yearPage(ctx, A, r) {
  const { html, c, svg } = ctx;
  const path = yearPath(r.year);
  const ms = A.monthsOfYear(r.year);
  const rows = ms.map((ym) => A.month(ym));
  const prev = A.yearMap.get(r.year - 1);
  const next = A.yearMap.get(r.year + 1);
  const label = yearLabel(r);
  const v = r.khi.value;
  const d = prev ? ctx.stats.ppChange(v, prev.khi.value) : null;
  const yoys = rows.map((m) => m.yoy);
  const hi = ctx.stats.max(ms, yoys);
  const lo = ctx.stats.min(ms, yoys);
  const monthsShort = (list) => listFi(list.map((m) => fmt.monthShort(m, { year: false })));
  const hasY = rows.some((m) => fmt.isNum(m.ykhi.yoy));
  const anyComputedMom = rows.some((m) => !m.momOfficial && fmt.isNum(m.mom));

  const kpiLabel = r.khi.official ? `Inflaatio ${r.year}` : `Vuosi ${r.khi.label}`;

  const kpis = c.kpiGrid([
    c.kpiCard({ label: kpiLabel, value: fmt.pct(v), note: r.khi.official ? 'Tilastokeskuksen virallinen vuosimuutos' : (r.khi.months ?? ms.length) === 1 ? fmt.capitalize(fmt.monthName(ms[0])) : `Keskiarvo ${r.khi.months ?? ms.length} kuukaudesta` }),
    prev
      ? c.kpiCard({ label: 'Muutos edellisestä vuodesta', value: fmt.pp(d), delta: ctx.stats.deltaClass(d), note: `${prev.year}: ${fmt.pct(prev.khi.value)}` })
      : c.kpiCard({ label: 'Kuukausia', value: String(ms.length), note: fmt.monthRange(ms[0], ms.at(-1)) }),
    c.kpiCard({ label: 'Korkein kuukausi', value: fmt.pct(hi?.value), note: monthsShort(hi?.months ?? []) }),
    c.kpiCard({ label: 'Alin kuukausi', value: fmt.pct(lo?.value), note: monthsShort(lo?.months ?? []) }),
  ]);

  const bars = svg.barChart({
    bars: rows.map((m) => ({ label: fmt.monthShort(m.ym, { year: false }), value: m.yoy, cls: ctx.stats.levelBand(m.yoy) ?? 'khi', title: `${fmt.capitalize(fmt.monthName(m.ym))}: ${fmt.pct(m.yoy)}` })),
    refLines: [{ value: 2, cls: 'target' }],
    height: 240,
    ariaLabel: `Kuluttajahintojen vuosimuutos kuukausittain vuonna ${r.year}: korkein ${fmt.pct(hi?.value)} (${monthsShort(hi?.months ?? [])}), alin ${fmt.pct(lo?.value)} (${monthsShort(lo?.months ?? [])}).`,
  });
  const monthCell = (m) => {
    const name = fmt.capitalize(fmt.monthNameOnly(m.ym));
    return m.hasPage ? html`<a href="${monthPath(m.ym)}">${name}</a>` : name;
  };
  const table = c.dataTable({
    id: 'kuukaudet-taulukko',
    caption: `Inflaatio kuukausittain vuonna ${r.year}`,
    columns: [
      { label: 'Kuukausi' },
      { label: 'KHI', num: true },
      { label: 'Hinnat kuukaudessa', num: true },
      ...(hasY ? [{ label: 'YKHI', num: true }, { label: 'Euroalue', num: true }] : []),
    ],
    rows: rows.map((m) => [
      monthCell(m),
      html`<span class="level">${c.levelDot(m.yoy)}${c.numUnit(fmt.pct(m.yoy))}</span>`,
      html`${c.numUnit(fmt.pct(m.mom, { sign: true }))}${!m.momOfficial && fmt.isNum(m.mom) ? html`<abbr class="archive-mark" title="laskettu pisteluvuista">*</abbr><span class="sr-only"> (laskettu pisteluvuista)</span>` : ''}`,
      ...(hasY
        ? [
            html`${c.numUnit(fmt.pct(m.ykhi.yoy))}${m.ykhi.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`,
            html`${c.numUnit(fmt.pct(m.ea.yoy))}${m.ea.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`,
          ]
        : []),
    ]),
    note: html`KHI = kuluttajahintojen vuosimuutos (Tilastokeskus). Hinnat kuukaudessa = hintatason muutos edellisestä kuukaudesta.${anyComputedMom ? ' * Laskettu Tilastokeskuksen virallisista pisteluvuista (1972=100); virallinen kuukausimuutos julkaistaan helmikuusta 1995 alkaen.' : ''}${hasY ? ' YKHI ja euroalue: Eurostat.' : ''}`,
  });
  const figure = c.chartFigure({
    id: 'kuukaudet',
    title: `Inflaatio kuukausittain ${r.year}`,
    subtitle: 'Kuluttajahintaindeksin vuosimuutos, %',
    legend: c.legend([
      { cls: 'deflation', label: 'alle 0 %', box: true },
      { cls: 'low', label: '0–2 %', box: true },
      { cls: 'elevated', label: '2–4 %', box: true },
      { cls: 'high', label: 'yli 4 %', box: true },
      { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
    ]),
    chart: bars,
    summary: `Vuosimuutos oli korkeimmillaan ${fmt.pct(hi?.value)} (${monthsShort(hi?.months ?? [])}) ja matalimmillaan ${fmt.pct(lo?.value)} (${monthsShort(lo?.months ?? [])}).`,
    table,
    source: c.sourceLine({ sources: hasY ? [A.sources.khi, A.sources.ykhi] : [A.sources.khi], updated: ctx.latest.khi.updated }),
  });

  // Comparison with YKHI and the euro area
  let comparison = '';
  if (r.ykhi || r.ea) {
    const yLabel = (x) => (x.official ? 'Eurostatin virallinen vuosimuutos' : `${x.partial ? x.span : 'tammi–joulu'}kuun keskiarvo`);
    const items = [
      { label: 'KHI (Tilastokeskus)', value: c.numUnit(fmt.pct(v)), note: r.khi.official ? 'virallinen vuosimuutos' : `${r.khi.span}kuun keskiarvo` },
      r.ykhi ? { label: 'YKHI, Suomi', value: c.numUnit(fmt.pct(r.ykhi.value)), note: yLabel(r.ykhi) } : null,
      r.ea ? { label: 'YKHI, euroalue', value: c.numUnit(fmt.pct(r.ea.value)), note: yLabel(r.ea) } : null,
      r.ykhi && r.ea ? { label: 'Suomi – euroalue', value: c.numUnit(fmt.pp(ctx.stats.ppChange(r.ykhi.value, r.ea.value))), note: 'YKHI-lukujen ero' } : null,
    ].filter(Boolean);
    const line = hasY && ms.length > 1
      ? svg.lineChart({
          series: [
            { values: yoys, cls: 'khi', label: 'KHI' },
            { values: rows.map((m) => m.ykhi.yoy), cls: 'ykhi', label: 'YKHI' },
            { values: rows.map((m) => m.ea.yoy), cls: 'ea', label: 'Euroalue' },
          ],
          labels: ms,
          refLines: [{ value: 2, cls: 'target' }],
          height: 240,
          ariaLabel: `Vuosimuutos kuukausittain vuonna ${r.year}: KHI, YKHI Suomi ja euroalue. ${fmt.capitalize(fmt.inessive(ms.at(-1)))} KHI ${fmt.pct(yoys.at(-1))}, YKHI ${fmt.pct(rows.at(-1).ykhi.yoy)} ja euroalue ${fmt.pct(rows.at(-1).ea.yoy)}.`,
        })
      : null;
    comparison = c.section({
      id: 'vertailu',
      eyebrow: 'Vertailu',
      title: 'Suomi ja euroalue',
      intro: 'YKHI on EU:n yhdenmukaistettu kuluttajahintaindeksi, jolla maiden inflaatiota verrataan. Siitä puuttuvat omistusasumisen kulut, kuten asuntolainojen korot.',
      body: html`${c.statsList(items)}${line
        ? c.chartFigure({
            id: 'vertailu-kaavio',
            title: `KHI, YKHI ja euroalue ${r.year}`,
            subtitle: 'Vuosimuutos, %',
            legend: c.legend([
              { cls: 'khi', label: 'KHI (Tilastokeskus)' },
              { cls: 'ykhi', label: 'YKHI Suomi (Eurostat)' },
              { cls: 'ea', label: 'Euroalue (Eurostat)' },
              { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
            ]),
            chart: line,
            summary: `${fmt.capitalize(fmt.inessive(ms.at(-1)))} KHI oli ${fmt.pct(yoys.at(-1))}, Suomen YKHI ${fmt.pct(rows.at(-1).ykhi.yoy)} ja euroalueen YKHI ${fmt.pct(rows.at(-1).ea.yoy)}. Kuukausiluvut ovat taulukossa kohdassa Inflaatio kuukausittain ${r.year}.`,
            source: c.sourceLine({ sources: [A.sources.khi, A.sources.ykhi], updated: ctx.latest.ykhi?.updated }),
          })
        : ''}`,
    });
  }

  const level = priceLevelNow(A, r.year);
  const text = yearText(A, r);
  const events = A.events.filter((e) => fmt.yearOf(e.month) === r.year);

  const summaryBody = html`<div class="prose">
  ${text.slice(2).map((s) => html`<p>${s}</p>`)}
  ${level ? html`<p>Hinnat ovat nousseet vuoden ${r.year} keskimääräiseltä tasolta ${fmt.illative(A.latestMonth)} mennessä ${fmt.pct(level.change)}: ostokset, jotka maksoivat vuonna ${r.year} ${r.year < 2002 ? 'euroiksi muunnettuna ' : ''}100 euroa, maksavat nyt noin ${fmt.num(level.eur100, 0)} euroa. <a href="/rahanarvo/">Laske rahan arvo</a>.</p>` : ''}
  ${r.year === A.latestYear && ms.length ? html`<p>Uusin kuukausi: <a href="${monthPath(ms.at(-1))}">${fmt.monthName(ms.at(-1))}</a>${ms.at(-1) >= KATSAUS_FROM ? html` · <a href="${katsausPath(ms.at(-1))}">Inflaatiokatsaus ${fmt.monthName(ms.at(-1))}</a>` : ''}.</p>` : ''}
</div>`;
  const levelNote = level ? html`<p class="table-note">Hintatason muutos: Tilastokeskuksen viralliset pisteluvut 1972=100, vuoden ${r.year} keskiarvo ${fmt.idx(level.from, 1)} ja ${fmt.monthName(A.latestMonth)} ${fmt.idx(level.to)}.</p>` : '';

  const h1 = r.khi.official ? `Inflaatio Suomessa vuonna ${r.year}: ${fmt.pct(v)}` : `Inflaatio Suomessa vuonna ${r.year}`;
  const lede = text.slice(0, 2).join(' ');

  const main = html`${c.pageHeader({
    eyebrow: `Kuluttajahintaindeksi · ${label}`,
    title: h1,
    lede,
    meta: sourceMeta(ctx, [r.khi.official ? A.sources.khiAnnual : A.sources.khi], ctx.latest.khi.updated),
  })}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--tight', body: kpis })}
${c.section({ id: 'kuukausittain', eyebrow: 'Kuukausittain', title: `Vuoden ${r.year} kuukaudet`, body: figure })}
${comparison}
${c.section({ id: 'yhteenveto', eyebrow: 'Vuosi lyhyesti', title: `Vuosi ${r.year} lyhyesti`, body: html`${summaryBody}${levelNote}${events.length ? html`<h3 class="archive-subhead">Tapahtumia vuonna ${r.year}</h3>${eventList(ctx, events)}` : ''}` })}
${c.section({
  id: 'selaa',
  title: 'Muut vuodet',
  className: 'section--tight',
  body: html`${c.pager({
    label: 'Vuodet',
    prev: prev ? { href: yearPath(prev.year), label: `${yearLabel(prev)}: ${fmt.pct(prev.khi.value)}` } : null,
    next: next ? { href: yearPath(next.year), label: `${yearLabel(next)}: ${fmt.pct(next.khi.value)}` } : null,
  })}<p class="archive-back"><a href="/inflaatio/">Kaikki vuodet ${A.years[0].year}–${A.latestYear}</a></p>`,
})}`;

  const title = r.khi.official ? `Inflaatio ${r.year} Suomessa: ${fmt.pct(v)}` : `Inflaatio ${r.year} Suomessa: ${fmt.pct(v)} (${r.khi.span})`;
  const description = fitDescription([
    r.khi.official
      ? `Suomen inflaatio vuonna ${r.year} oli ${fmt.pct(v)} (Tilastokeskus, virallinen vuosimuutos).`
      : `Suomen inflaatio vuonna ${r.khi.label}: keskimäärin ${fmt.pct(v)} (Tilastokeskus).`,
    'Kuukausiluvut, korkein ja alin kuukausi sekä vertailu euroalueeseen.',
  ]);
  return {
    path,
    priority: r.year >= A.latestYear - 1 ? 0.8 : 0.6,
    changefreq: r.year === A.latestYear ? 'monthly' : 'yearly',
    html: ctx.layout({
      title,
      description,
      path,
      page: 'inflaatio',
      breadcrumbs: ctx.crumbs(path, String(r.year)),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: h1,
          description,
          url: ctx.baseUrl + path,
          inLanguage: 'fi',
          isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
          about: { '@type': 'Thing', name: `Inflaatio Suomessa vuonna ${r.year}` },
          dateModified: ctx.latest.dataUpdated ?? undefined,
        },
      ],
      main,
    }),
  };
}

/* ------------------------------------------------------------- month page */

/**
 * Generated text of a month (lede + context sentences).
 * @param {ReturnType<typeof archive>} A
 * @param {ReturnType<ReturnType<typeof archive>['month']>} m
 */
export function monthText(A, m) {
  const out = [levelSentence(m.ym, m.yoy)];
  const ds = deltaSentence(m.prevYm, m.prevYoy, m.delta);
  if (ds) out.push(ds);
  const ms = momSentence(m.mom);
  if (ms && m.momOfficial) out.push(ms);
  if (fmt.isNum(m.yearAgoYoy)) out.push(`Vuotta aiemmin, ${fmt.inessive(fmt.ymAdd(m.ym, -12))}, inflaatio oli ${fmt.pct(m.yearAgoYoy)}.`);
  return out;
}

/** Contributions figure (main groups) for a month, or '' when not available. */
export function contributionsFigure(ctx, A, m, { id = 'vaikutukset', headingLevel = 3 } = {}) {
  const { c, svg } = ctx;
  if (!m.groups) return '';
  const rows = m.groups.rows;
  const top = rows[0];
  const bottom = rows.at(-1);
  if (m.groups.mode === 'yoy') {
    return c.chartFigure({
      id,
      headingLevel,
      title: 'Pääryhmien hintamuutokset',
      subtitle: `Vuosimuutos, % · ${fmt.monthName(m.ym)}`,
      chart: svg.hBarChart({
        bars: rows.map((g) => ({ label: g.name, value: g.yoy })),
        formatValue: (v) => fmt.pct(v, { sign: true }),
        ariaLabel: `Kuluttajahintaindeksin pääryhmien vuosimuutos ${fmt.inessive(m.ym)}: eniten nousivat ${lowerFirst(top.name)} (${fmt.pct(top.yoy, { sign: true })}), vähiten ${lowerFirst(bottom.name)} (${fmt.pct(bottom.yoy, { sign: true })}).`,
      }),
      summary: `Hinnat nousivat vuodessa eniten pääryhmässä ${lowerFirst(top.name)} (${fmt.pct(top.yoy, { sign: true })}) ja vähiten pääryhmässä ${lowerFirst(bottom.name)} (${fmt.pct(bottom.yoy, { sign: true })}).`,
      table: c.dataTable({
        id: `${id}-taulukko`,
        caption: `Pääryhmien vuosimuutos ${fmt.inessive(m.ym)}`,
        columns: [{ label: 'Pääryhmä' }, { label: 'Vuosimuutos', num: true }],
        rows: rows.map((g) => [g.name, c.numUnit(fmt.pct(g.yoy, { sign: true }))]),
        compact: true,
        note: A.contributionsFrom ? `Ryhmien vaikutukset kokonaisinflaatioon (prosenttiyksikköinä) ovat aineistossa ${fmt.elative(A.contributionsFrom)} alkaen.` : null,
      }),
      source: c.sourceLine({ sources: [A.sources.groups], updated: ctx.latest.updated?.hyodykkeet }),
    });
  }
  return c.chartFigure({
    id,
    headingLevel,
    title: 'Pääryhmien vaikutus inflaatioon',
    subtitle: `Vaikutus vuosimuutokseen, %-yks. · ${fmt.monthName(m.ym)}`,
    chart: svg.hBarChart({
      bars: rows.map((g) => ({ label: g.name, value: g.contribution, title: `${g.name}: vaikutus ${fmt.pp(g.contribution, { decimals: 2 })}, vuosimuutos ${fmt.pct(g.yoy)}` })),
      ariaLabel: `Pääryhmien vaikutus kuluttajahintojen vuosimuutokseen ${fmt.inessive(m.ym)}: eniten nosti ${lowerFirst(top.name)} (${fmt.pp(top.contribution, { decimals: 2 })}), eniten laski ${lowerFirst(bottom.name)} (${fmt.pp(bottom.contribution, { decimals: 2 })}).`,
    }),
    summary: `Eniten vuosimuutosta nosti ${lowerFirst(top.name)} (${fmt.pp(top.contribution, { decimals: 2 })})${bottom.contribution < 0 ? ` ja eniten laski ${lowerFirst(bottom.name)} (${fmt.pp(bottom.contribution, { decimals: 2 })})` : ''}. Pääryhmien vaikutukset ovat yhteensä ${fmt.num(m.groups.total, 2, { sign: true })} prosenttiyksikköä.`,
    table: c.dataTable({
      id: `${id}-taulukko`,
      caption: `Pääryhmien vuosimuutos ja vaikutus kokonaisinflaatioon ${fmt.inessive(m.ym)}`,
      columns: [{ label: 'Pääryhmä' }, { label: 'Vuosimuutos', num: true }, { label: 'Vaikutus, %-yks.', num: true }],
      rows: rows.map((g) => [g.name, c.numUnit(fmt.pct(g.yoy)), fmt.num(g.contribution, 2, { sign: true })]),
      compact: true,
      note: 'Vaikutus = paljonko ryhmän hintojen muutos nosti tai laski koko kuluttajahintaindeksin vuosimuutosta (prosenttiyksikköä). Vaikutukset summautuvat kokonaisinflaatioon pyöristyseroja lukuun ottamatta.',
    }),
    source: c.sourceLine({ sources: [A.sources.groups], updated: ctx.latest.updated?.hyodykkeet }),
  });
}

/**
 * KHI/YKHI/euro area line chart of the `span` months up to the month
 * (24 → 25 points, i.e. two years of context).
 */
export function contextFigure(ctx, A, m, { id = 'kehitys', headingLevel = 3, span = 24 } = {}) {
  const { c, svg, data } = ctx;
  const y = data.ykhi;
  const yAt = (geo, ym) => (y?.geo?.[geo]?.yoy ? ctx.stats.seriesAt(y.months, y.geo[geo].yoy, ym) : null);
  const end = fmt.ymDiff(A.months[0], m.ym);
  const labels = A.months.slice(Math.max(0, end - span), end + 1);
  const s = {
    khi: labels.map((ym) => A.khiAt(data.khi.yoy, ym)),
    ykhi: labels.map((ym) => yAt('FI', ym)),
    ea: labels.map((ym) => yAt('EA', ym)),
  };
  const hasY = s.ykhi.some(fmt.isNum);
  const period = fmt.monthRange(labels[0], labels.at(-1));
  return c.chartFigure({
    id,
    headingLevel,
    title: 'Inflaation kehitys',
    subtitle: `Vuosimuutos, % · ${period}`,
    legend: c.legend([
      { cls: 'khi', label: 'KHI (Tilastokeskus)' },
      ...(hasY ? [{ cls: 'ykhi', label: 'YKHI Suomi (Eurostat)' }, { cls: 'ea', label: 'Euroalue (Eurostat)' }] : []),
      { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
    ]),
    chart: svg.lineChart({
      series: [
        { values: s.khi, cls: 'khi', label: 'KHI' },
        ...(hasY ? [{ values: s.ykhi, cls: 'ykhi', label: 'YKHI' }, { values: s.ea, cls: 'ea', label: 'Euroalue' }] : []),
      ],
      labels,
      refLines: [{ value: 2, cls: 'target' }],
      height: 260,
      ariaLabel: `Vuosimuutos kuukausittain ${period}: KHI ${fmt.pct(m.yoy)}${hasY ? `, YKHI ${fmt.pct(m.ykhi.yoy)} ja euroalue ${fmt.pct(m.ea.yoy)}` : ''} ${fmt.inessive(m.ym)}.`,
    }),
    summary: `KHI oli ${fmt.inessive(m.ym)} ${fmt.pct(m.yoy)}${hasY ? `, YKHI ${fmt.pct(m.ykhi.yoy)} ja euroalueen YKHI ${fmt.pct(m.ea.yoy)}` : ''}.`,
    table: c.dataTable({
      id: `${id}-taulukko`,
      caption: `Vuosimuutos kuukausittain, ${period}`,
      columns: [{ label: 'Kuukausi' }, { label: 'KHI', num: true }, ...(hasY ? [{ label: 'YKHI', num: true }, { label: 'Euroalue', num: true }] : [])],
      rows: labels
        .map((ym, i) => {
          const name = fmt.monthShort(ym);
          const cell = ym >= MONTH_PAGES_FROM && ym !== m.ym ? ctx.html`<a href="${monthPath(ym)}">${name}</a>` : name;
          return [cell, c.numUnit(fmt.pct(s.khi[i])), ...(hasY ? [c.numUnit(fmt.pct(s.ykhi[i])), c.numUnit(fmt.pct(s.ea[i]))] : [])];
        })
        .reverse(),
      visibleRows: 13,
      toggleLabels: { more: `Näytä kaikki kuukaudet (${labels.length})`, less: 'Näytä vain 13 viimeisintä' },
      compact: true,
    }),
    source: c.sourceLine({ sources: hasY ? [A.sources.khi, A.sources.ykhi] : [A.sources.khi], updated: ctx.latest.khi.updated }),
  });
}

function monthPage(ctx, A, ym) {
  const { html, c } = ctx;
  const m = A.month(ym);
  const path = monthPath(ym);
  const name = fmt.monthName(ym);
  const Name = fmt.capitalize(name);
  const year = fmt.yearOf(ym);
  const prevOk = m.prevYm >= MONTH_PAGES_FROM;
  const nextYm = fmt.ymAdd(ym, 1);
  const nextOk = nextYm <= A.latestMonth;
  const text = monthText(A, m);
  const provisional = (x) => (x.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : '');

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Inflaatio (KHI)', value: fmt.pct(m.yoy), note: `${Name} · Tilastokeskus` }),
    c.kpiCard({
      label: 'Muutos edellisestä kuukaudesta',
      value: fmt.pp(m.delta),
      delta: ctx.stats.deltaClass(m.delta),
      note: `${fmt.capitalize(fmt.inessive(m.prevYm, { year: fmt.yearOf(m.prevYm) !== year }))} ${fmt.pct(m.prevYoy)}`,
    }),
    c.kpiCard({
      label: 'Hinnat kuukaudessa',
      value: fmt.pct(m.mom, { sign: true }),
      note: m.momOfficial ? `Hintataso ${fmt.elative(m.prevYm, { year: false })} ${fmt.illative(ym, { year: false })}` : 'Laskettu pisteluvuista',
    }),
    c.kpiCard({
      label: 'YKHI (Eurostat)',
      value: fmt.pct(m.ykhi.yoy),
      note: html`Euroalue ${fmt.pct(m.ea.yoy)}${m.ykhi.provisional || m.ea.provisional ? ' · ennakko' : ''}`,
    }),
  ]);

  const bases = Object.entries(m.index).sort((a, b) => Number(b[0].slice(0, 4)) - Number(a[0].slice(0, 4)));
  const mainBases = bases.filter(([b]) => b === '2025=100' || b === '2015=100');
  const pointItems = [
    ...mainBases.map(([b, v]) => ({ label: `KHI ${b}`, value: points(v, b), note: name })),
    fmt.isNum(m.eki) ? { label: `Elinkustannusindeksi ${m.ekiBase}`, value: points(m.eki, 'eki'), note: name } : null,
  ].filter(Boolean);
  const otherBases = bases.filter(([b]) => b !== '2025=100' && b !== '2015=100');
  const pointsBody = html`${c.statsList(pointItems)}
${otherBases.length
  ? c.details({
      summary: `Kaikki perusvuodet (${bases.length})`,
      className: 'disclosure--plain',
      body: c.dataTable({
        id: 'perusvuodet-taulukko',
        caption: `Kuluttajahintaindeksin pisteluvut ${fmt.inessive(ym)} kaikilla perusvuosilla`,
        columns: [{ label: 'Perusvuosi' }, { label: 'Pisteluku', num: true }],
        rows: bases.map(([b, v]) => [b, points(v, b)]),
        compact: true,
      }),
    })
  : ''}
<p class="table-note">Indeksikorotukset lasketaan pisteluvuista, ei prosenteista. Käytä samaa indeksiä ja perusvuotta kuin sopimuksessa. <a href="/pisteluvut/">Kaikki pisteluvut kuukausittain</a> · <a href="/vuokrankorotus/">Vuokrankorotuslaskuri</a></p>
${c.sourceLine({ sources: [{ ...A.sources.khi, detail: fmt.isNum(m.eki) ? 'kuluttajahintaindeksi ja elinkustannusindeksi' : 'kuluttajahintaindeksi' }], updated: ctx.latest.khi.updated })}`;

  const compare = c.statsList([
    { label: 'KHI (Tilastokeskus)', value: c.numUnit(fmt.pct(m.yoy)), note: name },
    { label: 'YKHI, Suomi', value: html`${c.numUnit(fmt.pct(m.ykhi.yoy))}${provisional(m.ykhi)}`, note: 'Eurostat' },
    { label: 'YKHI, euroalue', value: html`${c.numUnit(fmt.pct(m.ea.yoy))}${provisional(m.ea)}`, note: 'Eurostat' },
    fmt.isNum(m.ykhi.core) ? { label: 'Pohjainflaatio, Suomi', value: c.numUnit(fmt.pct(m.ykhi.core)), note: 'YKHI ilman energiaa, ruokaa, alkoholia ja tupakkaa' } : null,
  ].filter(Boolean));
  const compareNote = m.ykhi.provisional || m.ea.provisional
    ? c.callout({ tone: 'warning', title: 'Ennakkotieto', body: 'Eurostatin pikaennakko voi tarkentua, kun lopulliset luvut julkaistaan noin kahden viikon kuluttua.' })
    : '';

  const related = [
    { href: yearPath(year), eyebrow: 'Vuosi', title: `Inflaatio ${year}`, text: `Vuoden ${year} kaikki kuukaudet ja vuosiluku.`, meta: 'Katso' },
    m.hasKatsaus ? { href: katsausPath(ym), eyebrow: 'Katsaus', title: `Inflaatiokatsaus: ${name}`, text: 'Kuukauden luvut sanallisena katsauksena.', meta: 'Lue' } : null,
    { href: '/pisteluvut/', eyebrow: 'Indeksit', title: 'Pisteluvut', text: 'Kuluttajahintaindeksin ja elinkustannusindeksin pisteluvut.', meta: 'Katso' },
  ].filter(Boolean);

  const released = m.released ? html` · Julkaistu <time datetime="${m.released}">${fmt.date(m.released)}</time>` : '';
  const main = html`${c.pageHeader({
    eyebrow: `Kuluttajahintaindeksi · ${name}`,
    title: `Inflaatio ${fmt.inessive(ym)}: ${fmt.pct(m.yoy)}`,
    lede: text.slice(0, 3).join(' '),
    meta: html`Lähde: <a href="${A.sources.khi.href}">Tilastokeskus</a> (kuluttajahintaindeksi)${released}`,
  })}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--tight', body: kpis })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Kaksi vuotta taaksepäin', body: contextFigure(ctx, A, m, { id: 'kehitys-kaavio' }) })}
${m.groups ? c.section({ id: 'nostajat', eyebrow: 'Hyödykeryhmät', title: 'Mikä nosti hintoja?', intro: html`${m.groups.mode === 'contribution' ? 'Kuluttajahintaindeksin 13 pääryhmän vaikutus vuosimuutokseen.' : 'Kuluttajahintaindeksin 13 pääryhmän hintojen muutos vuodessa.'} Yksittäisten hyödykkeiden hinnat: <a href="/hinnat/">Hinnat</a>.`, body: contributionsFigure(ctx, A, m) }) : ''}
${c.section({ id: 'pisteluvut', eyebrow: 'Indeksit', title: `Pisteluvut ${fmt.inessive(ym)}`, body: pointsBody })}
${c.section({ id: 'vertailu', eyebrow: 'Vertailu', title: 'Suomi ja euroalue', intro: 'YKHI on EU:n yhdenmukaistettu kuluttajahintaindeksi. Siitä puuttuvat omistusasumisen kulut, kuten asuntolainojen korot.', body: html`${compare}${compareNote}${c.sourceLine({ sources: [A.sources.ykhi], updated: ctx.latest.ykhi?.updated })}` })}
${m.events.length ? c.section({ id: 'tapahtumat', eyebrow: 'Taustaa', title: `Tapahtumia ${fmt.inessive(ym)}`, body: eventList(ctx, m.events) }) : ''}
${c.section({
  id: 'selaa',
  title: 'Lisää',
  className: 'section--tight',
  body: html`${c.cardGrid(related)}${c.pager({
    label: 'Kuukaudet',
    prev: prevOk ? { href: monthPath(m.prevYm), label: `${fmt.capitalize(fmt.monthName(m.prevYm))}: ${fmt.pct(m.prevYoy)}` } : null,
    next: nextOk ? { href: monthPath(nextYm), label: `${fmt.capitalize(fmt.monthName(nextYm))}: ${fmt.pct(A.month(nextYm).yoy)}` } : null,
  })}`,
})}`;

  const description = fitDescription([
    `Suomen inflaatio ${fmt.inessive(ym)} oli ${fmt.pct(m.yoy)} (Tilastokeskus).`,
    fmt.isNum(m.prevYoy) ? `${fmt.capitalize(fmt.inessive(m.prevYm, { year: false }))} ${fmt.pct(m.prevYoy)}.` : '',
    fmt.isNum(m.mom) && m.momOfficial ? `Hinnat kuukaudessa ${fmt.pct(m.mom, { sign: true })}.` : '',
    fmt.isNum(m.ykhi.yoy) ? `YKHI ${fmt.pct(m.ykhi.yoy)}${m.ykhi.provisional ? ' (ennakko)' : ''}, euroalue ${fmt.pct(m.ea.yoy)}.` : '',
    'Pisteluvut.',
  ]);
  const title = `Inflaatio ${fmt.inessive(ym)}: ${fmt.pct(m.yoy)}`;
  return {
    path,
    priority: ym >= fmt.ymAdd(A.latestMonth, -2) ? 0.7 : 0.4,
    changefreq: ym === A.latestMonth ? 'monthly' : 'yearly',
    html: ctx.layout({
      title,
      description,
      path,
      page: 'inflaatio',
      breadcrumbs: ctx.crumbs(path, Name, { [yearPath(year)]: String(year) }),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: title,
          description,
          url: ctx.baseUrl + path,
          inLanguage: 'fi',
          isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
          about: { '@type': 'Thing', name: `Inflaatio Suomessa ${fmt.inessive(ym)}` },
          datePublished: m.released ?? undefined,
          dateModified: m.ykhiFinalReleased ?? m.released ?? undefined,
        },
      ],
      main,
    }),
  };
}
