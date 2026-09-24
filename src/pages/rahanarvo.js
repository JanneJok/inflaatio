/**
 * /rahanarvo/ – value of money calculator + "Säästöt ja inflaatio" (owner CALC).
 *
 * Official series only (src/js/lib/calc.js pickMoneySeries): KHI 1972=100
 * (monthly 11xs, annual averages 11xt) from 1972, elinkustannusindeksi
 * 1938:8–1939:7=100 monthly from 8/1939, 1951:10=100 annual 1952–1971 and
 * 1914:1–6=100 annual from 1860 (annual calculation, labelled). Optionally
 * Finland's HICP (YKHI, Eurostat, monthly from 1996). Markka amounts are
 * converted at 5,94573 mk/€ (old markka before 1963 = 1/100).
 *
 * Server-rendered: default result (100 € 1/2000 → latest month), an SVG chart
 * of the path with a data table, a table of selected years and the two savings
 * calculators with their default results. src/js/pages/rahanarvo.js
 * recalculates, swaps in an interactive Chart.js chart and keeps the inputs in
 * the URL. `moneyCalculator(ctx, { lang })`, `yearsTable()` and
 * `savingsSection(ctx, { lang })` are reused by /en/value-of-money/.
 */
import { html } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import {
  buildSeries,
  pickMoneySeries,
  valueOfMoney,
  moneyPath,
  moneyView,
  savingsReal,
  savingsView,
  latestPeriod,
  periodYear,
  formatter,
  fromEuros,
  isYkhi,
  MONEY_FAMILIES,
  MONEY_SERIES_IDS,
  CURRENCY_REFORM_YEAR,
  EURO_CASH_YEAR,
} from '../js/lib/calc.js';
import { monthYearField, out, calcJsonLd, messageData, noJsNote, calculatorCards, calcCrumbs, ablative } from './laskurit.js';

export const PATH = '/rahanarvo/';
export const PATH_EN = '/en/value-of-money/';
/** Default inputs (examples, not statistics). */
const DEFAULT_AMOUNT = 100;
const DEFAULT_FROM = '2000-01';
const SAVINGS_AMOUNT = 10000;
const SAVINGS_YEARS = 5;

const T = {
  fi: {
    amount: 'Summa',
    amountHint: 'Esimerkiksi 100 tai 2 500,50.',
    currency: 'Valuutta',
    currencyOptions: [
      { value: 'eur', label: 'Euroa (€)' },
      { value: 'mk', label: 'Markkaa (mk), ennen vuotta 2002' },
    ],
    currencyHint: 'Markat muunnetaan euroiksi kurssilla 5,94573. Ennen vuotta 1963 käytössä olivat vanhat markat (100 vanhaa markkaa = 1 uusi markka).',
    index: 'Hintaindeksi',
    indexOptions: (ykhiStart) => [
      { value: 'khi', label: 'Kuluttajahintaindeksi (Tilastokeskus)' },
      { value: 'ykhi', label: `Yhdenmukaistettu kuluttajahintaindeksi, YKHI (Eurostat, vuodesta ${periodYear(ykhiStart)})` },
    ],
    indexHint: 'Oletuksena kuluttajahintaindeksi ja sitä vanhemmat elinkustannusindeksit. YKHI on EU-maiden kesken vertailukelpoinen mittari; sillä voi verrata vain kuukausia.',
    from: 'Ajankohta, jolloin summa oli käytössä',
    fromHint: (first) => `Valitse kuukausi tai koko vuosi (vuoden keskiarvo). Laskuri kattaa ajan vuodesta ${first} lähtien.`,
    to: 'Ajankohta, johon verrataan',
    toHint: 'Oletuksena uusin julkaistu kuukausi.',
    presets: 'Pikavalinnat',
    presetList: (latest) => [
      { label: 'Eurokäteinen käyttöön (1/2002)', value: '2002-01' },
      { label: 'Ennen inflaatiopiikkiä (1/2021)', value: '2021-01' },
      { label: '10 vuotta sitten', value: fmt.ymAdd(latest, -120) },
      { label: 'Vuosi sitten', value: fmt.ymAdd(latest, -12) },
    ],
    submit: 'Laske rahan arvo',
    resultTitle: 'Rahan arvo',
    facts: { series: 'Indeksi', points: 'Pisteluvut', factor: 'Kerroin' },
    formula: 'Laskelma',
    share: 'Kopioi linkki laskelmaan',
    print: 'Tulosta',
    errorBox: 'Tulosta ei voi laskea. Korjaa merkityt kentät.',
    noJs: 'Alla on esimerkkilaskelma (100 € tammikuusta 2000 uusimpaan kuukauteen) ja taulukko eri vuosista. Voit laskea itse: summa × uusi pisteluku / vanha pisteluku.',
  },
  en: {
    amount: 'Amount',
    amountHint: 'For example 100 or 2,500.50.',
    currency: 'Currency',
    currencyOptions: [
      { value: 'eur', label: 'Euros (€)' },
      { value: 'mk', label: 'Finnish markka (mk), before 2002' },
    ],
    currencyHint: 'Markka amounts are converted at 5.94573 markka per euro. Before 1963 the old markka was in use (100 old markka = 1 new markka).',
    index: 'Price index',
    indexOptions: (ykhiStart) => [
      { value: 'khi', label: 'Consumer price index (Statistics Finland)' },
      { value: 'ykhi', label: `Harmonised index of consumer prices, HICP (Eurostat, from ${periodYear(ykhiStart)})` },
    ],
    indexHint: 'By default the consumer price index and, before it, the cost-of-living indices. The HICP is comparable across EU countries; it compares months only.',
    from: 'When the money was used',
    fromHint: (first) => `Choose a month or a whole year (annual average). The calculator goes back to ${first}.`,
    to: 'Compare with',
    toHint: 'By default the latest published month.',
    presets: 'Quick choices',
    presetList: (latest) => [
      { label: 'Euro cash (1/2002)', value: '2002-01' },
      { label: 'Before the inflation spike (1/2021)', value: '2021-01' },
      { label: '10 years ago', value: fmt.ymAdd(latest, -120) },
      { label: 'A year ago', value: fmt.ymAdd(latest, -12) },
    ],
    submit: 'Calculate',
    resultTitle: 'Value of money',
    facts: { series: 'Index', points: 'Point figures', factor: 'Factor' },
    formula: 'Calculation',
    share: 'Copy link to this calculation',
    print: 'Print',
    errorBox: 'The result cannot be calculated. Please correct the marked fields.',
    noJs: 'Below is a worked example (€100 from January 2000 to the latest month) and a table of selected years. You can calculate it yourself: amount × new point figure / old point figure.',
  },
};

