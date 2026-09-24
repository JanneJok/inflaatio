/**
 * /hinnat/ – "Mikä inflaatiota nostaa?": main-group contributions, the group
 * table, top 10 risers and fallers, contribution history and links to every
 * commodity page; and /hinnat/<slug>/ for every item of
 * scripts/fetch/hyodykesivut.json that has data (data/hyodykesarjat.json).
 *
 * Data: data/hyodykkeet.json (Tilastokeskus 15b5 + 15bc weights),
 * data/hyodykesarjat.json (item series), data/khi.json (total index).
 *
 * Also exports small helpers shared by the other TOPICS modules
 * (polttoaineet, vertailu, korot) and pure calculations used by
 * test/topics.test.js. Interactive charts use src/js/pages/hinnat.js.
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import { html, attrs } from '../../scripts/lib/html.js';
import { niceScale, monthTicks } from '../../scripts/lib/svg.js';

/* ================================================================ shared */

/** Chart range labels (segmented control). */
export const RANGE_LABELS = Object.freeze({ '6kk': '6 kk', '1v': '1 v', '3v': '3 v', '5v': '5 v', '10v': '10 v', kaikki: 'Kaikki' });
/** Longest page title before the " | Inflaatio.fi" suffix (60 − 15). */
export const TITLE_BASE_MAX = 45;
export const DESCRIPTION_MAX = 155;
/** Minimum weight (‰) of an item on the top 10 lists. */
export const MIN_WEIGHT = 1;
/** Colours of highlighted main groups (never khi/ykhi, which are fixed to the indices). */
export const GROUP_COLOURS = Object.freeze(['s3', 's4', 's5', 'ea', 'core']);
const OTHERS_COLOUR = 's6';
const HIGHLIGHT = GROUP_COLOURS.length;
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const TK_ORG = Object.freeze({ '@type': 'Organization', name: 'Tilastokeskus', url: 'https://stat.fi/' });

/**
 * First candidate that fits `max` characters, else the shortest one.
 * @param {string[]} candidates
 * @param {number} [max=TITLE_BASE_MAX]
 */
export function fitText(candidates, max = TITLE_BASE_MAX) {
  const list = candidates.filter(Boolean);
  return list.find((t) => t.length <= max) ?? [...list].sort((a, b) => a.length - b.length)[0];
}

/**
 * Source entry for ctx.c.sourceLine from data/meta.json.
 * @param {any} ctx
 * @param {string} key meta source key ('hyodykkeet', 'polttoaineet' …)
 * @param {string} detail e.g. 'kuluttajahintaindeksi, taulukko 15b5'
 */
export function metaSource(ctx, key, detail) {
  const m = ctx.data.meta?.sources?.[key];
  const publisher = m?.publisher ?? 'Tilastokeskus';
  return { name: publisher, href: m?.url, detail };
}

/** schema.org Dataset for a page (JSON-LD). */
export function datasetLd(ctx, { path, name, description, creator = [TK_ORG], license = CC_BY, basedOn, start, end, updated, keywords }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    url: `${ctx.baseUrl}${path}`,
    inLanguage: 'fi',
    isAccessibleForFree: true,
    creator: creator.length === 1 ? creator[0] : creator,
    publisher: { '@type': 'Organization', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
    ...(license ? { license } : {}),
    ...(basedOn ? { isBasedOn: basedOn } : {}),
    ...(start && end ? { temporalCoverage: `${start}/${end}` } : {}),
    ...(updated ? { dateModified: fmt.isoDate(updated) } : {}),
    ...(keywords ? { keywords } : {}),
  };
}

/**
 * Period label inside a chart subtitle that src/js/pages/hinnat.js rewrites
 * when the range of the interactive chart `id` changes ('tammi 2002 – elo 2026').
 * @param {string} id chart id (as passed to interactiveChart)
 * @param {string} period server-rendered period of the default range
 */
export function rangeLabel(id, period) {
  return html`<span data-range-label="${id}">${period}</span>`;
}

/**
 * Interactive chart container (enhanced by src/js/pages/hinnat.js): optional
 * range control (JS only), the server SVG as the no-JS fallback, a hidden
 * canvas container and the chart spec as a JSON data island.
 * `spec.param` names the query parameter that keeps the chosen range in the
 * URL (e.g. 'jakso'); a dataset may carry its own `decimals`.
 * @param {any} ctx
 * @param {{id: string, spec: object, fallback: import('../../scripts/lib/html.js').SafeString}} o
 */
export function interactiveChart(ctx, { id, spec, fallback }) {
  const ranges = spec.ranges?.length
    ? ctx.c.segmented({
        name: `${id}-jakso`,
        label: 'Kaavion aikaväli',
        value: spec.range,
        full: true,
        controls: `${id}-alue`,
        options: spec.ranges.map((k) => ({ value: k, label: RANGE_LABELS[k] ?? k })),
      })
    : '';
  return html`${ranges ? html`<div class="topic-chart__controls js-only">${ranges}</div>` : ''}<div class="topic-chart" id="${id}-alue" data-topic-chart="${id}">
  <div data-chart-fallback>${fallback}</div>
  <div class="chart-canvas" hidden></div>
</div>
${ctx.jsonScript(`${id}-data`, spec)}`;
}

/** "Lataa kuva" button for an interactive chart (JS only). */
export function downloadButton(ctx, id) {
  return ctx.c.button({ label: 'Lataa kuva', icon: 'download', size: 'sm', className: 'js-only', attrs: { data: { chartDownload: id } } });
}

/** Signed price change: '+2,2 %' / '−0,4 %' / '0,0 %' (no ± for a zero change). */
export const signed = (v, decimals = 1) => fmt.pct(v, { decimals, sign: fmt.isNum(v) && fmt.round(v, decimals) !== 0 });
/** Lower-case the first letter ('Liikenne' → 'liikenne'). */
const lcFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('fi-FI') + s.slice(1) : s);
/** Round away float noise. */
const r3 = (v) => (fmt.isNum(v) ? Math.round(v * 1000) / 1000 : null);

