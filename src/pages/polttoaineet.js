/**
 * /polttoaineet/ – monthly average fuel prices (Tilastokeskus 11xx):
 * latest month, change vs a month and a year earlier (€ and %), a long-run
 * chart (Chart.js with an SVG fallback), record highs and lows and the same
 * month in every year. These are monthly averages, not today's pump prices.
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import { html } from '../../scripts/lib/html.js';
import { fitText, metaSource, datasetLd, interactiveChart, downloadButton, signed, DESCRIPTION_MAX } from './hinnat.js';

/** Colour per fuel (series classes; khi/ykhi stay reserved for the indices). */
const FUEL_COLOURS = Object.freeze({ bensiini95: 's5', bensiini98: 's3', diesel: 's4', polttooljy: 'core' });
const SPARE_COLOURS = ['s6', 'ea'];
/** Genitive of the fuels named in the lede. */
const GENITIVE = Object.freeze({ bensiini95: 'bensiinin', diesel: 'dieselin' });

/** '2,09 €/l' */
export const perLitre = (v) => (fmt.isNum(v) ? `${fmt.num(v, 2)}${fmt.NBSP}€/l` : fmt.DASH);

/**
 * Latest price of every fuel with the changes from a month and a year earlier.
 * @param {any} p data/polttoaineet.json
 * @param {string} [month] 'YYYY-MM' (default: latest month with data)
 */
export function fuelRows(p, month) {
  const keys = Object.keys(p?.series ?? {});
  const last = month ? p.months.indexOf(month) : Math.max(...keys.map((k) => stats.latestIndex(p.series[k])));
  if (last < 0) return [];
  return keys.map((key) => {
    const s = p.series[key];
    const v = s[last] ?? null;
    const prev = s[last - 1] ?? null;
    const ya = s[last - 12] ?? null;
    const diffYear = fmt.isNum(v) && fmt.isNum(ya) ? fmt.round(v - ya, 3) : null;
    return {
      key,
      label: p.labels?.[key] ?? key,
      month: p.months[last],
      value: v,
      prev,
      yearAgo: ya,
      diffYear,
      pctYear: stats.totalChange(ya, v),
      pctMonth: stats.totalChange(prev, v),
    };
  });
}