const MESSAGES = {
  fi: {
    amount: 'Anna summa numerona, esimerkiksi 100 tai 2 500,50.',
    future: 'Lukua ei ole vielä julkaistu ajankohdalle {aika}. Uusin kuukausi on {viimeisin} ja uusin vuosikeskiarvo vuodelta {vuosi}.',
    futureYkhi: 'YKHI-lukua ei ole vielä julkaistu ajankohdalle {aika}. Uusin kuukausi on {viimeisin}.',
    before: 'Laskuri kattaa ajan vuodesta {alku} lähtien.',
    beforeYkhi: 'YKHI-luvut alkavat {alku}. Valitse myöhempi kuukausi tai kuluttajahintaindeksi.',
    ykhiYear: 'YKHI:llä voi verrata vain kuukausia. Valitse kuukausi tai kuluttajahintaindeksi.',
    markka: 'Markkoja voi käyttää vain, kun ajankohta on ennen vuotta 2002.',
    order: 'Loppukuukauden pitää olla alkukuukauden jälkeen.',
    beforeMonthly: 'Säästölaskuri kattaa kuukaudet elokuusta 1939 lähtien.',
    rate: 'Anna korko prosentteina, esimerkiksi 0, 2 tai 2,5.',
    years: 'Anna aika vuosina väliltä 1–50.',
    inflation: 'Anna oletettu inflaatio prosentteina (−10 ja 30 väliltä), esimerkiksi 2.',
  },
  en: {
    amount: 'Enter the amount as a number, for example 100 or 2,500.50.',
    future: 'No figure has been published for {aika} yet. The latest month is {viimeisin} and the latest annual average is for {vuosi}.',
    futureYkhi: 'No HICP figure has been published for {aika} yet. The latest month is {viimeisin}.',
    before: 'The calculator goes back to {alku}.',
    beforeYkhi: 'The HICP starts in {alku}. Choose a later month or the consumer price index.',
    ykhiYear: 'The HICP compares months only. Choose a month or the consumer price index.',
    markka: 'Markka can only be used for dates before 2002.',
    order: 'The end month must be after the start month.',
    beforeMonthly: 'The savings calculator goes back to August 1939.',
    rate: 'Enter the interest rate as a percentage, for example 0, 2 or 2.5.',
    years: 'Enter a period of 1–50 years.',
    inflation: 'Enter the assumed inflation as a percentage between −10 and 30, for example 2.',
  },
};

const PARAMS = {
  fi: { amount: 'summa', currency: 'valuutta', index: 'indeksi', from: 'alku', to: 'loppu' },
  en: { amount: 'amount', currency: 'currency', index: 'index', from: 'from', to: 'to' },
};

/** Query parameters of the savings calculators. */
const SAVINGS_PARAMS = {
  fi: { hAmount: 'hsumma', hFrom: 'halku', hTo: 'hloppu', hRate: 'hkorko', eAmount: 'esumma', eYears: 'evuodet', eRate: 'ekorko', eInflation: 'einfl' },
  en: { hAmount: 'hamount', hFrom: 'hfrom', hTo: 'hto', hRate: 'hrate', eAmount: 'eamount', eYears: 'eyears', eRate: 'erate', eInflation: 'einfl' },
};

/**
 * Value-of-money calculation for a from/to pair (throws on invalid defaults).
 * @param {object[]} list buildSeries(…, MONEY_SERIES_IDS)
 */
function compute(list, amount, from, to) {
  const pick = pickMoneySeries(list, from, to);
  if ('error' in pick) throw new Error(`rahanarvo: default calculation failed (${pick.error})`);
  const v = valueOfMoney({ amount, fromIdx: pick.fromIdx, toIdx: pick.toIdx });
  return { pick, ...v };
}

