/**
 * /vuokrankorotus/ – rent index increase calculator (owner CALC).
 *
 * Server-rendered: the form with defaults, the result of the default
 * calculation (a worked example with the latest official point figures),
 * the formula, contract clauses, a 24-month table of point figures (the
 * no-JS fallback) and FAQ. src/js/pages/vuokrankorotus.js recalculates on
 * input with the same functions (src/js/lib/calc.js) and keeps the inputs in
 * the URL.
 *
 * `rentCalculator(ctx, { lang })` is also used by the English page
 * (en-calculators.js → /en/rent-increase-calculator/).
 */
import { html } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import { buildSeries, rentIncrease, rentView, pointAt, latestPeriod, seriesName, formatter, periodYear } from '../js/lib/calc.js';
import { monthYearField, out, calcJsonLd, messageData, noJsNote, calculatorCards, calcCrumbs, clock } from './laskurit.js';

export const PATH = '/vuokrankorotus/';
export const PATH_EN = '/en/rent-increase-calculator/';
/** Default example rent (an input example, not a statistic). */
const DEFAULT_RENT = 900;

/** Monthly series offered for rent calculations, in display order. */
export function rentSeries(data) {
  const all = buildSeries(data).filter((s) => s.kind === 'month');
  const eki = all.filter((s) => s.id === 'eki-1951');
  const khi = all.filter((s) => s.family.startsWith('khi-')).sort((a, b) => b.id.localeCompare(a.id));
  const old = all.filter((s) => s.id === 'eki-1939');
  return [...eki, ...khi, ...old];
}

/** UI texts per language. */
const T = {
  fi: {
    rent: 'Nykyinen vuokra',
    rentHint: 'Kuukausivuokra euroina, esimerkiksi 850 tai 850,50.',
    series: 'Indeksi ja perusvuosi',
    seriesHint: 'Valitse sama indeksi kuin vuokrasopimuksessa. Useimmiten se on elinkustannusindeksi (1951:10=100).',
    base: 'Perusindeksin kuukausi',
    baseHint: 'Sopimuksessa mainittu perusindeksi tai edellisen tarkistuksen kuukausi.',
    check: 'Tarkistusindeksin kuukausi',
    checkHint: 'Yleensä viimeisin julkaistu kuukausi.',
    clauses: 'Sopimuksen lisäehdot',
    min: 'Vähimmäiskorotus',
    minHint: 'Esim. ”kuitenkin vähintään 3 %”.',
    max: 'Enimmäiskorotus',
    maxHint: 'Esim. ”enintään 5 %”.',
    extra: 'Lisäkorotus indeksin päälle',
    extraHint: 'Esim. ”indeksin muutos + 1 prosenttiyksikkö”.',
    noDecrease: 'Vuokra ei laske, vaikka indeksi laskisi',
    noDecreaseDesc: 'Monissa sopimuksissa vuokra pysyy ennallaan, jos indeksi laskee.',
    rounding: 'Pyöristys',
    roundingOptions: [
      { value: 'cent', label: 'Lähimpään senttiin' },
      { value: 'euro', label: 'Lähimpään euroon' },
      { value: 'euro-up', label: 'Ylöspäin täyteen euroon' },
    ],
    submit: 'Laske uusi vuokra',
    resultTitle: 'Uusi vuokra',
    increaseLead: ['Korotus ', '/kk eli ', ' (', ' vuodessa).'],
    facts: { series: 'Indeksi', base: 'Perusindeksi', check: 'Tarkistusindeksi', change: 'Indeksin muutos' },
    formula: 'Laskukaava',
    noticeTitle: 'Tekstipohja korotusilmoitukseen',
    noticeCopy: 'Kopioi teksti',
    print: 'Tulosta',
    share: 'Kopioi linkki laskelmaan',
    errorBox: 'Tulosta ei voi laskea. Korjaa merkityt kentät.',
    disclaimer: 'Laskelma on suuntaa antava eikä ole oikeudellista neuvontaa. Tarkista vuokrasopimuksesi indeksiehto: sopimuksen ehdot ratkaisevat.',
    noJs: 'Alla on esimerkkilaskelma uusimmilla pisteluvuilla ja taulukko viimeisten 24 kuukauden pisteluvuista. Voit laskea korotuksen niillä itse: uusi vuokra = vuokra × tarkistusindeksi / perusindeksi.',
    months: { perMonth: '/kk' },
  },
  en: {
    rent: 'Current rent',
    rentHint: 'Monthly rent in euros, for example 850 or 850.50.',
    series: 'Index and base year',
    seriesHint: 'Choose the index named in your lease. Most Finnish leases use the cost-of-living index (elinkustannusindeksi, 1951:10=100).',
    base: 'Base index month',
    baseHint: 'The base index in your lease, or the month of the previous rent review.',
    check: 'Review index month',
    checkHint: 'Usually the latest published month.',
    clauses: 'Other lease terms',
    min: 'Minimum increase',
    minHint: 'E.g. “but at least 3%”.',
    max: 'Maximum increase',
    maxHint: 'E.g. “at most 5%”.',
    extra: 'Additional increase on top of the index',
    extraHint: 'E.g. “index change + 1 percentage point”.',
    noDecrease: 'The rent does not go down if the index falls',
    noDecreaseDesc: 'Many leases keep the rent unchanged when the index falls.',
    rounding: 'Rounding',
    roundingOptions: [
      { value: 'cent', label: 'To the nearest cent' },
      { value: 'euro', label: 'To the nearest euro' },
      { value: 'euro-up', label: 'Up to the next whole euro' },
    ],
    submit: 'Calculate the new rent',
    resultTitle: 'New rent',
    increaseLead: ['Increase ', ' a month, or ', ' (', ' a year).'],
    facts: { series: 'Index', base: 'Base index', check: 'Review index', change: 'Index change' },
    formula: 'Formula',
    noticeTitle: 'Text for a rent increase notice',
    noticeCopy: 'Copy text',
    print: 'Print',
    share: 'Copy link to this calculation',
    errorBox: 'The result cannot be calculated. Please correct the marked fields.',
    disclaimer: 'The calculation is indicative and not legal advice. Check the index clause of your lease: its terms decide.',
    noJs: 'Below is a worked example with the latest point figures and a table of the last 24 months. You can calculate the increase yourself: new rent = rent × review index / base index.',
    months: { perMonth: '/month' },
  },
};

