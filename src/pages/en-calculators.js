/**
 * English calculators (owner CALC): /en/rent-increase-calculator/ and
 * /en/value-of-money/ (lang="en", hreflang pairs with /vuokrankorotus/ and
 * /rahanarvo/). They reuse the Finnish calculators' builders with English
 * texts and number formats (src/js/lib/calc.js formatter('en')) and the same
 * page scripts (src/js/pages/vuokrankorotus.js, rahanarvo.js), which read the
 * language from the data island. The /en/ landing page belongs to en.js.
 */
import { formatter, pointAt, latestPeriod } from '../js/lib/calc.js';
import { isoDate } from '../js/lib/format.js';
import { rentCalculator, pointTable, PATH as RENT_FI, PATH_EN as RENT_EN } from './vuokrankorotus.js';
import { moneyCalculator, yearsTable, savingsSection, PATH as MONEY_FI, PATH_EN as MONEY_EN } from './rahanarvo.js';
import { calcJsonLd } from './laskurit.js';

const F = formatter('en');

/** Release time '08:00' → ' at 8:00 (Finnish time)'. */
const at = (t) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? ` at ${Number(m[1])}:${m[2]} Finnish time` : '';
};

/** '14.10.2026' style dates are Finnish; English pages use '14 October 2026'. */
const enDate = (value) => {
  const m = String((value && isoDate(value)) ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${F.period(`${m[1]}-${m[2]}`)}` : '';
};

/**
 * Breadcrumbs of an English calculator.
 * @param {any} ctx
 * @param {string} path
 * @param {string} name
 */
const crumbs = (ctx, path, name) => [
  { name: ctx.site.brand, href: '/' },
  { name: 'In English', href: '/en/' },
  { name, href: path },
];

/** Links to the other English pages. */
function moreLinks(ctx, exclude) {
  const cards = [
    { href: '/en/', eyebrow: 'Inflation in Finland', title: 'Latest figures', text: 'The latest consumer price index and HICP figures in English.', meta: 'Read', lang: 'en' },
    { href: RENT_EN, eyebrow: 'Calculator', title: 'Rent increase calculator', text: 'New rent with the cost-of-living index or the consumer price index.', meta: 'Calculate', lang: 'en' },
    { href: MONEY_EN, eyebrow: 'Calculator', title: 'Value of money', text: 'What an amount from an earlier month or year is worth today.', meta: 'Calculate', lang: 'en' },
    { href: `${MONEY_EN}#savings`, eyebrow: 'Calculator', title: 'Savings and inflation', text: 'The real return on savings once inflation is taken into account.', meta: 'Calculate', lang: 'en' },
  ];
  return ctx.c.cardGrid(cards.filter((c) => c.href !== exclude && !c.href.startsWith(`${exclude}#`)));
}

