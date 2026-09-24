/**
 * /korot/ – interest rates and inflation: the ECB deposit facility rate (rate
 * now + every change since 1999), the 12-month Euribor (monthly average), KHI
 * inflation and the real rate (12-month Euribor − KHI annual change), with
 * charts (Chart.js + SVG fallback), tables and a no-advice disclaimer.
 * Data: data/korot.json (ECB Data Portal), data/khi.json, data/ykhi.json.
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import { html } from '../../scripts/lib/html.js';
import { fitText, metaSource, datasetLd, interactiveChart, downloadButton, signed, DESCRIPTION_MAX } from './hinnat.js';

const RANGES = Object.freeze(['1v', '3v', '5v', '10v', 'kaikki']);
const ECB_ORG = Object.freeze({ '@type': 'Organization', name: 'Euroopan keskuspankki (EKP)', url: 'https://www.ecb.europa.eu/' });
const TK_ORG = Object.freeze({ '@type': 'Organization', name: 'Tilastokeskus', url: 'https://stat.fi/' });

/** Interest rate '2,50 %' (2 decimals, as the ECB publishes it). */
const rate = (v, decimals = 2) => fmt.pct(v, { decimals });

/**
 * Real rate = nominal rate − inflation (both %), rounded to 3 decimals so no
 * float noise leaks into the output; null when either is missing.
 * @param {number|null} nominal e.g. the 12-month Euribor
 * @param {number|null} inflation annual change of the KHI
 * @returns {number|null}
 */
export function realRate(nominal, inflation) {
  if (!fmt.isNum(nominal) || !fmt.isNum(inflation)) return null;
  return fmt.round(nominal - inflation, 3);
}

/**
 * Monthly real rate on the month axis of korot.json: euribor12[m] − KHI yoy[m].
 * @param {{months: string[], euribor12: (number|null)[]}} korot
 * @param {{months: string[], yoy: (number|null)[]}} khi
 * @returns {{months: string[], values: (number|null)[]}}
 */
export function realRateSeries(korot, khi) {
  const months = korot?.months ?? [];
  const values = months.map((ym, i) => realRate(korot.euribor12?.[i], stats.seriesAt(khi?.months ?? [], khi?.yoy ?? [], ym)));
  return { months, values };
}

/**
 * Rate changes, newest first, with the change in %-points (the first row is
 * the starting level in 1999 and has no change).
 * @param {{date: string, depositRate: number}[]} decisions
 */
export function decisionRows(decisions) {
  return (decisions ?? [])
    .map((d, i, arr) => ({ date: d.date, rate: d.depositRate, change: i > 0 ? fmt.round(d.depositRate - arr[i - 1].depositRate, 2) : null }))
    .reverse();
}

