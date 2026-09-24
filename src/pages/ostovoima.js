/**
 * /ostovoima/ – nominal vs real earnings and "Riittääkö palkankorotuksesi?"
 * (owner CALC).
 *
 * Earnings: Tilastokeskus ansiotasoindeksi and reaaliansioindeksi (table 14um,
 * quarterly, 2015=100, preliminary quarters labelled "ennakko"). The wage
 * calculator deflates a pay change with the official consumer price index
 * (src/js/lib/calc.js realWageChange + pickMoneySeries: KHI 1972=100).
 */
import { html } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import { buildSeries, pickMoneySeries, realWageChange, wageView, latestPeriod, periodYear } from '../js/lib/calc.js';
import { monthYearField, out, calcJsonLd, messageData, noJsNote, calculatorCards, calcCrumbs, quarterName, quarterInWords, earningsClause, SOURCES } from './laskurit.js';

export const PATH = '/ostovoima/';
/** Example salaries (inputs, not statistics). */
const BEFORE = 3200;
const AFTER = 3300;

const MESSAGES = {
  salary: 'Anna palkka euroina, esimerkiksi 3 200 tai 3 250,50.',
  future: 'Kuukauden {kuukausi} hintoja ei ole vielä julkaistu. Uusin on {viimeisin}.',
  before: 'Laskurin varhaisin kuukausi on {alku}.',
  order: 'Jälkimmäisen kuukauden pitää olla ensimmäisen jälkeen.',
};