/** Finnish list: ['a'] → 'a', ['a', 'b', 'c'] → 'a, b ja c'. */
export const joinFi = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ja ${items.at(-1)}`);

/** Finnish cardinal words 0–19 (sentence start: 'Kymmenen pääryhmää …'). */
const CARDINALS = Object.freeze([
  'nolla', 'yksi', 'kaksi', 'kolme', 'neljä', 'viisi', 'kuusi', 'seitsemän', 'kahdeksan', 'yhdeksän',
  'kymmenen', 'yksitoista', 'kaksitoista', 'kolmetoista', 'neljätoista', 'viisitoista', 'kuusitoista', 'seitsemäntoista', 'kahdeksantoista', 'yhdeksäntoista',
]);

/** A count as a word when it is small (0–19), else as digits. */
export const countWord = (n) => CARDINALS[n] ?? String(n);

/**
 * Elative ending of a number written in digits ('13:sta', '10:stä'): the
 * vowel harmony follows the inflected word (kolmesta(toista), kymmenestä).
 * @param {number} n non-negative integer
 */
export function elativeSuffix(n) {
  const back = new Set([2, 3, 6, 8]); // kahdesta, kolmesta, kuudesta, kahdeksasta
  const last = n % 10 === 0 ? 10 : n % 10;
  return n > 0 && back.has(last) ? 'sta' : 'stä';
}

/**
 * Summary sentence: how many of the main groups raised inflation.
 * 'Kymmenen pääryhmää 13:sta nosti inflaatiota elokuussa 2026.'
 * @param {number} positives groups with a positive contribution
 * @param {number} total number of main groups
 * @param {string} when inessive month ('elokuussa 2026')
 */
export function positivesSentence(positives, total, when) {
  const of = `${total}:${elativeSuffix(total)}`;
  if (positives === 0) return `Mikään pääryhmä ei nostanut inflaatiota ${when}.`;
  if (positives === 1) return `Yksi pääryhmä ${of} nosti inflaatiota ${when}.`;
  return `${fmt.capitalize(countWord(positives))} pääryhmää ${of} nosti inflaatiota ${when}.`;
}

/* =========================================================== calculations */

/** Map code → item of hyodykkeet.json. */
export function itemsByCode(h) {
  return new Map((h?.items ?? []).map((it) => [it.code, it]));
}

/**
 * Weight of an item in ‰; items without a published weight (the most
 * detailed level) use the weight of their nearest ancestor that has one.
 * @returns {{weight: number|null, own: boolean}}
 */
export function effectiveWeight(item, byCode) {
  if (fmt.isNum(item?.weight)) return { weight: item.weight, own: true };
  let p = byCode.get(item?.parent);
  while (p) {
    if (fmt.isNum(p.weight)) return { weight: p.weight, own: false };
    p = byCode.get(p.parent);
  }
  return { weight: null, own: false };
}

/** The 13 main groups in display order (groups.codes). */
export function mainGroups(h) {
  const byCode = itemsByCode(h);
  const codes = (h?.groups?.codes ?? []).filter((c) => c !== 'SSS');
  const list = codes.map((c) => byCode.get(c)).filter(Boolean);
  return list.length ? list : (h?.items ?? []).filter((it) => it.level === 1);
}

/**
 * Do the main-group contributions add up to the total? (Tilastokeskus
 * publishes rounded contributions, so a few thousandths of difference is normal.)
 * @returns {{sum: number, total: number|null, yoy: number|null, diff: number|null, diffYoy: number|null}}
 */
export function contributionCheck(h) {
  const total = itemsByCode(h).get('SSS');
  const sum = r3(mainGroups(h).reduce((s, g) => s + (g.contribution ?? 0), 0));
  return {
    sum,
    total: total?.contribution ?? null,
    yoy: total?.yoy ?? null,
    diff: fmt.isNum(total?.contribution) ? r3(sum - total.contribution) : null,
    diffYoy: fmt.isNum(total?.yoy) ? r3(sum - total.yoy) : null,
  };
}

/**
 * Top risers and fallers: the most detailed items (leaves) with a weight of
 * at least `minWeight` ‰ (own weight, or the nearest ancestor's when the
 * item has none), sorted by annual change.
 * @param {any} h hyodykkeet.json
 * @param {{n?: number, minWeight?: number}} [o]
 */
export function topMovers(h, { n = 10, minWeight = MIN_WEIGHT } = {}) {
  const byCode = itemsByCode(h);
  const eligible = (h?.items ?? [])
    .filter((it) => it.leaf && it.level >= 2 && fmt.isNum(it.yoy))
    .map((it) => ({ ...it, ew: effectiveWeight(it, byCode) }))
    .filter((it) => fmt.isNum(it.ew.weight) && it.ew.weight >= minWeight);
  const tie = (a, b) => (b.ew.weight - a.ew.weight) || a.code.localeCompare(b.code);
  const up = eligible.filter((it) => it.yoy > 0).sort((a, b) => b.yoy - a.yoy || tie(a, b)).slice(0, n);
  const down = eligible.filter((it) => it.yoy < 0).sort((a, b) => a.yoy - b.yoy || tie(a, b)).slice(0, n);
  return { up, down, eligible: eligible.length };
}

/**
 * Contribution history of the main groups: the months (at most `maxMonths`)
 * for which Tilastokeskus publishes contributions, the `highlight` groups with
 * the largest mean absolute contribution, the rest summed as "muut".
 * @returns {null | {months: string[], codes: string[], series: Record<string, (number|null)[]>, others: (number|null)[], otherCodes: string[], total: (number|null)[]}}
 */
export function contributionHistory(h, { maxMonths = 60, highlight = HIGHLIGHT } = {}) {
  const g = h?.groups;
  const total = g?.series?.SSS?.contribution;
  if (!g?.months?.length || !total) return null;
  const end = stats.latestIndex(total);
  if (end < 0) return null;
  let start = end;
  while (start > 0 && fmt.isNum(total[start - 1]) && end - start + 1 < maxMonths) start--;
  const months = g.months.slice(start, end + 1);
  const codes = mainGroups(h).map((it) => it.code).filter((c) => g.series[c]);
  const slice = (c) => g.series[c].contribution.slice(start, end + 1);
  const meanAbs = (c) => stats.mean(slice(c).map((v) => (fmt.isNum(v) ? Math.abs(v) : null))) ?? 0;
  const ranked = [...codes].sort((a, b) => meanAbs(b) - meanAbs(a) || codes.indexOf(a) - codes.indexOf(b));
  const top = ranked.slice(0, highlight);
  const chosen = codes.filter((c) => top.includes(c)); // keep the COICOP order
  const otherCodes = codes.filter((c) => !chosen.includes(c));
  const series = Object.fromEntries(chosen.map((c) => [c, slice(c)]));
  const others = months.map((_, i) => {
    const vals = otherCodes.map((c) => g.series[c].contribution[start + i]);
    return vals.some(fmt.isNum) ? r3(vals.reduce((s, v) => s + (v ?? 0), 0)) : null;
  });
  return { months, codes: chosen, series, others, otherCodes, total: total.slice(start, end + 1) };
}

/**
 * Commodity pages with data: one model per hyodykesarjat item.
 * @param {any} data ctx.data
 */
export function commodityModels(data) {
  const s = data?.hyodykesarjat;
  const khi = data?.khi;
  const h = data?.hyodykkeet;
  if (!s?.items) return [];
  const byCode = itemsByCode(h);
  const out = [];
  for (const [slug, it] of Object.entries(s.items)) {
    if (!it?.months?.length || !Array.isArray(it.yoy)) continue;
    const li = stats.latestIndex(it.yoy);
    if (li < 0) continue;
    const month = it.months[li];
    const prevYoy = fmt.isNum(it.yoy[li - 1]) ? it.yoy[li - 1] : null;
    const khiYoy = khi ? stats.seriesAt(khi.months, khi.yoy, month) : null;
    const hItem = h?.latest === month ? byCode.get(it.code) ?? null : null;
    const group = h?.latest === month ? byCode.get(String(it.code).slice(0, 2)) ?? null : null;
    out.push({
      slug,
      path: `/hinnat/${slug}/`,
      code: it.code,
      coicop: it.coicop,
      name: it.name,
      officialName: it.officialName ?? it.name,
      category: it.category ?? 'Muut',
      phrase: TITLE_PHRASES[slug] ?? it.name,
      months: it.months,
      yoySeries: it.yoy,
      indexSeries: it.index,
      li,
      month,
      yoy: it.yoy[li],
      prevYoy,
      delta: stats.ppChange(it.yoy[li], prevYoy),
      index: it.index?.[li] ?? null,
      khiYoy,
      diff: stats.ppChange(it.yoy[li], khiYoy),
      hItem,
      group,
    });
  }
  // Rank by annual change among the pages of the same month (1 = fastest rise).
  for (const m of out) {
    const peers = out.filter((o) => o.month === m.month);
    m.rank = 1 + peers.filter((o) => o.yoy > m.yoy).length;
    m.peers = peers.length;
  }
  return out;
}

/**
 * Total change of an item's index and of the KHI over the same window
 * (10 years, or from the first month with an index).
 * @returns {null | {start: string, end: string, years: number, item: number, khi: number|null}}
 */
export function longRunChange(model, khi, years = 10) {
  const idx = model.indexSeries ?? [];
  const li = stats.latestIndex(idx);
  if (li < 0) return null;
  const end = model.months[li];
  let i0 = Math.max(stats.firstIndex(idx), li - years * 12);
  if (i0 < 0 || i0 >= li) return null;
  if (!fmt.isNum(idx[i0])) i0 = stats.firstIndex(idx);
  const start = model.months[i0];
  const k = khi?.index?.['2025=100'];
  const k0 = k ? stats.seriesAt(khi.months, k, start) : null;
  const k1 = k ? stats.seriesAt(khi.months, k, end) : null;
  return {
    start,
    end,
    years: fmt.ymDiff(start, end) / 12,
    item: stats.totalChange(idx[i0], idx[li]),
    khi: stats.totalChange(k0, k1),
  };
}

/**
 * Title phrase of each commodity page ("Naudanlihan hinta"): the natural
 * Finnish search phrase. Unknown slugs fall back to the item name.
 */
export const TITLE_PHRASES = Object.freeze({
  leipa: 'Leivän hinta',
  naudanliha: 'Naudanlihan hinta',
  sianliha: 'Sianlihan hinta',
  broileri: 'Broilerin hinta',
  lihavalmisteet: 'Lihavalmisteiden hinnat',
  kala: 'Kalan hinta',
  maitotuotteet: 'Maitotuotteiden hinnat',
  'rasvaton-maito': 'Maidon hinta',
  juusto: 'Juuston hinta',
  jogurtti: 'Jogurtin hinta',
  munat: 'Kananmunien hinta',
  voi: 'Voin hinta',
  kasvioljyt: 'Kasviöljyn hinta',
  hedelmat: 'Hedelmien hinnat',
  marjat: 'Marjojen hinta',
  vihannekset: 'Vihannesten hinnat',
  peruna: 'Perunan hinta',
  suklaa: 'Suklaan hinta',
  valmisruoat: 'Valmisruokien hinnat',
  kahvi: 'Kahvin hinta',
  mehut: 'Mehujen hinnat',
  virvoitusjuomat: 'Virvoitusjuomien hinnat',
  olut: 'Oluen hinta',
  viini: 'Viinin hinta',
  'vakevat-alkoholijuomat': 'Väkevien alkoholijuomien hinnat',
  savukkeet: 'Savukkeiden hinta',
  vaatteet: 'Vaatteiden hinnat',
  kengat: 'Kenkien hinnat',
  vuokra: 'Vuokrien kehitys',
  hoitovastike: 'Hoitovastikkeiden kehitys',
  vesihuolto: 'Vesihuollon hinta',
  sahko: 'Sähkön hinta',
  lammitysoljy: 'Lämmitysöljyn hinta',
  kaukolampo: 'Kaukolämmön hinta',
  'asuntolainojen-korot': 'Asuntolainojen korkomenot',
  huonekalut: 'Huonekalujen hinnat',
  kodinkoneet: 'Kodinkoneiden hinnat',
  laakkeet: 'Lääkkeiden hinnat',
  hammashoito: 'Hammashoidon hinta',
  'uudet-autot': 'Uusien autojen hinnat',
  'kaytetyt-autot': 'Käytettyjen autojen hinnat',
  bensiini: 'Bensiinin hinta',
  diesel: 'Dieselin hinta',
  'auton-huolto': 'Auton huollon hinta',
  renkaat: 'Renkaiden hinnat',
  junaliput: 'Junalippujen hinnat',
  bussiliput: 'Bussilippujen hinnat',
  lentoliput: 'Lentolippujen hinnat',
  matkapuhelimet: 'Matkapuhelinten hinnat',
  tietokoneet: 'Tietokoneiden hinnat',
  puhelinliittymat: 'Puhelinliittymien hinnat',
  internetliittymat: 'Internetliittymien hinnat',
  lemmikkitarvikkeet: 'Lemmikkitarvikkeiden hinnat',
  liikuntapalvelut: 'Liikuntapalvelujen hinnat',
  'elokuvat-ja-teatteri': 'Elokuva-, teatteri- ja konserttiliput',
  kirjat: 'Kirjojen hinnat',
  valmismatkat: 'Valmismatkojen hinnat',
  ravintolat: 'Ravintolahinnat',
  hotellit: 'Hotellihinnat',
  vakuutukset: 'Vakuutusten hinnat',
  kampaamo: 'Kampaamohinnat',
  hygieniatuotteet: 'Hygieniatuotteiden hinnat',
});

/** Commodity pages whose topic also has its own page. */
const RELATED_TOPICS = Object.freeze({
  bensiini: { href: '/polttoaineet/', label: 'Polttoaineiden keskihinnat euroina litralta' },
  diesel: { href: '/polttoaineet/', label: 'Polttoaineiden keskihinnat euroina litralta' },
  lammitysoljy: { href: '/polttoaineet/', label: 'Polttoaineiden keskihinnat euroina litralta' },
  'asuntolainojen-korot': { href: '/korot/', label: 'Korot ja inflaatio: euribor ja reaalikorko' },
});

/* ========================================================= local SVG chart */

const c2 = (v) => String(Math.round(v * 100) / 100);
const pctPos = (f) => `${Math.round(f * 100000) / 1000}%`;

/**
 * Stacked bar chart (server SVG, no-JS fallback of the contribution history):
 * positive parts stack up from zero, negative parts down; the total is a line
 * with a dot per month (as in the interactive chart).
 * Uses the chart classes of components.css (colours from tokens).
 * @param {{months: string[], stacks: {cls: string, label: string, values: (number|null)[]}[],
 *   total?: {label: string, values: (number|null)[]}, ariaLabel: string, height?: number}} o
 */
export function stackedBarsSvg({ months, stacks, total, ariaLabel, height = 300 }) {
  if (!ariaLabel) throw new Error('stackedBarsSvg: ariaLabel is required');
  const n = months.length;
  const pos = months.map((_, i) => stacks.reduce((s, st) => s + Math.max(0, st.values[i] ?? 0), 0));
  const neg = months.map((_, i) => stacks.reduce((s, st) => s + Math.min(0, st.values[i] ?? 0), 0));
  const tv = (total?.values ?? []).filter(fmt.isNum);
  const scale = niceScale(Math.min(0, ...neg, ...tv), Math.max(0, ...pos, ...tv), 5);
  const top = 12;
  const bottom = 28;
  const plotH = height - top - bottom;
  const span = scale.max - scale.min || 1;
  const yIn = (v) => (1 - (v - scale.min) / span) * plotH;
  const slot = 10;
  const pad = n > 40 ? 1.5 : n > 20 ? 2 : n > 8 ? 2.5 : 3;
  const decimals = scale.step >= 1 ? 0 : scale.step >= 0.1 ? 1 : 2;
  const parts = [];
  for (const t of scale.ticks) {
    const y = c2(top + yIn(t));
    parts.push(html`<line${attrs({ class: ['chart-grid', Math.abs(t) < 1e-9 && 'chart-grid--zero'], x1: 0, x2: '100%', y1: y, y2: y })}/>`);
    parts.push(html`<text class="chart-axis chart-axis--y" x="-8" y="${y}" dy="0.32em" text-anchor="end">${fmt.num(t, decimals)}</text>`);
  }
  const rects = [];
  months.forEach((ym, i) => {
    let up = 0;
    let down = 0;
    for (const st of stacks) {
      const v = st.values[i];
      if (!fmt.isNum(v) || v === 0) continue;
      const from = v > 0 ? up : down;
      const to = from + v;
      if (v > 0) up = to;
      else down = to;
      const y1 = yIn(Math.max(from, to));
      const y2 = yIn(Math.min(from, to));
      rects.push(html`<rect class="chart-bar chart-bar--${st.cls}" x="${c2(i * slot + pad)}" y="${c2(y1)}" width="${c2(slot - 2 * pad)}" height="${c2(Math.max(y2 - y1, 0.5))}"><title>${st.label}, ${fmt.monthShort(ym)}: ${fmt.pp(v, { decimals: 2 })}</title></rect>`);
    }
  });
  // Total as a line through the bar centres (non-scaling stroke keeps it 2 px).
  let d = '';
  let pen = false;
  (total?.values ?? []).forEach((v, i) => {
    if (!fmt.isNum(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${c2(i * slot + slot / 2)} ${c2(yIn(v))}`;
    pen = true;
  });
  const totalLine = d.includes('L') ? html`<path class="chart-line chart-line--khi" d="${d}" vector-effect="non-scaling-stroke"/>` : '';
  parts.push(html`<svg class="chart-plot" x="0" y="${top}" width="100%" height="${plotH}" viewBox="0 0 ${n * slot} ${plotH}" preserveAspectRatio="none" overflow="visible">${rects}${totalLine}</svg>`);
  (total?.values ?? []).forEach((v, i) => {
    if (!fmt.isNum(v)) return;
    parts.push(html`<circle class="chart-dot chart-dot--khi" cx="${pctPos((i + 0.5) / n)}" cy="${c2(top + yIn(v))}" r="4"><title>${total.label}, ${fmt.monthShort(months[i])}: ${fmt.pp(v, { decimals: 2 })}</title></circle>`);
  });
  for (const t of monthTicks(months)) {
    parts.push(html`<text${attrs({ class: ['chart-axis', 'chart-axis--x', t.minor && 'chart-tick--minor'], x: pctPos((t.index + 0.5) / n), y: c2(height - 8), 'text-anchor': 'middle' })}>${t.text}</text>`);
  }
  return html`<svg${attrs({ xmlns: 'http://www.w3.org/2000/svg', class: 'chart-svg chart-svg--bar', role: 'img', 'aria-label': ariaLabel, width: '100%', height, overflow: 'visible', focusable: 'false' })}>${parts}</svg>`;
}

