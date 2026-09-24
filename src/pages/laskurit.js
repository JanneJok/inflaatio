/**
 * /laskurit/ – index of the calculators (owner CALC).
 *
 * The named exports below are server-side helpers shared by the calculator
 * page modules (vuokrankorotus, rahanarvo, oma-inflaatio, ostovoima,
 * en-calculators): the month + year picker, the WebApplication JSON-LD, the
 * calculator list and small text helpers. The build only uses the default
 * export of a page module, so importing these from another page module is safe.
 */
import { html, attrs, raw } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import { buildSeries, pickMoneySeries, valueOfMoney, pointAt, latestPeriod, formatter, MONEY_SERIES_IDS } from '../js/lib/calc.js';

/** Statistics Finland source links. */
export const SOURCES = Object.freeze({
  khi: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'kuluttajahintaindeksi' },
  eki: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'elinkustannusindeksi' },
  ati: { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/ati', detail: 'ansiotasoindeksi' },
  khiEn: { name: 'Statistics Finland', href: 'https://stat.fi/en/statistics/khi', detail: 'consumer price index' },
});

/**
 * Quarter label: '2026-Q2' → '2. neljännes 2026' (fi) / 'Q2 2026' (en).
 * @param {string} q
 * @param {'fi'|'en'} [lang='fi']
 */