/**
 * The series of the value-of-money calculator: the KHI chain (MONEY_SERIES_IDS)
 * and, when available, Finland's HICP (YKHI) with the newest base.
 * @param {any} data ctx.data
 */
export function moneySeries(data) {
  const list = buildSeries(data, { ids: MONEY_SERIES_IDS });
  const ykhi = buildSeries({ ykhi: data?.ykhi }).find((s) => isYkhi(s.id)) ?? null;
  return { list: ykhi ? [...list, ykhi] : list, ykhi };
}

/**
 * Year tick for monthly or annual labels: about eight evenly spaced years.
 * @param {string} l label ('YYYY-MM' or 'YYYY')
 * @param {number} i
 * @param {string[]} labels
 */
function yearTick(l, i, labels) {
  const first = Number(labels[0].slice(0, 4));
  const last = Number(labels.at(-1).slice(0, 4));
  const step = [1, 2, 5, 10, 20, 25, 50].find((s) => (last - first) / s <= 8) ?? 50;
  const y = Number(l.slice(0, 4));
  const isJan = l.length === 4 || l.endsWith('-01');
  return isJan && y % step === 0 ? String(y) : null;
}

/**
 * Chart figure of a money path (SVG fallback + Chart.js container + table).
 * The summary is not a live region: the result panel above announces the
 * same sentence (one announcement per recalculation).
 * @param {any} ctx
 * @param {{path: {kind: string, labels: string[], values: number[]}, lang: 'fi'|'en', summary: string, id: string, title: string, sources: any}} o
 */
function pathFigure(ctx, { path, lang, summary, id, title, sources }) {
  const { c, svg } = ctx;
  const F = formatter(lang);
  const monthly = path.kind === 'month';
  // Table: every January (or every year) and the last point, newest first.
  const rows = path.labels
    .map((p, i) => ({ p, v: path.values[i], i }))
    .filter((r) => !monthly || r.p.endsWith('-01') || r.i === path.labels.length - 1)
    .reverse()
    .map((r) => [monthly ? F.period(r.p) : r.p, F.eur(r.v)]);
  const table = c.dataTable({
    id: `${id}-taulukko`,
    caption: title,
    columns: [{ label: lang === 'en' ? 'Period' : 'Ajankohta' }, { label: lang === 'en' ? 'Amount' : 'Summa', num: true }],
    rows,
    compact: true,
  });
  const chart = svg.lineChart({
    series: [{ values: path.values, cls: 'khi', label: lang === 'en' ? 'Value' : 'Rahan arvo', formatValue: (v) => F.eur(v, v >= 1000 ? 0 : 2) }],
    labels: path.labels,
    // Finnish month ticks from svg.js; English (and annual) paths label years only.
    xTicks: monthly && lang === 'fi' ? 'auto' : (l, i) => yearTick(l, i, path.labels),
    formatY: (v, step) => (lang === 'en' ? `€${F.num(v, step < 1 ? 2 : 0)}` : `${F.num(v, step < 1 ? 2 : 0)}${fmt.NBSP}€`),
    height: 280,
    ariaLabel: summary,
  });
  return c.chartFigure({
    id,
    title,
    subtitle: lang === 'en' ? 'Amount with the same purchasing power, €' : 'Samaa ostovoimaa vastaava summa, €',
    legend: c.legend([{ cls: 'khi', label: lang === 'en' ? 'Value of the amount' : 'Summan arvo' }]),
    chart: html`<div class="raha-chart" id="${id}-alue"><div data-chart-fallback>${chart}</div><div class="chart-canvas" data-chart="${id}" data-label="${summary}" hidden></div></div>`,
    summary: html`${out('chartSummary', summary)}`,
    table,
    tableLabel: lang === 'en' ? 'Show the figures as a table' : 'Näytä luvut taulukkona',
    source: sources,
    actions: c.button({ label: lang === 'en' ? 'Download image' : 'Lataa kuva', icon: 'download', size: 'sm', className: 'js-only', attrs: { data: { chartDownload: id } } }),
    className: 'raha-figure',
  });
}

/**
 * The value-of-money calculator (form, result, chart, data island).
 * @param {any} ctx
 * @param {{lang?: 'fi'|'en'}} [o]
 */