/* ================================================================= /hinnat/ */

function groupLabel(g) {
  return g.shortName ?? g.name;
}

function hinnatIndex(ctx, models) {
  const { c, svg } = ctx;
  const h = ctx.data.hyodykkeet;
  const path = '/hinnat/';
  const byCode = itemsByCode(h);
  const sss = byCode.get('SSS');
  const month = h.latest;
  const groups = mainGroups(h);
  if (!sss || !groups.length) throw new Error('hinnat: data/hyodykkeet.json has no total or main groups');
  const check = contributionCheck(h);
  const sorted = [...groups].filter((g) => fmt.isNum(g.contribution)).sort((a, b) => b.contribution - a.contribution);
  const topG = sorted[0];
  const lowG = sorted.at(-1);
  const bySlug = new Map(models.map((m) => [m.slug, m]));
  const src = metaSource(ctx, 'hyodykkeet', 'kuluttajahintaindeksi hyödykeryhmittäin, taulukot 15b5 ja 15bc');
  const updated = ctx.latest.updated?.hyodykkeet ?? ctx.latest.khi?.updated;
  const monthTxt = fmt.monthName(month);

  // Lede: total, the biggest driver and its share, the biggest brake.
  const rise = sss.yoy >= 0;
  const share = topG && topG.contribution > 0 && sss.contribution >= 0.5 && topG.contribution <= sss.contribution
    ? Math.round((topG.contribution / sss.contribution) * 100)
    : null;
  const When = fmt.capitalize(fmt.inessive(month));
  const ledeParts = [
    fmt.round(sss.yoy, 1) === 0
      ? `${When} kuluttajahinnat olivat samalla tasolla kuin vuotta aiemmin.`
      : `${When} kuluttajahinnat olivat ${fmt.pct(Math.abs(sss.yoy))} ${rise ? 'korkeammat' : 'alemmat'} kuin vuotta aiemmin.`,
  ];
  if (topG && topG.contribution > 0) {
    ledeParts.push(`Eniten inflaatiota nosti pääryhmä ${groupLabel(topG)}: sen vaikutus oli ${fmt.pp(topG.contribution, { decimals: 2 })}${share != null ? ` eli noin ${share} % koko vuosimuutoksesta` : ''}.`);
  }
  if (lowG && lowG.contribution < 0) {
    ledeParts.push(`Eniten hintojen nousua hillitsi pääryhmä ${groupLabel(lowG)} (${fmt.pp(lowG.contribution, { decimals: 2 })}).`);
  }

  const header = c.pageHeader({
    eyebrow: `Hinnat · ${monthTxt}`,
    title: 'Mikä inflaatiota nostaa?',
    lede: ledeParts.join(' '),
    meta: c.sourceLine({ sources: [src], updated }),
  });

  // KPI cards
  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Inflaatio (KHI)', value: fmt.pct(sss.yoy), note: `Vuosimuutos, ${monthTxt}` }),
    c.kpiCard({ label: 'Suurin nostaja', value: topG ? fmt.pp(topG.contribution, { decimals: 2 }) : null, note: topG ? `${groupLabel(topG)} (${signed(topG.yoy)} vuodessa)` : null }),
    c.kpiCard({ label: 'Suurin hillitsijä', value: lowG ? fmt.pp(lowG.contribution, { decimals: 2 }) : null, note: lowG ? `${groupLabel(lowG)} (${signed(lowG.yoy)} vuodessa)` : null }),
    c.kpiCard({
      label: 'Hinnat kuukaudessa',
      value: signed(sss.mom),
      note: `Muutos ${fmt.elative(fmt.ymAdd(month, -1), { year: false })} ${fmt.illative(month, { year: false })}`,
    }),
  ]);

  // Contribution bars
  const hbar = svg.hBarChart({
    bars: sorted.map((g) => ({ label: groupLabel(g), value: g.contribution, title: `${g.name}: ${fmt.pp(g.contribution, { decimals: 2 })}` })),
    ariaLabel: `Pääryhmien vaikutus kuluttajahintojen vuosimuutokseen ${fmt.inessive(month)}, prosenttiyksikköä. Suurin vaikutus pääryhmällä ${groupLabel(topG)} (${fmt.pp(topG.contribution, { decimals: 2 })}), pienin pääryhmällä ${groupLabel(lowG)} (${fmt.pp(lowG.contribution, { decimals: 2 })}).`,
  });
  const positives = sorted.filter((g) => g.contribution > 0).length;
  const contribFigure = c.chartFigure({
    id: 'vaikutukset-kaavio',
    title: `Pääryhmien vaikutus inflaatioon, ${monthTxt}`,
    subtitle: `Vaikutus vuosimuutokseen, %-yks. · kokonaisinflaatio ${fmt.pct(sss.yoy)}`,
    legend: c.legend([
      { cls: 'pos', label: 'Nostaa inflaatiota', box: true },
      { cls: 'neg', label: 'Hillitsee inflaatiota', box: true },
    ]),
    chart: hbar,
    summary: `${positivesSentence(positives, sorted.length, fmt.inessive(month))} Suurin vaikutus oli pääryhmällä ${groupLabel(topG)} (${fmt.pp(topG.contribution, { decimals: 2 })}). Luvut ovat taulukossa alla.`,
    source: c.sourceLine({ sources: [src], updated }),
  });

  const groupTable = c.dataTable({
    id: 'paaryhmat-taulukko',
    caption: `Kuluttajahinnat pääryhmittäin, ${monthTxt}`,
    columns: [
      { label: 'Pääryhmä' },
      { label: 'Paino, ‰', num: true },
      { label: 'Vuosimuutos', num: true },
      { label: 'Vaikutus, %-yks.', num: true },
      { label: 'Kuukausimuutos', num: true },
    ],
    rows: [
      ...groups.map((g) => [
        html`${groupLabel(g)}${g.shortName && g.shortName !== g.name ? html`<span class="hinnat-official"><span class="sr-only">, virallinen nimi: </span>${g.name}</span>` : ''}`,
        fmt.num(g.weight, 1),
        c.numUnit(signed(g.yoy)),
        c.numUnit(fmt.pp(g.contribution, { decimals: 2 })),
        c.numUnit(signed(g.mom)),
      ]),
      {
        className: 'is-total',
        cells: ['Kaikki yhteensä (KHI)', fmt.num(sss.weight ?? 1000, 0), c.numUnit(signed(sss.yoy)), c.numUnit(fmt.pp(sss.contribution, { decimals: 2 })), c.numUnit(signed(sss.mom))],
      },
    ],
    note: `Paino kertoo ryhmän osuuden kotitalouksien kulutusmenoista vuoden ${h.weightYear} painorakenteessa (promilleina). Pääryhmien vaikutukset ovat yhteensä ${fmt.pp(check.sum, { decimals: 2 })} ja kokonaisindeksin vaikutus ${fmt.pp(sss.contribution, { decimals: 2 })}${
      fmt.isNum(check.diff) && Math.abs(check.diff) <= 0.05 ? '; pieni ero johtuu pyöristyksistä' : ''
    }. Lähde: Tilastokeskus.`,
  });

  // Fuels inside the transport group (link to the € prices page)
  const transport = byCode.get('07');
  const fuels = byCode.get('0722');
  const fuelNote = transport && fuels && fmt.isNum(transport.contribution) && fmt.isNum(fuels.contribution)
    ? html`<p class="hinnat-note">Liikenteen vaikutuksesta (${fmt.pp(transport.contribution, { decimals: 2 })}) ajoneuvojen polttoaineiden osuus oli ${fmt.pp(fuels.contribution, { decimals: 2 })} Polttoaineiden hinnat ${fuels.yoy >= 0 ? 'nousivat' : 'laskivat'} vuodessa ${fmt.pct(Math.abs(fuels.yoy))}. Katso <a href="/polttoaineet/">polttoaineiden keskihinnat euroina litralta</a>.</p>`
    : '';

  // Top 10 lists
  const movers = topMovers(h);
  // Name cell: rank (CSS counter) + name, main group and — on phones, where
  // the contribution column is hidden — the contribution on its own line.
  const moverName = (it) => {
    const m = it.slug ? bySlug.get(it.slug) : null;
    const g = byCode.get(String(it.code).slice(0, 2));
    return html`<div class="hinnat-mover__name"><span class="hinnat-rank" aria-hidden="true"></span><div>${m ? html`<a href="${m.path}">${m.name}</a>` : it.name}${
      g ? html`<span class="hinnat-official"><span class="sr-only">, pääryhmä: </span>${groupLabel(g)}</span>` : ''
    }<span class="hinnat-mover__contrib">Vaikutus ${c.numUnit(fmt.pp(it.contribution, { decimals: 2 }))}</span></div></div>`;
  };
  const moverTable = (id, caption, list) =>
    c.dataTable({
      id,
      caption,
      columns: [{ label: 'Hyödyke' }, { label: 'Vuosimuutos', num: true }, { label: 'Vaikutus, %-yks.', num: true, className: 'hinnat-col-contrib' }],
      rows: list.map((it) => ({ className: 'hinnat-mover', cells: [moverName(it), c.deltaChip({ value: it.yoy, unit: 'pct', plain: true }), c.numUnit(fmt.pp(it.contribution, { decimals: 2 }))] })),
      compact: true,
    });
  const moversBody = html`<div class="hinnat-movers">
  <div>${moverTable('kallistujat-taulukko', `Eniten kallistuneet, ${monthTxt}`, movers.up)}</div>
  <div>${moverTable('halventujat-taulukko', `Eniten halventuneet, ${monthTxt}`, movers.down)}</div>
</div>
<p class="hinnat-note">Listoilla ovat kuluttajahintaindeksin tarkimman tason hyödykeryhmät, joiden paino on vähintään ${fmt.num(MIN_WEIGHT)} ‰ eli joihin kuluu vähintään tuhannesosa kotitalouksien kulutusmenoista (${movers.eligible} ryhmää). Jos tarkimmalle tasolle ei julkaista omaa painoa, rajana käytetään lähimmän yläryhmän painoa. Pienemmät erät jätetään pois, koska niiden hinnat heilahtelevat paljon eikä niillä ole juuri merkitystä kotitalouksien menoille. Muutos on hintaindeksin vuosimuutos ${fmt.elative(fmt.ymAdd(month, -12))} ${fmt.illative(month)}.</p>`;

  // Contribution history (stacked bars) and main-group annual changes (lines)
  const history = contributionHistory(h);
  let historySection = '';
  if (history && history.months.length >= 2) {
    const label = (code) => groupLabel(byCode.get(code));
    const stacks = [
      ...history.codes.map((code, i) => ({ cls: GROUP_COLOURS[i], label: label(code), values: history.series[code] })),
      { cls: OTHERS_COLOUR, label: 'Muut ryhmät', values: history.others },
    ];
    const period = fmt.monthRange(history.months[0], history.months.at(-1));
    const fallback = stackedBarsSvg({
      months: history.months,
      stacks,
      total: { label: 'Kaikki yhteensä', values: history.total },
      ariaLabel: `Pääryhmien vaikutus kuluttajahintojen vuosimuutokseen kuukausittain ${period}, prosenttiyksikköä.`,
    });
    const spec = {
      label: `Pääryhmien vaikutus inflaatioon kuukausittain ${period}, prosenttiyksikköä`,
      months: history.months,
      unit: 'pp',
      decimals: 2,
      stacked: true,
      datasets: [
        ...stacks.map((st) => ({ type: 'bar', series: st.cls, label: st.label, data: st.values, stack: 'ryhmat' })),
        { type: 'line', series: 'khi', label: 'Kaikki yhteensä', data: history.total, stack: 'yhteensa' },
      ],
      download: { filename: `inflaation-vaikutukset-${month}.png`, title: 'Pääryhmien vaikutus inflaatioon (%-yks.)', source: 'Lähde: Tilastokeskus · inflaatio.fi' },
    };
    const first = history.months[0];
    const table = c.dataTable({
      id: 'vaikutushistoria-taulukko',
      caption: `Pääryhmien vaikutus vuosimuutokseen kuukausittain, %-yks., ${period}`,
      columns: [{ label: 'Kuukausi' }, ...stacks.map((st) => ({ label: st.label, num: true })), { label: 'Yhteensä', num: true }],
      rows: history.months
        .map((ym, i) => [fmt.monthShort(ym), ...stacks.map((st) => c.numUnit(fmt.num(st.values[i], 2, { sign: true }))), c.numUnit(fmt.num(history.total[i], 2, { sign: true }))])
        .reverse(),
      visibleRows: 12,
      compact: true,
      note: history.otherCodes.length ? `Muut ryhmät: ${history.otherCodes.map((cd) => label(cd)).join(', ')}.` : undefined,
    });
    const lastTotal = history.total.at(-1);
    const stackFigure = c.chartFigure({
      id: 'vaikutushistoria',
      title: 'Vaikutukset kuukausittain',
      subtitle: `Vaikutus vuosimuutokseen, %-yks. · ${period}`,
      legend: c.legend([...stacks.map((st) => ({ cls: st.cls, label: st.label, box: true })), { cls: 'khi', label: 'Kaikki yhteensä' }]),
      chart: interactiveChart(ctx, { id: 'vaikutushistoria', spec, fallback }),
      summary: `Pylväät näyttävät, paljonko kukin pääryhmä nosti (ylöspäin) tai hillitsi (alaspäin) inflaatiota kunakin kuukautena. Viiva on koko kuluttajahintaindeksin vaikutus: ${fmt.inessive(history.months.at(-1))} se oli ${fmt.pp(lastTotal, { decimals: 2 })}, mikä vastaa pääryhmien vaikutusten summaa pyöristyksiä lukuun ottamatta. Tilastokeskus julkaisee vaikutukset nykyisellä luokituksella ${fmt.elative(first)} alkaen, joten kaavio pitenee kuukausi kerrallaan.`,
      table,
      source: c.sourceLine({ sources: [src], updated }),
      actions: downloadButton(ctx, 'vaikutushistoria'),
    });

    // Annual change of the same groups (60 months, lines)
    const g = h.groups;
    const lineSeries = [
      { key: 'SSS', cls: 'khi', label: 'Kaikki (KHI)' },
      ...history.codes.map((code, i) => ({ key: code, cls: GROUP_COLOURS[i], label: label(code) })),
    ].filter((s) => g.series[s.key]?.yoy);
    const five = stats.sliceRange(g.months, lineSeries.map((s) => g.series[s.key].yoy), '5v');
    const yoyFallback = svg.lineChart({
      series: lineSeries.map((s, i) => ({ values: five.series[i], cls: s.cls, label: s.label })),
      labels: five.months,
      refLines: [{ value: 0, cls: 'muted' }],
      height: 320,
      ariaLabel: `Pääryhmien hintojen vuosimuutos ${fmt.monthRange(five.months[0], five.months.at(-1))}.`,
    });
    const yoySpec = {
      label: `Pääryhmien hintojen vuosimuutos kuukausittain, viimeisin ${monthTxt}`,
      months: g.months,
      unit: '%',
      ranges: ['1v', '3v', '5v'],
      range: '5v',
      param: 'jakso',
      datasets: lineSeries.map((s) => ({ type: 'line', series: s.cls, label: s.label, data: g.series[s.key].yoy })),
      download: { filename: `paaryhmien-vuosimuutos-${month}.png`, title: 'Pääryhmien hintojen vuosimuutos (%)', source: 'Lähde: Tilastokeskus · inflaatio.fi' },
    };
    const top3 = lineSeries.slice(1).map((s) => ({ ...s, v: stats.seriesAt(g.months, g.series[s.key].yoy, month) })).filter((s) => fmt.isNum(s.v));
    const yoyFigure = c.chartFigure({
      id: 'ryhmien-vuosimuutos',
      title: 'Pääryhmien hintojen vuosimuutos',
      subtitle: html`Vuosimuutos, % · ryhmät, joiden vaikutus on ollut suurin · ${rangeLabel('ryhmien-vuosimuutos', fmt.monthRange(five.months[0], five.months.at(-1)))}`,
      legend: c.legend(lineSeries.map((s) => ({ cls: s.cls, label: s.label }))),
      chart: interactiveChart(ctx, { id: 'ryhmien-vuosimuutos', spec: yoySpec, fallback: yoyFallback }),
      summary: `Vuosimuutos ${fmt.inessive(month)}: ${top3.map((s) => `${s.label} ${signed(s.v)}`).join(', ')}; kaikki kuluttajahinnat ${signed(sss.yoy)}.`,
      table: c.dataTable({
        id: 'ryhmien-vuosimuutos-taulukko',
        caption: `Pääryhmien vuosimuutos kuukausittain, ${fmt.monthRange(g.months[0], g.months.at(-1))}`,
        columns: [{ label: 'Kuukausi' }, ...lineSeries.map((s) => ({ label: s.label, num: true }))],
        rows: g.months.map((ym, i) => [fmt.monthShort(ym), ...lineSeries.map((s) => c.numUnit(fmt.pct(g.series[s.key].yoy[i])))]).reverse(),
        visibleRows: 12,
        compact: true,
        toggleLabels: { more: `Näytä kaikki kuukaudet (${g.months.length})`, less: 'Näytä vain 12 viimeisintä kuukautta' },
      }),
      source: c.sourceLine({ sources: [src], updated }),
      actions: downloadButton(ctx, 'ryhmien-vuosimuutos'),
    });
    historySection = c.section({
      id: 'kehitys',
      eyebrow: 'Kehitys',
      title: 'Miten vaikutukset ovat muuttuneet?',
      intro: 'Kuukausittaiset vaikutukset ja suurimpien pääryhmien hintojen vuosimuutos.',
      body: html`<div class="stack-lg">${stackFigure}${yoyFigure}</div>`,
    });
  }

  // All commodity pages by category
  const cats = new Map();
  for (const m of models) {
    if (!cats.has(m.category)) cats.set(m.category, []);
    cats.get(m.category).push(m);
  }
  const itemList = html`<div class="hinnat-list">${[...cats].map(
    ([cat, list]) => html`<div class="hinnat-list__group">
  <h3 class="hinnat-list__title">${cat}</h3>
  <ul class="list-reset">${list.map(
    (m) => html`<li><a href="${m.path}">${m.name}</a><span class="hinnat-list__value">${c.numUnit(signed(m.yoy))}</span></li>`,
  )}</ul>