/** @param {any} ctx */
export default async function ostovoima(ctx) {
  const { html: h, fmt: f, c, svg } = ctx;
  const an = ctx.data.ansiot;
  const k = ctx.latest.khi;
  const la = ctx.latest.ansiot;
  if (!an || !k || !la) throw new Error('ostovoima: data/ansiot.json or data/khi.json is missing (run npm run fetch)');
  const prelim = new Set(an.preliminary ?? []);
  const ennakko = (q) => (prelim.has(q) ? ' (ennakko)' : '');
  const updatedAti = ctx.latest.updated?.ansiot;

  // Index chart from the first quarter with both indices.
  const first = an.periods.findIndex((_, i) => f.isNum(an.nominalIndex?.[i]) && f.isNum(an.realIndex?.[i]));
  const last = Math.max(ctx.stats.latestIndex(an.nominalIndex), ctx.stats.latestIndex(an.realIndex));
  const quarters = an.periods.slice(first, last + 1);
  const nominal = an.nominalIndex.slice(first, last + 1);
  const real = an.realIndex.slice(first, last + 1);
  const lastQ = quarters.at(-1);
  const realSince = (real.at(-1) / 100 - 1) * 100;
  const nomSince = (nominal.at(-1) / 100 - 1) * 100;
  const firstYear = Number(quarters[0].slice(0, 4));
  const lastYear = Number(lastQ.slice(0, 4));
  const tickStep = [1, 2, 3, 5].find((s) => (lastYear - firstYear) / s <= 7) ?? 5;
  const base = an.indexBase ?? '2015=100';
  const since = (v) => `${v >= 0 ? 'nousseet' : 'laskeneet'} ${f.pct(Math.abs(v))}`;
  const summary = `${f.capitalize(quarterInWords(lastQ))} ansiotasoindeksi oli ${f.idx(nominal.at(-1), 1)} ja reaaliansioindeksi ${f.idx(real.at(-1), 1)} (${base}${prelim.has(lastQ) ? ', ennakko' : ''}). Nimelliset ansiot ovat ${since(nomSince)} vuoden ${base.slice(0, 4)} tasosta, reaaliansiot ${(nomSince >= 0) === (realSince >= 0) ? f.pct(Math.abs(realSince)) : since(realSince)}.`;

  const chart = svg.lineChart({
    series: [
      { values: nominal, cls: 'khi', label: 'Ansiotasoindeksi', formatValue: (v) => f.idx(v, 1) },
      { values: real, cls: 's3', label: 'Reaaliansioindeksi', formatValue: (v) => f.idx(v, 1) },
    ],
    labels: quarters,
    refLines: [{ value: 100, cls: 'muted' }],
    xTicks: (l) => (l.endsWith('Q1') && (Number(l.slice(0, 4)) - firstYear) % tickStep === 0 ? l.slice(0, 4) : null),
    formatY: (v) => f.num(v, 0),
    height: 300,
    ariaLabel: summary,
  });
  const rows = [];
  for (let i = an.periods.length - 1; i >= 0 && rows.length < 44; i--) {
    const q = an.periods[i];
    if (!f.isNum(an.nominalYoy[i])) continue;
    rows.push([
      html`${quarterName(q)}${prelim.has(q) ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`,
      f.pct(an.nominalYoy[i], { sign: true }),
      f.pct(an.realYoy?.[i], { sign: true }),
      f.idx(an.nominalIndex?.[i], 1),
      f.idx(an.realIndex?.[i], 1),
    ]);
  }
  const table = c.dataTable({
    id: 'ansiot-taulukko',
    caption: `Ansiotaso ja reaaliansiot neljänneksittäin (Tilastokeskus, ${base})`,
    columns: [
      { label: 'Neljännes' },
      { label: 'Ansiot, vuosimuutos', num: true },
      { label: 'Reaaliansiot, vuosimuutos', num: true },
      { label: 'Ansiotasoindeksi', num: true },
      { label: 'Reaaliansioindeksi', num: true },
    ],
    rows,
    visibleRows: 8,
    toggleLabels: { more: `Näytä kaikki neljännekset (${rows.length})`, less: 'Näytä vain 8 viimeisintä neljännestä' },
    compact: true,
    note: 'Vuosimuutos = muutos edellisen vuoden samasta neljänneksestä. Ennakkotiedot tarkentuvat myöhemmin.',
  });
  const figure = c.chartFigure({
    id: 'ansiot-kaavio',
    title: 'Ansiot ja reaaliansiot',
    subtitle: `Indeksi, ${base}, neljänneksittäin`,
    legend: c.legend([
      { cls: 'khi', label: 'Ansiotasoindeksi (nimellinen)' },
      { cls: 's3', label: 'Reaaliansioindeksi (hinnat huomioitu)' },
    ]),
    chart,
    summary,
    table,
    source: c.sourceLine({ sources: [{ ...SOURCES.ati, detail: 'ansiotasoindeksi ja reaaliansioindeksi, taulukko 14um' }], updated: updatedAti }),
  });

  // Annual changes (from the first quarter with both rates): nominal vs real.
  const y0 = an.periods.findIndex((_, i) => f.isNum(an.nominalYoy?.[i]) && f.isNum(an.realYoy?.[i]));
  const y1 = ctx.stats.latestIndex(an.nominalYoy);
  const yq = an.periods.slice(y0, y1 + 1);
  const yNom = an.nominalYoy.slice(y0, y1 + 1);
  const yReal = an.realYoy.slice(y0, y1 + 1);
  const yFirst = Number(yq[0].slice(0, 4));
  const yStep = [1, 2, 3, 5].find((s) => (Number(yq.at(-1).slice(0, 4)) - yFirst) / s <= 7) ?? 5;
  const yoySummary = `${f.capitalize(quarterName(yq.at(-1)))}: ansiot ${f.pct(yNom.at(-1), { sign: true })} ja reaaliansiot ${f.pct(yReal.at(-1), { sign: true })} vuodessa${ennakko(yq.at(-1))}. Kun reaaliansiot ovat alle nollan, hinnat nousevat palkkoja nopeammin.`;
  const yoyFigure = c.chartFigure({
    id: 'ansiot-muutos',
    title: 'Ansioiden vuosimuutos',
    subtitle: 'Muutos edellisen vuoden samasta neljänneksestä, %',
    legend: c.legend([
      { cls: 'khi', label: 'Ansiot (nimellinen)' },
      { cls: 's3', label: 'Reaaliansiot' },
    ]),
    chart: svg.lineChart({
      series: [
        { values: yNom, cls: 'khi', label: 'Ansiot' },
        { values: yReal, cls: 's3', label: 'Reaaliansiot' },
      ],
      labels: yq,
      refLines: [{ value: 0, cls: 'muted' }],
      xTicks: (l) => (l.endsWith('Q1') && (Number(l.slice(0, 4)) - yFirst) % yStep === 0 ? l.slice(0, 4) : null),
      height: 280,
      ariaLabel: yoySummary,
    }),
    summary: yoySummary,
    source: c.sourceLine({ sources: [{ ...SOURCES.ati, detail: 'taulukko 14um' }], updated: updatedAti, note: 'Vuosimuutokset ovat taulukossa yllä.' }),
  });

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Ansiot vuodessa', value: f.pct(la.nominalYoy, { sign: true }), note: `${quarterName(la.period)}${ennakko(la.period)}` }),
    c.kpiCard({ label: 'Reaaliansiot vuodessa', value: f.pct(la.realYoy, { sign: true }), note: `${quarterName(la.period)}${ennakko(la.period)}` }),
    c.kpiCard({ label: 'Inflaatio (KHI)', value: f.pct(k.yoy), note: f.monthName(k.month) }),
    c.kpiCard({ label: `Reaaliansiot vuoteen ${base.slice(0, 4)} verrattuna`, value: f.pct(realSince, { sign: true }), note: `${quarterName(lastQ)}${ennakko(lastQ)}` }),
  ]);

  // Wage calculator (default: the latest 12 months).
  const list = buildSeries(ctx.data, { ids: ['khi-1972', 'eki-1939'] });
  const latestMonth = list.map(latestPeriod).sort().at(-1);
  const from = fmt.ymAdd(latestMonth, -12);
  const pick = pickMoneySeries(list, from, latestMonth);
  if ('error' in pick) throw new Error(`ostovoima: default calculation failed (${pick.error})`);
  const r = realWageChange({ before: BEFORE, after: AFTER, cpiFrom: pick.fromIdx, cpiTo: pick.toIdx });
  const v = wageView(r, { before: BEFORE, after: AFTER, from, to: latestMonth });
  const minYear = periodYear(list.find((s) => s.id === 'khi-1972')?.start ?? '1972-01');
  const maxYear = periodYear(latestMonth);
  const decimalAttrs = { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' };

  const form = h`<form class="calc__form form js-only" id="palkka-lomake" novalidate${ctx.attrs({ data: messageData(MESSAGES) })}>
  <div class="calc__grid">
    ${c.field({ id: 'palkka-ennen', label: 'Palkka ennen', value: String(BEFORE), suffix: '€', hint: 'Kuukausipalkka ennen korotusta, esimerkiksi 3 200.', required: true, attrs: decimalAttrs })}
    ${c.field({ id: 'palkka-nyt', label: 'Palkka nyt', value: String(AFTER), suffix: '€', hint: 'Kuukausipalkka korotuksen jälkeen.', required: true, attrs: decimalAttrs })}
  </div>
  ${monthYearField({ id: 'palkka-alku', legend: 'Milloin sait vanhaa palkkaa?', value: from, minYear, maxYear, hint: 'Esimerkiksi edellisen palkankorotuksen kuukausi.' })}
  ${monthYearField({ id: 'palkka-loppu', legend: 'Mihin kuukauteen verrataan?', value: latestMonth, minYear, maxYear, hint: 'Oletuksena uusin kuukausi, jonka hinnat on julkaistu.' })}
  <div class="calc__submit">${c.button({ label: 'Laske ostovoima', variant: 'primary', type: 'submit' })}</div>
</form>`;
  const result = h`<div class="calc__result" id="palkka-tulos" role="region" aria-labelledby="palkka-tulos-otsikko">
  <h3 class="calc__result-title" id="palkka-tulos-otsikko">Ostovoiman muutos</h3>
  <div data-result-ok>
    <div class="calc__live" aria-live="polite" aria-atomic="true">
      <p class="calc__big">${out('real', v.real)}</p>
      ${out('verdict', v.verdict, 'p', { class: 'calc__lead calc__verdict' })}
      ${out('lead', v.lead, 'p', { class: 'calc__lead' })}
    </div>
    <dl class="calc__facts">
      <div><dt>Palkka muuttui</dt><dd>${out('nominal', v.nominal)}</dd></div>
      <div><dt>Hinnat muuttuivat</dt><dd>${out('prices', v.prices)}</dd></div>
      <div><dt>Ostovoiman säilyttämiseen olisi riittänyt</dt><dd>${out('needed', v.needed)}</dd></div>
      <div><dt>Palkkasi ero siihen</dt><dd>${out('difference', v.difference)}</dd></div>
    </dl>
    <div class="calc__actions">${c.shareButton({ label: 'Kopioi linkki laskelmaan', size: 'sm', track: 'result_shared' })}</div>
  </div>
  <p class="calc__error" data-result-error hidden role="alert">Tulosta ei voi laskea. Korjaa merkityt kentät.</p>
  <p class="calc__disclaimer">Laskelma vertaa bruttopalkkaa kuluttajahintaindeksiin (1972=100, Tilastokeskus). Verotuksen muutokset eivät ole mukana.</p>
</div>`;
  const island = ctx.jsonScript('palkka-data', {
    latestMonth,
    firstMonth: list.find((s) => s.id === 'khi-1972')?.start,
    defaults: { before: BEFORE, after: AFTER, from, to: latestMonth },
    series: list.map((s) => ({ id: s.id, family: s.family, kind: s.kind, decimals: s.decimals, start: s.start, values: s.values })),
  });

  const explain = h`<div class="prose">
  <p><strong>Ansiotasoindeksi</strong> kuvaa palkansaajien säännöllisen työajan ansioiden muutosta. <strong>Reaaliansioindeksi</strong> on ansiotasoindeksi, josta on poistettu kuluttajahintojen muutos: kun ansiot nousevat hintoja nopeammin, ostovoima kasvaa.</p>
  <p>Laskuri tekee saman omalle palkallesi: <code>reaalimuutos = (palkka nyt / palkka ennen) / (hintaindeksi nyt / hintaindeksi ennen) − 1</code>. Esimerkiksi ${f.eur(BEFORE, 0)} → ${f.eur(AFTER, 0)} on ${v.nominal}, ja hinnat ${r.pricePct >= 0 ? 'nousivat' : 'laskivat'} ${f.pct(Math.abs(r.pricePct))} ${f.elative(from)} ${f.illative(latestMonth)}, joten ostovoima ${r.realPct >= 0.05 ? 'kasvoi' : r.realPct <= -0.05 ? 'heikkeni' : 'pysyi ennallaan'}${Math.abs(r.realPct) >= 0.05 ? ` ${f.pct(Math.abs(r.realPct))}` : ''}.</p>
  <p>Laskelma käyttää bruttopalkkaa. Nettopalkkaan vaikuttavat myös verot ja maksut. Koko talouden keskimääräiset ansiot ja hintakehitys löytyvät yllä olevasta kaaviosta; inflaatiosta tarkemmin <a href="/inflaatio/">Inflaatio vuosittain</a> -sivulla.</p>
</div>`;

  const main = h`${c.pageHeader({
    eyebrow: `Ostovoima · ${quarterName(la.period)}`,
    title: 'Ostovoima ja reaaliansiot',
    lede: `${f.capitalize(quarterInWords(la.period))} ${earningsClause(la.nominalYoy, la.realYoy)}${la.preliminary ? ' (ennakkotieto)' : ''}. Laske, riittääkö oma palkankorotuksesi kattamaan hintojen nousun.`,
    meta: h`Päivitetty <time datetime="${String(updatedAti ?? ctx.latest.dataUpdated).slice(0, 10)}">${f.date(updatedAti ?? ctx.latest.dataUpdated)}</time> · Lähde: Tilastokeskus (ansiotasoindeksi, kuluttajahintaindeksi)`,
  })}
${c.section({ id: 'tunnusluvut', title: 'Ansiot ja hinnat', className: 'section--flush-top', body: kpis })}
${c.section({ id: 'palkkalaskuri', title: 'Riittääkö palkankorotuksesi?', intro: 'Vertaa palkkasi muutosta kuluttajahintojen muutokseen samalla ajanjaksolla.', body: h`${noJsNote(c, 'Alla on esimerkkilaskelma uusimmilla hinnoilla. Voit laskea itse: jaa palkkojen suhde hintaindeksien suhteella.')}<div class="calc">${form}${result}</div>${island}` })}
${c.section({ id: 'kehitys', title: 'Ansioiden kehitys', intro: 'Nimelliset ansiot ja hintojen nousulla korjatut reaaliansiot.', body: h`${figure}${yoyFigure}` })}
${c.section({ id: 'selitys', title: 'Mitä luvut tarkoittavat?', body: explain })}
${c.section({ id: 'muut-laskurit', title: 'Muut laskurit', body: c.cardGrid(calculatorCards(ctx, { exclude: PATH })) })}`;

  const description = `${f.capitalize(earningsClause(la.nominalYoy, la.realYoy))} (${quarterName(la.period)}${la.preliminary ? ', ennakko' : ''}). Riittääkö palkankorotuksesi?`;
  return [
    {
      path: PATH,
      html: ctx.layout({
        title: 'Ostovoima ja reaaliansiot – palkkalaskuri',
        description,
        path: PATH,
        page: 'ostovoima',
        scripts: ['pages/ostovoima.js'],
        breadcrumbs: calcCrumbs(ctx, PATH, 'Ostovoima'),
        jsonLd: [calcJsonLd(ctx, { name: 'Riittääkö palkankorotuksesi? – ostovoimalaskuri', path: PATH, description })],
        main,
      }),
      changefreq: 'monthly',
    },
  ];
}