/** @param {any} ctx */
export default async function korot(ctx) {
  const { c, svg } = ctx;
  const k = ctx.data.korot;
  const khi = ctx.data.khi;
  const L = ctx.latest.korot;
  if (!k?.months?.length || !L) throw new Error('korot: data/korot.json is missing (run npm run fetch)');
  if (!khi?.months) throw new Error('korot: data/khi.json is missing (run npm run fetch)');
  const path = '/korot/';
  const ecbSrc = { ...metaSource(ctx, 'korot', 'talletuskorko ja 12 kuukauden euribor'), name: 'EKP' };
  const khiSrc = { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' };
  const updated = ctx.latest.updated?.korot;

  const decisions = decisionRows(k.decisions);
  const now = decisions[0];
  const before = decisions[1];
  if (!now) throw new Error('korot: data/korot.json has no rate decisions');
  const real = realRateSeries(k, khi);
  const ri = stats.latestIndex(real.values);
  const rMonth = ri >= 0 ? real.months[ri] : L.month;
  const euribor = ri >= 0 ? k.euribor12[ri] : L.euribor12;
  const infl = stats.seriesAt(khi.months, khi.yoy, rMonth);
  const realNow = ri >= 0 ? real.values[ri] : null;
  const rMonthTxt = fmt.monthName(rMonth);
  const ea = ctx.latest.ea;

  const lede = [
    now ? `EKP:n talletuskorko on ${rate(now.rate)} ${fmt.date(now.date)} alkaen${before ? ` (aiemmin ${rate(before.rate)})` : ''}.` : '',
    fmt.isNum(euribor) && fmt.isNum(infl)
      ? `12 kuukauden euribor oli ${fmt.inessive(rMonth)} keskimäärin ${rate(euribor)} ja Suomen inflaatio ${fmt.pct(infl)}, joten reaalikorko oli noin ${signed(realNow)}.`
      : '',
  ].filter(Boolean).join(' ');

  const header = c.pageHeader({
    eyebrow: `Korot ja inflaatio · ${rMonthTxt}`,
    title: 'Korot ja inflaatio',
    lede,
    meta: c.sourceLine({ sources: [ecbSrc, khiSrc], updated }),
  });

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'EKP:n talletuskorko', value: now ? rate(now.rate) : null, note: now ? `${fmt.date(now.date)} alkaen${before ? ` · aiemmin ${rate(before.rate)}` : ''}` : null }),
    c.kpiCard({ label: '12 kk euribor', value: rate(euribor), note: `${fmt.capitalize(fmt.genitive(rMonth))} keskiarvo` }),
    c.kpiCard({ label: 'Inflaatio (KHI)', value: fmt.pct(infl), note: `Vuosimuutos, ${rMonthTxt}` }),
    c.kpiCard({ label: 'Reaalikorko', value: signed(realNow), note: `12 kk euribor − inflaatio, ${rMonthTxt}` }),
  ]);

  // Chart 1: deposit rate, Euribor and KHI on one month axis
  const khiFrom = khi.months.indexOf(k.months[0]);
  const aligned = stats.alignMany([
    { months: k.months, values: k.depositRate },
    { months: k.months, values: k.euribor12 },
    { months: khi.months.slice(Math.max(0, khiFrom)), values: khi.yoy.slice(Math.max(0, khiFrom)) },
  ]);
  const lines = [
    { cls: 's3', label: 'EKP:n talletuskorko' },
    { cls: 's5', label: '12 kk euribor' },
    { cls: 'khi', label: 'Inflaatio (KHI)' },
  ];
  const ten = stats.sliceRange(aligned.months, aligned.values, '10v');
  const tenPeriod = fmt.monthRange(ten.months[0], ten.months.at(-1));
  const ratesFigure = c.chartFigure({
    id: 'korot-kaavio',
    title: 'Korot ja inflaatio kuukausittain',
    subtitle: 'Prosenttia · talletuskorko kuukauden lopussa, euribor kuukauden keskiarvo',
    legend: c.legend(lines.map((l) => ({ cls: l.cls, label: l.label }))),
    chart: interactiveChart(ctx, {
      id: 'korot-kaavio',
      spec: {
        label: `EKP:n talletuskorko, 12 kuukauden euribor ja inflaatio kuukausittain, viimeisin ${rMonthTxt}`,
        months: aligned.months,
        unit: '%',
        decimals: 2,
        ranges: RANGES,
        range: '10v',
        datasets: lines.map((l, i) => ({ type: 'line', series: l.cls, label: l.label, data: aligned.values[i] })),
        download: { filename: `korot-ja-inflaatio-${rMonth}.png`, title: 'Korot ja inflaatio (%)', source: 'Lähteet: EKP, Tilastokeskus · inflaatio.fi' },
      },
      fallback: svg.lineChart({
        series: lines.map((l, i) => ({ values: ten.series[i], cls: l.cls, label: l.label, formatValue: (v) => fmt.pct(v, { decimals: l.cls === 'khi' ? 1 : 2 }) })),
        labels: ten.months,
        refLines: [{ value: 0, cls: 'muted' }],
        height: 320,
        ariaLabel: `EKP:n talletuskorko, 12 kuukauden euribor ja inflaatio ${tenPeriod}. ${fmt.capitalize(fmt.inessive(rMonth))} euribor ${rate(euribor)} ja inflaatio ${fmt.pct(infl)}.`,
      }),
    }),
    summary: `${fmt.capitalize(fmt.inessive(rMonth))} 12 kuukauden euribor oli ${rate(euribor)} ja inflaatio ${fmt.pct(infl)}. Talletuskorko on kuukauden viimeisen päivän korko; korkopäätösten päivät ovat taulukossa alempana.`,
    table: c.dataTable({
      id: 'korot-taulukko',
      caption: `Korot ja inflaatio kuukausittain, ${fmt.monthRange(aligned.months[0], aligned.months.at(-1))}`,
      columns: [{ label: 'Kuukausi' }, ...lines.map((l) => ({ label: l.label, num: true }))],
      rows: aligned.months.map((ym, i) => [fmt.monthShort(ym), c.numUnit(rate(aligned.values[0][i])), c.numUnit(rate(aligned.values[1][i], 3)), c.numUnit(fmt.pct(aligned.values[2][i]))]).reverse(),
      visibleRows: 12,
      compact: true,
      toggleLabels: { more: `Näytä kaikki kuukaudet (${aligned.months.length})`, less: 'Näytä vain 12 viimeisintä' },
    }),
    source: c.sourceLine({ sources: [ecbSrc, khiSrc], updated }),
    actions: downloadButton(ctx, 'korot-kaavio'),
  });

  // Chart 2: real rate
  const rTen = stats.sliceRange(real.months, real.values, '10v');
  const rStats = stats.sliceRange(real.months, real.values, 'kaikki');
  const rMax = stats.max(rStats.months, rStats.series);
  const rMin = stats.min(rStats.months, rStats.series);
  const negMonths = rTen.series.filter((v) => fmt.isNum(v) && v < 0).length;
  const realFigure = c.chartFigure({
    id: 'reaalikorko',
    title: 'Reaalikorko',
    subtitle: '12 kuukauden euribor miinus inflaatio (KHI), %',
    legend: c.legend([{ cls: 'core', label: 'Reaalikorko' }]),
    chart: interactiveChart(ctx, {
      id: 'reaalikorko',
      spec: {
        label: `Reaalikorko kuukausittain (12 kuukauden euribor miinus inflaatio), viimeisin ${rMonthTxt}`,
        months: real.months,
        unit: '%',
        decimals: 1,
        ranges: RANGES,
        range: '10v',
        datasets: [{ type: 'line', series: 'core', label: 'Reaalikorko', data: real.values }],
        download: { filename: `reaalikorko-${rMonth}.png`, title: 'Reaalikorko: 12 kk euribor − inflaatio (%)', source: 'Lähteet: EKP, Tilastokeskus · inflaatio.fi' },
      },
      fallback: svg.lineChart({
        series: [{ values: rTen.series, cls: 'core', label: 'Reaalikorko', formatValue: (v) => signed(v) }],
        labels: rTen.months,
        refLines: [{ value: 0, cls: 'muted' }],
        height: 280,
        ariaLabel: `Reaalikorko ${fmt.monthRange(rTen.months[0], rTen.months.at(-1))}, viimeisin ${signed(realNow)} (${rMonthTxt}).`,
      }),
    }),
    summary: `Reaalikorko oli ${fmt.inessive(rMonth)} ${signed(realNow)}. Viimeisen kymmenen vuoden aikana se oli negatiivinen ${negMonths} kuukautena ${rTen.months.length}:stä. Koko jaksolla (${fmt.monthRange(rStats.months[0], rStats.months.at(-1))}) korkein ${signed(rMax?.value)} (${rMax?.months.map((m) => fmt.monthShort(m)).join(', ')}) ja matalin ${signed(rMin?.value)} (${rMin?.months.map((m) => fmt.monthShort(m)).join(', ')}).`,
    table: c.dataTable({
      id: 'reaalikorko-taulukko',
      caption: `Reaalikorko kuukausittain, ${fmt.monthRange(rStats.months[0], rStats.months.at(-1))}`,
      columns: [{ label: 'Kuukausi' }, { label: '12 kk euribor', num: true }, { label: 'Inflaatio (KHI)', num: true }, { label: 'Reaalikorko', num: true }],
      rows: rStats.months
        .map((ym, i) => [fmt.monthShort(ym), c.numUnit(rate(stats.seriesAt(k.months, k.euribor12, ym), 3)), c.numUnit(fmt.pct(stats.seriesAt(khi.months, khi.yoy, ym))), c.numUnit(signed(rStats.series[i]))])
        .reverse(),
      visibleRows: 12,
      compact: true,
      toggleLabels: { more: `Näytä kaikki kuukaudet (${rStats.months.length})`, less: 'Näytä vain 12 viimeisintä' },
    }),
    source: c.sourceLine({ sources: [ecbSrc, khiSrc], updated }),
    actions: downloadButton(ctx, 'reaalikorko'),
  });

  // Decisions
  const decisionsTable = c.dataTable({
    id: 'korkopaatokset-taulukko',
    caption: `EKP:n talletuskoron muutokset ${fmt.yearOf(decisions.at(-1).date.slice(0, 7))}–${fmt.yearOf(now.date.slice(0, 7))}`,
    columns: [{ label: 'Voimassa alkaen' }, { label: 'Talletuskorko', num: true }, { label: 'Muutos, %-yks.', num: true }],
    rows: decisions.map((d) => [html`<time datetime="${d.date}">${fmt.date(d.date)}</time>`, c.numUnit(rate(d.rate)), d.change == null ? 'lähtötaso' : c.numUnit(fmt.pp(d.change, { decimals: 2 }))]),
    visibleRows: 10,
    compact: true,
    toggleLabels: { more: `Näytä kaikki muutokset (${decisions.length})`, less: 'Näytä vain 10 viimeisintä' },
    note: 'Päivämäärä on päivä, jona korko tuli voimaan. EKP:n neuvosto päättää koroista yleensä muutamaa päivää aiemmin. Ensimmäinen rivi on euron käyttöönoton lähtötaso.',
  });
  const ups = decisions.filter((d) => d.change > 0);
  const downs = decisions.filter((d) => d.change < 0);
  const decisionsIntro = `EKP on muuttanut talletuskorkoa ${decisions.length - 1} kertaa vuodesta ${fmt.yearOf(decisions.at(-1).date.slice(0, 7))}: ${ups.length} korotusta ja ${downs.length} laskua.`;

  const target = ea
    ? c.callout({
        tone: 'info',
        title: 'EKP:n inflaatiotavoite on 2 %',
        body: html`<p>EKP tavoittelee euroalueelle 2 %:n inflaatiota keskipitkällä aikavälillä yhdenmukaistetulla kuluttajahintaindeksillä (YKHI) mitattuna. Euroalueen inflaatio oli ${fmt.inessive(ea.month)} ${fmt.pct(ea.yoy)}${ea.provisional ? ' (ennakko)' : ''} (Eurostat), ${fmt.num(Math.abs(stats.ppChange(ea.yoy, 2)), 1)} prosenttiyksikköä tavoitteen ${ea.yoy >= 2 ? 'yläpuolella' : 'alapuolella'}. Katso <a href="/vertailu/">Suomen ja euroalueen vertailu</a>.</p>`,
      })
    : '';

  const explain = c.accordion([
    {
      summary: 'Mikä on reaalikorko?',
      body: html`<p>Reaalikorko on korko, josta on vähennetty inflaatio. Se kertoo, kasvaako rahan ostovoima: kun korko on inflaatiota korkeampi, reaalikorko on positiivinen. Tällä sivulla reaalikorko lasketaan yksinkertaisesti: 12 kuukauden euriborin kuukausikeskiarvo miinus saman kuukauden inflaatio (kuluttajahintaindeksin vuosimuutos). Tarkemmin reaalikorko lasketaan odotetusta inflaatiosta, joten luku on suuntaa antava.</p>`,
    },
    {
      summary: 'Mikä on euribor?',
      body: html`<p>Euribor on euroalueen pankkien välinen viitekorko. Suomessa monen asuntolainan korko on sidottu 12 kuukauden euriboriin: lainan korko on euribor lisättynä pankin marginaalilla. Sivun luku on kuukauden päivittäisten noteerausten keskiarvo.</p>`,
    },
    {
      summary: 'Mikä on EKP:n talletuskorko?',
      body: html`<p>Talletuskorko on korko, jonka pankit saavat keskuspankkiin tallettamistaan varoista. Se on EKP:n tärkein ohjauskorko, ja sen muutokset näkyvät nopeasti euriborkoroissa. EKP:n neuvosto päättää koroista rahapolitiikan kokouksissaan noin kuuden viikon välein.</p>`,
    },
    {
      summary: 'Miten korot näkyvät inflaatiossa?',
      body: html`<p>Suomen kuluttajahintaindeksiin (KHI) sisältyvät asuntolainojen korkomenot, joten korkojen nousu nostaa KHI:tä ja korkojen lasku laskee sitä. EU:n yhdenmukaistetussa kuluttajahintaindeksissä (YKHI) korkomenoja ei ole. Katso <a href="/hinnat/asuntolainojen-korot/">asuntolainojen korkomenojen kehitys</a> ja <a href="/vertailu/#khi-ykhi">miksi KHI ja YKHI eroavat</a>.</p>`,
    },
  ]);

  const disclaimer = c.callout({
    tone: 'warning',
    title: 'Ei sijoitus- tai lainaneuvontaa',
    body: html`<p>Sivun luvut ovat yleistä tietoa korkojen ja inflaation kehityksestä. Ne eivät ole sijoitus-, laina- tai muuta taloudellista neuvontaa eivätkä ennuste tulevista koroista. Tarkista oman lainasi korko pankistasi. <a href="/kayttoehdot/#vastuuvapaus">Vastuuvapauslauseke</a></p>`,
  });

  const main = html`${header}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--flush-top', body: html`<div class="stack-lg">${kpis}${disclaimer}</div>` })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Korot ja inflaatio', intro: 'Talletuskorko, euribor ja inflaatio samassa kuvassa. Valitse aikaväli kaavion yläpuolelta.', body: html`<div class="stack-lg">${ratesFigure}${target}</div>` })}
${c.section({ id: 'reaalikorko-osio', eyebrow: 'Reaalikorko', title: 'Kasvaako rahan ostovoima korkoa vastaan?', intro: 'Reaalikorko on positiivinen, kun euribor on inflaatiota korkeampi.', body: realFigure })}
${c.section({ id: 'korkopaatokset', eyebrow: 'EKP', title: 'Talletuskoron muutokset', intro: decisionsIntro, body: decisionsTable })}
${c.section({ id: 'selitykset', title: 'Käsitteet', body: explain })}`;

  const description = fitText(
    [
      now && fmt.isNum(euribor)
        ? `EKP:n talletuskorko ${rate(now.rate)} ${fmt.date(now.date)} alkaen. 12 kk euribor ${fmt.inessive(rMonth)} ${rate(euribor)} ja inflaatio ${fmt.pct(infl)}: reaalikorko ${signed(realNow)}.`
        : null,
      `EKP:n talletuskorko, 12 kuukauden euribor, inflaatio ja reaalikorko kuukausittain vuodesta ${fmt.yearOf(k.months[0])} (EKP, Tilastokeskus).`,
    ],
    DESCRIPTION_MAX,
  );

  return [
    {
      path,
      priority: 0.7,
      changefreq: 'monthly',
      html: ctx.layout({
        title: fitText(['Korot ja inflaatio: euribor ja reaalikorko', 'Korot ja inflaatio']),
        description,
        path,
        page: 'korot',
        scripts: ['pages/hinnat.js'],
        breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Korot'),
        jsonLd: [
          datasetLd(ctx, {
            path,
            name: 'EKP:n talletuskorko, 12 kuukauden euribor, inflaatio ja reaalikorko',
            description: `EKP:n talletuskoron muutokset, 12 kuukauden euriborin kuukausikeskiarvo, kuluttajahintaindeksin vuosimuutos ja niistä laskettu reaalikorko ${fmt.monthRange(k.months[0], L.month)}.`,
            creator: [ECB_ORG, TK_ORG],
            license: null, // mixed sources: ECB reuse policy + CC BY 4.0 (see the source line)
            basedOn: [ecbSrc.href, 'https://pxdata.stat.fi/PxWeb/pxweb/fi/StatFin/StatFin__khi/122p.px/'].filter(Boolean),
            start: k.months[0],
            end: L.month,
            updated,
            keywords: ['euribor', 'EKP', 'talletuskorko', 'reaalikorko', 'inflaatio'],
          }),
        ],
        main,
      }),
    },
  ];
}