</div>`,
  )}</div>
<p class="hinnat-note">Luvut ovat hintaindeksin vuosimuutoksia ${fmt.inessive(month)} (Tilastokeskus). Jokaisella sivulla on hintojen kehitys kuukausittain, vertailu kaikkiin kuluttajahintoihin ja hyödykkeen pääryhmään.</p>`;

  const explain = c.accordion([
    {
      summary: 'Mitä vaikutus prosenttiyksikköinä tarkoittaa?',
      body: html`<p>Vaikutus kertoo, montako prosenttiyksikköä ryhmän hintamuutos lisää kuluttajahintaindeksin vuosimuutokseen (tai vähentää siitä). Se riippuu sekä ryhmän hintojen muutoksesta että siitä, kuinka suuren osan kotitalouksien menoista ryhmä kattaa (paino). Pääryhmien vaikutukset summautuvat kokonaisinflaatioon pyöristyksiä lukuun ottamatta.</p>`,
    },
    {
      summary: 'Mistä luvut tulevat?',
      body: html`<p>Luvut ovat Tilastokeskuksen kuluttajahintaindeksistä (KHI, perusvuosi 2025=100): hyödykeryhmien pisteluvut, vuosi- ja kuukausimuutokset sekä vaikutukset taulukosta 15b5 ja painot taulukosta 15bc. Ryhmittely noudattaa vuonna 2026 käyttöön otettua COICOP 2018 -luokitusta. Pääryhmien nimet on lyhennetty arkikielisiksi; viralliset nimet näkyvät taulukossa.</p>`,
    },
    {
      summary: 'Ovatko nämä euromääräisiä hintoja?',
      body: html`<p>Eivät. Luvut kertovat, kuinka paljon hinnat ovat muuttuneet (hintaindeksi), eivät mitä tuotteet maksavat. Euromääräisiä keskihintoja Tilastokeskus julkaisee polttoaineista: katso <a href="/polttoaineet/">polttoaineiden keskihinnat</a>.</p>`,
    },
  ]);

  const main = html`${header}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--flush-top', body: kpis })}
${c.section({
  id: 'vaikutus',
  eyebrow: 'Vaikutus inflaatioon',
  title: 'Mitkä ryhmät nostavat hintoja?',
  intro: 'Pääryhmät suuruusjärjestyksessä sen mukaan, paljonko ne nostivat tai hillitsivät vuosimuutosta.',
  body: html`<div class="stack-lg">${contribFigure}<div>${groupTable}${fuelNote}</div></div>`,
})}
${c.section({
  id: 'kallistujat',
  eyebrow: 'Hyödykkeet',
  title: 'Mikä kallistui ja mikä halpeni eniten?',
  intro: `Kymmenen eniten kallistunutta ja halventunutta hyödykeryhmää, muutos ${fmt.elative(fmt.ymAdd(month, -12), { year: true })} ${fmt.illative(month)}.`,
  body: moversBody,
})}
${historySection}
${c.section({
  id: 'hyodykkeet',
  eyebrow: 'Hintasivut',
  title: 'Hintojen kehitys hyödykkeittäin',
  intro: `${models.length} tuttua hyödykettä ja palvelua, kukin omalla sivullaan.`,
  body: itemList,
})}
${c.section({ id: 'luvuista', title: 'Näin luvut luetaan', body: explain })}`;

  const description = fitText(
    [
      `${When} inflaatio oli ${fmt.pct(sss.yoy)}. Eniten sitä nosti pääryhmä ${groupLabel(topG)} (${fmt.pp(topG.contribution, { decimals: 2 })}). Pääryhmät sekä eniten kallistuneet ja halventuneet hyödykkeet.`,
      `${When} inflaatio oli ${fmt.pct(sss.yoy)}. Pääryhmien vaikutukset sekä eniten kallistuneet ja halventuneet hyödykkeet (Tilastokeskus).`,
    ],
    DESCRIPTION_MAX,
  );
  return {
    path,
    priority: 0.8,
    changefreq: 'monthly',
    html: ctx.layout({
      title: fitText([`Mikä inflaatiota nostaa? (${monthTxt})`, 'Mikä inflaatiota nostaa?']),
      description,
      path,
      page: 'hinnat',
      scripts: ['pages/hinnat.js'],
      breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Hinnat'),
      jsonLd: [
        datasetLd(ctx, {
          path,
          name: `Kuluttajahinnat hyödykeryhmittäin ja vaikutukset inflaatioon, ${monthTxt}`,
          description: `Kuluttajahintaindeksin pääryhmien vuosimuutokset, painot ja vaikutukset inflaatioon sekä eniten kallistuneet ja halventuneet hyödykkeet ${fmt.inessive(month)}. Lähde: Tilastokeskus.`,
          basedOn: src.href,
          start: h.groups?.months?.[0],
          end: month,
          updated,
          keywords: ['inflaatio', 'kuluttajahintaindeksi', 'hyödykeryhmät', 'hinnat'],
        }),
      ],
      main,
    }),
  };
}

