/**
 * /404.html – Finnish "page not found" page (module notfound, owner EXTRAS;
 * PSA-27, OPS-22, PROD-9).
 *
 * Served by nginx (error_page 404) and scripts/serve.js for every unknown
 * URL, so every link and asset on it is root-relative (the layout's are).
 * noindex, not in the sitemap, no breadcrumbs (it is not a place in the
 * site hierarchy) and no search box: the latest figure plus the main
 * destinations are the fastest way back.
 */

/**
 * Sentence with the latest KHI figure, its month and source.
 * @param {any} fmt
 * @param {{month: string, yoy: number}} k ctx.latest.khi
 * @returns {string}
 */
export function latestSentence(fmt, k) {
  const when = fmt.capitalize(fmt.inessive(k.month));
  if (k.yoy > 0) return `${when} kuluttajahinnat olivat ${fmt.pct(k.yoy)} korkeammat kuin vuotta aiemmin (Tilastokeskus).`;
  if (k.yoy < 0) return `${when} kuluttajahinnat olivat ${fmt.pct(Math.abs(k.yoy))} alemmat kuin vuotta aiemmin (Tilastokeskus).`;
  return `${when} kuluttajahinnat olivat samalla tasolla kuin vuotta aiemmin (Tilastokeskus).`;
}

/** @param {any} ctx */
export default async function notfound(ctx) {
  const { html, fmt, c } = ctx;
  const path = '/404.html';
  const k = ctx.latest.khi;

  const latest = k && fmt.isNum(k.yoy)
    ? c.callout({
        tone: 'note',
        title: `Inflaatio nyt: ${fmt.pct(k.yoy)} (${fmt.monthName(k.month)})`,
        body: html`<p>${latestSentence(fmt, k)} <a href="/">Katso luvut ja kehitys etusivulta</a>.</p>`,
      })
    : '';

  const cards = c.cardGrid([
    { href: '/', eyebrow: 'Etusivu', title: 'Inflaatio Suomessa nyt', text: 'Tuorein luku, tunnusluvut ja kehitys kuukausittain.', meta: 'Avaa' },
    { href: '/inflaatio/', eyebrow: 'Historia', title: 'Inflaatio vuosittain', text: 'Viralliset vuosimuutokset vuodesta 1980 ja kuukausiluvut.', meta: 'Avaa' },
    { href: '/laskurit/', eyebrow: 'Laskurit', title: 'Laskurit', text: 'Vuokrankorotus, rahan arvo, oma inflaatio ja ostovoima.', meta: 'Avaa' },
    { href: '/hinnat/', eyebrow: 'Hinnat', title: 'Mikä kallistui?', text: 'Hintojen muutokset hyödykeryhmittäin.', meta: 'Avaa' },
  ]);

  const main = html`${c.pageHeader({
    eyebrow: 'Virhe 404',
    title: 'Sivua ei löytynyt',
    lede: 'Hakemaasi sivua ei ole olemassa tai se on siirretty. Tarkista osoite tai jatka alla olevista linkeistä.',
  })}
${c.section({
  id: 'jatka',
  title: 'Jatka tästä',
  body: html`<div class="notfound">${latest}${cards}</div>`,
})}`;

  return [
    {
      path,
      sitemap: false,
      noindex: true,
      html: ctx.layout({
        title: 'Sivua ei löytynyt',
        description: 'Hakemaasi sivua ei löytynyt. Katso Suomen tuorein inflaatioluku, inflaatio vuosittain, laskurit ja hintojen muutokset.',
        path,
        page: 'notfound',
        noindex: true,
        main,
      }),
    },
  ];
}