/** Message templates for the page script (placeholders in braces). */
const MESSAGES = {
  fi: {
    rent: 'Anna vuokra euroina, esimerkiksi 850 tai 850,50.',
    percent: 'Anna prosentti numerona, esimerkiksi 3 tai 2,5, tai jätä kenttä tyhjäksi.',
    minMax: 'Enimmäiskorotuksen pitää olla vähintään yhtä suuri kuin vähimmäiskorotus.',
    before: '{sarja}: pisteluvut alkavat kuukaudesta {alku}. Valitse myöhempi kuukausi tai toinen sarja.',
    future: 'Pistelukua ei ole vielä julkaistu kuukaudelle {kuukausi}. Viimeisin on {viimeisin}.',
    missing: 'Kuukaudelle {kuukausi} ei ole julkaistu pistelukua.',
    seriesInfo: 'Pisteluvut {alku} – {loppu}. Viimeisin {arvo} ({kuukausi}).',
  },
  en: {
    rent: 'Enter the rent in euros, for example 850 or 850.50.',
    percent: 'Enter a percentage as a number, for example 3 or 2.5, or leave the field empty.',
    minMax: 'The maximum increase must be at least as large as the minimum increase.',
    before: '{sarja}: the point figures start in {alku}. Choose a later month or another series.',
    future: 'No point figure has been published for {kuukausi} yet. The latest is {viimeisin}.',
    missing: 'No point figure has been published for {kuukausi}.',
    seriesInfo: 'Point figures {alku} – {loppu}. Latest {arvo} ({kuukausi}).',
  },
};