/* ======================================================= /hinnat/<slug>/ */

function directionWord(v, { past = true } = {}) {
  if (!fmt.isNum(v) || v === 0) return past ? 'pysyivät ennallaan' : 'ennallaan';
  return v > 0 ? 'nousivat' : 'laskivat';
}

/**
 * Plural subject of the generated texts for pages where "hinnat" would read
 * oddly (interest costs, rents, maintenance charges).
 */
const SUBJECTS = Object.freeze({ 'asuntolainojen-korot': 'asuntolainojen korkomenot', vuokra: 'vuokrat', hoitovastike: 'hoitovastikkeet' });

/**
 * Plural subject of a commodity page's sentences, from its title phrase:
 * 'Kahvin hinta' → 'kahvin hinnat', 'Ravintolahinnat' → 'ravintolahinnat',
 * vuokra → 'vuokrat'; plain 'hinnat' when the phrase has no genitive.
 * @param {{slug: string, phrase?: string}} m
 * @returns {{text: string, prices: boolean}}
 */
export function commoditySubject(m) {
  if (SUBJECTS[m.slug]) return { text: SUBJECTS[m.slug], prices: false };
  const phrase = m.phrase ?? TITLE_PHRASES[m.slug];
  const hit = phrase?.match(/^(.+) (?:hinta|hinnat)$/);
  if (hit) return { text: `${lcFirst(hit[1])} hinnat`, prices: true };
  if (phrase && /^\S+hinnat$/.test(phrase)) return { text: lcFirst(phrase), prices: true };
  return { text: 'hinnat', prices: true };
}

