/**
 * /tyylit/ – internal style guide (noindex, not in the sitemap).
 * Renders every component of the design system in its states, with real data
 * from ctx.data when the data files exist and clearly labelled sample values
 * otherwise, plus light and dark panels side by side. Later agents and QA use
 * this page to see the system; it is not linked from the navigation.
 */

/* Sample values (used only when data/*.json is missing; labelled on the page).
   KHI/YKHI annual rates 2021-08…2026-08 and annual means 1980–2025. */
const SAMPLE_START = '2021-08';
const SAMPLE_KHI = [2.2, 2.5, 3.2, 3.7, 3.5, 4.4, 4.5, 5.8, 5.7, 7, 7.8, 7.8, 7.6, 8.1, 8.3, 9.1, 9.1, 8.4, 8.8, 7.9, 7.9, 6.8, 6.3, 6.5, 5.6, 5.5, 4.9, 3.3, 3.6, 3.3, 3, 2.2, 1.9, 1.5, 1.3, 1, 1.2, 0.8, 1.1, 1, 0.7, 0.7, 0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.5, 0.5, -0.2, -0.1, 0.2, -0.2, 0.6, 1.3, 1.5, 2.1, 2.1, 2.1, 2.2];
const SAMPLE_INDEX = [105.96, 106.29, 107.09, 107.57, 107.49, 108.8, 109.36, 110.95, 111.3, 112.76, 113.57, 113.94, 114.03, 114.92, 115.99, 117.4, 117.32, 117.99, 118.98, 119.75, 120.12, 120.45, 120.69, 121.3, 120.43, 121.28, 121.62, 121.22, 121.54, 121.85, 122.5, 122.36, 122.39, 122.25, 122.23, 122.49, 121.89, 122.26, 122.92, 122.47, 122.39, 122.69, 123.06, 123.01, 122.98, 122.82, 122.53, 122.76, 122.47, 122.88, 122.69, 122.4, 122.67, 122.48, 123.78, 124.67, 124.82, 125.38, 125.07, 125.38, 125.15];
const SAMPLE_YKHI = [1.8, 2.1, 2.8, 3.5, 3.2, 4.1, 4.4, 5.8, 5.8, 7.1, 8.1, 8, 7.9, 8.4, 8.4, 9.1, 8.8, 7.9, 7.9, 6.7, 6.3, 5, 4.1, 4.2, 3.1, 3, 2.4, 0.7, 1.3, 1.1, 1.1, 0.6, 0.6, 0.5, 0.6, 0.5, 1.1, 0.9, 1.5, 1.7, 1.6, 1.7, 1.5, 1.8, 1.9, 2, 1.9, 1.9, 2.3, 2.2, 1.4, 1.5, 1.7, 1, 1.8, 2.5, 2.4, 2.8, 2.7, 2.5, 2.4];
const SAMPLE_ANNUAL = [11.5, 12.1, 9.3, 8.6, 7.1, 5.9, 3.6, 3.7, 5.1, 6.6, 6.1, 4.1, 2.6, 2.2, 1.1, 1, 0.6, 1.2, 1.4, 1.2, 3.4, 2.6, 1.6, 0.9, 0.2, 0.9, 1.6, 2.5, 4.1, 0, 1.2, 3.4, 2.8, 1.5, 1, -0.2, 0.4, 0.7, 1.1, 1, 0.3, 2.2, 7.1, 6.3, 1.6, 0.3];
const SAMPLE_CONTRIB = [
  { label: 'Liikenne', value: 0.52 },
  { label: 'Elintarvikkeet ja alkoholittomat juomat', value: 0.41 },
  { label: 'Ravintolat ja hotellit', value: 0.3 },
  { label: 'Kulttuuri ja vapaa-aika', value: 0.12 },
  { label: 'Alkoholijuomat ja tupakka', value: 0.1 },
  { label: 'Asuminen, vesi, sähkö, kaasu ja muut polttoaineet', value: -0.18 },
];

/**
 * View model from ctx.data with per-part fallbacks.
 * @param {any} ctx
 */