/** Query parameter names per language. */
const PARAMS = {
  fi: { rent: 'vuokra', series: 'sarja', base: 'perus', check: 'tarkistus', min: 'vahintaan', max: 'enintaan', extra: 'lisa', noDecrease: 'eilaske', rounding: 'pyoristys' },
  en: { rent: 'rent', series: 'series', base: 'base', check: 'review', min: 'min', max: 'max', extra: 'extra', noDecrease: 'nodecrease', rounding: 'rounding' },
};

/**
 * Series info line under the series select.
 * @param {object} s compact series
 * @param {'fi'|'en'} lang
 */
function seriesInfo(s, lang) {
  const F = formatter(lang);
  const last = latestPeriod(s);
  return MESSAGES[lang].seriesInfo
    .replace('{alku}', F.periodNumeric(s.start))
    .replace('{loppu}', F.periodNumeric(last))
    .replace('{arvo}', F.idx(pointAt(s, last), s.decimals))
    .replace('{kuukausi}', F.period(last));
}

/**
 * The calculator (form + result panel + data island) in Finnish or English.
 * @param {any} ctx
 * @param {{lang?: 'fi'|'en'}} [o]
 */
export function rentCalculator(ctx, { lang = 'fi' } = {}) {
  const { c } = ctx;
  const t = T[lang];
  const list = rentSeries(ctx.data);
  const def = list.find((s) => s.id === 'eki-1951') ?? list[0];
  if (!def) throw new Error('vuokrankorotus: no index series in data (run npm run fetch)');
  const check = latestPeriod(def);
  const base = fmt.ymAdd(check, -12);
  const result = rentIncrease({ rent: DEFAULT_RENT, baseIndex: pointAt(def, base), checkIndex: pointAt(def, check) });
  if ('error' in result) throw new Error(`vuokrankorotus: default example failed (${result.error})`);
  const view = rentView(result, { series: def, base, check, lang });
  const minYear = Math.min(...list.map((s) => periodYear(s.start)));
  const maxYear = periodYear(check);
  const decimalAttrs = { inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' };

  const form = html`<form class="calc__form form js-only" id="vuokra-lomake" novalidate${ctx.attrs({ data: { lang, ...messageData(MESSAGES[lang]) } })}>
  ${c.field({ id: 'vuokra', label: t.rent, value: String(DEFAULT_RENT), hint: t.rentHint, suffix: '€', required: true, attrs: decimalAttrs })}
  ${c.field({
    id: 'sarja',
    label: t.series,
    as: 'select',
    value: def.id,
    hint: html`${t.seriesHint} ${out('seriesInfo', seriesInfo(def, lang))}`,
    options: list.map((s) => ({ value: s.id, label: seriesName(s.id, lang) })),
  })}
  ${monthYearField({ id: 'perus', legend: t.base, value: base, minYear, maxYear, hint: t.baseHint, lang })}
  ${monthYearField({ id: 'tarkistus', legend: t.check, value: check, minYear, maxYear, hint: t.checkHint, lang })}
  ${c.details({
    summary: t.clauses,
    className: 'calc__more',
    body: html`<div class="calc__grid">
      ${c.field({ id: 'vahintaan', label: t.min, hint: t.minHint, suffix: '%', optional: true, lang, attrs: decimalAttrs })}
      ${c.field({ id: 'enintaan', label: t.max, hint: t.maxHint, suffix: '%', optional: true, lang, attrs: decimalAttrs })}
      ${c.field({ id: 'lisa', label: t.extra, hint: t.extraHint, suffix: lang === 'en' ? 'pp' : '%-yks.', optional: true, lang, attrs: decimalAttrs, className: 'calc__field--wide-suffix' })}
      ${c.field({ id: 'pyoristys', label: t.rounding, as: 'select', value: 'cent', options: t.roundingOptions })}
    </div>
    ${c.checkbox({ id: 'eilaske', label: t.noDecrease, desc: t.noDecreaseDesc })}`,
  })}
  <div class="calc__submit js-only">${c.button({ label: t.submit, variant: 'primary', type: 'submit' })}</div>
</form>`;

  const perMonth = t.months.perMonth;
  const lead = t.increaseLead;
  const resultPanel = html`<div class="calc__result" id="vuokra-tulos" role="region" aria-labelledby="vuokra-tulos-otsikko">
  <h3 class="calc__result-title" id="vuokra-tulos-otsikko">${t.resultTitle}</h3>
  <div data-result-ok>
    <div class="calc__live" aria-live="polite" aria-atomic="true">
      <p class="calc__big">${out('newRent', view.newRent)}<span class="calc__big-unit">${perMonth}</span></p>
      <p class="calc__lead">${lead[0]}<strong>${out('increase', view.increase)}</strong>${lead[1]}<strong>${out('appliedPct', view.appliedPct)}</strong>${lead[2]}${out('increaseYear', view.increaseYear)}${lead[3]}</p>
    </div>
    ${out('rule', view.rule, 'p', { class: 'calc__rule', hidden: !view.rule })}
    <dl class="calc__facts">
      <div><dt>${t.facts.series}</dt><dd>${out('seriesName', view.seriesName)}</dd></div>
      <div><dt>${t.facts.base}</dt><dd><span class="num">${out('basePoint', view.basePoint)}</span> <span class="subtle">(${out('baseMonth', view.baseMonth)})</span></dd></div>
      <div><dt>${t.facts.check}</dt><dd><span class="num">${out('checkPoint', view.checkPoint)}</span> <span class="subtle">(${out('checkMonth', view.checkMonth)})</span></dd></div>
      <div><dt>${t.facts.change}</dt><dd class="num">${out('indexChangePct', view.indexChangePct)}</dd></div>
    </dl>
    <p class="calc__formula"><span class="calc__formula-label">${t.formula}</span>${out('formula', view.formula, 'code')}</p>
    ${c.details({
      summary: t.noticeTitle,
      className: 'disclosure--plain calc__notice',
      body: html`${out('notice', view.notice, 'p', { id: 'vuokra-ilmoitus', class: 'calc__notice-text' })}
      ${c.copyButton({ target: '#vuokra-ilmoitus', label: t.noticeCopy, size: 'sm', copiedLabel: lang === 'en' ? 'Copied' : 'Kopioitu' })}`,
    })}
    <div class="calc__actions">
      ${c.shareButton({ label: t.share, size: 'sm', track: 'result_shared' })}
      ${c.button({ label: t.print, size: 'sm', variant: 'ghost', className: 'js-only', attrs: { data: { print: '' } } })}
    </div>
  </div>
  <p class="calc__error" data-result-error hidden role="alert">${t.errorBox}</p>
  <p class="calc__disclaimer">${t.disclaimer}</p>
</div>`;

  const island = ctx.jsonScript('vuokra-data', {
    lang,
    params: PARAMS[lang],
    defaults: { rent: DEFAULT_RENT, series: def.id, base, check, rounding: 'cent' },
    series: list.map((s) => ({ id: s.id, name: seriesName(s.id, lang), decimals: s.decimals, start: s.start, values: s.values })),
  });

  const calculator = html`${noJsNote(c, t.noJs, lang)}
<div class="calc" id="laskuri-alue">${form}${resultPanel}</div>
${island}`;

  return { calculator, result, view, def, base, check, list };
}

/**
 * Table of the latest 24 months of point figures.
 * @param {any} ctx
 * @param {object[]} list rentSeries()
 * @param {'fi'|'en'} [lang='fi']
 */
export function pointTable(ctx, list, lang = 'fi') {
  const { c } = ctx;
  const F = formatter(lang);
  const ids = ['eki-1951', 'khi-2025', 'khi-2015'];
  const cols = ids.map((id) => list.find((s) => s.id === id)).filter(Boolean);
  const last = latestPeriod(cols[0]);
  const months = Array.from({ length: 24 }, (_, i) => fmt.ymAdd(last, -i));
  const label = (s) => (s.family.startsWith('eki') ? (lang === 'en' ? `Cost-of-living index (${s.base})` : `Elinkustannusindeksi (${s.base})`) : lang === 'en' ? `CPI (${s.base})` : `KHI (${s.base})`);
  return c.dataTable({
    id: 'pisteluvut-24',
    caption: lang === 'en'
      ? `Point figures, ${F.period(months.at(-1))} – ${F.period(last)} (Statistics Finland)`
      : `Pisteluvut ${fmt.monthRange(months.at(-1), last)} (Tilastokeskus)`,
    columns: [{ label: lang === 'en' ? 'Month' : 'Kuukausi' }, ...cols.map((s) => ({ label: label(s), num: true }))],
    rows: months.map((ym) => [F.period(ym), ...cols.map((s) => F.idx(pointAt(s, ym), s.decimals))]),
    visibleRows: 12,
    toggleLabels: lang === 'en' ? { more: 'Show all 24 months', less: 'Show the latest 12 months' } : { more: 'Näytä kaikki 24 kuukautta', less: 'Näytä vain 12 viimeisintä kuukautta' },
    compact: true,
  });
}

/** @param {any} ctx */
export default async function vuokrankorotus(ctx) {
  const { html: h, fmt: f, c } = ctx;
  const eki = ctx.latest.elinkustannusindeksi;
  const k = ctx.latest.khi;
  if (!eki || !k) throw new Error('vuokrankorotus: data/elinkustannusindeksi.json or data/khi.json is missing (run npm run fetch)');
  const calc = rentCalculator(ctx, { lang: 'fi' });
  const { result: r, view: v, base, check, list } = calc;
  const updated = ctx.latest.updated?.elinkustannusindeksi ?? k.updated;
  const next = ctx.latest.nextRelease?.khi;
  const khi2025 = list.find((s) => s.id === 'khi-2025');
  const khiChange = khi2025 && pointAt(khi2025, base) && pointAt(khi2025, check) ? (pointAt(khi2025, check) / pointAt(khi2025, base) - 1) * 100 : null;

  const example = h`<div class="prose">
  <p>Indeksikorotus lasketaan <strong>pisteluvuista</strong>:</p>
  <p class="calc-formula-block"><code>uusi vuokra = nykyinen vuokra × tarkistusindeksi / perusindeksi</code></p>
  <ul>
    <li><strong>Perusindeksi</strong> on sen kuukauden pisteluku, johon korotusta verrataan: yleensä vuokrasopimuksessa mainittu kuukausi tai edellisen tarkistuksen kuukausi.</li>
    <li><strong>Tarkistusindeksi</strong> on sopimuksen mukaisen tarkistuskuukauden pisteluku, yleensä viimeisin julkaistu luku.</li>
  </ul>
  <p><strong>Esimerkki uusimmilla luvuilla.</strong> Vuokra on ${f.eur(r.rent, 0)}. Perusindeksi on elinkustannusindeksin ${f.genitive(base)} pisteluku ${v.basePoint} ja tarkistusindeksi ${f.genitive(check)} pisteluku ${v.checkPoint}. Uusi vuokra on ${f.eur(r.rent)} × ${v.checkPoint} / ${v.basePoint} = <strong>${v.newRent}</strong>. Vuokra nousee ${f.eur(r.increase)} kuukaudessa eli ${f.pct(r.appliedPct, { decimals: 2 })}.</p>
  <p>Korotus lasketaan pisteluvuista eikä inflaatioprosentista. ${f.capitalize(f.inessive(k.month))} kuluttajahintojen vuosimuutos oli ${f.pct(k.yoy)}, mutta sopimuksen korotus riippuu siitä, mitä indeksiä ja mitä kuukausia sopimus käyttää: esimerkiksi elinkustannusindeksillä samojen kuukausien muutos on ${f.pct(r.indexChangePct, { decimals: 2, sign: true })}${khiChange != null ? ` ja kuluttajahintaindeksillä (2025=100) ${f.pct(khiChange, { decimals: 2, sign: true })}` : ''}. Jos tarkistusväli on muu kuin tasan vuosi, korotus voi poiketa vuosimuutoksesta selvästi.</p>
</div>`;

  const clauses = h`<div class="prose">
  <p>Vuokran korottamisesta ja sen perusteesta sovitaan vuokrasopimuksessa. Tavallisimpia indeksiehtoja:</p>
  <dl class="calc-terms">
    <div><dt>”Vuokraa tarkistetaan vuosittain elinkustannusindeksin muutoksen mukaisesti.”</dt><dd>Perusmuoto: vuokra muuttuu samassa suhteessa kuin indeksin pisteluku.</dd></div>
    <div><dt>”… kuitenkin vähintään 3 %.”</dt><dd>Vähimmäiskorotus: jos indeksi nousee vähemmän, vuokra nousee silti sovitun vähimmäismäärän. Syötä ehto kohtaan Vähimmäiskorotus.</dd></div>
    <div><dt>”… enintään 5 %.”</dt><dd>Enimmäiskorotus eli katto: indeksiä suurempi nousu rajataan sovittuun enimmäismäärään.</dd></div>
    <div><dt>”Indeksin muutos + 1 prosenttiyksikkö.”</dt><dd>Kiinteä lisä indeksin muutoksen päälle. Syötä se kohtaan Lisäkorotus.</dd></div>
    <div><dt>”Vuokra ei laske, vaikka indeksi laskisi.”</dt><dd>Jos indeksi laskee, vuokra pysyy ennallaan.</dd></div>
  </dl>
  <p><strong>Kiinteä vai liukuva perusindeksi?</strong> Osa sopimuksista vertaa aina alkuperäiseen perusindeksiin ja alkuperäiseen vuokraan, osa edellisen tarkistuksen pistelukuun ja silloiseen vuokraan. Jos sopimus käyttää kiinteää perusindeksiä, syötä laskuriin alkuperäinen vuokra ja sopimuksen perusindeksin kuukausi.</p>
  <p><strong>Mikä kuukausi?</strong> Tilastokeskus julkaisee kuukauden pisteluvun yleensä seuraavan kuukauden puolivälissä${
    next ? `: ${f.genitive(next.period)} luvut julkaistaan ${f.date(next.date)}${clock(next.time)}` : ''
  }. Uusin julkaistu kuukausi on ${f.monthName(check)}.</p>
</div>
${c.callout({ tone: 'note', title: 'Tarkista sopimuksesi', body: 'Laskelma on suuntaa antava eikä ole oikeudellista neuvontaa. Sopimuksen indeksiehto ratkaisee, mitä indeksiä, kuukausia ja pyöristystä käytetään.' })}`;

  const table = h`${pointTable(ctx, list, 'fi')}
<p class="table-note">Kaikki kuukaudet ja perusvuodet: <a href="/pisteluvut/">Pisteluvut</a>. Pisteluvut ovat Tilastokeskuksen virallisia lukuja; elinkustannusindeksi julkaistaan kokonaislukuina ja kuluttajahintaindeksi kahden desimaalin tarkkuudella.</p>`;

  const faq = c.accordion(
    [
      {
        id: 'mika-on-elinkustannusindeksi',
        summary: 'Mikä on elinkustannusindeksi?',
        open: true,
        body: h`<p>Elinkustannusindeksi on Tilastokeskuksen pitkä hintaindeksisarja, jonka perusajankohta on lokakuu 1951 (= 100). Sen muutokset lasketaan kuluttajahintaindeksistä, ja sitä käytetään edelleen monissa vuokra- ja muissa sopimuksissa. ${f.capitalize(f.inessive(eki.month))} pisteluku oli ${f.idx(eki.value, 0)}.</p>`,
      },
      {
        id: 'mika-sarja',
        summary: 'Minkä sarjan valitsen?',
        body: h`<p>Saman, joka mainitaan vuokrasopimuksessa. Jos sopimuksessa lukee pelkkä ”elinkustannusindeksi”, tarkoitetaan yleensä sarjaa 1951:10=100. Kuluttajahintaindeksin perusvuosia on useita (esim. 2025=100 ja 2015=100); käytä sopimuksessa mainittua.</p>`,
      },
      {
        id: 'miksi-eri-tulos',
        summary: 'Miksi eri sarjat antavat hieman eri tuloksen?',
        body: h`<p>Pisteluvut julkaistaan pyöristettyinä: elinkustannusindeksi kokonaislukuina ja kuluttajahintaindeksi kahdella desimaalilla. Siksi saman ajanjakson muutos voi erota eri sarjoissa muutaman sadasosaprosentin. Sopimuksen mukainen sarja ratkaisee.</p>`,
      },
      {
        id: 'milloin-julkaistaan',
        summary: 'Milloin uusi pisteluku julkaistaan?',
        body: h`<p>${
          next
            ? `Tilastokeskus julkaisee ${f.genitive(next.period)} kuluttajahintaindeksin ja elinkustannusindeksin ${f.date(next.date)}${clock(next.time)}.`
            : 'Tilastokeskus julkaisee kuluttajahintaindeksin ja elinkustannusindeksin yleensä seuraavan kuukauden puolivälissä.'
        } Laskuri päivittyy uusiin lukuihin automaattisesti.</p>`,
      },
    ],
    { faq: true, headingLevel: 3 },
  );

  const sources = c.sourceLine({
    sources: [
      { name: 'Tilastokeskus', href: 'https://stat.fi/tilasto/khi', detail: 'elinkustannusindeksi, taulukko 11xl; kuluttajahintaindeksi, taulukot 11xs ja 15b5' },
    ],
    updated,
  });

  const main = h`${c.pageHeader({
    eyebrow: `Laskuri · elinkustannusindeksi, ${f.monthName(eki.month)}`,
    title: 'Vuokrankorotuslaskuri',
    lede: `Laske vuokran indeksikorotus Tilastokeskuksen virallisilla pisteluvuilla. Elinkustannusindeksin pisteluku oli ${f.idx(eki.value, 0)} ${f.inessive(eki.month)} (${eki.base}).`,
    meta: h`Päivitetty <time datetime="${String(updated).slice(0, 10)}">${f.date(updated)}</time> · Lähde: Tilastokeskus · <a href="${PATH_EN}" hreflang="en" lang="en">In English</a>`,
  })}
${c.section({ id: 'laskuri', title: 'Laske uusi vuokra', className: 'section--flush-top', body: calc.calculator })}
${c.section({ id: 'nain-lasketaan', title: 'Näin vuokrankorotus lasketaan', body: example })}
${c.section({ id: 'sopimusehdot', title: 'Tavallisia sopimusehtoja', intro: 'Yleistä tietoa indeksiehdoista – tarkista aina oma sopimuksesi.', body: clauses })}
${c.section({ id: 'pisteluvut', title: 'Pisteluvut 24 kuukaudelta', intro: 'Elinkustannusindeksi ja kuluttajahintaindeksi kuukausittain, uusin ensin.', body: h`${table}${sources}` })}
${c.section({ id: 'ukk', title: 'Usein kysyttyä', body: faq })}
${c.section({ id: 'muut-laskurit', title: 'Muut laskurit', body: c.cardGrid(calculatorCards(ctx, { exclude: PATH })) })}`;

  const description = `Laske vuokran indeksikorotus. Elinkustannusindeksi ${f.inessive(eki.month)}: ${f.idx(eki.value, 0)} (${eki.base}). Esimerkki: ${f.eur(r.rent, 0)} → ${v.newRent}.`;
  return [
    {
      path: PATH,
      html: ctx.layout({
        title: 'Vuokrankorotuslaskuri – elinkustannusindeksi',
        description,
        path: PATH,
        page: 'vuokrankorotus',
        alternates: [
          { hreflang: 'en', href: PATH_EN },
          { hreflang: 'x-default', href: PATH },
        ],
        scripts: ['pages/vuokrankorotus.js'],
        breadcrumbs: calcCrumbs(ctx, PATH, 'Vuokrankorotuslaskuri'),
        jsonLd: [calcJsonLd(ctx, { name: 'Vuokrankorotuslaskuri', path: PATH, description })],
        main,
      }),
      changefreq: 'monthly',
      priority: 0.9,
    },
  ];
}