/** @param {any} ctx */
async function rentPage(ctx) {
  const { html: h, c } = ctx;
  const eki = ctx.latest.elinkustannusindeksi;
  const next = ctx.latest.nextRelease?.khi;
  const calc = rentCalculator(ctx, { lang: 'en' });
  const { result: r, view: v, base, check, list } = calc;
  const updated = ctx.latest.updated?.elinkustannusindeksi ?? ctx.latest.khi?.updated;
  const ekiSeries = list.find((s) => s.id === 'eki-1951');
  const lastEki = latestPeriod(ekiSeries);

  const explain = h`<div class="prose">
  <p>Most Finnish residential leases tie rent increases to an index. The lease usually says something like <i lang="fi">”Vuokraa tarkistetaan vuosittain elinkustannusindeksin muutosta vastaavasti”</i> – the rent is reviewed once a year in line with the change in the cost-of-living index.</p>
  <p class="calc-formula-block"><code>new rent = current rent × review index / base index</code></p>
  <dl class="calc-terms">
    <div><dt>Elinkustannusindeksi (cost-of-living index, 1951:10=100)</dt><dd>A long price index series of Statistics Finland with October 1951 as the base (= 100). It moves with the consumer price index and is the index most leases refer to. It was ${F.idx(pointAt(ekiSeries, lastEki), 0)} in ${F.period(lastEki)}.</dd></div>
    <div><dt>Kuluttajahintaindeksi (consumer price index, CPI)</dt><dd>The official measure of inflation in Finland. It is published with several base years (2025=100, 2015=100 …); use the one named in your lease.</dd></div>
    <div><dt>Perusindeksi (base index)</dt><dd>The point figure of the month the lease refers to – often the month the lease was signed or the month of the previous review.</dd></div>
    <div><dt>Tarkistusindeksi (review index)</dt><dd>The point figure of the review month, usually the latest published month.</dd></div>
    <div><dt><span lang="fi">”kuitenkin vähintään 3 %”</span> – “but at least 3%”</dt><dd>A minimum increase: the rent rises at least this much even if the index rises less.</dd></div>
    <div><dt><span lang="fi">”enintään 5 %”</span> – “at most 5%”</dt><dd>A cap on the increase.</dd></div>
  </dl>
  <p><strong>Worked example with the latest figures.</strong> Rent ${F.eur(r.rent, 0)}; base index ${v.basePoint} (${F.period(base)}); review index ${v.checkPoint} (${F.period(check)}). New rent = ${F.eur(r.rent)} × ${v.checkPoint} / ${v.basePoint} = <strong>${v.newRent}</strong>, an increase of ${F.eur(r.increase)} a month (${F.pct(r.appliedPct, { decimals: 2 })}).</p>
  <p>The increase is calculated from the point figures, not from the annual inflation rate. Statistics Finland publishes a month's figures in the middle of the following month${next ? `: the ${F.period(next.period)} figures are due on ${enDate(next.date)}${at(next.time)}` : ''}.</p>
</div>
${c.callout({ tone: 'note', title: 'Check your lease', body: 'This calculator gives an indicative result and is not legal advice. The index clause of your lease decides which index, months and rounding are used.' })}`;

  const main = h`${c.pageHeader({
    eyebrow: `Calculator · Cost-of-living index, ${F.period(eki.month)}`,
    title: 'Rent increase calculator',
    lede: `Calculate an index-linked rent increase with the official point figures of Statistics Finland. The cost-of-living index (1951:10=100) was ${F.idx(eki.value, 0)} in ${F.period(eki.month)}.`,
    meta: h`Updated <time datetime="${String(updated).slice(0, 10)}">${enDate(updated)}</time> · Source: Statistics Finland · <a href="${RENT_FI}" hreflang="fi" lang="fi">Suomeksi</a>`,
  })}
${c.section({ id: 'calculator', title: 'Calculate your new rent', className: 'section--flush-top', body: calc.calculator })}
${c.section({ id: 'how-it-works', title: 'How rent index increases work in Finland', body: explain })}
${c.section({ id: 'point-figures', title: 'Point figures for the last 24 months', intro: 'Cost-of-living index and consumer price index by month, latest first.', body: h`${pointTable(ctx, list, 'en')}${c.sourceLine({ sources: [{ name: 'Statistics Finland', href: 'https://stat.fi/en/statistics/khi', detail: 'cost-of-living index, table 11xl; consumer price index, tables 11xs and 15b5' }], updated, lang: 'en' })}` })}
${c.section({ id: 'more', title: 'More in English', body: moreLinks(ctx, RENT_EN) })}`;

  const description = `Rent increase calculator for Finnish leases. Cost-of-living index ${F.period(eki.month)}: ${F.idx(eki.value, 0)} (1951:10=100). Formula and worked example.`;
  return {
    path: RENT_EN,
    changefreq: 'monthly',
    html: ctx.layout({
      title: 'Rent increase calculator for Finland',
      description,
      path: RENT_EN,
      lang: 'en',
      page: 'vuokrankorotus',
      alternates: [
        { hreflang: 'fi', href: RENT_FI },
        { hreflang: 'x-default', href: RENT_FI },
      ],
      scripts: ['pages/vuokrankorotus.js'],
      breadcrumbs: crumbs(ctx, RENT_EN, 'Rent increase calculator'),
      jsonLd: [calcJsonLd(ctx, { name: 'Rent increase calculator', path: RENT_EN, description, lang: 'en' })],
      main,
    }),
  };
}

