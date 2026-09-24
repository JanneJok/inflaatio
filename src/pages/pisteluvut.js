/**
 * /pisteluvut/ – monthly index points (owner ARCHIVE).
 *
 * Every official base of the consumer price index in data/khi.json
 * ('2025=100' … '1972=100') and the cost-of-living index
 * (elinkustannusindeksi, 1951:10=100). Without JavaScript the page shows the
 * latest month on every base, the last 36 months on 2025=100 and the full
 * 2025=100 history per year. src/js/pages/pisteluvut.js switches the base
 * (select, ?indeksi=2015) and rebuilds the 36-month table and the history
 * from the JSON data island with DOM methods only.
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import { fitDescription, sourceMeta } from './inflaatio.js';

/** Default base key (official base since the January 2026 figures). */
export const DEFAULT_BASE = '2025';
/** Months in the main table. */
export const RECENT_MONTHS = 36;

/**
 * All index series, newest base first, trimmed to their first value.
 * @param {any} ctx
 * @returns {{key: string, base: string, label: string, short: string, decimals: number,
 *   start: string, values: (number|null)[], annual: {start: string, values: (number|null)[]}|null}[]}
 */
export function indexSeries(ctx) {
  const khi = ctx.data.khi;
  if (!khi?.months?.length || !khi.index) throw new Error('pisteluvut: data/khi.json puuttuu (aja npm run fetch)');
  const ka = ctx.data['khi-annual'];
  const trimMonthly = (months, values) => {
    const i0 = stats.firstIndex(values);
    const i1 = stats.latestIndex(values);
    return i0 < 0 ? null : { start: months[i0], values: values.slice(i0, i1 + 1) };
  };
  const trimAnnual = (years, values) => {
    if (!years?.length || !values) return null;
    const i0 = stats.firstIndex(values);
    const i1 = stats.latestIndex(values);
    return i0 < 0 ? null : { start: String(years[i0]), values: values.slice(i0, i1 + 1) };
  };
  const out = Object.keys(khi.index)
    .filter((b) => /^\d{4}=100$/.test(b))
    .sort((a, b) => Number(b.slice(0, 4)) - Number(a.slice(0, 4)))
    .map((base) => {
      const t = trimMonthly(khi.months, khi.index[base]);
      if (!t) return null;
      return {
        key: base.slice(0, 4),
        base,
        label: `Kuluttajahintaindeksi ${base}`,
        short: `KHI ${base}`,
        decimals: 2,
        start: t.start,
        values: t.values,
        annual: trimAnnual(ka?.years, ka?.index?.[base]),
      };
    })
    .filter(Boolean);
  const eki = ctx.data.elinkustannusindeksi;
  if (eki?.monthly?.months?.length) {
    const t = trimMonthly(eki.monthly.months, eki.monthly.values);
    if (t) {
      out.push({
        key: 'eki',
        base: eki.monthly.base,
        label: `Elinkustannusindeksi ${eki.monthly.base}`,
        short: `Elinkustannusindeksi ${eki.monthly.base}`,
        decimals: 0,
        start: t.start,
        values: t.values,
        annual: trimAnnual(eki.annual?.years, eki.annual?.values),
      });
    }
  }
  return out;
}

/** Value of a trimmed series at a month. */
export function valueAt(s, ym) {
  const i = fmt.ymDiff(s.start, ym);
  const v = i >= 0 ? s.values[i] : null;
  return fmt.isNum(v) ? v : null;
}

/** Last month with a value. */
export const lastMonth = (s) => fmt.ymAdd(s.start, stats.latestIndex(s.values));

/** Formatted point figure of a series. */
const pts = (s, v) => (s.decimals === 0 ? fmt.num(v, 0) : fmt.idx(v));

/** 12-month change computed from the point figures (2 decimals). */
export function change12(s, ym) {
  return stats.totalChange(valueAt(s, fmt.ymAdd(ym, -12)), valueAt(s, ym));
}