export function moneyCalculator(ctx, { lang = 'fi' } = {}) {
  const { c } = ctx;
  const t = T[lang];
  const F = formatter(lang);
  const { list, ykhi } = moneySeries(ctx.data);
  // The KHI chain decides the default and the newest month (a YKHI month can
  // be published before the KHI of the same month).
  const chain = list.filter((s) => MONEY_FAMILIES.includes(s.family));
  const latestMonth = chain.filter((s) => s.kind === 'month').map(latestPeriod).sort().at(-1);
  if (!latestMonth) throw new Error('rahanarvo: no index series in data (run npm run fetch)');
  const firstYear = Math.min(...chain.map((s) => periodYear(s.start)));
  const from = DEFAULT_FROM;
  const to = latestMonth;
  const d = compute(list, DEFAULT_AMOUNT, from, to);
  const view = moneyView({ amount: DEFAULT_AMOUNT, currency: 'eur', pick: d.pick, value: d.value, factor: d.factor }, lang);
  const path = moneyPath(list, d.pick, DEFAULT_AMOUNT);
  const decimalAttrs = { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' };
  const maxYear = periodYear(latestMonth);
  const presets = t.presetList(latestMonth);
  const ykhiLatest = ykhi ? latestPeriod(ykhi) : null;
  const messages = {
    ...MESSAGES[lang],
    beforeYkhi: ykhi ? MESSAGES[lang].beforeYkhi.replace('{alku}', lang === 'en' ? F.period(ykhi.start) : fmt.elative(ykhi.start)) : '',
  };

  const form = html`<form class="calc__form form js-only" id="raha-lomake" novalidate${ctx.attrs({ data: { lang, ...messageData(messages) } })}>
  <div class="calc__grid">
    ${c.field({ id: 'summa', label: t.amount, value: String(DEFAULT_AMOUNT), hint: t.amountHint, required: true, attrs: decimalAttrs })}
    ${c.field({ id: 'valuutta', label: t.currency, as: 'select', value: 'eur', options: t.currencyOptions })}
  </div>
  <p class="field__hint">${t.currencyHint}</p>
  ${monthYearField({ id: 'alku', legend: t.from, value: from, minYear: firstYear, maxYear, hint: t.fromHint(firstYear), allowYear: true, lang })}
  <div class="raha-presets js-only" role="group" aria-label="${t.presets}">
    <span class="raha-presets__label" aria-hidden="true">${t.presets}:</span>
    ${presets.map((p) => c.button({ label: p.label, size: 'sm', variant: 'ghost', attrs: { data: { preset: p.value } } }))}
  </div>
  ${monthYearField({ id: 'loppu', legend: t.to, value: to, minYear: firstYear, maxYear, hint: t.toHint, allowYear: true, lang })}
  ${ykhi ? c.field({ id: 'indeksi', label: t.index, as: 'select', value: 'khi', hint: t.indexHint, options: t.indexOptions(ykhi.start) }) : ''}
  <div class="calc__submit js-only">${c.button({ label: t.submit, variant: 'primary', type: 'submit' })}</div>
</form>`;

  const result = html`<div class="calc__result" id="raha-tulos" role="region" aria-labelledby="raha-tulos-otsikko">
  <h3 class="calc__result-title" id="raha-tulos-otsikko">${t.resultTitle}</h3>
  <div data-result-ok>
    <div class="calc__live" aria-live="polite" aria-atomic="true">
      <p class="calc__big">${out('value', view.value)}</p>
      ${out('sentence', view.sentence, 'p', { class: 'calc__lead' })}
    </div>
    ${out('change', view.change, 'p', { class: 'calc__lead' })}
    ${out('buys', view.buys, 'p', { class: 'calc__lead', hidden: !view.buys })}
    ${out('note', view.note, 'p', { class: 'calc__rule', hidden: !view.note })}
    <dl class="calc__facts">
      <div><dt>${t.facts.series}</dt><dd>${out('seriesName', view.seriesName)}</dd></div>
      <div><dt>${t.facts.points}</dt><dd>${out('points', view.points)}</dd></div>
      <div><dt>${t.facts.factor}</dt><dd>${out('factor', view.factor)}</dd></div>
    </dl>
    <p class="calc__formula"><span class="calc__formula-label">${t.formula}</span>${out('basis', view.basis, 'code')}</p>
    <div class="calc__actions">
      ${c.shareButton({ label: t.share, size: 'sm', track: 'result_shared' })}
      ${c.button({ label: t.print, size: 'sm', variant: 'ghost', className: 'js-only', attrs: { data: { print: '' } } })}
    </div>
  </div>
  <p class="calc__error" data-result-error hidden role="alert">${t.errorBox}</p>
</div>`;

  const summary = `${view.sentence} ${view.change}`;
  const updated = ctx.latest.khi?.updated;
  const sources = lang === 'en'
    ? [
        { name: 'Statistics Finland', href: 'https://stat.fi/en/statistics/khi', detail: 'consumer price index, cost-of-living index' },
        ...(ykhi ? [{ name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'HICP, when chosen' }] : []),
      ]
    : [
        { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi, elinkustannusindeksi' },
        ...(ykhi ? [{ name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'YKHI, kun se on valittu' }] : []),
      ];
  const figure = pathFigure(ctx, {
    path,
    lang,
    summary,
    id: 'raha-kaavio',
    title: lang === 'en' ? 'Value of the amount over time' : 'Summan arvo ajan mittaan',
    sources: c.sourceLine({ sources, updated, lang }),
  });

  const island = ctx.jsonScript('raha-data', {
    lang,
    params: PARAMS[lang],
    defaults: { amount: DEFAULT_AMOUNT, currency: 'eur', index: 'khi', from, to },
    firstYear,
    latestMonth,
    latestYear: chain.filter((s) => s.kind === 'year').map(latestPeriod).sort().at(-1),
    families: { khi: MONEY_FAMILIES, ykhi: ykhi ? [ykhi.family] : [] },
    ykhi: ykhi ? { start: ykhi.start, latest: ykhiLatest } : null,
    series: list.map((s) => ({ id: s.id, family: s.family, kind: s.kind, decimals: s.decimals, start: s.start, values: s.values, ...(s.provisional?.length ? { provisional: s.provisional } : {}) })),
    chart: {
      title: lang === 'en' ? 'Value of money' : 'Rahan arvo',
      source: lang === 'en' ? 'Source: Statistics Finland · inflaatio.fi' : 'Lähde: Tilastokeskus · inflaatio.fi',
      sourceYkhi: lang === 'en' ? 'Source: Eurostat (HICP) · inflaatio.fi' : 'Lähde: Eurostat (YKHI) · inflaatio.fi',
    },
  });

  const calculator = html`${noJsNote(c, t.noJs, lang)}
<div class="calc" id="raha-laskuri">${form}${result}</div>
${figure}
${island}`;
  return { calculator, d, view, list, latestMonth, from, to };
}

/**
 * Table "what 100 € / 100 mk of year X is worth in the latest month".
 * @param {any} ctx
 * @param {object[]} list
 * @param {string} latestMonth
 * @param {'fi'|'en'} [lang='fi']
 */
export function yearsTable(ctx, list, latestMonth, lang = 'fi') {
  const { c } = ctx;
  const F = formatter(lang);
  const annual = list.find((s) => s.id === 'khi-1972-v');
  const lastYear = annual ? Number(latestPeriod(annual)) : periodYear(latestMonth) - 1;
  const years = new Set([EURO_CASH_YEAR]);
  for (let y = 1955; y <= lastYear; y += 5) years.add(y);
  for (let y = lastYear - 4; y <= lastYear; y++) years.add(y);
  const rows = [...years]
    .sort((a, b) => b - a)
    .map((y) => {
      const pick = pickMoneySeries(list, String(y), latestMonth);
      if ('error' in pick || pick.annualFallback) return null;
      const factor = pick.toIdx / pick.fromIdx;
      const markka = y < EURO_CASH_YEAR ? fromEuros(1, 'mk', y) : null;
      const mkNow = markka ? (100 / markka) * factor : null;
      return [
        String(y),
        F.eur(100 * factor),
        mkNow == null ? fmt.DASH : `${F.eur(mkNow)}${y < CURRENCY_REFORM_YEAR ? '*' : ''}`,
        F.pct((factor - 1) * 100, { decimals: factor < 2 ? 1 : 0 }),
      ];
    })
    .filter(Boolean);
  const caption = lang === 'en'
    ? `What €100 or 100 markka of each year is worth in ${F.period(latestMonth)}`
    : `Mitä 100 € tai 100 mk vastaa ${fmt.inessive(latestMonth)}`;
  return c.dataTable({
    id: 'raha-vuodet',
    caption,
    columns: [
      { label: lang === 'en' ? 'Year' : 'Vuosi' },
      { label: lang === 'en' ? '€100 then' : '100 € silloin', num: true },
      { label: lang === 'en' ? '100 mk then' : '100 mk silloin', num: true },
      { label: lang === 'en' ? 'Price change' : 'Hinnat nousseet', num: true },
    ],
    rows,
    visibleRows: 10,
    toggleLabels: lang === 'en' ? { more: `Show all years (${rows.length})`, less: 'Show the 10 most recent years' } : { more: `Näytä kaikki vuodet (${rows.length})`, less: 'Näytä vain 10 uusinta vuotta' },
    note: lang === 'en'
      ? `Annual average of the year compared with ${F.period(latestMonth)}: consumer price index 1972=100 (Statistics Finland, tables 11xt and 11xs); before 1972 cost-of-living index 1951:10=100. Markka converted at 5.94573. * Old markka (before 1963): 100 old mk = 1 new mk.`
      : `Vuoden keskiarvo verrattuna ${fmt.genitive(latestMonth)} pistelukuun: kuluttajahintaindeksi 1972=100 (Tilastokeskus, taulukot 11xt ja 11xs), ennen vuotta 1972 elinkustannusindeksi 1951:10=100. Markat muunnettu kurssilla 5,94573. * Vanhoja markkoja (ennen vuotta 1963): 100 vanhaa mk = 1 uusi mk.`,
    compact: true,
  });
}

/** Texts of the savings calculators. */
const S = {
  fi: {
    histTitle: 'Mitä säästöille on käynyt?',
    histIntro: 'Laske, paljonko säästöjen ostovoima on muuttunut, kun tilin korko ja toteutunut inflaatio otetaan huomioon.',
    fcTitle: 'Mitä säästöille käy?',
    fcIntro: 'Arvioi säästöjen todellinen tuotto tulevaisuudessa oletetulla korolla ja inflaatiolla (Fisherin kaava).',
    hAmount: 'Säästösumma alussa',
    hFrom: 'Alkukuukausi',
    hTo: 'Loppukuukausi',
    rate: 'Nimellinen korko vuodessa',
    hRateHint: '0 % = käteinen tai korkoton tili. Korko lisätään pääomaan kerran vuodessa.',
    eAmount: 'Säästösumma nyt',
    eYears: 'Säästöaika',
    yearsSuffix: 'v',
    eRateHint: (pct, from) => `Oletuksena EKP:n talletuskorko ${pct} (${from} alkaen). Pankkitilien korot ovat usein matalampia.`,
    eRateHintNone: 'Esimerkiksi määräaikaistilin korko.',
    eInflation: 'Oletettu inflaatio vuodessa',
    eInflationHint: (pct, month) => `Oletuksena viimeisin inflaatio: ${pct} (${month}, Tilastokeskus). EKP:n tavoite on 2 %.`,
    eInflationHintNone: 'EKP:n tavoite on 2 %.',
    histPanel: 'Toteutunut tuotto',
    fcPanel: 'Arvioitu tuotto',
    nominal: 'Nimellinen arvo',
    prices: 'Hintojen muutos',
    errorBox: 'Tulosta ei voi laskea. Korjaa merkityt kentät.',
    disclaimerTitle: 'Ei sijoitusneuvontaa',
    disclaimer: 'Laskelmat ovat suuntaa antavia. Ne eivät ota huomioon veroja, kuluja tai korkojen muutoksia, eivätkä ne ole sijoitus- tai talousneuvontaa.',
    sources: (rate) => [
      { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi 1972=100' },
      ...(rate ? [{ name: 'Euroopan keskuspankki', href: 'https://data.ecb.europa.eu/data/datasets/FM', detail: 'talletuskorko' }] : []),
    ],
    ids: { history: 'saastot-historia', forecast: 'saastot-ennuste' },
  },
  en: {
    histTitle: 'What has happened to savings?',
    histIntro: 'See how the purchasing power of savings has changed once the interest rate and actual inflation are taken into account.',
    fcTitle: 'What will happen to savings?',
    fcIntro: 'Estimate the real return on savings with an assumed interest rate and inflation (Fisher equation).',
    hAmount: 'Savings at the start',
    hFrom: 'Start month',
    hTo: 'End month',
    rate: 'Nominal interest rate a year',
    hRateHint: '0% = cash or an account without interest. Interest is added to the capital once a year.',
    eAmount: 'Savings now',
    eYears: 'Saving period',
    yearsSuffix: 'yrs',
    eRateHint: (pct, from) => `By default the ECB deposit facility rate, ${pct} (from ${from}). Bank account rates are often lower.`,
    eRateHintNone: 'For example the rate of a fixed-term deposit.',
    eInflation: 'Assumed inflation a year',
    eInflationHint: (pct, month) => `By default the latest inflation rate: ${pct} (${month}, Statistics Finland). The ECB's target is 2%.`,
    eInflationHintNone: 'The ECB’s target is 2%.',
    histPanel: 'Actual return',
    fcPanel: 'Estimated return',
    nominal: 'Nominal value',
    prices: 'Change in prices',
    errorBox: 'The result cannot be calculated. Please correct the marked fields.',
    disclaimerTitle: 'Not investment advice',
    disclaimer: 'The calculations are indicative. They do not take taxes, fees or changes in interest rates into account, and they are not investment or financial advice.',
    sources: (rate) => [
      { name: 'Statistics Finland', href: 'https://stat.fi/en/statistics/khi', detail: 'consumer price index 1972=100' },
      ...(rate ? [{ name: 'European Central Bank', href: 'https://data.ecb.europa.eu/data/datasets/FM', detail: 'deposit facility rate' }] : []),
    ],
    ids: { history: 'savings-history', forecast: 'savings-forecast' },
  },
};

/**
 * Savings calculators (historical + forecast) in Finnish or English. Needs
 * the value-of-money island on the same page (its series).
 * @param {any} ctx
 * @param {{list: object[], latestMonth: string, lang?: 'fi'|'en'}} o
 */
export function savingsSection(ctx, { list, latestMonth, lang = 'fi' }) {
  const { c } = ctx;
  const s = S[lang];
  const F = formatter(lang);
  const k = ctx.latest.khi;
  const rateNow = ctx.latest.korot?.rateNow;
  const hasRate = fmt.isNum(rateNow);
  const hFrom = fmt.ymAdd(latestMonth, -12 * SAVINGS_YEARS);
  const hTo = latestMonth;
  const pick = pickMoneySeries(list, hFrom, hTo);
  if ('error' in pick) throw new Error(`rahanarvo: savings default failed (${pick.error})`);
  const hist = savingsReal({ amount: SAVINGS_AMOUNT, nominalRate: 0, months: fmt.ymDiff(hFrom, hTo), fromIdx: pick.fromIdx, toIdx: pick.toIdx });
  const hv = savingsView(hist, { kind: 'history', from: hFrom, to: hTo, lang });
  const inflDefault = k?.yoy ?? 2;
  const rateDefault = hasRate ? rateNow : 0;
  const fc = savingsReal({ amount: SAVINGS_AMOUNT, nominalRate: rateDefault, months: SAVINGS_YEARS * 12, assumedInflation: inflDefault });
  const fv = savingsView(fc, { kind: 'forecast', lang });
  const decimalAttrs = { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' };
  const firstYear = periodYear(list.find((x) => x.id === 'eki-1939')?.start ?? '1939-08');
  const maxYear = periodYear(latestMonth);
  // Input values in the page's number format without grouping ('2,5' / '2.5';
  // rates stay below 1 000, so only the Finnish NBSP grouping could occur).
  const num = (v, d = 2) => F.num(v, d).replace(/\s/g, '');
  const rateDate = hasRate ? (lang === 'en' ? enDate(ctx.latest.korot.rateNowFrom) : fmt.date(ctx.latest.korot.rateNowFrom)) : '';

  const panel = (id, v, title) => html`<div class="calc__result" id="${id}-tulos" role="region" aria-labelledby="${id}-tulos-otsikko">
  <h4 class="calc__result-title" id="${id}-tulos-otsikko">${title}</h4>
  <div data-result-ok>
    <div class="calc__live" aria-live="polite" aria-atomic="true">
      ${out('realLabel', v.realLabel, 'p', { class: 'calc__label' })}
      <p class="calc__big">${out('real', v.real)}</p>
      ${out('lead', v.lead, 'p', { class: 'calc__lead' })}
    </div>
    ${out('realReturn', v.realReturn, 'p', { class: 'calc__lead', hidden: !v.realReturn })}
    <dl class="calc__facts">
      <div><dt>${s.nominal}</dt><dd>${out('nominal', v.nominal)}</dd></div>
      <div><dt>${s.prices}</dt><dd>${out('inflation', v.inflation)}</dd></div>
    </dl>
  </div>
  <p class="calc__error" data-result-error hidden role="alert">${s.errorBox}</p>
</div>`;

  const histForm = html`<form class="calc__form form js-only" id="saasto-historia" novalidate>
  ${c.field({ id: 'h-summa', label: s.hAmount, value: String(SAVINGS_AMOUNT), suffix: '€', required: true, attrs: decimalAttrs })}
  ${monthYearField({ id: 'h-alku', legend: s.hFrom, value: hFrom, minYear: firstYear, maxYear, lang })}
  ${monthYearField({ id: 'h-loppu', legend: s.hTo, value: hTo, minYear: firstYear, maxYear, lang })}
  ${c.field({ id: 'h-korko', label: s.rate, value: '0', suffix: '%', hint: s.hRateHint, attrs: decimalAttrs })}
</form>`;

  const fcForm = html`<form class="calc__form form js-only" id="saasto-ennuste" novalidate>
  ${c.field({ id: 'e-summa', label: s.eAmount, value: String(SAVINGS_AMOUNT), suffix: '€', required: true, attrs: decimalAttrs })}
  ${c.field({ id: 'e-vuodet', label: s.eYears, value: String(SAVINGS_YEARS), suffix: s.yearsSuffix, attrs: { ...decimalAttrs, inputmode: 'numeric' } })}
  ${c.field({
    id: 'e-korko',
    label: s.rate,
    value: num(rateDefault),
    suffix: '%',
    hint: hasRate ? s.eRateHint(F.pct(rateNow, { decimals: 2 }), rateDate) : s.eRateHintNone,
    attrs: decimalAttrs,
  })}
  ${c.field({
    id: 'e-inflaatio',
    label: s.eInflation,
    value: num(inflDefault, 1),
    suffix: '%',
    hint: k ? s.eInflationHint(F.pct(k.yoy), F.period(k.month)) : s.eInflationHintNone,
    attrs: decimalAttrs,
  })}
</form>`;

  const island = ctx.jsonScript('saasto-data', {
    lang,
    params: SAVINGS_PARAMS[lang],
    defaults: { hAmount: SAVINGS_AMOUNT, hFrom, hTo, hRate: 0, eAmount: SAVINGS_AMOUNT, eYears: SAVINGS_YEARS, eRate: rateDefault, eInflation: inflDefault },
    messages: MESSAGES[lang],
  });

  return html`<h3 class="calc-subhead" id="${s.ids.history}">${s.histTitle}</h3>
<p>${s.histIntro}</p>
<div class="calc">${histForm}${panel('saasto-historia', hv, s.histPanel)}</div>
<h3 class="calc-subhead" id="${s.ids.forecast}">${s.fcTitle}</h3>
<p>${s.fcIntro}</p>
<div class="calc">${fcForm}${panel('saasto-ennuste', fv, s.fcPanel)}</div>
${c.callout({ tone: 'note', title: s.disclaimerTitle, body: s.disclaimer })}
${c.sourceLine({ sources: s.sources(hasRate), updated: k?.updated, lang })}
${island}`;
}

/** '2026-09-16' → '16 September 2026'. */
function enDate(value) {
  const m = String((value && fmt.isoDate(value)) ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${formatter('en').period(`${m[1]}-${m[2]}`)}` : '';
}

/** @param {any} ctx */
export default async function rahanarvo(ctx) {
  const { html: h, fmt: f, c } = ctx;
  const k = ctx.latest.khi;
  if (!k) throw new Error('rahanarvo: data/khi.json is missing (run npm run fetch)');
  const calc = moneyCalculator(ctx, { lang: 'fi' });
  const { d, view, list, latestMonth } = calc;
  const updated = k.updated ?? ctx.latest.dataUpdated;
  const ykhi = list.find((s) => isYkhi(s.id));

  const method = h`<div class="prose">
  <p>Rahan arvo lasketaan virallisista pisteluvuista: <code>arvo nyt = summa × pisteluku nyt / pisteluku silloin</code>. Laskuri valitsee sarjan ajankohtien mukaan eikä ketjuta eri sarjoja:</p>
  <ul>
    <li><strong>Vuodesta 1972:</strong> kuluttajahintaindeksi 1972=100 kuukausittain (Tilastokeskus 11xs) ja vuosikeskiarvoina (11xt).</li>
    <li><strong>Elokuusta 1939:</strong> elinkustannusindeksi 1938:8–1939:7=100 kuukausittain (11xn); vuosikeskiarvot 1952–1971 elinkustannusindeksistä 1951:10=100 (11xm).</li>
    <li><strong>Vuodesta 1860:</strong> elinkustannusindeksi 1914:1–6=100 vuositasolla (11xy). Laskelma tehdään silloin vuosien välillä ja päättyy sarjan viimeisimpään vuoteen.</li>
    <li><strong>Vuosikeskiarvot ennen vuotta 1952:</strong> elinkustannusindeksi 1914:1–6=100 (11xy), koska kuukausisarjasta 11xn ei julkaista vuosikeskiarvoja.</li>
    ${ykhi ? h`<li><strong>YKHI (valinnainen):</strong> Eurostatin yhdenmukaistettu kuluttajahintaindeksi ${ykhi.base} kuukausittain ${f.elative(ykhi.start)} alkaen. Sillä voi verrata vain kuukausia, koska vuosikeskiarvoja ei ole aineistossa.</li>` : ''}
  </ul>
  <p>Markat muunnetaan euroiksi kiinteällä kurssilla 5,94573 mk/€. Vuoden 1963 rahanuudistuksessa 100 vanhaa markkaa vaihtui yhdeksi uudeksi markaksi, joten sitä vanhemmat markkasummat jaetaan lisäksi sadalla.</p>
  <p>Tulos kertoo, paljonko rahaa tarvitaan samojen tavaroiden ja palvelujen ostamiseen. Se ei kerro palkkojen tai elintason muutoksesta – niistä kerrotaan <a href="/ostovoima/">Ostovoima</a>-sivulla. Menetelmistä tarkemmin <a href="/menetelmat/">Menetelmät</a>-sivulla.</p>
</div>`;

  const main = h`${c.pageHeader({
    eyebrow: `Laskuri · kuluttajahintaindeksi, ${f.monthName(k.month)}`,
    title: 'Rahanarvolaskuri',
    lede: `Mitä vanha rahasumma vastaa nykyrahassa? Esimerkiksi 100 € tammikuussa 2000 vastaa ${view.value} ${f.inessive(latestMonth)}. Laske kuukauden tarkkuudella Tilastokeskuksen virallisilla hintaindekseillä.`,
    meta: h`Luvut ${ablative(latestMonth)} · Päivitetty <time datetime="${String(updated).slice(0, 10)}">${f.date(updated)}</time> · Lähde: Tilastokeskus · <a href="${PATH_EN}" hreflang="en" lang="en">In English</a>`,
  })}
${c.section({ id: 'laskuri', title: 'Laske rahan arvo', className: 'section--flush-top', body: calc.calculator })}
${c.section({ id: 'vuodet', title: 'Rahan arvo eri vuosina', intro: `Paljonko 100 € tai 100 markkaa eri vuosina vastaa ${f.inessive(latestMonth)}.`, body: yearsTable(ctx, list, latestMonth, 'fi') })}
${c.section({ id: 'saastot', title: 'Säästöt ja inflaatio', intro: 'Kun inflaatio on korkoa suurempi, säästöjen ostovoima pienenee.', className: 'raha-saastot', body: savingsSection(ctx, { list, latestMonth, lang: 'fi' }) })}
${c.section({ id: 'menetelma', title: 'Näin laskuri toimii', body: method })}
${c.section({ id: 'muut-laskurit', title: 'Muut laskurit', body: c.cardGrid(calculatorCards(ctx, { exclude: PATH })) })}`;

  const description = `Rahanarvolaskuri: mitä vanha summa on nykyrahassa? 100 € tammikuussa 2000 = ${f.eur(d.value)} ${f.inessive(latestMonth)}. Myös markat ja säästöjen reaalituotto.`;
  return [
    {
      path: PATH,
      html: ctx.layout({
        title: 'Rahanarvolaskuri – rahan arvo eri vuosina',
        description,
        path: PATH,
        page: 'rahanarvo',
        alternates: [
          { hreflang: 'en', href: PATH_EN },
          { hreflang: 'x-default', href: PATH },
        ],
        scripts: ['pages/rahanarvo.js'],
        breadcrumbs: calcCrumbs(ctx, PATH, 'Rahan arvo'),
        jsonLd: [calcJsonLd(ctx, { name: 'Rahanarvolaskuri', path: PATH, description })],
        main,
      }),
      changefreq: 'monthly',
      priority: 0.9,
    },
  ];
}