/** @param {any} ctx */
async function moneyPage(ctx) {
  const { html: h, c } = ctx;
  const calc = moneyCalculator(ctx, { lang: 'en' });
  const { d, list, latestMonth } = calc;
  const hicp = list.find((s) => s.family.startsWith('ykhi-'));
  const updated = ctx.latest.khi?.updated ?? ctx.latest.dataUpdated;

  const explain = h`<div class="prose">
  <p>The value of money is calculated from official price index point figures: <code>value now = amount × index now / index then</code>. The calculator picks the series by date and never chains different series:</p>
  <ul>
    <li><strong>From 1972:</strong> consumer price index 1972=100, monthly (Statistics Finland table 11xs) and as annual averages (11xt).</li>
    <li><strong>From August 1939:</strong> cost-of-living index 1938:8–1939:7=100, monthly (11xn); annual averages 1952–1971 from the cost-of-living index 1951:10=100 (11xm).</li>
    <li><strong>From 1860:</strong> cost-of-living index 1914:1–6=100, annual only (11xy). The calculation then compares years and ends in the series' latest year.</li>
    <li><strong>Annual averages before 1952:</strong> cost-of-living index 1914:1–6=100 (11xy), because no annual averages are published for the monthly series 11xn.</li>
    ${hicp ? h`<li><strong>HICP (optional):</strong> Eurostat's harmonised index of consumer prices ${hicp.base}, monthly from ${F.period(hicp.start)}. It compares months only, as there are no annual averages in the data.</li>` : ''}
  </ul>
  <p>Markka amounts are converted at the fixed rate of 5.94573 markka per euro. In the 1963 currency reform 100 old markka became 1 new markka, so older amounts are also divided by 100.</p>
  <p>The result shows how much money is needed to buy the same basket of goods and services. It does not show how incomes or living standards have changed.</p>
</div>`;

  const main = h`${c.pageHeader({
    eyebrow: `Calculator · Consumer price index, ${F.period(latestMonth)}`,
    title: 'Value of money calculator',
    lede: `What is an old amount of money worth today? For example, €100 in January 2000 is equivalent to ${F.eur(d.value)} in ${F.period(latestMonth)}. Month by month with the official price indices of Statistics Finland.`,
    meta: h`Updated <time datetime="${String(updated).slice(0, 10)}">${enDate(updated)}</time> · Source: Statistics Finland · <a href="${MONEY_FI}" hreflang="fi" lang="fi">Suomeksi</a>`,
  })}
${c.section({ id: 'calculator', title: 'Calculate the value of money', className: 'section--flush-top', body: calc.calculator })}
${c.section({ id: 'years', title: 'Value of money by year', intro: `What €100 or 100 markka of each year is worth in ${F.period(latestMonth)}.`, body: yearsTable(ctx, list, latestMonth, 'en') })}
${c.section({ id: 'savings', title: 'Savings and inflation', intro: 'When inflation is higher than the interest rate, savings lose purchasing power.', className: 'raha-saastot', body: savingsSection(ctx, { list, latestMonth, lang: 'en' }) })}
${c.section({ id: 'method', title: 'How the calculator works', body: explain })}
${c.section({ id: 'more', title: 'More in English', body: moreLinks(ctx, MONEY_EN) })}`;

  const description = `What is an old amount worth today? €100 in January 2000 = ${F.eur(d.value)} in ${F.period(latestMonth)}. Official Finnish price indices; markka amounts too.`;
  return {
    path: MONEY_EN,
    changefreq: 'monthly',
    html: ctx.layout({
      title: 'Value of money calculator for Finland',
      description,
      path: MONEY_EN,
      lang: 'en',
      page: 'rahanarvo',
      alternates: [
        { hreflang: 'fi', href: MONEY_FI },
        { hreflang: 'x-default', href: MONEY_FI },
      ],
      scripts: ['pages/rahanarvo.js'],
      breadcrumbs: crumbs(ctx, MONEY_EN, 'Value of money'),
      jsonLd: [calcJsonLd(ctx, { name: 'Value of money calculator', path: MONEY_EN, description, lang: 'en' })],
      main,
    }),
  };
}

/** @param {any} ctx */
export default async function enCalculators(ctx) {
  if (!ctx.latest.elinkustannusindeksi || !ctx.latest.khi) throw new Error('en-calculators: data/elinkustannusindeksi.json or data/khi.json is missing (run npm run fetch)');
  return [await rentPage(ctx), await moneyPage(ctx)];
}