/** @param {any} ctx */
export default async function polttoaineet(ctx) {
  const { c, svg } = ctx;
  const p = ctx.data.polttoaineet;
  const L = ctx.latest.polttoaineet;
  if (!p?.months?.length || !L?.month) throw new Error('polttoaineet: data/polttoaineet.json is missing (run npm run fetch)');
  const path = '/polttoaineet/';
  const month = L.month;
  const monthTxt = fmt.monthName(month);
  const rows = fuelRows(p, month);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const colour = (key, i) => FUEL_COLOURS[key] ?? SPARE_COLOURS[i % SPARE_COLOURS.length];
  const src = metaSource(ctx, 'polttoaineet', 'polttonesteiden keskihinnat, taulukko 11xx');
  const updated = ctx.latest.updated?.polttoaineet;
  const yearAgo = fmt.ymAdd(month, -12);

  // Lede: petrol and diesel (when present), otherwise every fuel.
  const b = byKey.bensiini95;
  const d = byKey.diesel;
  const verb = (x) => (x > 0 ? 'nousi' : x < 0 ? 'laski' : 'pysyi ennallaan');
  const change = (r) => (fmt.isNum(r.diffYear) && r.diffYear !== 0 ? `${verb(r.diffYear)} ${fmt.eur(Math.abs(r.diffYear), 2)} (${signed(r.pctYear)})` : verb(0));
  let lede;
  if (b && d && fmt.isNum(b.value) && fmt.isNum(d.value)) {
    lede = `${b.label} maksoi ${fmt.inessive(month)} keskimäärin ${perLitre(b.value)} ja diesel ${perLitre(d.value)}. Vuodessa ${GENITIVE.bensiini95} litrahinta ${change(b)} ja ${GENITIVE.diesel} ${change(d)}.`;
  } else {
    lede = `Polttonesteiden keskihinnat ${fmt.inessive(month)}: ${rows.filter((r) => fmt.isNum(r.value)).map((r) => `${r.label} ${perLitre(r.value)}`).join(', ')}.`;
  }

  const header = c.pageHeader({
    eyebrow: `Polttoaineet · ${monthTxt}`,
    title: 'Polttoaineiden keskihinnat',
    lede,
    meta: c.sourceLine({ sources: [src], updated }),
  });

  const kpis = c.kpiGrid(
    rows.map((r) =>
      c.kpiCard({
        label: r.label,
        value: fmt.isNum(r.value) ? fmt.num(r.value, 2) : null,
        unit: '€/l',
        note: fmt.isNum(r.pctYear) ? c.deltaChip({ value: r.pctYear, unit: 'pct', context: 'vuodessa' }) : null,
        foot: `${fmt.capitalize(fmt.monthShort(month))} · vuotta aiemmin ${perLitre(r.yearAgo)}`,
      }),
    ),
  );

  const table = c.dataTable({
    id: 'keskihinnat-taulukko',
    caption: `Polttonesteiden keskihinnat, ${monthTxt} (€/l)`,
    columns: [
      { label: 'Polttoaine' },
      { label: fmt.capitalize(fmt.monthShort(month)), num: true },
      { label: fmt.capitalize(fmt.monthShort(fmt.ymAdd(month, -1))), num: true },
      { label: fmt.capitalize(fmt.monthShort(yearAgo)), num: true },
      { label: 'Muutos vuodessa, €', num: true },
      { label: 'Muutos vuodessa, %', num: true },
    ],
    rows: rows.map((r) => [
      r.label,
      c.numUnit(perLitre(r.value)),
      c.numUnit(perLitre(r.prev)),
      c.numUnit(perLitre(r.yearAgo)),
      c.numUnit(fmt.eur(r.diffYear, 2, { sign: true })),
      c.deltaChip({ value: r.pctYear, unit: 'pct', plain: true }),
    ]),
    note: `Kuukauden keskihinnat euroina litralta. Lähde: Tilastokeskus, polttonesteiden keskihinnat (${monthTxt}).`,
  });

  // Long-run chart
  const keys = rows.map((r) => r.key);
  const all = stats.sliceRange(p.months, keys.map((k) => p.series[k]), 'kaikki');
  const period = fmt.monthRange(all.months[0], all.months.at(-1));
  const eurAxis = (v, step) => `${fmt.num(v, step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}${fmt.NBSP}€`;
  const fallback = svg.lineChart({
    series: keys.map((k, i) => ({ values: all.series[i], cls: colour(k, i), label: byKey[k].label, formatValue: (v) => `${fmt.num(v, 2)}${fmt.NBSP}€` })),
    labels: all.months,
    formatY: eurAxis,
    height: 320,
    ariaLabel: `Polttonesteiden keskihinnat kuukausittain ${period}, euroa litralta. ${rows.map((r) => `${r.label} ${perLitre(r.value)}`).join(', ')} ${fmt.inessive(month)}.`,
  });
  const spec = {
    label: `Polttonesteiden keskihinnat kuukausittain, euroa litralta, viimeisin ${monthTxt}`,
    months: p.months,
    unit: '€/l',
    decimals: 2,
    ranges: ['1v', '3v', '5v', '10v', 'kaikki'],
    range: 'kaikki',
    datasets: keys.map((k, i) => ({ type: 'line', series: colour(k, i), label: byKey[k].label, data: p.series[k] })),
    download: { filename: `polttoaineiden-hinnat-${month}.png`, title: 'Polttonesteiden keskihinnat (€/l)', source: 'Lähde: Tilastokeskus · inflaatio.fi' },
  };
  const extremes = rows.map((r) => ({ r, max: stats.max(p.months, p.series[r.key]), min: stats.min(p.months, p.series[r.key]) }));
  const monthsList = (x) => x?.months?.map((m) => fmt.monthShort(m)).join(', ') ?? fmt.DASH;
  const dz = extremes.find((e) => e.r.key === 'diesel') ?? extremes[0];
  const chart = c.chartFigure({
    id: 'hintahistoria',
    title: 'Keskihinnat kuukausittain',
    subtitle: `Euroa litralta · ${period}`,
    legend: c.legend(keys.map((k, i) => ({ cls: colour(k, i), label: byKey[k].label }))),
    chart: interactiveChart(ctx, { id: 'hintahistoria', spec, fallback }),
    summary: `${dz.r.label} oli kalleimmillaan ${perLitre(dz.max?.value)} (${monthsList(dz.max)}) ja halvimmillaan ${perLitre(dz.min?.value)} (${monthsList(dz.min)}). ${fmt.capitalize(fmt.inessive(month))} se maksoi ${perLitre(dz.r.value)}.`,
    table: c.dataTable({
      id: 'hintahistoria-taulukko',
      caption: `Polttonesteiden keskihinnat kuukausittain, €/l, ${period}`,
      columns: [{ label: 'Kuukausi' }, ...keys.map((k) => ({ label: byKey[k].label, num: true }))],
      rows: all.months.map((ym, i) => [fmt.monthShort(ym), ...keys.map((_, j) => fmt.num(all.series[j][i], 2))]).reverse(),
      visibleRows: 12,
      compact: true,
      toggleLabels: { more: `Näytä kaikki kuukaudet (${all.months.length})`, less: 'Näytä vain 12 viimeisintä' },
    }),
    source: c.sourceLine({ sources: [src], updated }),
    actions: downloadButton(ctx, 'hintahistoria'),
  });

  const extremesTable = c.dataTable({
    id: 'ennatykset-taulukko',
    caption: `Korkein ja matalin kuukauden keskihinta, ${period}`,
    columns: [{ label: 'Polttoaine' }, { label: 'Korkein', num: true }, { label: 'Kuukausi' }, { label: 'Matalin', num: true }, { label: 'Kuukausi' }],
    rows: extremes.map((e) => [e.r.label, c.numUnit(perLitre(e.max?.value)), monthsList(e.max), c.numUnit(perLitre(e.min?.value)), monthsList(e.min)]),
  });

  // The same month in every year
  const mNum = fmt.parseYm(month).m;
  const sameMonth = p.months.map((ym, i) => ({ ym, i })).filter((x) => fmt.parseYm(x.ym).m === mNum).reverse();
  const monthGen = fmt.genitive(month, { year: false });
  const yearTable = c.dataTable({
    id: 'vuosivertailu-taulukko',
    caption: `${fmt.capitalize(monthGen)} keskihinnat vuosittain, €/l`,
    columns: [{ label: 'Vuosi' }, ...keys.map((k) => ({ label: byKey[k].label, num: true }))],
    rows: sameMonth.map((x) => [String(fmt.yearOf(x.ym)), ...keys.map((k) => fmt.num(p.series[k][x.i], 2))]),
    visibleRows: 10,
    compact: true,
    toggleLabels: { more: `Näytä kaikki vuodet (${sameMonth.length})`, less: 'Näytä vain 10 viimeisintä vuotta' },
  });

  const note = c.callout({
    tone: 'info',
    title: 'Kuukauden keskihinta, ei päivän pumppuhinta',
    body: html`<p>Luvut ovat Tilastokeskuksen kuluttajahintatilastoa varten laskemia kuukauden keskihintoja. Ne eivät kerro, mitä polttoaine maksaa tänään tietyllä asemalla: pumppuhinnat vaihtelevat asemittain, alueittain ja päivittäin. Tilastokeskus julkaisee kuukauden keskihinnat yleensä kuun lopussa, joten luku päivittyy kerran kuukaudessa.</p>`,
  });

  const links = html`<ul class="topic-links">
  <li><a href="/hinnat/bensiini/">Bensiinin hintaindeksi</a>, <a href="/hinnat/diesel/">dieselin hintaindeksi</a> ja <a href="/hinnat/lammitysoljy/">lämmitysöljyn hintaindeksi</a>: hintojen muutos kuluttajahintaindeksissä</li>
  <li><a href="/hinnat/">Mikä inflaatiota nostaa?</a> Liikenteen ja energian vaikutus inflaatioon</li>
</ul>`;

  const main = html`${header}
${c.section({ id: 'hinnat-nyt', title: 'Keskihinnat nyt', className: 'section--flush-top', body: html`<div class="stack-lg">${kpis}${table}${note}</div>` })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Hinnat vuodesta ' + fmt.yearOf(all.months[0]), intro: 'Kuukauden keskihinnat euroina litralta. Valitse aikaväli kaavion yläpuolelta.', body: chart })}
${c.section({ id: 'vertailu', eyebrow: 'Vertailu', title: 'Ennätykset ja vuosivertailu', intro: `Kalleimmat ja halvimmat kuukaudet sekä ${monthGen} keskihinnat vuosittain.`, body: html`<div class="stack-lg">${extremesTable}${yearTable}</div>` })}
${c.section({ id: 'lisaa', title: 'Lisää aiheesta', body: links })}`;

  const bTxt = b && fmt.isNum(b.value) ? `${b.label} maksoi ${fmt.inessive(month)} ${perLitre(b.value)} (${signed(b.pctYear)} vuodessa)` : null;
  const dTxt = d && fmt.isNum(d.value) ? `diesel ${perLitre(d.value)} (${signed(d.pctYear)})` : null;
  const description = fitText(
    [
      bTxt && dTxt ? `${bTxt}, ${dTxt}. Tilastokeskuksen kuukausikeskihinnat vuodesta ${fmt.yearOf(all.months[0])}.` : null,
      bTxt && dTxt ? `${bTxt}, ${dTxt}. Lähde: Tilastokeskus.` : null,
      `Bensiinin, dieselin ja polttoöljyn keskihinnat ${fmt.inessive(month)} ja kehitys vuodesta ${fmt.yearOf(all.months[0])} (Tilastokeskus).`,
    ],
    DESCRIPTION_MAX,
  );

  return [
    {
      path,
      priority: 0.7,
      changefreq: 'monthly',
      html: ctx.layout({
        title: fitText([`Bensiinin ja dieselin keskihinta (${fmt.monthShort(month)})`, 'Polttoaineiden keskihinnat']),
        description,
        path,
        page: 'polttoaineet',
        scripts: ['pages/hinnat.js'],
        breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Polttoaineet'),
        jsonLd: [
          datasetLd(ctx, {
            path,
            name: 'Polttonesteiden keskihinnat kuukausittain',
            description: `Bensiinin (95 E10 ja 98 E5), dieselin ja kevyen polttoöljyn kuukauden keskihinnat euroina litralta ${period}. Lähde: Tilastokeskus.`,
            basedOn: src.href,
            start: all.months[0],
            end: month,
            updated,
            keywords: ['bensiinin hinta', 'dieselin hinta', 'polttoöljyn hinta', 'polttoaineet'],
          }),
        ],
        main,
      }),
    },
  ];
}