export function quarterName(q, lang = 'fi') {
  const m = String(q ?? '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return fmt.DASH;
  return lang === 'en' ? `Q${m[2]} ${m[1]}` : `${m[2]}. neljännes ${m[1]}`;
}

/**
 * Annual change of earnings as a clause without a capital:
 * 'ansiot nousivat vuodessa 3,4 % ja reaaliansiot 1,6 %' (the verb is not
 * repeated when both move the same way), or '…, mutta reaaliansiot laskivat 0,4 %'.
 * @param {number} nominalYoy
 * @param {number} realYoy
 */
export function earningsClause(nominalYoy, realYoy) {
  const verb = (v) => (v >= 0 ? 'nousivat' : 'laskivat');
  const first = `ansiot ${verb(nominalYoy)} vuodessa ${fmt.pct(Math.abs(nominalYoy))}`;
  return (nominalYoy >= 0) === (realYoy >= 0)
    ? `${first} ja reaaliansiot ${fmt.pct(Math.abs(realYoy))}`
    : `${first}, mutta reaaliansiot ${verb(realYoy)} ${fmt.pct(Math.abs(realYoy))}`;
}

/**
 * Quarter in the inessive: '2026-Q2' → '2. neljänneksellä 2026'.
 * @param {string} q
 */
export function quarterIn(q) {
  return quarterName(q).replace('neljännes', 'neljänneksellä');
}

/**
 * Quarter in words for the start of a sentence: '2026-Q2' → 'vuoden 2026
 * toisella neljänneksellä' (no numeral at the start of a sentence).
 * @param {string} q
 */
export function quarterInWords(q) {
  const m = String(q ?? '').match(/^(\d{4})-Q([1-4])$/);
  if (!m) return fmt.DASH;
  return `vuoden ${m[1]} ${['ensimmäisellä', 'toisella', 'kolmannella', 'neljännellä'][Number(m[2]) - 1]} neljänneksellä`;
}

/**
 * Month + year picker (two selects in a fieldset). The month select has an
 * optional "whole year (average)" choice (value '') when `allowYear` is set.
 * Values are read by the page scripts as `${year}-${month}` or `${year}`.
 * @param {object} p
 * @param {string} p.id base id: selects `${id}-kk` / `${id}-v`, error `${id}-virhe`
 * @param {string} p.legend
 * @param {string} p.value 'YYYY-MM' (or 'YYYY' with allowYear)
 * @param {number} p.minYear
 * @param {number} p.maxYear
 * @param {string|import('../../scripts/lib/html.js').SafeString} [p.hint]
 * @param {boolean} [p.allowYear=false]
 * @param {'fi'|'en'} [p.lang='fi']
 */
export function monthYearField({ id, legend, value, minYear, maxYear, hint, allowYear = false, lang = 'fi' }) {
  const F = formatter(lang);
  const [vy, vm] = String(value).split('-');
  const hintId = hint ? `${id}-ohje` : null;
  const errId = `${id}-virhe`;
  const describedby = [hintId, errId].filter(Boolean).join(' ');
  const t = lang === 'en' ? { month: 'Month', year: 'Year', whole: 'Whole year (average)' } : { month: 'Kuukausi', year: 'Vuosi', whole: 'Koko vuosi (keskiarvo)' };
  const months = F.monthNames.map((name, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return html`<option${attrs({ value: mm, selected: vm === mm })}>${fmt.capitalize(name)}</option>`;
  });
  const years = [];
  for (let y = maxYear; y >= minYear; y--) years.push(html`<option${attrs({ value: String(y), selected: String(y) === vy })}>${y}</option>`);
  return html`<fieldset class="calc-month" id="${id}">
  <legend class="field__label">${legend}</legend>
  ${hint ? html`<p class="field__hint" id="${hintId}">${hint}</p>` : ''}
  <div class="calc-month__row">
    <div class="field calc-month__part">
      <label class="calc-month__label" for="${id}-kk">${t.month}</label>
      <select${attrs({ id: `${id}-kk`, name: `${id}-kk`, 'aria-describedby': describedby })}>${allowYear ? html`<option${attrs({ value: '', selected: !vm })}>${t.whole}</option>` : ''}${months}</select>
    </div>
    <div class="field calc-month__part calc-month__part--year">
      <label class="calc-month__label" for="${id}-v">${t.year}</label>
      <select${attrs({ id: `${id}-v`, name: `${id}-v`, 'aria-describedby': describedby })}>${years}</select>
    </div>
  </div>
  <p class="field__error" id="${errId}"></p>
</fieldset>`;
}

/**
 * Output element updated by a page script ([data-out] + server-rendered text).
 * @param {string} key
 * @param {string} text
 * @param {string} [tag='span']
 * @param {object} [extra] more attributes
 */
export function out(key, text, tag = 'span', extra = {}) {
  if (!/^[a-z][a-z0-9]*$/.test(tag)) throw new Error(`out: invalid tag "${tag}"`);
  return html`${raw(`<${tag}`)}${attrs({ ...extra, data: { out: key } })}>${text}${raw(`</${tag}>`)}`;
}

/**
 * Ablative of a month ("from August"): '2026-08' → 'elokuulta 2026'.
 * @param {string} ym
 */
export function ablative(ym) {
  const { y, m } = fmt.parseYm(ym);
  return `${fmt.MONTHS[m - 1]}lta ${y}`;
}

/**
 * Release time for Finnish text: '08:00' → ' klo 8.00' ('' when missing).
 * @param {string|null|undefined} t 'HH:MM'
 */
export function clock(t) {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? ` klo ${Number(m[1])}.${m[2]}` : '';
}

/**
 * Breadcrumbs of a calculator page: Etusivu › Laskurit › <name>.
 * @param {any} ctx
 * @param {string} path
 * @param {string} name
 */
export function calcCrumbs(ctx, path, name) {
  return [
    { name: ctx.site.pageName('/') ?? 'Etusivu', href: '/' },
    { name: ctx.site.pageName('/laskurit/') ?? 'Laskurit', href: '/laskurit/' },
    { name, href: path },
  ];
}

/**
 * WebApplication JSON-LD for a calculator page.
 * @param {object} ctx
 * @param {{name: string, path: string, description: string, lang?: string}} p
 */
export function calcJsonLd(ctx, { name, path, description, lang = 'fi' }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name,
    url: `${ctx.baseUrl}${path}`,
    description,
    inLanguage: lang,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@type': 'Organization', name: ctx.site.brand, url: ctx.baseUrl },
  };
}

/**
 * Message templates as data attributes: { rent: '…' } → data-msg-rent="…".
 * @param {Record<string, string>} messages
 */
export function messageData(messages) {
  return Object.fromEntries(Object.entries(messages).map(([k, v]) => [`msg${k.charAt(0).toUpperCase()}${k.slice(1)}`, v]));
}

/**
 * Callout shown only without JavaScript.
 * @param {object} c ctx.c
 * @param {string} text
 * @param {'fi'|'en'} [lang='fi']
 */
export function noJsNote(c, text, lang = 'fi') {
  return html`<div class="no-js-only">${c.callout({ tone: 'note', title: lang === 'en' ? 'The calculator needs JavaScript' : 'Laskuri tarvitsee JavaScriptin', body: text })}</div>`;
}