/** Rows of one calendar year (months with a value). */
function yearRows(s, year) {
  const rows = [];
  for (let mo = 1; mo <= 12; mo++) {
    const ym = fmt.toYm(year, mo);
    const v = valueAt(s, ym);
    if (v != null) rows.push({ ym, v });
  }
  return rows;
}

/** Annual average of a series (official annual table), or null. */
function annualAt(s, year) {
  if (!s.annual) return null;
  const i = year - Number(s.annual.start);
  const v = i >= 0 ? s.annual.values[i] : null;
  return fmt.isNum(v) ? v : null;
}

/**
 * History markup (one <details> per year, newest first). The browser script
 * builds exactly the same structure when the base changes.
 */
function historyMarkup(ctx, s) {
  const { html } = ctx;
  const first = fmt.yearOf(s.start);
  const last = fmt.yearOf(lastMonth(s));
  const years = [];
  for (let y = last; y >= first; y--) years.push(y);
  return html`${years.map((y) => {
    const rows = yearRows(s, y);
    const avg = rows.length === 12 ? annualAt(s, y) : null;
    return html`<details class="disclosure pisteluvut-vuosi">
<summary>${y}</summary>
<div class="disclosure__body"><table class="data-table data-table--compact pisteluvut-vuosi__taulukko">
<caption class="sr-only">${`Pisteluvut ${y}, ${s.label}`}</caption>
<thead><tr><th scope="col">Kuukausi</th><th scope="col" class="num">Pisteluku</th></tr></thead>
<tbody>${rows.map((r) => html`<tr><th scope="row">${fmt.capitalize(fmt.monthNameOnly(r.ym))}</th><td class="num">${pts(s, r.v)}</td></tr>`)}${
      avg != null ? html`<tr class="pisteluvut-vuosi__keskiarvo"><th scope="row">Vuoden keskiarvo</th><td class="num">${s.decimals === 0 ? fmt.num(avg, 0) : fmt.num(avg, 1)}</td></tr>` : ''
    }</tbody>
</table></div>
</details>`;
  })}`;
}