/** Generated description paragraph of a commodity page. */
export function commodityText(m, long) {
  const { text: subject, prices } = commoditySubject(m);
  const devWord = prices ? 'hintakehitys' : 'kehitys';
  const When = fmt.capitalize(fmt.inessive(m.month));
  const out = [];
  if (fmt.round(m.yoy, 1) === 0) out.push(`${When} ${subject} olivat samalla tasolla kuin vuotta aiemmin.`);
  else out.push(`${When} ${subject} olivat ${fmt.pct(Math.abs(m.yoy))} ${m.yoy > 0 ? 'korkeammat' : 'alemmat'} kuin vuotta aiemmin.`);
  if (fmt.isNum(m.khiYoy) && fmt.isNum(m.diff)) {
    const khiPart = m.khiYoy === 0 ? 'Kaikki kuluttajahinnat pysyivät samaan aikaan ennallaan' : `Kaikki kuluttajahinnat ${directionWord(m.khiYoy)} samaan aikaan ${fmt.pct(Math.abs(m.khiYoy))}`;
    const d = Math.abs(m.diff);
    const cmp = d < 0.5
      ? `joten ${devWord} oli lähellä keskimääräistä`
      : `joten ${devWord} oli ${fmt.num(d, 1)} prosenttiyksikköä keskimääräistä ${m.diff > 0 ? 'nopeampaa' : 'hitaampaa'}`;
    out.push(`${khiPart}, ${cmp}.`);
  }
  if (long && fmt.isNum(long.item)) {
    const span = Math.round(long.years);
    const range = `${fmt.elative(long.start)} ${fmt.illative(long.end)}`;
    const when = span === 10 ? `kymmenessä vuodessa (${range})` : span >= 2 ? `${span} vuodessa (${range})` : range;
    const itemPart = `${fmt.capitalize(when)} ${subject} ovat ${long.item >= 0 ? 'nousseet' : 'laskeneet'} ${fmt.pct(Math.abs(long.item))}`;
    const khiPart = fmt.isNum(long.khi) ? `, kun kaikki kuluttajahinnat ovat ${long.khi >= 0 ? 'nousseet' : 'laskeneet'} ${fmt.pct(Math.abs(long.khi))}` : '';
    out.push(`${itemPart}${khiPart}.`);
  }
  return out;
}