/**
 * Cards of all calculators with a current number in each text.
 * @param {object} ctx
 * @param {{exclude?: string}} [o] path of the current page (left out)
 */
export function calculatorCards(ctx, { exclude } = {}) {
  const { fmt: f, latest } = ctx;
  const eki = latest.elinkustannusindeksi;
  const list = buildSeries(ctx.data, { ids: MONEY_SERIES_IDS });
  const to = latest.khi?.month ?? latestPeriod(list[0]);
  const pick = to ? pickMoneySeries(list, '2000-01', to) : null;
  const money = pick && !('error' in pick) ? valueOfMoney({ amount: 100, fromIdx: pick.fromIdx, toIdx: pick.toIdx }) : null;
  const groups = (ctx.data.hyodykkeet?.items ?? []).filter((it) => it.level === 1 && f.isNum(it.yoy));
  const top = [...groups].sort((a, b) => b.yoy - a.yoy)[0];
  const an = latest.ansiot;
  const cards = [
    {
      href: '/vuokrankorotus/',
      eyebrow: 'Vuokra',
      title: 'Vuokrankorotuslaskuri',
      text: eki
        ? `Uusi vuokra elinkustannusindeksillä tai kuluttajahintaindeksillä. Elinkustannusindeksi ${f.inessive(eki.month)}: ${f.idx(eki.value, 0)} (${eki.base}).`
        : 'Uusi vuokra elinkustannusindeksillä tai kuluttajahintaindeksillä.',
      meta: 'Laske vuokra',
    },
    {
      href: '/rahanarvo/',
      eyebrow: 'Rahan arvo',
      title: 'Rahanarvolaskuri',
      text: money
        ? `Paljonko vanha rahasumma on nykyrahassa? Esimerkiksi 100 € tammikuussa 2000 vastaa ${f.eur(money.value)} ${f.inessive(to)}.`
        : 'Paljonko vanha rahasumma on nykyrahassa? Laske kuukauden tarkkuudella.',
      meta: 'Laske rahan arvo',
    },
    {
      href: '/rahanarvo/#saastot',
      eyebrow: 'Säästöt',
      title: 'Säästöt ja inflaatio',
      text: latest.khi
        ? `Säästöjen todellinen tuotto, kun inflaatio huomioidaan. Inflaatio ${f.inessive(latest.khi.month)}: ${f.pct(latest.khi.yoy)}.`
        : 'Säästöjen todellinen tuotto, kun inflaatio huomioidaan.',
      meta: 'Laske tuotto',
    },
    {
      href: '/oma-inflaatio/',
      eyebrow: 'Oma inflaatio',
      title: 'Oma inflaatio',
      text: top && latest.khi
        ? `Arvioi inflaatio oman kulutuksesi mukaan. ${f.capitalize(f.inessive(ctx.data.hyodykkeet.latest))} ${top.shortName.toLowerCase()} kallistui vuodessa ${f.pct(top.yoy)}, kun kuluttajahinnat nousivat keskimäärin ${f.pct(latest.khi.yoy)}.`
        : 'Arvioi inflaatio oman kulutuksesi mukaan.',
      meta: 'Laske oma inflaatio',
    },
    {
      href: '/ostovoima/',
      eyebrow: 'Palkka',
      title: 'Ostovoima ja palkka',
      text: an
        ? `Riittääkö palkankorotuksesi? ${f.capitalize(earningsClause(an.nominalYoy, an.realYoy))} (${quarterName(an.period)}${an.preliminary ? ', ennakko' : ''}).`
        : 'Riittääkö palkankorotuksesi? Vertaa palkkaa ja hintoja.',
      meta: 'Laske ostovoima',
    },
  ];
  return cards.filter((c) => c.href !== exclude);
}

