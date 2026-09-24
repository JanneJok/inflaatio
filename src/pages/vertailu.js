/**
 * /vertailu/ – Finland compared with the euro area, the EU, the Nordic
 * countries, Germany and Estonia (Eurostat HICP = YKHI): latest annual rates
 * with their months, Finland's rank among the EU member states, charts, core
 * inflation (TOT_X_NRG_FOOD) for Finland and the euro area, the KHI − YKHI
 * difference with a plain-language explanation, the ECB 2 % target and the
 * published forecasts of src/content/ennusteet.json.
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import { html } from '../../scripts/lib/html.js';
import { fitText, datasetLd, itemsByCode, DESCRIPTION_MAX } from './hinnat.js';

/** Comparison areas in display order. */
export const GEOS = Object.freeze(['FI', 'EA', 'EU', 'SE', 'DK', 'NO', 'DE', 'EE']);
const EUROSTAT_ORG = Object.freeze({ '@type': 'Organization', name: 'Eurostat', url: 'https://ec.europa.eu/eurostat' });
const TARGET = 2;

/**
 * Latest annual rate of every area with its month (areas may end in different months).
 * @param {any} y data/ykhi.json
 */
export function latestByGeo(y) {
  return GEOS.filter((g) => y?.geo?.[g]?.yoy).map((geo) => {
    const s = y.geo[geo].yoy;
    const li = stats.latestIndex(s);
    const month = li >= 0 ? y.months[li] : null;
    const prev = li > 0 && fmt.isNum(s[li - 1]) ? s[li - 1] : null;
    return {
      geo,
      label: y.labels?.[geo] ?? geo,
      month,
      value: li >= 0 ? s[li] : null,
      prev,
      delta: stats.ppChange(s[li], prev),
      yearAgo: li >= 12 && fmt.isNum(s[li - 12]) ? s[li - 12] : null,
      provisional: month ? y.flags?.[geo]?.[month] === 'p' : false,
    };
  });
}

/**
 * Rank of `geo` among the EU member states in the latest month where it has
 * a value (1 = lowest inflation); ties share the better rank.
 * @param {any} y data/ykhi.json
 * @param {string} [geo='FI']
 */
export function euRank(y, geo = 'FI') {
  const c = y?.countries;
  const own = c?.yoy?.[geo];
  if (!own) return null;
  const i = stats.latestIndex(own);
  if (i < 0) return null;
  const values = Object.entries(c.yoy)
    .map(([g, arr]) => ({ geo: g, label: c.labels?.[g] ?? g, value: arr[i] }))
    .filter((v) => fmt.isNum(v.value))
    .sort((a, b) => a.value - b.value || a.label.localeCompare(b.label, 'fi'));
  const value = own[i];
  return {
    month: c.months[i],
    value,
    rank: 1 + values.filter((v) => v.value < value).length,
    total: values.length,
    values,
  };
}

/**
 * KHI − YKHI (Finland) by complete year from the official annual tables.
 * @param {any} data ctx.data
 * @param {number} [years=10] how many latest complete years
 */
export function annualGaps(data, years = 10) {
  const ka = data?.['khi-annual'];
  const ya = data?.['ykhi-annual'];
  if (!ka?.years || !ya?.geo?.FI) return [];
  return ya.years
    .map((yr, i) => {
      const khi = ka.yoy[ka.years.indexOf(yr)];
      const ykhi = ya.geo.FI[i];
      return { year: yr, khi: fmt.isNum(khi) ? khi : null, ykhi: fmt.isNum(ykhi) ? ykhi : null, gap: stats.ppChange(khi, ykhi) };
    })
    .filter((r) => r.gap != null)
    .slice(-years);
}