function commodityPage(ctx, m, models) {
  const { c, svg } = ctx;
  const khi = ctx.data.khi;
  const h = ctx.data.hyodykkeet;
  const monthTxt = fmt.monthName(m.month);
  const long = longRunChange(m, khi);
  const src = metaSource(ctx, 'hyodykesarjat', `kuluttajahintaindeksi, hyödyke ${m.coicop ?? m.code}`);
  const updated = ctx.latest.updated?.hyodykesarjat ?? ctx.latest.khi?.updated;
  const bothSrc = { ...src, detail: `kuluttajahintaindeksi, hyödyke ${m.coicop ?? m.code} ja kokonaisindeksi` };

  const textParts = commodityText(m, long);
  const header = c.pageHeader({
    eyebrow: `Hinnat · ${m.category} · ${monthTxt}`,
    title: m.phrase,
    lede: textParts.join(' '),
    meta: c.sourceLine({ sources: [src], updated }),
  });

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Vuosimuutos', value: signed(m.yoy), note: `${fmt.capitalize(monthTxt)} · ${m.name}` }),
    c.kpiCard({
      label: 'Vuosimuutoksen muutos',
      value: fmt.pp(m.delta),
      delta: stats.deltaClass(m.delta),
      deltaWords: 'pct',
      note: fmt.isNum(m.prevYoy) ? `Vuosimuutos ${signed(m.prevYoy)} ${fmt.inessive(fmt.ymAdd(m.month, -1))}` : null,
    }),
    c.kpiCard({ label: 'Kaikki kuluttajahinnat', value: signed(m.khiYoy), note: `KHI, ${monthTxt}` }),
    c.kpiCard({ label: 'Pisteluku', value: fmt.idx(m.index), note: `Perusvuosi 2025=100, ${monthTxt}` }),
  ]);

  // Comparison table: item, its main group, all items. Contributions with 3
  // decimals in every row (as published): an item's is often below 0,01.
  const sss = h?.latest === m.month ? itemsByCode(h).get('SSS') : null;
  const contrib = (v) => c.numUnit(fmt.pp(v, { decimals: 3 }));
  const cmpRows = [
    [html`${m.name}<span class="hinnat-official"><span class="sr-only">, Tilastokeskuksen nimike: </span>${m.officialName}</span>`, c.numUnit(signed(m.yoy)), c.numUnit(signed(m.hItem?.mom)), contrib(m.hItem?.contribution)],
  ];
  if (m.group && m.group.code !== m.code) {
    cmpRows.push([html`Pääryhmä: ${groupLabel(m.group)}`, c.numUnit(signed(m.group.yoy)), c.numUnit(signed(m.group.mom)), contrib(m.group.contribution)]);
  }
  cmpRows.push({ className: 'is-total', cells: ['Kaikki kuluttajahinnat (KHI)', c.numUnit(signed(m.khiYoy)), c.numUnit(signed(sss?.mom)), contrib(sss?.contribution)] });
  const cmpTable = c.dataTable({
    id: 'vertailu-taulukko',
    caption: `${m.name} verrattuna pääryhmään ja kaikkiin kuluttajahintoihin, ${monthTxt}`,
    columns: [{ label: 'Ryhmä' }, { label: 'Vuosimuutos', num: true }, { label: 'Kuukausimuutos', num: true }, { label: 'Vaikutus inflaatioon, %-yks.', num: true }],
    rows: cmpRows,
    note: `Sija ${m.rank}/${m.peers} kallistumisjärjestyksessä niistä hyödykkeistä, joille sivustolla on oma hintasivu. Vaikutus kertoo, montako prosenttiyksikköä ryhmä nosti tai laski kuluttajahintaindeksin vuosimuutosta.`,
  });

  // Index chart (whole series) vs KHI, both 2025=100
  const kIdx = khi?.index?.['2025=100'] ?? [];
  const i0 = stats.firstIndex(m.indexSeries);
  const idxMonths = m.months.slice(i0);
  const idxItem = m.indexSeries.slice(i0);
  const idxKhi = idxMonths.map((ym) => stats.seriesAt(khi.months, kIdx, ym));
  const idxPeriod = fmt.monthRange(idxMonths[0], idxMonths.at(-1));
  const idxFormat = (v) => fmt.idx(v); // 2 decimals, as published (SPEC §6)
  const indexFigure = c.chartFigure({
    id: 'pisteluku',
    title: 'Hintaindeksi',
    subtitle: `Pisteluku, 2025=100 · ${idxPeriod}`,
    legend: c.legend([
      { cls: 's5', label: m.name },
      { cls: 'khi', label: 'Kaikki kuluttajahinnat (KHI)' },
      { cls: 'muted', label: 'Perustaso 100 (vuoden 2025 keskiarvo)' },
    ]),
    chart: svg.lineChart({
      series: [
        { values: idxItem, cls: 's5', label: m.name },
        { values: idxKhi, cls: 'khi', label: 'KHI' },
      ],
      labels: idxMonths,
      refLines: [{ value: 100, cls: 'muted' }],
      formatY: (v, step) => fmt.num(v, step >= 1 ? 0 : 1),
      formatValue: idxFormat,
      height: 300,
      ariaLabel: `${m.name}: hintaindeksi (2025=100) ${idxPeriod}, viimeisin ${fmt.idx(m.index)}; kaikkien kuluttajahintojen indeksi ${fmt.idx(idxKhi.at(-1))}.`,
    }),
    summary: `${fmt.capitalize(fmt.genitive(m.month))} pisteluku ${fmt.idx(m.index)} tarkoittaa, että ${commoditySubject(m).text} olivat ${
      fmt.round(m.index - 100, 1) === 0 ? 'samalla tasolla' : `${fmt.pct(Math.abs(m.index - 100))} ${m.index > 100 ? 'korkeammat' : 'alemmat'}`
    } kuin vuonna 2025 keskimäärin. Kaikkien kuluttajahintojen pisteluku oli ${fmt.idx(idxKhi.at(-1))}.`,
    table: c.dataTable({
      id: 'pisteluku-taulukko',
      caption: `${m.name}: pisteluku ja vuosimuutos kuukausittain (2025=100), ${idxPeriod}`,
      columns: [{ label: 'Kuukausi' }, { label: 'Pisteluku', num: true }, { label: 'Vuosimuutos', num: true }, { label: 'KHI, vuosimuutos', num: true }],
      rows: idxMonths
        .map((ym, i) => [fmt.monthShort(ym), fmt.idx(idxItem[i]), c.numUnit(fmt.pct(m.yoySeries[i0 + i])), c.numUnit(fmt.pct(stats.seriesAt(khi.months, khi.yoy, ym)))])
        .reverse(),
      visibleRows: 12,
      compact: true,
      toggleLabels: { more: `Näytä kaikki kuukaudet (${idxMonths.length})`, less: 'Näytä vain 12 viimeisintä kuukautta' },
    }),
    source: c.sourceLine({ sources: [bothSrc], updated }),
  });

  // Annual change chart (10 years) vs KHI
  const ten = stats.sliceRange(m.months, m.yoySeries, '10v');
  const tenKhi = ten.months.map((ym) => stats.seriesAt(khi.months, khi.yoy, ym));
  const tenPeriod = fmt.monthRange(ten.months[0], ten.months.at(-1));
  const tenMax = stats.max(ten.months, ten.series);
  const tenMin = stats.min(ten.months, ten.series);
  const yoyFigure = c.chartFigure({
    id: 'vuosimuutos',
    title: 'Hintojen vuosimuutos',
    subtitle: `Vuosimuutos, % · ${tenPeriod}`,
    legend: c.legend([
      { cls: 's5', label: m.name },
      { cls: 'khi', label: 'Kaikki kuluttajahinnat (KHI)' },
    ]),
    chart: svg.lineChart({
      series: [
        { values: ten.series, cls: 's5', label: m.name },
        { values: tenKhi, cls: 'khi', label: 'KHI' },
      ],
      labels: ten.months,
      refLines: [{ value: 0, cls: 'muted' }],
      height: 300,
      ariaLabel: `${m.name}: hintojen vuosimuutos ${tenPeriod}, viimeisin ${signed(m.yoy)}; kaikki kuluttajahinnat ${signed(m.khiYoy)}.`,
    }),
    summary: tenMax && tenMin
      ? `${fmt.capitalize(tenPeriod)}: suurin vuosimuutos ${signed(tenMax.value)} (${tenMax.months.map((x) => fmt.monthShort(x)).join(', ')}), pienin ${signed(tenMin.value)} (${tenMin.months.map((x) => fmt.monthShort(x)).join(', ')}). Viimeisin ${signed(m.yoy)}; kaikkien kuluttajahintojen muutos oli ${signed(m.khiYoy)}.`
      : `Viimeisin vuosimuutos ${signed(m.yoy)} (${monthTxt}).`,
    source: c.sourceLine({ sources: [bothSrc], updated }),
  });

  // Related pages: same category, then topical links
  const siblings = models.filter((o) => o.category === m.category && o.slug !== m.slug);
  const topic = RELATED_TOPICS[m.slug];
  const related = html`${siblings.length
    ? html`<h3 class="hinnat-list__title">Muut hyödykkeet: ${m.category}</h3>
