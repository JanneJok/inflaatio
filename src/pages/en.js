/**
 * /en/ – short English landing page for people living in Finland
 * (module en, owner EXTRAS; PROD-25).
 *
 * Latest CPI (KHI) and HICP (YKHI) with their months and sources, a 25-month
 * chart with a text alternative, three short explanations (what the indices
 * measure, why they differ, where rent index clauses come from) and links to
 * the English calculators /en/rent-increase-calculator/ and /en/value-of-money/
 * (built by the calculator module). hreflang pairs with the Finnish home page.
 *
 * Numbers are formatted in English here (decimal point, "2.2%", "+0.1 pp");
 * the site-wide format.js stays Finnish.
 */
import { isNum, isoDate, parseYm, MINUS } from '../js/lib/format.js';

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DASH = '–';

/** 'August 2026' @param {string} ym 'YYYY-MM' */
export function enMonth(ym) {
  const { y, m } = parseYm(ym);
  return `${EN_MONTHS[m - 1]} ${y}`;
}

/** 'Aug 2026' (or 'Aug' with year: false) @param {string} ym */
export function enMonthShort(ym, { year = true } = {}) {
  const { y, m } = parseYm(ym);
  const name = EN_MONTHS[m - 1].slice(0, 3);
  return year ? `${name} ${y}` : name;
}

/**
 * English number: decimal point, thousands comma, U+2212 minus; '–' when missing.
 * @param {number|null|undefined} v
 * @param {number} [decimals=1]
 * @param {{sign?: boolean}} [o] '+' for positive values
 */
