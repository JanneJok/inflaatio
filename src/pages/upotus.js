/**
 * /upotus/ and /upotus/ohje/ (module upotus, owner EXTRAS; PROD-20).
 *
 * /upotus/       Embeddable card (about 320×140, also works at 100 % width):
 *                latest KHI annual change with its month, the change from the
 *                previous month, a 25-month sparkline and the source link
 *                "Lähde: Inflaatio.fi · Tilastokeskus" (new tab, rel=noopener).
 *                Bare layout (no header/footer/banners), noindex, not in the
 *                sitemap. Framing is allowed only for this route
 *                (deploy/security-headers-embed.conf). Theme: ?teema=vaalea|tumma;
 *                without the parameter (or without JS) it follows the reader's
 *                prefers-color-scheme. The theme is applied before first paint by
 *                src/js/pages/upotus-ohje.js loaded as a classic script in <head>
 *                (data-upotus="widget").
 * /upotus/ohje/  Instructions: live preview, copyable iframe code (GA event
 *                'widget_code_copied' after consent via data-track → track()),
 *                theme/width options (JS), attribution rules and FAQ.
 */

export const WIDGET_WIDTH = 320;
export const WIDGET_HEIGHT = 140;
const TITLE = 'Inflaatio Suomessa – Inflaatio.fi';

/** Theme option → query string of the widget URL. */
export const WIDGET_THEMES = Object.freeze({ auto: '', vaalea: '?teema=vaalea', tumma: '?teema=tumma' });

/**
 * The iframe snippet for embedding the widget.
 * @param {string} baseUrl e.g. 'https://inflaatio.fi'
 * @param {{theme?: 'auto'|'vaalea'|'tumma', width?: '320'|'full'}} [o]
 * @returns {string}
 */
export function embedCode(baseUrl, { theme = 'auto', width = '320' } = {}) {
  const src = `${baseUrl}/upotus/${WIDGET_THEMES[theme] ?? ''}`;
  const w = width === 'full' ? '100%' : String(WIDGET_WIDTH);
  return `<iframe src="${src}" width="${w}" height="${WIDGET_HEIGHT}" style="border:0;max-width:100%" loading="lazy" title="${TITLE}"></iframe>`;
}