function prepare(ctx) {
  const { fmt, stats } = ctx;
  const d = ctx.data;
  const used = [];
  let months;
  let khi;
  let index;
  let mom;
  if (d.khi?.months?.length && d.khi?.yoy) {
    months = d.khi.months;
    khi = d.khi.yoy;
    index = d.khi.index?.['2025=100'] ?? d.khi.index?.[Object.keys(d.khi.index ?? {})[0]] ?? months.map(() => null);
    mom = d.khi.mom ?? months.map(() => null);
  } else {
    used.push('KHI');
    months = SAMPLE_KHI.map((_, i) => fmt.ymAdd(SAMPLE_START, i));
    khi = SAMPLE_KHI;
    index = SAMPLE_INDEX;
    mom = stats.pctChangeSeries(SAMPLE_INDEX, 1);
  }
  let ykhi;
  const fi = d.ykhi?.geo?.FI;
  if (d.ykhi?.months?.length && fi?.yoy) {
    ykhi = months.map((ym) => stats.seriesAt(d.ykhi.months, fi.yoy, ym));
  } else {
    used.push('YKHI');
    const start = fmt.ymDiff(months[0], SAMPLE_START);
    ykhi = months.map((_, i) => SAMPLE_YKHI[i + start] ?? null);
  }

  const li = stats.latestIndex(khi);
  const latest = {
    month: months[li],
    yoy: khi[li],
    prevYoy: khi[li - 1] ?? null,
    mom: mom[li] ?? null,
    yearAgo: khi[li - 12] ?? null,
    ykhi: ykhi[li] ?? null,
    mean12: stats.trailingMean(khi, 12, li),
  };

  // Annual rows: official annual tables when present, else sample means;
  // the current partial year from monthly rates.
  const byYear = new Map();
  const ka = d['khi-annual'];
  if (ka?.years?.length) ka.years.forEach((y, i) => byYear.set(y, { year: y, khi: ka.yoy[i], ykhi: null }));
  else {
    used.push('vuosiluvut');
    SAMPLE_ANNUAL.forEach((v, i) => byYear.set(1980 + i, { year: 1980 + i, khi: v, ykhi: null }));
  }
  const ya = d['ykhi-annual'];
  if (ya?.years?.length) ya.years.forEach((y, i) => byYear.has(y) && (byYear.get(y).ykhi = ya.geo?.FI?.[i] ?? null));
  const monthlyKhi = stats.annualMeanOfMonthly(months, khi);
  const monthlyYkhi = stats.annualMeanOfMonthly(months, ykhi);
  const curYear = fmt.yearOf(latest.month);
  monthlyKhi.years.forEach((y, i) => {
    const complete = monthlyKhi.complete[i];
    const yi = monthlyYkhi.years.indexOf(y);
    if (!byYear.has(y) && !complete) {
      byYear.set(y, { year: y, khi: monthlyKhi.values[i], ykhi: yi >= 0 ? monthlyYkhi.values[yi] : null, partial: fmt.partialYear(monthlyKhi.spanStart[i], monthlyKhi.spanEnd[i]), span: fmt.monthsSpan(monthlyKhi.spanStart[i], monthlyKhi.spanEnd[i]) });
    }
    const row = byYear.get(y);
    if (row && row.ykhi == null && yi >= 0 && monthlyYkhi.complete[yi]) row.ykhi = monthlyYkhi.values[yi];
  });
  const annual = [...byYear.values()].filter((r) => fmt.isNum(r.khi)).sort((a, b) => a.year - b.year);

  let contributions = (d.hyodykkeet?.items ?? [])
    .filter((it) => it.level === 1 && fmt.isNum(it.contribution))
    .map((it) => ({ label: it.shortName ?? it.name, value: it.contribution, title: `${it.name}: ${fmt.pp(it.contribution, { decimals: 2 })}` }))
    .sort((a, b) => b.value - a.value);
  if (!contributions.length) {
    used.push('painot ja vaikutukset');
    contributions = SAMPLE_CONTRIB;
  }

  return {
    sample: used,
    months,
    khi,
    ykhi,
    index,
    latest,
    curYear,
    annual,
    contributions,
    updated: ctx.latest.updated?.khi ?? ctx.latest.dataUpdated ?? ctx.buildDate,
  };
}