/** @param {any} ctx */
export default async function pisteluvut(ctx) {
  const { html, c } = ctx;
  const path = '/pisteluvut/';
  const series = indexSeries(ctx);
  const byKey = new Map(series.map((s) => [s.key, s]));
  const def = byKey.get(DEFAULT_BASE) ?? series[0];
  const latest = ctx.latest.khi.month;
  const yearAgo = fmt.ymAdd(latest, -12);
  const eki = byKey.get('eki');
  const ekiLatest = eki ? lastMonth(eki) : null;
  const k2015 = byKey.get('2015');

  const kpis = c.kpiGrid(
    [
      c.kpiCard({ label: `KHI ${def.base}`, value: pts(def, valueAt(def, latest)), note: `${fmt.capitalize(fmt.monthName(latest))} · virallinen perusvuosi` }),
      k2015 ? c.kpiCard({ label: `KHI ${k2015.base}`, value: pts(k2015, valueAt(k2015, latest)), note: fmt.capitalize(fmt.monthName(latest)) }) : null,
      eki ? c.kpiCard({ label: `Elinkustannusindeksi ${eki.base}`, value: pts(eki, valueAt(eki, ekiLatest)), note: fmt.capitalize(fmt.monthName(ekiLatest)) }) : null,
    ].filter(Boolean),
  );

  // Latest month on every base (works without JS).
  const allBases = c.dataTable({
    id: 'perusvuodet',
    caption: `Pisteluvut ${fmt.inessive(latest)} kaikilla perusvuosilla`,
    columns: [{ label: 'Indeksi' }, { label: fmt.capitalize(fmt.monthShort(latest)), num: true }, { label: fmt.capitalize(fmt.monthShort(yearAgo)), num: true }, { label: 'Muutos 12 kk', num: true }],
    rows: series.map((s) => {
      const ym = s.key === 'eki' ? ekiLatest : latest;
      return [s.short, pts(s, valueAt(s, ym)), pts(s, valueAt(s, fmt.ymAdd(ym, -12))), c.numUnit(fmt.pct(change12(s, ym), { decimals: 2, sign: true }))];
    }),
    note: 'Muutos on laskettu pisteluvuista kahden desimaalin tarkkuudella. Pyöristyksen vuoksi eri perusvuosien muutokset voivat poiketa toisistaan hieman. Tilastokeskuksen virallinen vuosimuutos julkaistaan yhden desimaalin tarkkuudella.',
  });

  // Last 36 months of the default base.
  const recentMonths = Array.from({ length: RECENT_MONTHS }, (_, i) => fmt.ymAdd(latest, -i));
  const recent = c.dataTable({
    id: 'pisteluvut-taulukko',
    caption: `${def.label}, ${fmt.monthRange(recentMonths.at(-1), latest)}`,
    columns: [{ label: 'Kuukausi' }, { label: 'Pisteluku', num: true }, { label: 'Muutos 12 kk', num: true }],
    rows: recentMonths.map((ym) => [fmt.capitalize(fmt.monthName(ym)), pts(def, valueAt(def, ym)), c.numUnit(fmt.pct(change12(def, ym), { decimals: 2, sign: true }))]),
    visibleRows: 12,
    toggleLabels: { more: `Näytä kaikki ${RECENT_MONTHS} kuukautta`, less: 'Näytä vain 12 viimeisintä' },
    compact: true,
  });
  const selectField = c.field({
    id: 'pisteluvut-perusvuosi',
    label: 'Indeksi ja perusvuosi',
    as: 'select',
    value: def.key,
    options: series.map((s) => ({ value: s.key, label: s.label })),
    attrs: { 'aria-controls': 'pisteluvut-taulukko pisteluvut-historia' },
  });

  // Example calculation (cost-of-living index, latest vs 12 months earlier).
  let example = '';
  if (eki && ekiLatest) {
    const a = valueAt(eki, fmt.ymAdd(ekiLatest, -12));
    const b = valueAt(eki, ekiLatest);
    if (a != null && b != null) {
      example = c.callout({
        tone: 'note',
        title: 'Esimerkki: indeksikorotus pisteluvuista',
        body: html`<p>Sopimus on sidottu elinkustannusindeksiin (${eki.base}), perusindeksinä ${fmt.genitive(fmt.ymAdd(ekiLatest, -12))} pisteluku ${pts(eki, a)} ja tarkistusindeksinä ${fmt.genitive(ekiLatest)} pisteluku ${pts(eki, b)}. Muutos on ${pts(eki, b)} / ${pts(eki, a)} = ${fmt.num(b / a, 4)} eli ${fmt.pct(stats.totalChange(a, b), { decimals: 2, sign: true })}. Esimerkiksi 800 euron vuokra nousisi ${fmt.num((800 * b) / a, 2)} euroon, jos sopimus ei rajoita korotusta.</p><p><a href="/vuokrankorotus/">Laske oma vuokrankorotus</a></p>`,
      });
    }
  }

  const island = {
    latest,
    defaultKey: def.key,
    recentMonths: RECENT_MONTHS,
    bases: series.map((s) => ({ key: s.key, base: s.base, label: s.label, decimals: s.decimals, start: s.start, values: s.values, annual: s.annual })),
  };

  const khiSource = { name: 'Tilastokeskus', href: ctx.data.meta?.sources?.khi?.url ?? 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksin pisteluvut' };
  const sources = sourceMeta(ctx, [eki ? { ...khiSource, detail: 'kuluttajahintaindeksi ja elinkustannusindeksi' } : khiSource], ctx.latest.khi.updated);

  const main = html`${c.pageHeader({
    eyebrow: `Pisteluvut · ${fmt.monthName(latest)}`,
    title: 'Kuluttajahintaindeksin ja elinkustannusindeksin pisteluvut',
    lede: 'Vuokran tai muun sopimuksen indeksikorotus lasketaan pisteluvuista, ei prosenteista. Käytä samaa indeksiä ja perusvuotta kuin sopimuksessasi. Kaikki luvut ovat Tilastokeskuksen virallisia pistelukuja.',
    meta: sources,
  })}
${c.section({ id: 'uusimmat', title: 'Uusimmat pisteluvut', className: 'section--tight', body: kpis })}
${c.section({
  id: 'perusvuodet-osio',
  eyebrow: 'Kaikki perusvuodet',
  title: `${fmt.capitalize(fmt.monthName(latest))} kaikilla perusvuosilla`,
  intro: 'Kuluttajahintaindeksin virallinen perusvuosi on 2025=100 tammikuun 2026 luvuista alkaen. Vanhemmat perusvuodet julkaistaan edelleen, koska sopimukset viittaavat niihin.',
  body: html`${allBases}${example}`,
})}
${c.section({
  id: 'kuukausittain',
  eyebrow: 'Kuukausittain',
  title: 'Pisteluvut kuukausittain',
  intro: `Viimeiset ${RECENT_MONTHS} kuukautta. Vaihda indeksiä tai perusvuotta valikosta.`,
  controls: html`<div class="js-only pisteluvut-valinta">${selectField}</div>`,
  body: html`<div aria-live="polite" id="pisteluvut-tila" class="sr-only"></div>${recent}`,
})}
${c.section({
  id: 'historia',
  eyebrow: 'Historia',
  title: 'Koko historia vuosittain',
  intro: html`<span id="pisteluvut-historia-otsikko">${def.label}</span>, ${fmt.yearOf(def.start)}–${fmt.yearOf(lastMonth(def))}. Avaa vuosi nähdäksesi sen kuukaudet.`,
  body: html`<div class="pisteluvut-historia" id="pisteluvut-historia">${historyMarkup(ctx, def)}</div>
<p class="table-note">Vuoden keskiarvo on Tilastokeskuksen virallinen vuosikeskiarvo (perusvuodelle 2025=100 sitä ei julkaista). Koko aineisto CSV- ja JSON-muodossa: <a href="/data/">Avoin data</a>.</p>`,
})}
${ctx.jsonScript('pisteluvut-data', island)}`;

  const description = fitDescription([
    `Kuluttajahintaindeksin pisteluvut kuukausittain kaikilla perusvuosilla (2025=100 … 1972=100) ja elinkustannusindeksi 1951:10=100.`,
    `Uusin ${fmt.monthName(latest)}.`,
  ]);
  const first = series.reduce((a, s) => (s.start < a ? s.start : a), latest);
  return [
    {
      path,
      priority: 0.8,
      changefreq: 'monthly',
      html: ctx.layout({
        title: 'Pisteluvut: KHI ja elinkustannusindeksi',
        description,
        path,
        page: 'pisteluvut',
        scripts: ['pages/pisteluvut.js'],
        breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Pisteluvut'),
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'Dataset',
            name: 'Kuluttajahintaindeksin ja elinkustannusindeksin pisteluvut',
            description,
            url: ctx.baseUrl + path,
            inLanguage: 'fi',
            isAccessibleForFree: true,
            temporalCoverage: `${first}/${latest}`,
            spatialCoverage: { '@type': 'Place', name: 'Suomi' },
            variableMeasured: series.map((s) => s.label),
            creator: { '@type': 'Organization', name: 'Tilastokeskus', url: 'https://stat.fi/' },
            license: 'https://creativecommons.org/licenses/by/4.0/',
            dateModified: ctx.latest.dataUpdated ?? undefined,
          },
        ],
        main,
      }),
    },
  ];
}