export function enNum(v, decimals = 1, { sign = false } = {}) {
  if (!isNum(v)) return DASH;
  const r = Number(v.toFixed(decimals));
  const body = new Intl.NumberFormat('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(r));
  if (r < 0) return `${MINUS}${body}`;
  return sign && r > 0 ? `+${body}` : body;
}

/** '2.2%', '−0.2%', '+0.4%' (sign) @param {number|null|undefined} v */
export function enPct(v, { decimals = 1, sign = false } = {}) {
  const s = enNum(v, decimals, { sign });
  return s === DASH ? DASH : `${s}%`;
}

/** Percentage points: '+0.1 pp', '−0.3 pp', '±0.0 pp'. @param {number|null|undefined} v */
export function enPp(v, { decimals = 1 } = {}) {
  if (!isNum(v)) return DASH;
  const r = Number(v.toFixed(decimals));
  return r === 0 ? `±${enNum(0, decimals)} pp` : `${enNum(r, decimals, { sign: true })} pp`;
}

/** '14 September 2026' (Helsinki calendar date) @param {string|number|Date} v */
export function enDate(v) {
  const iso = isoDate(v);
  if (!iso) return DASH;
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/**
 * "Consumer prices were 2.2% higher in August 2026 than a year earlier".
 * @param {number} yoy
 * @param {string} ym
 */
export function enLevelSentence(yoy, ym) {
  if (yoy > 0) return `Consumer prices in Finland were ${enPct(yoy)} higher in ${enMonth(ym)} than a year earlier`;
  if (yoy < 0) return `Consumer prices in Finland were ${enPct(Math.abs(yoy))} lower in ${enMonth(ym)} than a year earlier`;
  return `Consumer prices in Finland were at the same level in ${enMonth(ym)} as a year earlier`;
}

/**
 * "Inflation accelerated from 2.1% in July." (difference of annual rates).
 * @param {number|null} delta %-points, rounded
 * @param {number|null} prevYoy
 * @param {string|null} prevMonth
 */
export function enDeltaSentence(delta, prevYoy, prevMonth) {
  if (!isNum(delta) || !isNum(prevYoy) || !prevMonth) return '';
  const when = enMonth(prevMonth);
  if (delta > 0) return `Inflation accelerated from ${enPct(prevYoy)} in ${when}.`;
  if (delta < 0) return `Inflation slowed from ${enPct(prevYoy)} in ${when}.`;
  return `Inflation was unchanged from ${when}.`;
}

/** @param {any} ctx */
export default async function en(ctx) {
  const { html, svg, stats, c } = ctx;
  const path = '/en/';
  const L = ctx.latest;
  const k = L.khi;
  const d = ctx.data;
  if (!k || !isNum(k.yoy) || !d.khi?.months?.length) throw new Error('en: data/khi.json is missing (run npm run fetch)');
  const y = L.ykhi && isNum(L.ykhi.yoy) ? L.ykhi : null;
  const ea = L.ea && isNum(L.ea.yoy) ? L.ea : null;
  const eki = L.elinkustannusindeksi;
  const next = L.nextRelease?.khi;

  const title = `Inflation in Finland: ${enPct(k.yoy)} (${enMonth(k.month)})`;
  const hicpText = y
    ? ` The EU-harmonised index (HICP) published by Eurostat was ${enPct(y.yoy)} in ${enMonth(y.month)}${y.provisional ? ' (flash estimate)' : ''}${
        ea && ea.month === y.month ? `, compared with ${enPct(ea.yoy)} in the euro area` : ''
      }.`
    : '';
  const lede = `${enLevelSentence(k.yoy, k.month)}, according to the consumer price index (CPI) of Statistics Finland. ${enDeltaSentence(k.delta, k.prevYoy, k.prevMonth)}${hicpText}`;

  // ------------------------------------------------------------- KPI cards
  const cards = [
    c.kpiCard({ label: 'CPI, Finland', value: enPct(k.yoy), note: `${enMonth(k.month)} · Statistics Finland`, headingLevel: 3 }),
    y && c.kpiCard({ label: 'HICP, Finland', value: enPct(y.yoy), note: `${enMonth(y.month)} · Eurostat${y.provisional ? ' · flash estimate' : ''}`, headingLevel: 3 }),
    ea && c.kpiCard({ label: 'HICP, euro area', value: enPct(ea.yoy), note: `${enMonth(ea.month)} · Eurostat${ea.provisional ? ' · flash estimate' : ''}`, headingLevel: 3 }),
    eki && c.kpiCard({ label: 'Cost-of-living index', value: enNum(eki.value, 0), note: `${enMonth(eki.month)} · ${eki.base.replace('=', ' = ')}`, headingLevel: 3 }),
  ].filter(Boolean);

  // ------------------------------------------------------------------ chart
  const i = d.khi.months.indexOf(k.month);
  const from = Math.max(0, i - 24);
  const months = d.khi.months.slice(from, i + 1);
  const khiSeries = d.khi.yoy.slice(from, i + 1);
  const fi = d.ykhi?.geo?.FI;
  const ykhiSeries = fi?.yoy ? months.map((ym) => stats.seriesAt(d.ykhi.months, fi.yoy, ym)) : null;
  const period = `${enMonthShort(months[0])} – ${enMonthShort(months.at(-1))}`;
  const series = [{ values: khiSeries, cls: 'khi', label: 'CPI' }];
  if (ykhiSeries?.some(isNum)) series.push({ values: ykhiSeries, cls: 'ykhi', label: 'HICP' });
  const xTicks = svg.monthTicks(months).map((t) => {
    const { m } = parseYm(months[t.index]);
    return { ...t, text: m === 1 ? String(parseYm(months[t.index]).y) : enMonthShort(months[t.index], { year: false }) };
  });
  const lastYkhi = ykhiSeries ? ykhiSeries.at(-1) : null;
  const chart = svg.lineChart({
    series,
    labels: months,
    refLines: [{ value: 2, cls: 'target' }],
    height: 280,
    xTicks,
    formatY: (v, step) => `${enNum(v, step < 1 ? 1 : 0)}%`,
    formatValue: (v) => enPct(v),
    ariaLabel: `Annual inflation in Finland, ${period}: CPI ${enPct(k.yoy)}${isNum(lastYkhi) ? ` and HICP ${enPct(lastYkhi)}` : ''} in ${enMonth(k.month)}. Dashed line: ECB target 2%.`,
  });
  const table = c.dataTable({
    id: 'en-table',
    caption: `Annual inflation by month, ${period}`,
    columns: [{ label: 'Month' }, { label: 'CPI', num: true }, ...(series.length > 1 ? [{ label: 'HICP', num: true }] : [])],
    rows: months
      .map((ym, j) => [enMonth(ym), enPct(khiSeries[j]), ...(series.length > 1 ? [enPct(ykhiSeries[j])] : [])])
      .reverse(),
    compact: true,
  });
  const range = stats.max(months, khiSeries);
  const figure = c.chartFigure({
    id: 'en-chart',
    title: 'Inflation over the past two years',
    subtitle: 'Annual change, %',
    legend: c.legend([
      { cls: 'khi', label: 'CPI (Statistics Finland)' },
      ...(series.length > 1 ? [{ cls: 'ykhi', label: 'HICP (Eurostat)' }] : []),
      { cls: 'target', label: 'ECB target 2%', dashed: true },
    ]),
    chart,
    summary: `CPI inflation was ${enPct(k.yoy)} in ${enMonth(k.month)}. Over ${period} it was highest at ${enPct(range?.value)} (${range?.months.map((m) => enMonthShort(m)).join(', ')}).`,
    table,
    tableLabel: 'Show the figures as a table',
    source: html`<p class="source-line">Sources: <a href="https://stat.fi/en/statistics/khi" hreflang="en">Statistics Finland</a> (consumer price index), <a href="https://ec.europa.eu/eurostat/web/hicp" hreflang="en">Eurostat</a> (HICP)${
      k.updated ? html` · Updated <time datetime="${isoDate(k.updated)}">${enDate(k.updated)}</time>` : ''
    }</p>`,
  });

  // ------------------------------------------------------------ explainers
  const explain = html`<div class="prose">
  <h3>What do the CPI and HICP measure?</h3>
  <p>The <strong>consumer price index</strong> (<span lang="fi">kuluttajahintaindeksi</span>, KHI) of Statistics Finland is the official measure of inflation in Finland. It follows the prices of the goods and services that households buy, and the annual change is published around the middle of the following month. The index also covers the costs of owner-occupied housing, such as interest on housing loans, so changes in interest rates move it.</p>
  <p>The <strong>harmonised index of consumer prices</strong> (<span lang="fi">yhdenmukaistettu kuluttajahintaindeksi</span>, YKHI; HICP in English) is calculated in the same way in every EU country, which makes it the right measure for comparing Finland with other countries. It leaves out owner-occupied housing costs, so it can differ from the CPI. The European Central Bank's 2% inflation target refers to the HICP of the euro area. Eurostat publishes a flash estimate at the end of the month and the final figure around the middle of the following month.</p>
  <h3>Rent increases and index clauses</h3>
  <p>Many Finnish rental agreements tie the annual rent increase to the <strong>cost-of-living index</strong> (<span lang="fi">elinkustannusindeksi</span>, 1951:10 = 100), which Statistics Finland derives from the consumer price index.${
    eki ? ` Its latest point figure is ${enNum(eki.value, 0)} (${enMonth(eki.month)}).` : ''
  } A typical clause compares the point figure of a later month with that of the contract's base month and raises the rent by the same percentage; some contracts add a minimum increase. Always check the exact wording of your own contract.</p>
</div>`;

  const tools = c.cardGrid([
    { href: '/en/rent-increase-calculator/', eyebrow: 'Calculator', title: 'Rent increase calculator', text: 'Your new rent with the cost-of-living index (1951:10 = 100).', meta: 'Calculate' },
    { href: '/en/value-of-money/', eyebrow: 'Calculator', title: 'Value of money', text: 'What a sum of euros (or markkaa) from an earlier year is worth today.', meta: 'Calculate' },
    { href: '/', eyebrow: 'Suomeksi', title: 'Inflaatio Suomessa', text: 'The full Finnish site: history, prices by product group, comparisons and more.', meta: 'Open', lang: 'fi' },
  ]);

  const releaseNote = next
    ? html`Next CPI release <time datetime="${next.date}">${enDate(next.date)}</time> (${enMonth(next.period)} figures) · `
    : '';
  const main = html`${c.pageHeader({
    eyebrow: `Inflation in Finland · ${enMonth(k.month)}`,
    title,
    lede,
    meta: html`${k.updated ? html`Updated <time datetime="${isoDate(k.updated)}">${enDate(k.updated)}</time> · ` : ''}${releaseNote}Sources: Statistics Finland, Eurostat`,
  })}
${c.section({ id: 'figures', title: 'Latest figures', intro: 'Annual change in consumer prices and the latest cost-of-living index point figure.', body: c.kpiGrid(cards) })}
${c.section({ id: 'trend', title: 'Trend', body: figure })}
${c.section({ id: 'explained', title: 'The figures explained', body: explain })}
${c.section({ id: 'tools', title: 'Calculators in English', intro: 'The rest of Inflaatio.fi is in Finnish.', body: tools })}`;

  const description = `Inflation in Finland was ${enPct(k.yoy)} in ${enMonth(k.month)} (CPI, Statistics Finland)${y ? `; HICP ${enPct(y.yoy)}` : ''}. Latest figures, trend and rent index clauses explained.`;

  return [
    {
      path,
      changefreq: 'monthly',
      html: ctx.layout({
        title,
        description,
        path,
        lang: 'en',
        alternates: [
          { hreflang: 'fi', href: '/' },
          { hreflang: 'x-default', href: '/' },
        ],
        page: 'en',
        ogTitle: title,
        ogImage: { alt: `Inflation in Finland ${enPct(k.yoy)} in ${enMonth(k.month)} (consumer price index, Statistics Finland)` },
        breadcrumbs: [
          { name: ctx.site.brand, href: '/' },
          { name: 'In English', href: path },
        ],
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: title,
            description,
            url: `${ctx.baseUrl}${path}`,
            inLanguage: 'en',
            dateModified: L.dataUpdated ?? undefined,
            isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
            about: { '@type': 'Thing', name: 'Inflation in Finland' },
          },
        ],
        main,
      }),
    },
  ];
}