/** @param {any} ctx */
export default async function upotus(ctx) {
  const { html, fmt, svg, c } = ctx;
  const k = ctx.latest.khi;
  const khi = ctx.data.khi;
  if (!k || !fmt.isNum(k.yoy) || !khi?.months?.length) throw new Error('upotus: data/khi.json is missing (run npm run fetch)');

  // ----------------------------------------------------------------- widget
  const i = khi.months.indexOf(k.month);
  const from = Math.max(0, i - 24);
  const sparkMonths = khi.months.slice(from, i + 1);
  const sparkValues = khi.yoy.slice(from, i + 1);
  const [number, unit] = fmt.pct(k.yoy).split(fmt.NBSP);
  const prev = fmt.isNum(k.prevYoy) ? `${fmt.capitalize(fmt.inessive(k.prevMonth, { year: false }))} ${fmt.pct(k.prevYoy)}` : '';

  const spark = svg.sparkline(sparkValues, {
    labels: sparkMonths,
    refLines: [
      { value: 0, cls: 'muted' },
      { value: 2, cls: 'target' },
    ],
    height: 44,
    ariaLabel: `Vuosimuutos kuukausittain ${fmt.monthRange(sparkMonths[0], k.month)}; viimeisin ${fmt.pct(k.yoy)}, katkoviiva 2 %.`,
  });

  const widget = html`<article class="widget" aria-labelledby="kortti-otsikko">
  <div class="widget__head">
    <h1 class="widget__title" id="kortti-otsikko">Inflaatio Suomessa</h1>
    <p class="widget__month"><time datetime="${k.month}">${fmt.monthName(k.month)}</time></p>
  </div>
  <div class="widget__body">
    <p class="widget__value"><span class="widget__number">${number}</span>${fmt.NBSP}<span class="widget__unit">${unit}</span>${
      fmt.isNum(k.delta) ? html` ${c.deltaChip({ value: k.delta })}` : ''
    }</p>
    <div class="widget__spark">${spark}</div>
  </div>
  <p class="widget__caption">Kuluttajahintojen vuosimuutos (KHI)${prev ? html`<span class="widget__prev"> · ${prev}</span>` : ''}</p>
  <p class="widget__source"><a href="${ctx.baseUrl}/" target="_blank" rel="noopener">Lähde: Inflaatio.fi · Tilastokeskus</a></p>
</article>`;

  const widgetDoc = ctx.layout({
    title: 'Inflaatio Suomessa – upotettava kortti',
    description: `Inflaatio Suomessa ${fmt.inessive(k.month)}: ${fmt.pct(k.yoy)} (Tilastokeskus, kuluttajahintaindeksi). Upotettava kortti.`,
    path: '/upotus/',
    page: 'upotus',
    bare: true,
    noindex: true,
    head: html`<script src="${ctx.asset('pages/upotus-ohje.js')}" data-upotus="widget"></script>`,
    main: widget,
  });

  // ------------------------------------------------------------ instructions
  const path = '/upotus/ohje/';
  const variants = {};
  for (const theme of Object.keys(WIDGET_THEMES)) {
    for (const width of ['320', 'full']) {
      variants[`${theme}|${width}`] = { code: embedCode(ctx.baseUrl, { theme, width }), preview: `/upotus/${WIDGET_THEMES[theme]}` };
    }
  }
  const defaultCode = variants['auto|320'].code;

  const options = html`<div class="embed-options js-only" id="upotus-valinnat">
  <div class="embed-options__group">
    <p class="embed-options__label" aria-hidden="true">Teema</p>
    ${c.segmented({
      name: 'upotus-teema',
      label: 'Kortin teema',
      value: 'auto',
      full: true,
      controls: 'upotuskoodi upotus-esikatselu',
      options: [
        { value: 'auto', label: 'Automaattinen' },
        { value: 'vaalea', label: 'Vaalea' },
        { value: 'tumma', label: 'Tumma' },
      ],
    })}
  </div>
  <div class="embed-options__group">
    <p class="embed-options__label" aria-hidden="true">Leveys</p>
    ${c.segmented({
      name: 'upotus-leveys',
      label: 'Kortin leveys',
      value: '320',
      full: true,
      controls: 'upotuskoodi upotus-esikatselu',
      options: [
        { value: '320', label: `${WIDGET_WIDTH} px` },
        { value: 'full', label: 'Koko leveys' },
      ],
    })}
  </div>
</div>`;

  const preview = html`<div class="embed-preview" data-embed-preview data-leveys="320">
  <iframe class="embed-preview__frame" id="upotus-esikatselu" src="/upotus/" width="${WIDGET_WIDTH}" height="${WIDGET_HEIGHT}" loading="lazy" title="${`Esikatselu: ${TITLE}`}"></iframe>
</div>
<p class="embed-preview__note no-js-only">Kortti seuraa lukijan laitteen vaaleaa tai tummaa teemaa. Kiinteän teeman saat lisäämällä osoitteen loppuun <code>?teema=vaalea</code> tai <code>?teema=tumma</code>.</p>`;

  const howTo = html`<ol class="embed-steps">
  <li><strong>Valitse teema ja leveys</strong> esikatselun yläpuolelta, jos haluat. Oletuksena kortti seuraa lukijan laitteen teemaa.</li>
  <li><strong>Kopioi upotuskoodi</strong> Kopioi koodi -painikkeella.</li>
  <li><strong>Liitä koodi sivusi HTML-koodiin</strong>, esimerkiksi WordPressin Mukautettu HTML -lohkoon tai sivupalkin HTML-vimpaimeen.</li>
  <li><strong>Julkaise.</strong> Kortti päivittyy itsestään, kun Tilastokeskus julkaisee uuden luvun – sinun ei tarvitse tehdä mitään.</li>
</ol>`;

  const rules = html`<ul class="embed-rules">
  <li>Kortin saa upottaa maksutta mille tahansa verkkosivulle, myös kaupalliselle.</li>
  <li>Älä poista, peitä tai rajaa kortin lähdelinkkiä <em>Lähde: Inflaatio.fi · Tilastokeskus</em>.</li>
  <li>Älä muuta kortin lukuja äläkä esitä niitä omana aineistonasi.</li>
  <li>Jos kirjoitat luvun myös tekstiisi, mainitse lähde, esimerkiksi: <q>Lähde: Tilastokeskus, kuluttajahintaindeksi, ${fmt.monthName(k.month)} (Inflaatio.fi).</q></li>
  <li>Kortti ei aseta evästeitä eikä lataa Google Analyticsia. Kortin avaukset lasketaan samalla evästeettömällä laskurilla kuin sivuston sivulataukset, ks. <a href="/kayttoehdot/#tietosuoja">tietosuoja</a>.</li>
  <li>Kortti tarjotaan sellaisenaan. Voimme kehittää sen ulkoasua; osoite ja koko pysyvät samoina.</li>
</ul>`;

  const faq = c.accordion(
    [
      {
        summary: 'Kuinka usein luku päivittyy?',
        body: html`<p>Kortti näyttää aina tuoreimman kuluttajahintaindeksin vuosimuutoksen. Tilastokeskus julkaisee luvun kerran kuukaudessa, yleensä kuun puolivälissä${
          ctx.latest.nextRelease?.khi ? html`; seuraava julkaisu on <time datetime="${ctx.latest.nextRelease.khi.date}">${fmt.date(ctx.latest.nextRelease.khi.date)}</time>` : ''
        }. Kortti päivittyy samana päivänä.</p>`,
      },
      {
        summary: 'Voiko kortin kokoa muuttaa?',
        body: html`<p>Kyllä. Korkeus on ${WIDGET_HEIGHT} px, ja leveys voi olla 240 px:stä koko palstan leveyteen (<code>width="100%"</code>). Alle 300 px:n levyisestä kortista pieni kuvaaja jätetään pois.</p>`,
      },
      {
        summary: 'Toimiiko kortti ilman JavaScriptiä?',
        body: html`<p>Toimii. Luvut ovat valmiina kortin HTML:ssä. JavaScriptiä tarvitaan vain kiinteään vaaleaan tai tummaan teemaan (<code>?teema=</code>); ilman sitä kortti seuraa lukijan laitteen teemaa.</p>`,
      },
      {
        summary: 'Mistä luku tulee?',
        body: html`<p>Luku on Tilastokeskuksen kuluttajahintaindeksin (KHI) vuosimuutos eli inflaatio: kuinka paljon kuluttajahinnat ovat nousseet vuodessa. Lue lisää <a href="/menetelmat/">menetelmistä</a> tai lataa luvut <a href="/data/">avoimena datana</a>.</p>`,
      },
    ],
    { headingLevel: 3 },
  );

  const main = html`${c.pageHeader({
    eyebrow: 'Upota sivullesi',
    title: 'Inflaatiokortti omalle sivustollesi',
    lede: 'Näytä Suomen tuorein inflaatioluku blogissa, taloyhtiön sivuilla tai uutissivulla. Kortti on maksuton ja päivittyy automaattisesti.',
    meta: html`Kortissa nyt ${fmt.pct(k.yoy)} (${fmt.monthName(k.month)}) · Lähde: Tilastokeskus, kuluttajahintaindeksi`,
  })}
${c.section({
  id: 'esikatselu',
  title: 'Esikatselu',
  intro: `Kortti on ${WIDGET_WIDTH} × ${WIDGET_HEIGHT} px ja mukautuu myös koko palstan leveyteen.`,
  body: html`${options}${preview}`,
})}
${c.section({
  id: 'koodi',
  title: 'Upotuskoodi',
  intro: 'Kopioi koodi ja liitä se sivusi HTML-koodiin.',
  body: html`${c.codeBlock({ id: 'upotuskoodi', code: defaultCode, label: 'Kopioi koodi', track: 'widget_code_copied' })}${ctx.jsonScript('upotus-koodit', variants)}`,
})}
${c.section({ id: 'ohjeet', title: 'Näin upotat kortin', body: howTo })}
${c.section({ id: 'ehdot', title: 'Käyttöehdot ja lähdemerkintä', body: rules })}
${c.section({ id: 'ukk', title: 'Kysymyksiä', body: faq })}`;

  const ohjeDoc = ctx.layout({
    title: 'Upota inflaatiokortti sivullesi',
    description: 'Upota Suomen tuorein inflaatioluku (KHI) omalle sivullesi maksutta. Kortti päivittyy automaattisesti. Kopioi valmis koodi ja katso esikatselu.',
    path,
    page: 'upotus',
    scripts: ['pages/upotus-ohje.js'],
    breadcrumbs: [
      { name: ctx.site.pageName('/') ?? 'Etusivu', href: '/' },
      { name: ctx.site.pageName(path) ?? 'Upota sivullesi', href: path },
    ],
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: 'Inflaatiokortti omalle sivustollesi',
        description: 'Ohje Inflaatio.fi-inflaatiokortin upottamiseen omalle verkkosivulle.',
        url: `${ctx.baseUrl}${path}`,
        inLanguage: 'fi',
        isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
        dateModified: ctx.latest.dataUpdated ?? undefined,
      },
    ],
    main,
  });

  return [
    { path: '/upotus/', html: widgetDoc, sitemap: false, noindex: true },
    { path, html: ohjeDoc, changefreq: 'monthly' },
  ];
}