/** @param {any} ctx */
export default async function laskurit(ctx) {
  const { html: h, fmt: f, c } = ctx;
  const path = '/laskurit/';
  const k = ctx.latest.khi;
  const eki = ctx.latest.elinkustannusindeksi;
  if (!k || !eki) throw new Error('laskurit: data/khi.json or data/elinkustannusindeksi.json is missing (run npm run fetch)');

  const cards = calculatorCards(ctx);
  const ekiSeries = buildSeries(ctx.data, { ids: ['eki-1951'] })[0];
  const prevYear = f.ymAdd(eki.month, -12);
  const prevPoint = pointAt(ekiSeries, prevYear);

  const intro = h`<div class="prose laskurit-prose">
  <p>Laskurit käyttävät Tilastokeskuksen virallisia pistelukuja ja päivittyvät automaattisesti, kun uudet luvut julkaistaan. Uusimmat luvut ovat ${ablative(k.month)}: kuluttajahinnat nousivat vuodessa ${f.pct(k.yoy)} ja elinkustannusindeksi oli ${f.idx(eki.value, 0)} (${eki.base}).</p>
  <p>Indeksikorotukset ja rahan arvo lasketaan <strong>pisteluvuista</strong>, ei vuosimuutosprosenteista: uusi summa = vanha summa × uusi pisteluku / vanha pisteluku.${
    prevPoint ? ` Esimerkiksi elinkustannusindeksillä ${f.monthName(prevYear)} → ${f.monthName(eki.month)}: ${f.idx(eki.value, 0)} / ${f.idx(prevPoint, 0)} = ${f.num(eki.value / prevPoint, 4)} eli hinnat ${eki.value >= prevPoint ? 'nousivat' : 'laskivat'} ${f.pct(Math.abs(eki.value / prevPoint - 1) * 100, { decimals: 2 })}.` : ''
  }</p>
  <p>Käytä aina samaa indeksiä ja perusvuotta kuin sopimuksessasi. Kaikki kuukausittaiset pisteluvut perusvuosineen löydät <a href="/pisteluvut/">Pisteluvut</a>-sivulta ja laskentatavat <a href="/menetelmat/">Menetelmät</a>-sivulta.</p>
</div>`;

  const en = c.cardGrid(
    [
      { href: '/en/rent-increase-calculator/', eyebrow: 'In English', title: 'Rent increase calculator', text: 'Rent index increases with the Finnish cost-of-living index, explained in English.', meta: 'Calculate', lang: 'en' },
      { href: '/en/value-of-money/', eyebrow: 'In English', title: 'Value of money calculator', text: 'What an amount of money in a past month is worth today, with official Finnish price indices.', meta: 'Calculate', lang: 'en' },
    ],
    { className: 'laskurit-en' },
  );

  const main = h`${c.pageHeader({
    eyebrow: `Laskurit · ${f.monthName(k.month)}`,
    title: 'Laskurit',
    lede: 'Laske vuokrankorotus, rahan arvo, säästöjen todellinen tuotto, oma inflaatiosi ja palkkasi ostovoima Tilastokeskuksen virallisilla luvuilla.',
    meta: h`Luvut ${ablative(k.month)} · Päivitetty <time datetime="${String(k.updated ?? ctx.latest.dataUpdated).slice(0, 10)}">${f.date(k.updated ?? ctx.latest.dataUpdated)}</time> · Lähde: Tilastokeskus`,
  })}
${c.section({ id: 'laskurit', title: 'Valitse laskuri', className: 'section--flush-top', body: c.cardGrid(cards, { className: 'laskurit-grid' }) })}
${c.section({ id: 'pisteluvut', title: 'Miten laskurit laskevat?', intro: 'Pisteluvut, perusvuodet ja lähteet lyhyesti.', body: intro })}
${c.section({ id: 'englanniksi', title: 'Laskurit englanniksi', intro: 'Englanninkieliset versiot esimerkiksi ulkomaalaisille vuokralaisille.', body: h`<div lang="en">${en}</div>` })}`;

  const description = `Laskurit vuokrankorotukselle, rahan arvolle, säästöille, omalle inflaatiolle ja ostovoimalle. Viralliset luvut ${ablative(k.month)}: KHI ${f.pct(k.yoy)}.`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Laskurit',
      url: `${ctx.baseUrl}${path}`,
      description,
      inLanguage: 'fi',
      isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: ctx.baseUrl },
      mainEntity: {
        '@type': 'ItemList',
        itemListElement: cards.map((card, i) => ({ '@type': 'ListItem', position: i + 1, name: card.title, url: `${ctx.baseUrl}${card.href}` })),
      },
    },
  ];

  return [
    {
      path,
      html: ctx.layout({
        title: 'Laskurit – vuokra, rahan arvo ja ostovoima',
        description,
        path,
        page: 'laskurit',
        breadcrumbs: ctx.crumbs(path, 'Laskurit'),
        jsonLd,
        main,
      }),
      changefreq: 'monthly',
    },
  ];
}