<ul class="hinnat-related list-reset">${siblings.map(
      (o) => html`<li><a href="${o.path}">${o.name}</a><span class="hinnat-list__value">${c.numUnit(signed(o.yoy))}</span></li>`,
    )}</ul>`
    : ''}
<h3 class="hinnat-list__title">Katso myös</h3>
<ul class="hinnat-links">
  <li><a href="/hinnat/">Mikä inflaatiota nostaa? Pääryhmät sekä eniten kallistuneet ja halventuneet hyödykkeet</a></li>
  ${topic ? html`<li><a href="${topic.href}">${topic.label}</a></li>` : ''}
</ul>`;

  const note = c.callout({
    tone: 'note',
    title: 'Hintaindeksi, ei euromääräinen hinta',
    body: html`<p>Luvut kertovat, kuinka paljon hinnat ovat muuttuneet (Tilastokeskuksen kuluttajahintaindeksi, hyödykeryhmä ${m.coicop ?? m.code} ”${m.officialName}”). Ne eivät kerro euromääräistä hintaa.${
      topic?.href === '/polttoaineet/' ? html` Polttoaineiden euromääräiset keskihinnat ovat sivulla <a href="/polttoaineet/">polttoaineet</a>.` : ''
    }</p>`,
  });

  const main = html`${header}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--flush-top', body: html`<div class="stack-lg">${kpis}${cmpTable}</div>` })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Hintojen kehitys', intro: `${m.name} verrattuna kaikkiin kuluttajahintoihin.`, body: html`<div class="stack-lg">${yoyFigure}${indexFigure}${note}</div>` })}
${c.section({ id: 'lisaa', title: 'Lisää hintoja', body: related })}`;

  const mShort = fmt.monthShort(m.month);
  const title = fitText([
    `${m.phrase}: ${signed(m.yoy)} vuodessa (${mShort})`,
    `${m.phrase}: ${signed(m.yoy)} (${mShort})`,
    `${m.phrase} (${mShort})`,
    m.phrase,
    m.name,
  ]);
  const firstYear = fmt.yearOf(m.months[stats.firstIndex(m.indexSeries)]);
  const khiTxt = fmt.isNum(m.khiYoy) ? `, kun kaikki kuluttajahinnat ${directionWord(m.khiYoy)} ${fmt.pct(Math.abs(m.khiYoy))}` : '';
  const description = fitText(
    [
      `${m.phrase} ${fmt.inessive(m.month)}: ${signed(m.yoy)} vuodessa${khiTxt}. Kehitys kuukausittain vuodesta ${firstYear} (Tilastokeskus).`,
      `${m.phrase} ${fmt.inessive(m.month)}: ${signed(m.yoy)} vuodessa${khiTxt}. Lähde: Tilastokeskus.`,
      `${m.name} ${fmt.inessive(m.month)}: ${signed(m.yoy)} vuodessa. Lähde: Tilastokeskus.`,
    ],
    DESCRIPTION_MAX,
  );
  return {
    path: m.path,
    priority: 0.5,
    changefreq: 'monthly',
    html: ctx.layout({
      title,
      description,
      path: m.path,
      page: 'hinnat',
      breadcrumbs: ctx.crumbs(m.path, m.name),
      jsonLd: [
        datasetLd(ctx, {
          path: m.path,
          name: `${m.name}: kuluttajahintaindeksi (2025=100) ja vuosimuutos`,
          description: `Hyödykeryhmän ${m.coicop ?? m.code} ”${m.officialName}” hintaindeksi (2025=100) ja vuosimuutos kuukausittain ${idxPeriod}. Lähde: Tilastokeskus, kuluttajahintaindeksi.`,
          basedOn: src.href,
          start: idxMonths[0],
          end: m.month,
          updated,
          keywords: [m.name, 'hinta', 'inflaatio', 'kuluttajahintaindeksi'],
        }),
      ],
      main,
    }),
  };
}

/* ================================================================= module */

/** @param {any} ctx */
export default async function hinnat(ctx) {
  const h = ctx.data.hyodykkeet;
  if (!h?.items?.length) throw new Error('hinnat: data/hyodykkeet.json is missing (run npm run fetch)');
  if (!ctx.data.khi?.months) throw new Error('hinnat: data/khi.json is missing (run npm run fetch)');
  const models = commodityModels(ctx.data);
  const seen = new Set();
  for (const m of models) {
    if (seen.has(m.slug)) throw new Error(`hinnat: duplicate slug ${m.slug}`);
    seen.add(m.slug);
  }
  return [hinnatIndex(ctx, models), ...models.map((m) => commodityPage(ctx, m, models))];
}