/** @param {any} ctx */
export default async function tyylit(ctx) {
  const { html, fmt, stats, svg, c } = ctx;
  const vm = prepare(ctx);
  const L = vm.latest;
  const path = '/tyylit/';

  // ---------------------------------------------------------- derived data
  const five = stats.sliceRange(vm.months, { khi: vm.khi, ykhi: vm.ykhi, index: vm.index }, '5v');
  const s5 = stats.rangeStats(five.months, five.series.khi, five.series.index);
  const spark = stats.sliceRange(vm.months, vm.khi, '1v');
  const spark24 = stats.sliceRange(vm.months, vm.khi, '3v');
  const delta = stats.ppChange(L.yoy, L.prevYoy);
  const partialRow = vm.annual.find((r) => r.partial);
  const period5 = fmt.monthRange(five.months[0], five.months.at(-1));
  const khiSource = { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' };
  const ykhiSource = { name: 'Eurostat', href: 'https://ec.europa.eu/eurostat/web/hicp', detail: 'YKHI' };

  const sampleNote = vm.sample.length
    ? c.callout({
        tone: 'warning',
        title: 'Esimerkkidataa',
        body: `Osa luvuista on esimerkkiarvoja, koska data-tiedostoja ei ole vielä haettu (${vm.sample.join(', ')}). Aja npm run fetch ja rakenna sivu uudelleen.`,
      })
    : c.callout({ tone: 'info', title: 'Oikea data', body: `Luvut tulevat data/-hakemistosta (viimeisin KHI-kuukausi ${fmt.monthName(L.month)}).` });

  // ------------------------------------------------------------- sections
  const tokens = {
    Pinnat: ['bg', 'surface', 'surface-2', 'border', 'border-strong', 'border-control'],
    Teksti: ['text', 'text-2', 'text-3'],
    Brändi: ['brand', 'brand-hover', 'brand-soft', 'focus'],
    Datasarjat: ['series-khi', 'series-ykhi', 'series-ykhi-text', 'series-ea', 'series-core', 'series-3', 'series-4', 'series-5', 'series-6', 'target'],
    'Inflaation taso': ['infl-deflation', 'infl-low', 'infl-elevated', 'infl-high'],
    'Muutoksen suunta': ['delta-up', 'delta-down', 'delta-flat', 'delta-up-soft', 'delta-down-soft', 'delta-flat-soft'],
  };
  const colours = html`${Object.entries(tokens).map(
    ([group, names]) => html`<p class="guide__label">${group}</p><ul class="swatches" role="list">${names.map(
      (n) => html`<li class="swatch"><span class="swatch__chip swatch--${n}" aria-hidden="true"></span><code>--${n}</code></li>`,
    )}</ul>`,
  )}`;

  const typography = html`<div class="type-scale">
  <p class="type-scale__display">${fmt.pct(L.yoy)}</p>
  <p class="h1">Inflaatio Suomessa nyt</p>
  <p class="h2">Mikä nostaa hintoja?</p>
  <p class="h3">Vuosi ${vm.curYear}${partialRow ? ` (${partialRow.span})` : ''}</p>
  <p class="measure">Leipäteksti 16 px / 1,6. ${fmt.capitalize(fmt.inessive(L.month))} kuluttajahinnat olivat ${fmt.pct(L.yoy)} korkeammat kuin vuotta aiemmin. Luvut ovat tasalevyisiä: 1 234,56 € · −0,2 % · +0,1 %-yks.</p>
  <p><small>Pieni teksti 14 px – lähteet, selitteet ja apuviivat.</small></p>
  <p class="type-scale__caption">KUVATEKSTI 12 PX · ISOT KIRJAIMET</p>
  <p><a href="#varit">Tekstilinkki</a> ja <code>koodi</code>.</p>
</div>`;

  const buttons = html`<div class="guide__row">
  ${c.button({ label: 'Ensisijainen', variant: 'primary' })}
  ${c.button({ label: 'Toissijainen' })}
  ${c.button({ label: 'Haamu', variant: 'ghost' })}
  ${c.button({ label: 'Pieni', size: 'sm' })}
  ${c.button({ label: 'Ikonilla', icon: 'download' })}
  ${c.button({ label: 'Linkki-nappi', href: '#painikkeet', variant: 'secondary', icon: 'arrowRight' })}
  ${c.button({ label: 'Ei käytössä', variant: 'primary', attrs: { disabled: true } })}
  <button type="button" class="link-button">Tekstipainike</button>
  <button type="button" class="icon-button" aria-label="Sulje (esimerkki)">${c.icon('close')}</button>
</div>
<p class="guide__label">Ikonit</p>
<ul class="guide__row list-reset" role="list">${c.ICON_NAMES.map((n) => html`<li class="chip" title="${n}">${c.icon(n)} ${n}</li>`)}</ul>`;

  const markers = html`<p class="guide__label">Chipit</p>
<div class="guide__row">
  ${c.chip({ text: 'Neutraali' })}
  ${c.chip({ text: 'Brändi', tone: 'brand' })}
  ${c.chip({ text: 'ennakko', tone: 'provisional' })}
  ${c.chip({ text: 'KHI', series: 'khi' })}
  ${c.chip({ text: 'YKHI', series: 'ykhi' })}
  ${c.chip({ text: 'Linkki-chip', href: '#merkinnat' })}
</div>
<p class="guide__label">Tasopisteet (taso neutraalina, piste tasoluokasta)</p>
<div class="guide__row">
  ${[-0.2, 1.3, 2.2, 7.1].map((v) => html`<span class="level">${c.levelDot(v, { srLabel: true })}${fmt.pct(v)}</span>`)}
</div>
${c.levelLegend()}
<p class="guide__label">Muutoschipit (väri ja nuoli vain muutoksille)</p>
<div class="guide__row">
  ${c.deltaChip({ value: 0.1, context: 'heinäkuusta' })}
  ${c.deltaChip({ value: -0.3, context: 'heinäkuusta' })}
  ${c.deltaChip({ value: 0 })}
  ${c.deltaChip({ value: -0.18, unit: 'pct', decimals: 2 })}
  ${c.deltaChip({ value: 0.4, unit: 'pct', plain: true })}
  ${fmt.isNum(delta) ? c.deltaChip({ value: delta, context: fmt.elative(fmt.ymAdd(L.month, -1), { year: false }) }) : ''}
</div>`;

  const segmentedDemo = html`${c.sectionHead({
    title: 'Tunnusluvut',
    eyebrow: `Osio-otsikko · ${fmt.monthName(L.month)}`,
    intro: 'Yhden rivin kuvaus. Ohjaimet ovat samalla rivillä oikealla ja mobiilissa täysleveinä.',
    level: 3,
    controls: c.segmented({
      name: 'mittari',
      label: 'Mittari',
      value: 'khi',
      options: [
        { value: 'khi', label: 'KHI', sub: 'Tilastokeskus', series: 'khi' },
        { value: 'ykhi', label: 'YKHI', sub: 'Eurostat', series: 'ykhi' },
      ],
    }),
  })}
${c.segmented({
  name: 'jakso',
  label: 'Aikaväli',
  value: '5v',
  full: true,
  options: stats.RANGE_KEYS.map((k) => ({ value: k, label: { '6kk': '6 kk', '1v': '1 v', '3v': '3 v', '5v': '5 v', '10v': '10 v', kaikki: 'Kaikki' }[k] })),
})}
<p class="demo-output" id="segmentoitu-tulos" aria-live="polite">Valittu: KHI, 5 v</p>`;

  const kpiCards = [
    c.kpiCard({ label: 'Hinnat kuukaudessa', value: fmt.pct(L.mom, { sign: true }), note: `Hintojen muutos ${fmt.elative(fmt.ymAdd(L.month, -1), { year: false })} ${fmt.illative(L.month, { year: false })}.` }),
    c.kpiCard({
      label: 'Muutos edellisestä kuukaudesta',
      value: fmt.pp(delta),
      delta: stats.deltaClass(delta),
      note: `${fmt.capitalize(fmt.inessive(fmt.ymAdd(L.month, -1), { year: false }))} ${fmt.pct(L.prevYoy)}`,
    }),
    c.kpiCard({ label: '12 kk keskiarvo', value: fmt.pct(L.mean12), note: fmt.monthRange(fmt.ymAdd(L.month, -11), L.month) }),
    c.kpiCard({
      label: partialRow ? `Vuosi ${partialRow.year} (${partialRow.span})` : `Vuosi ${vm.curYear}`,
      value: fmt.pct(partialRow?.khi ?? vm.annual.at(-1)?.khi),
      note: 'Luku tarkentuu, kun loppuvuoden tiedot julkaistaan.',
    }),
    c.kpiCard({ label: 'Vuosi sitten', value: fmt.pct(L.yearAgo), note: fmt.monthName(fmt.ymAdd(L.month, -12)), foot: 'Lähde: Tilastokeskus' }),
  ];
  const kpis = html`${c.kpiGrid(kpiCards)}
<p class="guide__label">Neljän kortin ruudukko (2 × 2 mobiilissa)</p>
${c.kpiGrid(kpiCards.slice(1, 5))}`;

  // Charts
  const lineSvg = svg.lineChart({
    series: [
      { values: five.series.khi, cls: 'khi', label: 'KHI' },
      { values: five.series.ykhi, cls: 'ykhi', label: 'YKHI' },
    ],
    labels: five.months,
    refLines: [{ value: 2, cls: 'target' }], // named in the legend (an in-plot label would cover the lines)
    height: 300,
    ariaLabel: `Vuosi-inflaatio ${period5}: KHI ${fmt.pct(L.yoy)} ja YKHI ${fmt.pct(L.ykhi)} ${fmt.monthShort(L.month)}. Korkein KHI ${fmt.pct(s5.max?.value)} (${fmt.monthShort(s5.max?.months[0])}).`,
  });
  const lineTable = c.dataTable({
    id: 'kaavio-taulukko',
    caption: `Vuosi-inflaatio kuukausittain, ${period5}`,
    columns: [{ label: 'Kuukausi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }],
    rows: five.months.map((ym, i) => [fmt.monthShort(ym), fmt.pct(five.series.khi[i]), fmt.pct(five.series.ykhi[i])]).reverse(),
    visibleRows: 12,
    toggleLabels: { more: `Näytä kaikki kuukaudet (${five.months.length})`, less: 'Näytä vain 12 viimeisintä' },
    compact: true,
  });
  const lineFigure = c.chartFigure({
    id: 'kaavio-viiva',
    title: 'Inflaation kehitys',
    subtitle: 'Vuosimuutos, % · 5 v',
    legend: c.legend([
      { cls: 'khi', label: 'KHI (Tilastokeskus)' },
      { cls: 'ykhi', label: 'YKHI (Eurostat)' },
      { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
    ]),
    chart: lineSvg,
    summary: `${fmt.capitalize(fmt.inessive(L.month))} KHI oli ${fmt.pct(L.yoy)} ja YKHI ${fmt.pct(L.ykhi)}. Jakson korkein KHI oli ${fmt.pct(s5.max?.value)} (${fmt.monthName(s5.max?.months[0])}).`,
    table: lineTable,
    source: c.sourceLine({ sources: [khiSource, ykhiSource], updated: vm.updated }),
    actions: html`${c.shareButton({ size: 'sm' })}${c.button({ label: 'Lataa kuva', icon: 'download', size: 'sm', attrs: { disabled: true, title: 'Kuvan lataus kuuluu Chart.js-kaavioon (etusivu)' } })}`,
  });

  const sparkSvg = svg.sparkline(spark24.series, {
    labels: spark24.months,
    refLines: [{ value: 0, cls: 'muted' }, { value: 2, cls: 'target' }],
    ariaLabel: `Vuosi-inflaatio ${fmt.monthRange(spark24.months[0], spark24.months.at(-1))}, viimeisin ${fmt.pct(L.yoy)}.`,
    height: 72,
  });
  const barSvg = svg.barChart({
    bars: vm.annual.map((r) => ({
      label: String(r.year),
      value: r.khi,
      cls: stats.levelBand(r.khi) ?? 'khi',
      partial: Boolean(r.partial),
      title: `${r.partial ?? r.year}: ${fmt.pct(r.khi)}`,
    })),
    refLines: [{ value: 2, cls: 'target', label: 'EKP:n tavoite 2 %' }],
    height: 260,
    ariaLabel: `Inflaatio vuosittain ${vm.annual[0].year}–${vm.annual.at(-1).year}. Korkein ${fmt.pct(Math.max(...vm.annual.map((r) => r.khi)))}.`,
  });
  const barSmall = svg.barChart({
    bars: vm.annual.slice(-8).map((r) => ({ label: String(r.year), value: r.khi, cls: stats.levelBand(r.khi) ?? 'khi', partial: Boolean(r.partial) })),
    height: 200,
    ariaLabel: `Inflaatio vuosina ${vm.annual.at(-8).year}–${vm.annual.at(-1).year}.`,
  });
  const hbarSvg = svg.hBarChart({
    bars: vm.contributions,
    ariaLabel: `Pääryhmien vaikutus inflaatioon ${fmt.inessive(L.month)}: suurin ${vm.contributions[0].label}.`,
  });

  const charts = html`${lineFigure}
<div class="guide__two">
  <div>
    <p class="guide__label">Sparkline (24–36 kk, 0 % ja 2 % apuviivat)</p>
    ${sparkSvg}
  </div>
  <div>
    <p class="guide__label">Pylväät, arvot näkyvissä (≤ 16 pylvästä)</p>
    ${barSmall}
  </div>
</div>
${c.chartFigure({
  id: 'kaavio-pylvas',
  title: 'Inflaatio vuosittain',
  subtitle: `Vuosimuutos, % · ${partialRow ? `${partialRow.partial} haalealla` : ''}`,
  legend: c.legend([
    { cls: 'deflation', label: 'alle 0 %', box: true },
    { cls: 'low', label: '0–2 %', box: true },
    { cls: 'elevated', label: '2–4 %', box: true },
    { cls: 'high', label: 'yli 4 %', box: true },
    { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
  ]),
  chart: barSvg,
  summary: 'Pylvään väri kertoo tasoluokan (alle 0 %, 0–2 %, 2–4 %, yli 4 %). Kuluva vuosi on haalea, koska se perustuu vain julkaistuihin kuukausiin.',
})}
${c.chartFigure({
  id: 'kaavio-vaakapylvas',
  title: 'Mikä nostaa hintoja?',
  subtitle: 'Pääryhmän vaikutus vuosimuutokseen, %-yks.',
  chart: hbarSvg,
  summary: `Suurin nostaja oli ${vm.contributions[0].label.toLowerCase()} (${fmt.pp(vm.contributions[0].value, { decimals: 2 })}).`,
})}`;

  // Interactive Chart.js chart (src/js/charts/setup.js): the server SVG is the
  // no-JS fallback; the page script swaps in a canvas when the figure is near.
  const all = stats.sliceRange(vm.months, { khi: vm.khi, ykhi: vm.ykhi }, 'kaikki');
  const RANGE_LABELS = { '6kk': '6 kk', '1v': '1 v', '3v': '3 v', '5v': '5 v', '10v': '10 v', kaikki: 'Kaikki' };
  const interactive = c.chartFigure({
    id: 'kaavio-chartjs',
    title: 'Inflaation kehitys (interaktiivinen)',
    subtitle: 'Vuosimuutos, % · Chart.js ladataan vasta, kun kaavio tulee näkyviin',
    legend: c.legend([
      { cls: 'khi', label: 'KHI (Tilastokeskus)' },
      { cls: 'ykhi', label: 'YKHI (Eurostat)' },
      { cls: 'target', label: 'EKP:n tavoite 2 %', dashed: true },
    ]),
    chart: html`${c.segmented({
      name: 'kaavio-jakso',
      label: 'Kaavion aikaväli',
      value: '5v',
      full: true,
      controls: 'kaavio-chartjs-alue',
      options: stats.RANGE_KEYS.map((k) => ({ value: k, label: RANGE_LABELS[k] })),
    })}
<div class="guide__chart" id="kaavio-chartjs-alue">
  <div data-chart-fallback>${svg.lineChart({
    series: [
      { values: five.series.khi, cls: 'khi', label: 'KHI' },
      { values: five.series.ykhi, cls: 'ykhi', label: 'YKHI' },
    ],
    labels: five.months,
    refLines: [{ value: 2, cls: 'target' }],
    height: 280,
    ariaLabel: `Vuosi-inflaatio ${period5}: KHI ${fmt.pct(L.yoy)} ja YKHI ${fmt.pct(L.ykhi)} ${fmt.monthShort(L.month)}.`,
  })}</div>
  <div class="chart-canvas" data-chart="kehitys" data-label="${`Vuosi-inflaatio: KHI ja YKHI kuukausittain, viimeisin ${fmt.monthName(L.month)}.`}" hidden></div>
</div>
${ctx.jsonScript('kaavio-chartjs-data', { months: all.months, khi: all.series.khi, ykhi: all.series.ykhi })}`,
    summary: `${fmt.capitalize(fmt.inessive(L.month))} KHI oli ${fmt.pct(L.yoy)} ja YKHI ${fmt.pct(L.ykhi)}. Vie osoitin tai sormi kaavion päälle nähdäksesi kuukauden luvut.`,
    source: c.sourceLine({ sources: [khiSource, ykhiSource], updated: vm.updated }),
    actions: c.button({ label: 'Lataa kuva', icon: 'download', size: 'sm', className: 'js-only', attrs: { data: { chartDownload: 'kehitys' } } }),
  });

  const annualDesc = [...vm.annual].reverse();
  const table = c.dataTable({
    id: 'vuositaulukko',
    caption: `Inflaatio vuosittain ${vm.annual[0].year}–${vm.annual.at(-1).year}`,
    columns: [{ label: 'Vuosi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Muutos, %-yks.', num: true }],
    rows: annualDesc.map((r, i) => {
      const prev = annualDesc[i + 1]?.khi;
      const ch = stats.ppChange(r.khi, prev);
      return {
        partial: Boolean(r.partial),
        cells: [
          html`${r.year}${r.partial ? html`<span class="data-table__partial">${r.span}</span>` : ''}`,
          html`<span class="level">${c.levelDot(r.khi)}${fmt.pct(r.khi)}</span>`,
          r.ykhi == null ? fmt.DASH : fmt.pct(r.ykhi),
          ch == null ? fmt.DASH : c.deltaChip({ value: ch, plain: true, showUnit: false }),
        ],
      };
    }),
    visibleRows: 10,
    toggleLabels: {
      more: `Näytä kaikki vuodet (${vm.annual[0].year}–${vm.annual.at(-1).year})`,
      less: 'Näytä vain 10 viimeisintä vuotta',
    },
    note: `Lähde: Tilastokeskus, kuluttajahintaindeksi. ${partialRow ? `Vuoden ${partialRow.year} luku on ${partialRow.span}kuun keskiarvo ja tarkentuu vuoden lopussa.` : ''}`,
  });

  const statsRow = c.statsList([
    { label: 'Alin', value: fmt.pct(s5.min?.value), note: s5.min?.months.map((m) => fmt.monthShort(m)).join(', ') },
    { label: 'Keskiarvo', value: fmt.pct(s5.mean), note: period5 },
    { label: 'Korkein', value: fmt.pct(s5.max?.value), note: s5.max?.months.map((m) => fmt.monthShort(m)).join(', ') },
    { label: 'Keskimäärin vuodessa', value: fmt.pct(s5.annual, { sign: true }), note: `hintataso, ${five.intervals} kk` },
  ]);

  const faq = c.accordion(
    [
      {
        summary: 'Paljonko inflaatio on nyt?',
        open: true,
        body: html`<p>${fmt.capitalize(fmt.inessive(L.month))} kuluttajahinnat olivat ${fmt.pct(L.yoy)} korkeammat kuin vuotta aiemmin (Tilastokeskus, kuluttajahintaindeksi).</p>`,
      },
      { summary: 'Mitä eroa on KHI:llä ja YKHI:llä?', body: 'Suurin ero: KHI sisältää omistusasumisen kuluja, kuten asuntolainojen korot, YKHI ei.' },
      { summary: 'Milloin seuraava luku julkaistaan?', body: 'Julkaisukalenteri näkyy etusivun Lähteet ja päivitykset -osiossa.' },
    ],
    { faq: true, headingLevel: 3 },
  );

  const callouts = html`<div class="stack">
  ${c.callout({ title: 'Tieto', body: 'Päättyneiden vuosien luvut ovat Tilastokeskuksen virallisia vuosimuutoksia.' })}
  ${c.callout({ tone: 'warning', title: 'Ennakkotieto', body: 'Eurostatin pikaennakko voi tarkentua kuukauden kuluttua.' })}
  ${c.callout({ tone: 'note', body: 'Neutraali huomautus ilman otsikkoa.' })}
</div>`;

  const cards = c.cardGrid([
    { href: '/vuokrankorotus/', eyebrow: 'Laskuri', title: 'Vuokrankorotus', text: 'Uusi vuokra elinkustannusindeksillä sekunneissa.', meta: 'Laske' },
    { href: '/rahanarvo/', eyebrow: 'Laskuri', title: 'Rahan arvo', text: 'Paljonko 100 € on nyt mistä tahansa kuukaudesta.', meta: 'Laske' },
    { href: '/hinnat/', eyebrow: 'Aihe', title: 'Mikä kallistui?', text: 'Hintojen muutos ryhmittäin.', meta: 'Katso' },
  ]);

  const navDemo = html`<p class="guide__label">Murupolku</p>
${c.breadcrumb([
  { name: 'Etusivu', href: '/' },
  { name: 'Inflaatio vuosittain', href: '/inflaatio/' },
  { name: String(vm.curYear) },
])}
<p class="guide__label">Sivutus</p>
${c.pager({
  prev: { href: '#navigointi', label: fmt.capitalize(fmt.monthName(fmt.ymAdd(L.month, -1))) },
  next: { href: '#navigointi', label: fmt.capitalize(fmt.monthName(L.month)) },
})}`;

  const embed = `<iframe src="https://inflaatio.fi/upotus/" title="Inflaatio Suomessa nyt" width="360" height="220" loading="lazy"></iframe>`;
  const next = ctx.latest.nextRelease?.khi;
  const sources = html`${c.sourceLine({ sources: [khiSource], updated: vm.updated, note: next ? `Seuraava julkaisu ${fmt.date(next.date)} (${fmt.monthName(next.period)})` : 'Seuraava julkaisu julkaisukalenterin mukaan' })}
<ul class="download-list">
  <li>${c.downloadLink({ href: '/data/khi.csv', label: 'Kuluttajahintaindeksi', format: 'CSV', size: 'n. 40 kt', track: 'csv_download' })}</li>
  <li>${c.downloadLink({ href: '/data/json/khi.json', label: 'Kuluttajahintaindeksi', format: 'JSON', track: 'json_download' })}</li>
</ul>
<div class="guide__row">
  ${c.copyButton({ text: fmt.pct(L.yoy), label: `Kopioi luku ${fmt.pct(L.yoy)}` })}
  ${c.shareButton({ mode: 'native', label: 'Jaa' })}
  ${c.shareButton()}
</div>
<p class="guide__label">Koodilohko kopiointinapilla</p>
${c.codeBlock({ id: 'upotuskoodi', code: embed, track: 'widget_code_copied' })}`;

  const form = html`<div class="guide__two">
  <form class="form" action="#" novalidate>
    ${c.field({ id: 'demo-vuokra', label: 'Nykyinen vuokra', type: 'text', suffix: '€', value: '850', hint: 'Kuukausivuokra euroina.', attrs: { inputmode: 'decimal', autocomplete: 'off' } })}
    ${c.field({ id: 'demo-kuukausi', label: 'Alkukuukausi', type: 'month', value: fmt.ymAdd(L.month, -12) })}
    ${c.field({ id: 'demo-virhe', label: 'Kenttä virheellä', value: 'abc', error: 'Anna luku, esimerkiksi 850 tai 850,50.' })}
  </form>
  <form class="form" action="#" novalidate>
    ${c.field({ id: 'demo-valinta', label: 'Indeksi', as: 'select', value: 'eki', options: [{ value: 'eki', label: 'Elinkustannusindeksi (1951:10=100)' }, { value: 'khi', label: 'Kuluttajahintaindeksi (2025=100)' }] })}
    ${c.field({ id: 'demo-viesti', label: 'Viesti', as: 'textarea', optional: true, attrs: { rows: 3 } })}
    ${c.checkbox({ id: 'demo-check', label: 'Näytä tapahtumat', desc: 'Merkitsee kaavioon tunnetut tapahtumat.', checked: true })}
  </form>
</div>`;

  const dialogs = html`<div class="guide__row">
  ${c.button({ label: 'Avaa yhteydenottolomake', variant: 'secondary', icon: 'mail', className: 'js-only', attrs: { data: { openContact: '' } } })}
  ${c.button({ label: 'Avaa evästeasetukset', variant: 'secondary', className: 'js-only', attrs: { data: { openConsent: '' } } })}
</div>
<p class="guide__label">Evästeilmoitus (staattinen kopio; oikea ilmoitus kelluu vasemmassa alakulmassa)</p>
<section class="consent-banner consent-banner--static" aria-label="Evästeilmoituksen esimerkki">
  <p class="consent-banner__title">Evästeet</p>
  <p class="consent-banner__text">Käytämme Google Analyticsia sivuston kehittämiseen vain, jos sallit sen. Välttämätön eväste tallentaa ainoastaan tämän valintasi. Sivulatausten määrän laskemme ilman evästeitä ja tunnisteita. Voit muuttaa valintaa milloin tahansa sivun alareunan Evästeasetukset-painikkeesta.</p>
  <div class="consent-banner__actions">
    <button type="button" class="button button--primary" tabindex="-1">Vain välttämättömät</button>
    <button type="button" class="button button--primary" tabindex="-1">Salli analytiikka</button>
  </div>
  <p class="consent-banner__links"><button type="button" class="link-button js-only" data-open-consent>Asetukset</button><a href="/kayttoehdot/#evasteet">Evästeet ja tietosuoja</a></p>
</section>`;

  const panel = (theme) => html`<div class="theme-panel theme-scope" data-theme="${theme}">
  <p class="eyebrow">${theme === 'light' ? 'Vaalea' : 'Tumma'} teema</p>
  ${c.kpiGrid([kpiCards[1], kpiCards[2]])}
  <div class="guide__row">
    ${c.deltaChip({ value: 0.1 })}${c.deltaChip({ value: -0.3 })}${c.deltaChip({ value: 0 })}
    ${c.chip({ text: 'KHI', series: 'khi' })}${c.chip({ text: 'YKHI', series: 'ykhi' })}${c.chip({ text: 'ennakko', tone: 'provisional' })}
  </div>
  <div class="guide__row">
    ${c.button({ label: 'Ensisijainen', variant: 'primary' })}${c.button({ label: 'Toissijainen' })}${c.button({ label: 'Haamu', variant: 'ghost' })}
  </div>
  ${c.segmented({ name: `mittari-${theme}`, label: `Mittari (${theme})`, value: 'khi', options: [{ value: 'khi', label: 'KHI', series: 'khi' }, { value: 'ykhi', label: 'YKHI', series: 'ykhi' }] })}
  ${c.legend([{ cls: 'khi', label: 'KHI' }, { cls: 'ykhi', label: 'YKHI' }, { cls: 'target', label: 'Tavoite 2 %', dashed: true }])}
  ${svg.lineChart({
    series: [
      { values: spark.series, cls: 'khi', label: 'KHI' },
      { values: stats.sliceRange(vm.months, vm.ykhi, '1v').series, cls: 'ykhi', label: 'YKHI' },
    ],
    labels: spark.months,
    refLines: [{ value: 2, cls: 'target' }],
    height: 200,
    ariaLabel: `Vuosi-inflaatio ${fmt.monthRange(spark.months[0], spark.months.at(-1))} (${theme === 'light' ? 'vaalea' : 'tumma'} teema).`,
  })}
  ${c.levelLegend()}
  ${c.callout({ title: 'Huomio', body: 'Tekstikontrasti vähintään 4,5:1 kaikilla pinnoilla.' })}
</div>`;

  const sections = [
    { id: 'varit', title: 'Värit', intro: 'Kaikki värit tulevat tokeneista (src/css/tokens.css). Kontrastit on laskettu tiedoston alussa.', body: colours },
    { id: 'typografia', title: 'Typografia', intro: 'Seitsemän kokoluokkaa, Inter itse isännöitynä, tasalevyiset numerot.', body: typography },
    { id: 'painikkeet', title: 'Painikkeet ja ikonit', intro: 'Kosketusalue vähintään 40 px. Fokusrengas 2 px.', body: buttons },
    { id: 'merkinnat', title: 'Chipit, tasot ja muutokset', intro: 'Taso esitetään neutraalina; punainen ▲ = kiihtyi, sininen ▼ = hidastui.', body: markers },
    { id: 'osio-otsikko', title: 'Osio-otsikko ja segmenttivalitsin', intro: 'Valinta tallentuu osoitteeseen (?mittari=…&jakso=…).', body: segmentedDemo },
    { id: 'kpi', title: 'Tunnuslukukortit', intro: 'Label 12 px isoin kirjaimin, arvo 32 px, nuoli vain muutoskortissa.', body: kpis },
    { id: 'kaaviot', title: 'Kaaviot', intro: 'Palvelimella piirretyt SVG-kaaviot: role="img", aria-label, yhteenvetolause ja taulukko.', body: charts },
    { id: 'kaavio-interaktiivinen', title: 'Interaktiivinen kaavio', intro: 'Chart.js-kaavio (src/js/charts/setup.js): värit tokeneista, suomenkielinen tooltip, teeman vaihto piirtää uudelleen. Ilman JS:ää näkyy SVG.', body: interactive },
    { id: 'taulukko', title: 'Datataulukko', intro: 'Semanttinen taulukko: caption, th scope, numerot oikealla. Kymmenen riviä näkyy, loput napista (ilman JS:ää kaikki).', body: table },
    { id: 'tilastot', title: 'Tilastorivi', intro: 'Määrittelylista ajankohtineen kaavion alla.', body: statsRow },
    { id: 'haitari', title: 'Haitari (UKK)', intro: 'Natiivi details/summary, ensimmäinen auki. Tulostuksessa kaikki auki.', body: faq },
    { id: 'huomiot', title: 'Huomiolaatikot', body: callouts },
    { id: 'kortit', title: 'Korttiruudukko', intro: 'Koko kortti on linkki; linkin nimi on otsikko.', body: cards },
    { id: 'navigointi', title: 'Murupolku ja sivutus', body: navDemo },
    { id: 'lahteet', title: 'Lähteet, lataukset ja kopiointi', body: sources },
    { id: 'lomake', title: 'Lomakekentät', intro: 'Kentät 44 px, virhe kentän alla, ohje aria-describedby-yhteydellä.', body: form },
    { id: 'dialogit', title: 'Dialogit ja evästeilmoitus', intro: 'Natiivi dialog + showModal, fokus palaa avaajaan, Esc sulkee.', body: dialogs },
    { id: 'teemat', title: 'Vaalea ja tumma rinnakkain', intro: 'Sama sisältö molemmissa teemoissa ([data-theme] toimii myös alipuussa).', body: html`<div class="theme-panels">${panel('light')}${panel('dark')}</div>` },
  ];

  const main = html`${ctx.c.pageHeader({
    eyebrow: 'Sisäinen tyyliopas · ei hakukoneissa',
    title: 'Tyylit ja komponentit',
    lede: 'Inflaatio.fi-sivuston design-järjestelmä: tokenit, typografia ja kaikki palvelinpuolen komponentit datalla. Vaihda teemaa ylävalikon teemavalitsimesta.',
    meta: html`${c.sourceLine({ sources: [khiSource, ykhiSource], updated: vm.updated })}`,
  })}
<div class="container guide">
  <aside>${c.toc(sections.map((s) => ({ id: s.id, label: s.title })), { title: 'Komponentit' })}</aside>
  <div class="guide__body">
    <section aria-label="Datan tila">${sampleNote}</section>
    ${sections.map(
      (s) => html`<section id="${s.id}" aria-labelledby="${s.id}-otsikko">
  <h2 id="${s.id}-otsikko">${s.title}</h2>
  ${s.intro ? html`<p class="guide__intro">${s.intro}</p>` : ''}
  ${s.body}
</section>`,
    )}
  </div>
</div>`;

  const doc = ctx.layout({
    title: 'Tyylit ja komponentit',
    description: 'Inflaatio.fi-sivuston sisäinen tyyliopas: värit, typografia ja komponentit vaaleassa ja tummassa teemassa.',
    path,
    page: 'tyylit',
    noindex: true,
    scripts: ['pages/tyylit.js'],
    breadcrumbs: ctx.crumbs(path, 'Tyylit'),
    main,
  });

  return [{ path, html: doc, sitemap: false, noindex: true }];
}