/** @param {any} ctx */
export default async function vertailu(ctx) {
  const { c, svg } = ctx;
  const y = ctx.data.ykhi;
  const khi = ctx.data.khi;
  if (!y?.geo?.FI || !y?.geo?.EA) throw new Error('vertailu: data/ykhi.json is missing (run npm run fetch)');
  const path = '/vertailu/';
  const rows = latestByGeo(y);
  const by = Object.fromEntries(rows.map((r) => [r.geo, r]));
  const fi = by.FI;
  const ea = by.EA;
  const month = fi.month;
  const monthTxt = fmt.monthName(month);
  const updated = ctx.latest.updated?.ykhi;
  const esSrc = { name: 'Eurostat', href: ctx.data.meta?.sources?.ykhi?.url ?? 'https://ec.europa.eu/eurostat/web/hicp', detail: 'yhdenmukaistettu kuluttajahintaindeksi (YKHI)' };
  const khiSrc = { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' };
  const ennakko = (r) => (r?.provisional ? ' (ennakko)' : '');
  const rank = euRank(y, 'FI');

  // Headline sentence
  const gap = stats.ppChange(fi.value, ea.value);
  const sameMonth = fi.month === ea.month;
  let headline;
  if (!sameMonth) {
    headline = `Suomen inflaatio oli ${fmt.inessive(fi.month)} ${fmt.pct(fi.value)}${ennakko(fi)} ja euroalueen ${fmt.inessive(ea.month)} ${fmt.pct(ea.value)}${ennakko(ea)}.`;
  } else if (gap === 0) {
    headline = `Suomen inflaatio (${fmt.pct(fi.value)}) oli ${fmt.inessive(month)} yhtä suuri kuin euroalueella${ennakko(fi)}.`;
  } else {
    headline = `Suomen inflaatio (${fmt.pct(fi.value)}${ennakko(fi)}) oli ${fmt.inessive(month)} ${fmt.num(Math.abs(gap), 1)} prosenttiyksikköä euroalueen (${fmt.pct(ea.value)}) ${gap < 0 ? 'alapuolella' : 'yläpuolella'}.`;
  }

  const header = c.pageHeader({
    eyebrow: `Vertailu · ${monthTxt}`,
    title: 'Suomen inflaatio vertailussa',
    lede: `${headline} Vertailussa käytetään EU:n yhdenmukaistettua kuluttajahintaindeksiä (YKHI, engl. HICP), joka lasketaan kaikissa maissa samalla tavalla.`,
    meta: c.sourceLine({ sources: [esSrc], updated }),
  });

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Suomi (YKHI)', value: fmt.pct(fi.value), note: `${fmt.capitalize(fmt.monthName(fi.month))}${ennakko(fi)}` }),
    c.kpiCard({ label: 'Euroalue', value: fmt.pct(ea.value), note: `${fmt.capitalize(fmt.monthName(ea.month))}${ennakko(ea)}` }),
    c.kpiCard({ label: 'Ero euroalueeseen', value: sameMonth ? fmt.pp(gap) : null, note: sameMonth ? `Suomi − euroalue, ${monthTxt}` : 'Kuukaudet eroavat' }),
    c.kpiCard({ label: 'Sija EU-maiden joukossa', value: rank ? `${rank.rank}.` : null, note: rank ? `${rank.total} maasta, matalimmasta korkeimpaan (${fmt.monthShort(rank.month)})` : null }),
  ]);

  // Latest table + bars
  const geoCls = { FI: 'ykhi', EA: 'ea' };
  const sorted = [...rows].filter((r) => fmt.isNum(r.value)).sort((a, b) => b.value - a.value);
  const barsFigure = c.chartFigure({
    id: 'maat-kaavio',
    title: `Vuosi-inflaatio maittain, ${monthTxt}`,
    subtitle: 'Vuosimuutos, % (YKHI)',
    legend: c.legend([
      { cls: 'ykhi', label: 'Suomi', box: true },
      { cls: 'ea', label: 'Euroalue', box: true },
      { cls: 's6', label: 'Muut', box: true },
    ]),
    chart: svg.hBarChart({
      bars: sorted.map((r) => ({ label: `${r.label}${r.month !== month ? ` (${fmt.monthShort(r.month)})` : ''}`, value: r.value, cls: geoCls[r.geo] ?? 's6', title: `${r.label}, ${fmt.monthShort(r.month)}: ${fmt.pct(r.value)}` })),
      formatValue: (v) => fmt.pct(v),
      ariaLabel: `Vuosi-inflaatio ${fmt.inessive(month)}: ${sorted.map((r) => `${r.label} ${fmt.pct(r.value)}`).join(', ')}.`,
    }),
    summary: `Korkein: ${sorted[0].label} ${fmt.pct(sorted[0].value)}, matalin: ${sorted.at(-1).label} ${fmt.pct(sorted.at(-1).value)}. Suomi ${fmt.pct(fi.value)}, euroalue ${fmt.pct(ea.value)}. EKP:n tavoite on ${TARGET} %.`,
    source: c.sourceLine({ sources: [esSrc], updated }),
  });
  const latestTable = c.dataTable({
    id: 'maat-taulukko',
    caption: 'Vuosi-inflaatio maittain (YKHI), viimeisin kuukausi',
    columns: [
      { label: 'Alue' },
      { label: 'Kuukausi' },
      { label: 'Vuosimuutos', num: true },
      { label: 'Muutos edellisestä kuukaudesta', num: true },
      { label: 'Vuotta aiemmin', num: true },
    ],
    rows: rows.map((r) => ({
      className: r.geo === 'FI' ? 'is-highlight' : null,
      cells: [
        r.label,
        html`${fmt.monthShort(r.month)}${r.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`,
        c.numUnit(fmt.pct(r.value)),
        r.delta == null ? fmt.DASH : c.deltaChip({ value: r.delta, plain: true }),
        c.numUnit(fmt.pct(r.yearAgo)),
      ],
    })),
    note: 'Euroalue = euroalueen maat kunkin ajankohdan kokoonpanossa. EU = EU:n 27 jäsenmaata. Norja ei ole EU:n jäsen, mutta se raportoi YKHI-luvut Eurostatille. Lähde: Eurostat.',
  });

  // Charts over time
  const areaChart = (id, title, geos, rangeKey, colours) => {
    const list = geos.filter((g) => y.geo[g]?.yoy);
    const r = stats.sliceRange(y.months, list.map((g) => y.geo[g].yoy), rangeKey);
    const period = fmt.monthRange(r.months[0], r.months.at(-1));
    return c.chartFigure({
      id,
      title,
      subtitle: `Vuosimuutos, % (YKHI) · ${period}`,
      legend: c.legend([...list.map((g, i) => ({ cls: colours[i], label: y.labels?.[g] ?? g })), { cls: 'target', label: `EKP:n tavoite ${TARGET} %`, dashed: true }]),
      chart: svg.lineChart({
        series: list.map((g, i) => ({ values: r.series[i], cls: colours[i], label: y.labels?.[g] ?? g })),
        labels: r.months,
        refLines: [{ value: TARGET, cls: 'target' }],
        height: 300,
        ariaLabel: `Vuosi-inflaatio ${period}: ${list.map((g) => `${y.labels?.[g] ?? g} ${fmt.pct(by[g]?.value)}`).join(', ')} (viimeisin kuukausi).`,
      }),
      summary: `Viimeisimmät luvut: ${list.map((g) => `${y.labels?.[g] ?? g} ${fmt.pct(by[g]?.value)} (${fmt.monthShort(by[g]?.month)})`).join(', ')}.`,
      table: c.dataTable({
        id: `${id}-taulukko`,
        caption: `${title}: vuosimuutos kuukausittain, ${period}`,
        columns: [{ label: 'Kuukausi' }, ...list.map((g) => ({ label: y.labels?.[g] ?? g, num: true }))],
        rows: r.months.map((ym, i) => [fmt.monthShort(ym), ...list.map((_, j) => c.numUnit(fmt.pct(r.series[j][i])))]).reverse(),
        visibleRows: 12,
        compact: true,
      }),
      source: c.sourceLine({ sources: [esSrc], updated }),
    });
  };
  const trends = html`<div class="stack-lg">
${areaChart('suomi-euroalue', 'Suomi, euroalue ja EU', ['FI', 'EA', 'EU'], '10v', ['ykhi', 'ea', 's5'])}
<div class="vertailu-two">
${areaChart('pohjoismaat', 'Suomi ja muut Pohjoismaat', ['FI', 'SE', 'DK', 'NO'], '5v', ['ykhi', 's5', 's3', 's4'])}
${areaChart('saksa-viro', 'Suomi, Saksa ja Viro', ['FI', 'DE', 'EE'], '5v', ['ykhi', 's6', 'core'])}
</div>
</div>`;

  const targetNote = c.callout({
    tone: 'info',
    title: `EKP:n tavoite on ${TARGET} %`,
    body: html`<p>Euroopan keskuspankki (EKP) tavoittelee euroalueelle ${TARGET} %:n inflaatiota keskipitkällä aikavälillä YKHI:llä mitattuna. Euroalueen inflaatio oli ${fmt.inessive(ea.month)} ${fmt.pct(ea.value)}${ennakko(ea)}, ${fmt.num(Math.abs(stats.ppChange(ea.value, TARGET)), 1)} prosenttiyksikköä tavoitteen ${ea.value >= TARGET ? 'yläpuolella' : 'alapuolella'}. EKP:n korkopäätökset ja euribor: <a href="/korot/">korot ja inflaatio</a>.</p>`,
  });

  // EU ranking
  let euSection = '';
  if (rank) {
    const low = rank.values[0];
    const high = rank.values.at(-1);
    const euBars = svg.hBarChart({
      bars: rank.values.map((v) => ({ label: v.label, value: v.value, cls: v.geo === 'FI' ? 'ykhi' : 's6' })),
      formatValue: (v) => fmt.pct(v),
      rowHeight: 36,
      barHeight: 8,
      ariaLabel: `EU-maiden vuosi-inflaatio ${fmt.inessive(rank.month)} matalimmasta korkeimpaan. Suomi ${fmt.pct(rank.value)}, sija ${rank.rank}/${rank.total}.`,
    });
    euSection = c.section({
      id: 'eu-maat',
      eyebrow: 'EU-maat',
      title: `Suomi sijalla ${rank.rank}/${rank.total}`,
      intro: `EU-maat järjestettynä matalimmasta inflaatiosta korkeimpaan, ${fmt.monthName(rank.month)}.`,
      body: c.chartFigure({
        id: 'eu-kaavio',
        title: `EU-maiden vuosi-inflaatio, ${fmt.monthName(rank.month)}`,
        subtitle: 'Vuosimuutos, % (YKHI)',
        legend: c.legend([
          { cls: 'ykhi', label: 'Suomi', box: true },
          { cls: 's6', label: 'Muut EU-maat', box: true },
        ]),
        chart: euBars,
        summary: `Suomen inflaatio ${fmt.pct(rank.value)} oli ${fmt.inessive(rank.month)} ${rank.rank}. matalin EU:n ${rank.total} jäsenmaan joukossa. Matalin: ${low.label} ${fmt.pct(low.value)}, korkein: ${high.label} ${fmt.pct(high.value)}.`,
        table: c.dataTable({
          id: 'eu-taulukko',
          caption: `EU-maiden vuosi-inflaatio (YKHI), ${fmt.monthName(rank.month)}`,
          columns: [{ label: 'Maa' }, { label: 'Sija', num: true }, { label: 'Vuosimuutos', num: true }],
          rows: rank.values.map((v) => ({ className: v.geo === 'FI' ? 'is-highlight' : null, cells: [v.label, `${1 + rank.values.filter((o) => o.value < v.value).length}.`, c.numUnit(fmt.pct(v.value))] })),
          compact: true,
        }),
        source: c.sourceLine({ sources: [esSrc], updated }),
      }),
    });
  }

  // Core inflation
  const fiCore = y.geo.FI.coreYoy;
  const eaCore = y.geo.EA.coreYoy;
  let coreSection = '';
  if (fiCore && eaCore) {
    const ci = stats.latestIndex(fiCore);
    const cMonth = y.months[ci];
    const fiC = fiCore[ci];
    const eaC = stats.seriesAt(y.months, eaCore, cMonth);
    const fiH = stats.seriesAt(y.months, y.geo.FI.yoy, cMonth);
    const d = stats.ppChange(fiH, fiC);
    let reading;
    if (d > 0.5) reading = 'Kokonaisinflaatiota nostavat nyt erityisesti energia, ruoka, alkoholi ja tupakka; muiden hintojen nousu on maltillisempaa.';
    else if (d < -0.5) reading = 'Energian, ruoan, alkoholin ja tupakan hinnat hillitsevät nyt kokonaisinflaatiota; muut hinnat nousevat nopeammin.';
    else reading = 'Pohjainflaatio ja kokonaisinflaatio ovat lähellä toisiaan, joten energia ja ruoka eivät nyt juuri muuta kokonaiskuvaa.';
    const r = stats.sliceRange(y.months, [y.geo.FI.yoy, fiCore, eaCore], '5v');
    const period = fmt.monthRange(r.months[0], r.months.at(-1));
    const series = [
      { cls: 'ykhi', label: 'Suomi, kokonaisinflaatio' },
      { cls: 'core', label: 'Suomi, pohjainflaatio' },
      { cls: 'ea', label: 'Euroalue, pohjainflaatio' },
    ];
    coreSection = c.section({
      id: 'pohjainflaatio',
      eyebrow: 'Pohjainflaatio',
      title: 'Onko hintojen nousu laaja-alaista?',
      intro: 'Pohjainflaatiosta on jätetty pois energia, ruoka, alkoholi ja tupakka, joiden hinnat heilahtelevat eniten.',
      body: html`<div class="stack-lg">${c.kpiGrid([
        c.kpiCard({ label: 'Pohjainflaatio, Suomi', value: fmt.pct(fiC), note: fmt.capitalize(fmt.monthName(cMonth)) }),
        c.kpiCard({ label: 'Pohjainflaatio, euroalue', value: fmt.pct(eaC), note: fmt.capitalize(fmt.monthName(cMonth)) }),
        c.kpiCard({ label: 'Kokonaisinflaatio, Suomi', value: fmt.pct(fiH), note: `YKHI, ${fmt.monthName(cMonth)}` }),
        c.kpiCard({ label: 'Ero, Suomi', value: fmt.pp(d), note: 'Kokonais- miinus pohjainflaatio' }),
      ])}
${c.chartFigure({
  id: 'pohjainflaatio-kaavio',
  title: 'Kokonais- ja pohjainflaatio',
  subtitle: `Vuosimuutos, % (YKHI) · ${period}`,
  legend: c.legend([...series.map((s) => ({ cls: s.cls, label: s.label })), { cls: 'target', label: `EKP:n tavoite ${TARGET} %`, dashed: true }]),
  chart: svg.lineChart({
    series: series.map((s, i) => ({ values: r.series[i], cls: s.cls, label: s.label })),
    labels: r.months,
    refLines: [{ value: TARGET, cls: 'target' }],
    height: 300,
    ariaLabel: `Kokonais- ja pohjainflaatio ${period}: Suomen pohjainflaatio ${fmt.pct(fiC)}, euroalueen ${fmt.pct(eaC)} ja Suomen kokonaisinflaatio ${fmt.pct(fiH)} (${fmt.monthShort(cMonth)}).`,
  }),
  summary: `Suomen pohjainflaatio oli ${fmt.inessive(cMonth)} ${fmt.pct(fiC)} ja kokonaisinflaatio ${fmt.pct(fiH)}. ${reading} Euroalueen pohjainflaatio oli ${fmt.pct(eaC)}.`,
  table: c.dataTable({
    id: 'pohjainflaatio-taulukko',
    caption: `Kokonais- ja pohjainflaatio kuukausittain, ${period}`,
    columns: [{ label: 'Kuukausi' }, ...series.map((s) => ({ label: s.label, num: true }))],
    rows: r.months.map((ym, i) => [fmt.monthShort(ym), ...series.map((_, j) => c.numUnit(fmt.pct(r.series[j][i])))]).reverse(),
    visibleRows: 12,
    compact: true,
  }),
  source: c.sourceLine({ sources: [{ ...esSrc, detail: 'YKHI ilman energiaa, ruokaa, alkoholia ja tupakkaa' }], updated }),
})}</div>`,
    });
  }

  // KHI − YKHI
  let gapSection = '';
  if (khi?.months) {
    const ykhiFrom = stats.firstIndex(y.geo.FI.yoy);
    const aligned = stats.alignMany([
      { months: khi.months, values: khi.yoy },
      { months: y.months.slice(ykhiFrom), values: y.geo.FI.yoy.slice(ykhiFrom) },
    ]);
    const diff = aligned.months.map((_, i) => stats.ppChange(aligned.values[0][i], aligned.values[1][i]));
    const r = stats.sliceRange(aligned.months, [...aligned.values, diff], '10v');
    const period = fmt.monthRange(r.months[0], r.months.at(-1));
    const li = stats.latestIndex(r.series[2]);
    const gMonth = r.months[li];
    const kNow = r.series[0][li];
    const yNow = r.series[1][li];
    const gNow = r.series[2][li];
    const gaps = annualGaps(ctx.data, 10);
    const maxPos = [...gaps].sort((a, b) => b.gap - a.gap)[0];
    const maxNeg = [...gaps].sort((a, b) => a.gap - b.gap)[0];
    const owner = itemsByCode(ctx.data.hyodykkeet).get('046');
    const loans = itemsByCode(ctx.data.hyodykkeet).get('0463');
    const hMonth = ctx.data.hyodykkeet?.latest;

    const nowTxt = gNow === 0
      ? `${fmt.capitalize(fmt.inessive(gMonth))} KHI ja YKHI olivat yhtä suuret (${fmt.pct(kNow)}).`
      : `${fmt.capitalize(fmt.inessive(gMonth))} KHI oli ${fmt.pct(kNow)} ja YKHI ${fmt.pct(yNow)}, joten KHI oli ${fmt.num(Math.abs(gNow), 1)} prosenttiyksikköä YKHI:tä ${gNow > 0 ? 'korkeampi' : 'matalampi'}.`;
    const yearsTxt = maxPos && maxNeg && maxPos.gap > 0 && maxNeg.gap < 0
      ? `Vuosina ${gaps[0].year}–${gaps.at(-1).year} KHI oli eniten YKHI:tä korkeampi vuonna ${maxPos.year} (${fmt.pct(maxPos.khi)} vs. ${fmt.pct(maxPos.ykhi)}) ja eniten matalampi vuonna ${maxNeg.year} (${fmt.pct(maxNeg.khi)} vs. ${fmt.pct(maxNeg.ykhi)}).`
      : '';
    const ownerTxt = owner && fmt.isNum(owner.weight)
      ? html` KHI:ssä omistusasumisen paino on ${fmt.num(owner.weight, 0)} ‰ eli noin ${fmt.num(owner.weight / 10, 0)} % kulutuksesta${loans && fmt.isNum(loans.weight) ? `, josta asuntolainojen korkojen osuus on ${fmt.num(loans.weight, 0)} ‰` : ''}. ${fmt.capitalize(fmt.inessive(hMonth))} omistusasumisen vaikutus KHI:n vuosimuutokseen oli ${fmt.num(owner.contribution, 2, { sign: true })} prosenttiyksikköä.`
      : '';

    const explanation = html`<div class="prose">
<p>Kuluttajahintaindeksi (KHI) ja yhdenmukaistettu kuluttajahintaindeksi (YKHI, engl. HICP) mittaavat samojen kulutustavaroiden ja -palvelujen hintoja, mutta niiden sisältö eroaa. <strong>Suurin ero: KHI sisältää omistusasumisen kuluja, kuten asuntolainojen korot ja uusien asuntojen hinnat, YKHI ei.</strong>${ownerTxt}</p>
<p>Siksi korkojen nousu nostaa KHI:tä YKHI:tä nopeammin, ja korkojen laskiessa vaikutus kääntyy. ${yearsTxt}</p>
<p>YKHI lasketaan kaikissa EU-maissa samalla tavalla, joten sillä verrataan maita keskenään ja EKP seuraa sillä ${TARGET} %:n tavoitettaan. KHI on Suomen virallinen inflaatiomittari, ja sen pohjalta lasketaan myös elinkustannusindeksi, johon monet vuokrasopimukset on sidottu. ${nowTxt}</p>
</div>`;

    const lineFigure = c.chartFigure({
      id: 'khi-ykhi-kaavio',
      title: 'KHI ja YKHI',
      subtitle: `Vuosimuutos, % · ${period}`,
      legend: c.legend([
        { cls: 'khi', label: 'KHI (Tilastokeskus)' },
        { cls: 'ykhi', label: 'YKHI (Eurostat)' },
      ]),
      chart: svg.lineChart({
        series: [
          { values: r.series[0], cls: 'khi', label: 'KHI' },
          { values: r.series[1], cls: 'ykhi', label: 'YKHI' },
        ],
        labels: r.months,
        refLines: [{ value: 0, cls: 'muted' }],
        height: 300,
        ariaLabel: `KHI ja YKHI ${period}: ${fmt.monthShort(gMonth)} KHI ${fmt.pct(kNow)}, YKHI ${fmt.pct(yNow)}.`,
      }),
      summary: nowTxt,
      source: c.sourceLine({ sources: [khiSrc, esSrc], updated: ctx.latest.updated?.khi }),
    });
    const diffFigure = c.chartFigure({
      id: 'khi-ykhi-ero',
      title: 'Ero: KHI miinus YKHI',
      subtitle: `Prosenttiyksikköä · ${period}`,
      legend: c.legend([{ cls: 's6', label: 'KHI − YKHI' }]),
      chart: svg.lineChart({
        series: [{ values: r.series[2], cls: 's6', label: 'KHI − YKHI', formatValue: (v) => fmt.num(v, 1, { sign: true }) }],
        labels: r.months,
        refLines: [{ value: 0, cls: 'muted' }],
        formatY: (v, step) => fmt.num(v, step >= 1 ? 0 : 1),
        height: 240,
        ariaLabel: `KHI:n ja YKHI:n ero ${period}, viimeisin ${fmt.pp(gNow)} (${fmt.monthShort(gMonth)}).`,
      }),
      summary: `Kun viiva on nollan yläpuolella, KHI on YKHI:tä korkeampi. Ero oli ${fmt.inessive(gMonth)} ${fmt.num(gNow, 1, { sign: gNow !== 0 })} prosenttiyksikköä.`,
      table: c.dataTable({
        id: 'khi-ykhi-taulukko',
        caption: `KHI, YKHI ja niiden ero kuukausittain, ${period}`,
        columns: [{ label: 'Kuukausi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Ero, %-yks.', num: true }],
        rows: r.months.map((ym, i) => [fmt.monthShort(ym), c.numUnit(fmt.pct(r.series[0][i])), c.numUnit(fmt.pct(r.series[1][i])), c.numUnit(fmt.pp(r.series[2][i]))]).reverse(),
        visibleRows: 12,
        compact: true,
      }),
      source: c.sourceLine({ sources: [khiSrc, esSrc] }),
    });
    const annualTable = gaps.length
      ? c.dataTable({
          id: 'vuodet-taulukko',
          caption: `KHI ja YKHI vuosittain ${gaps[0].year}–${gaps.at(-1).year} (viralliset vuosimuutokset)`,
          columns: [{ label: 'Vuosi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Ero, %-yks.', num: true }],
          rows: [...gaps].reverse().map((g) => [g.year, c.numUnit(fmt.pct(g.khi)), c.numUnit(fmt.pct(g.ykhi)), c.numUnit(fmt.pp(g.gap))]),
          compact: true,
          note: 'Lähteet: Tilastokeskus (KHI, taulukko 122q) ja Eurostat (YKHI, prc_hicp_ainr).',
        })
      : '';
    gapSection = c.section({
      id: 'khi-ykhi',
      eyebrow: 'KHI vai YKHI?',
      title: 'Miksi Suomen kaksi inflaatiolukua eroavat?',
      intro: 'Tilastokeskuksen kuluttajahintaindeksi ja EU:n yhdenmukaistettu indeksi eroavat asumiskulujen osalta.',
      body: html`<div class="stack-lg">${explanation}<div class="vertailu-two">${lineFigure}${diffFigure}</div>${annualTable}</div>`,
    });
  }

  // Forecasts (src/content/ennusteet.json, verified from the publishers' pages)
  const forecasts = Array.isArray(ctx.content.ennusteet) ? ctx.content.ennusteet.filter((f) => f?.values && f.url) : [];
  let forecastSection = '';
  if (forecasts.length) {
    const years = [...new Set(forecasts.flatMap((f) => Object.keys(f.values)))].sort();
    const areaLabel = (f) => (f.area === 'EA' ? 'euroalue' : 'Suomi');
    forecastSection = c.section({
      id: 'ennusteet',
      eyebrow: 'Ennusteet',
      title: 'Mitä inflaatiolle ennustetaan?',
      intro: 'Suomen Pankin, valtiovarainministeriön ja EKP:n uusimmat julkaistut ennusteet. Inflaatio.fi ei laadi omia ennusteita.',
      body: c.dataTable({
        id: 'ennusteet-taulukko',
        caption: 'Inflaatioennusteet vuosittain, %',
        columns: [{ label: 'Ennustaja' }, { label: 'Mittari' }, ...years.map((yr) => ({ label: yr, num: true })), { label: 'Julkaistu' }],
        rows: forecasts.map((f) => [
          html`<a href="${f.url}">${f.org}</a><span class="vertailu-sub">${f.title}</span>`,
          `${f.measure}, ${areaLabel(f)}`,
          ...years.map((yr) => c.numUnit(fmt.pct(f.values[yr]))),
          html`<time datetime="${f.published}">${fmt.date(f.published)}</time>`,
        ]),
        note: `KHI = Tilastokeskuksen kuluttajahintaindeksi, YKHI = yhdenmukaistettu kuluttajahintaindeksi (HICP). EKP:n luvut koskevat euroaluetta, muut Suomea. Luvut on tarkistettu julkaisijoiden sivuilta ${fmt.date(forecasts.map((f) => f.verified).filter(Boolean).sort().at(-1) ?? forecasts[0].published)}.`,
      }),
    });
  }

  const main = html`${header}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--flush-top', body: kpis })}
${c.section({ id: 'maat', eyebrow: 'Viimeisin kuukausi', title: 'Suomi, euroalue ja naapurit', intro: 'Vuosi-inflaatio YKHI:llä mitattuna. Kuukausi näkyy jokaisen luvun vieressä.', body: html`<div class="stack-lg">${barsFigure}${latestTable}</div>` })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Inflaatio vuosien varrella', intro: 'Suomen inflaatio verrattuna euroalueeseen, Pohjoismaihin, Saksaan ja Viroon.', body: html`<div class="stack-lg">${targetNote}${trends}</div>` })}
${euSection}
${coreSection}
${gapSection}
${forecastSection}`;

  const description = fitText(
    [
      `Suomen inflaatio (YKHI) oli ${fmt.inessive(month)} ${fmt.pct(fi.value)}, euroalueen ${fmt.pct(ea.value)}. Vertailu Pohjoismaihin, Saksaan ja Viroon, pohjainflaatio ja KHI:n ja YKHI:n ero.`,
      `Suomen inflaatio (YKHI) ${fmt.inessive(month)} ${fmt.pct(fi.value)}, euroalue ${fmt.pct(ea.value)}. Vertailu Pohjoismaihin ja EU-maihin (Eurostat).`,
    ],
    DESCRIPTION_MAX,
  );
  return [
    {
      path,
      priority: 0.7,
      changefreq: 'monthly',
      html: ctx.layout({
        title: fitText([`Inflaatio Suomessa ja euroalueella (${fmt.monthShort(month)})`, 'Inflaatio Suomessa ja euroalueella']),
        description,
        path,
        page: 'vertailu',
        breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Vertailu'),
        jsonLd: [
          datasetLd(ctx, {
            path,
            name: 'Inflaatio Suomessa, euroalueella ja EU-maissa (YKHI)',
            description: `Yhdenmukaistetun kuluttajahintaindeksin (YKHI, HICP) vuosimuutos Suomessa, euroalueella, EU:ssa, Pohjoismaissa, Saksassa ja Virossa sekä pohjainflaatio, viimeisin ${monthTxt}. Lähde: Eurostat.`,
            creator: [EUROSTAT_ORG],
            basedOn: esSrc.href,
            start: y.months[stats.firstIndex(y.geo.FI.yoy)],
            end: month,
            updated,
            keywords: ['inflaatio', 'euroalue', 'YKHI', 'HICP', 'pohjainflaatio', 'EU-maat'],
          }),
        ],
        main,
      }),
    },
  ];
}
