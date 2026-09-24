/**
 * Document shell (SPEC §4): <head> metadata, header with navigation, live
 * chip and theme menu, <main>, footer, and the server-rendered (hidden)
 * consent banner, consent settings dialog, contact dialog and status toast.
 * JavaScript only toggles these; everything renders without JS.
 *
 * Page modules call it through the build context:
 *   ctx.layout({ title, description, path, main: html`…` })
 * (ctx.layout(ctx, opts) works too).
 */
import { html, attrs, jsonLd as jsonLdScript, SafeString } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import { breadcrumb, icon, field } from './components.js';
import { GA_COOKIE_MAX_AGE_DAYS } from '../js/lib/analytics.js';
import { CONTACT_LIMITS } from '../js/lib/contact.js';

/** Recommended maximum lengths (search result truncation). */
export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

/**
 * Chrome texts by page language. Finnish is the site language; the English
 * set is used on the few lang: 'en' pages (/en/ and the English calculators)
 * so their header, footer, banner and dialogs are not in Finnish.
 */
const CHROME = {
  fi: {
    skip: 'Siirry sisältöön',
    mainNav: 'Päävalikko',
    openMenu: 'Avaa valikko',
    closeMenu: 'Sulje valikko',
    theme: 'Teema',
    themes: { auto: 'Automaattinen', light: 'Vaalea', dark: 'Tumma' },
    footerNav: 'Alatunniste',
    breadcrumb: 'Murupolku',
    home: '/',
  },
  en: {
    skip: 'Skip to content',
    mainNav: 'Main menu',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    theme: 'Theme',
    themes: { auto: 'Automatic', light: 'Light', dark: 'Dark' },
    footerNav: 'Footer',
    breadcrumb: 'Breadcrumb',
    home: '/en/',
  },
};

const isEn = (lang) => String(lang ?? '').startsWith('en');

/** English formatters for the chrome (format.js; same output as calc.js formatter('en')). */
const EN_F = Object.freeze({ period: (ym) => fmt.enMonthName(ym), periodShort: (ym) => fmt.enMonthShort(ym), pct: (v) => fmt.enPct(v), num: (v, d) => fmt.enNum(v, d) });
/** Chrome texts for a language ('fi' for anything but English). */
export const chromeText = (lang) => (isEn(lang) ? CHROME.en : CHROME.fi);

/** '17 September 2026' (Helsinki calendar date) for English chrome. */
const enDate = (v) => fmt.enDate(v);

/**
 * @typedef {object} LayoutOptions
 * @property {string} title page title; " | Inflaatio.fi" is appended unless the
 *   title already contains the brand. Keep the result ≤ 60 characters.
 * @property {string} description meta description, ≤ 155 characters
 * @property {string} path route, e.g. '/hinnat/' (canonical = baseUrl + path)
 * @property {string} [lang='fi']
 * @property {{hreflang: string, href: string}[]} [alternates] language versions
 *   (absolute or root-relative hrefs); the page itself is added automatically
 * @property {string|{path?: string, url?: string, width?: number, height?: number, alt?: string}} [ogImage]
 *   social image (default site.ogImage, 1200×630)
 * @property {string} [ogType='website']
 * @property {string} [ogTitle] defaults to the title without the brand suffix
 * @property {string} [ogDescription] defaults to description
 * @property {object[]} [jsonLd] schema.org objects (each rendered as a JSON-LD block)
 * @property {string[]} [scripts] extra module entries, e.g. ['pages/home.js']
 * @property {SafeString|SafeString[]} main page content (sections)
 * @property {boolean} [noindex=false] adds robots noindex (also excluded from the sitemap)
 * @property {{name: string, href?: string}[]} [breadcrumbs] sub pages: visible
 *   trail + BreadcrumbList JSON-LD. Start with { name: 'Etusivu', href: '/' }.
 * @property {string} [page] page module name → <body data-page="…"> for CSS scoping
 * @property {boolean} [bare=false] no header/footer/banners (embeddable widget)
 * @property {SafeString} [head] extra head markup (e.g. rel=prev/next links)
 */

/**
 * Absolute URL on the site.
 * @param {object} ctx
 * @param {string} pathOrUrl
 */
export function absUrl(ctx, pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${ctx.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/**
 * Breadcrumb trail for a path from the page registry names:
 * crumbs(ctx, '/hinnat/kahvi/', 'Kahvi') → Etusivu › Hinnat › Kahvi.
 * Segments without a registry name use `names[segmentPath]` or the raw segment.
 * @param {object} ctx
 * @param {string} path
 * @param {string} currentName name of the last crumb
 * @param {Record<string, string>} [names] extra names by path, e.g. { '/inflaatio/2024/': '2024' }
 * @returns {{name: string, href: string}[]}
 */
export function crumbs(ctx, path, currentName, names = {}) {
  const out = [{ name: ctx.site.pageName('/') ?? 'Etusivu', href: '/' }];
  const segs = path.split('/').filter(Boolean);
  let acc = '/';
  segs.forEach((seg, i) => {
    acc += `${seg}/`;
    const last = i === segs.length - 1;
    const name = last ? currentName : (names[acc] ?? ctx.site.pageName(acc) ?? decodeURIComponent(seg));
    out.push({ name, href: acc });
  });
  return out;
}

/** aria-current value for a nav item. */
function navCurrent(item, path) {
  if (item.href === path) return 'page';
  if (item.href === '/') return null;
  return item.match?.some((p) => path.startsWith(p)) ? 'true' : null;
}

/**
 * Header: logo, primary nav, live chip, theme menu, hamburger.
 * @param {object} ctx
 * @param {string} path
 */
function header(ctx, path, lang = 'fi') {
  const T = chromeText(lang);
  const en = isEn(lang);
  const k = ctx.latest?.khi;
  // The month is always visible: "elo 2026" on wide screens, "8/2026" on phones
  // (the long form stays in the accessible name there).
  const ym = k ? fmt.parseYm(k.month) : null;
  let chip = '';
  if (k && fmt.isNum(k.yoy)) {
    const F = EN_F;
    const chipTitle = en
      ? `Annual change in consumer prices in ${F.period(k.month)} (Statistics Finland)`
      : `Kuluttajahintojen vuosimuutos ${fmt.inessive(k.month)} (Tilastokeskus)`;
    chip = html`<a class="live-chip" href="${T.home}" title="${chipTitle}"><span class="live-chip__src">${en ? 'CPI' : 'KHI'}</span><span class="live-chip__value">${en ? F.pct(k.yoy) : fmt.pct(k.yoy)}</span><span class="live-chip__month">· ${en ? F.periodShort(k.month) : fmt.monthShort(k.month)}</span><span class="live-chip__month-short" aria-hidden="true">· ${ym.m}/${ym.y}</span></a>`;
  }
  const themeItems = [
    { value: 'auto', label: T.themes.auto, ic: 'auto' },
    { value: 'light', label: T.themes.light, ic: 'sun' },
    { value: 'dark', label: T.themes.dark, ic: 'moon' },
  ];
  const nav = en ? (ctx.site.navEn ?? ctx.site.nav) : ctx.site.nav;
  return html`<header class="site-header">
  <div class="container site-header__inner">
    <a class="brand" href="${T.home}">Inflaatio<span class="brand__tld">.fi</span></a>
    <nav class="site-nav" id="paavalikko" aria-label="${T.mainNav}">
      <ul class="site-nav__list">${nav.map(
        (item) => html`<li><a${attrs({ class: 'site-nav__link', href: item.href, lang: item.lang, hreflang: item.hreflang, 'aria-current': navCurrent(item, path) })}>${item.label}</a></li>`,
      )}</ul>
    </nav>
    <div class="header-tools">
      ${chip}
      <div class="theme-menu" data-theme-menu>
        <button type="button" class="icon-button theme-menu__button" aria-haspopup="menu" aria-expanded="false" aria-controls="teemavalikko" aria-label="${T.theme}" title="${T.theme}">
          ${icon('auto', { className: 'theme-menu__icon theme-menu__icon--auto' })}${icon('sun', { className: 'theme-menu__icon theme-menu__icon--light' })}${icon('moon', { className: 'theme-menu__icon theme-menu__icon--dark' })}
        </button>
        <div class="menu theme-menu__popup" id="teemavalikko" role="menu" aria-label="${T.theme}" hidden>
          <p class="menu__label" aria-hidden="true">${T.theme}</p>
          ${themeItems.map(
            (t) => html`<button${attrs({ type: 'button', class: 'menu__item', role: 'menuitemradio', 'aria-checked': t.value === 'auto' ? 'true' : 'false', tabindex: '-1', data: { themeValue: t.value } })}>${icon(t.ic)}${t.label}${icon('check', { className: 'menu__check' })}</button>`,
          )}
        </div>
      </div>
      <button type="button" class="icon-button nav-toggle" aria-expanded="false" aria-controls="paavalikko" aria-label="${T.openMenu}" data-label-open="${T.openMenu}" data-label-close="${T.closeMenu}">${icon('menu')}${icon('close')}</button>
    </div>
  </div>
</header>`;
}

/**
 * Footer: brand line, link columns and the bottom line with the data year and
 * the latest data update date.
 * @param {object} ctx
 */
function footer(ctx, lang = 'fi') {
  const T = chromeText(lang);
  const en = isEn(lang);
  const month = ctx.latest?.khi?.month;
  const year = month ? month.slice(0, 4) : String(ctx.buildDate).slice(0, 4);
  const updated = ctx.latest?.dataUpdated ?? ctx.buildDate;
  const link = (l) => {
    if (l.action === 'consent') return html`<button type="button" class="site-footer__link js-only" data-open-consent>${l.label}</button>`;
    if (l.action === 'contact') return html`<button type="button" class="site-footer__link js-only" data-open-contact>${l.label}</button>`;
    return html`<a${attrs({ class: 'site-footer__link', href: l.href, lang: l.lang, hreflang: l.hreflang })}>${l.label}</a>`;
  };
  const cols = en ? (ctx.site.footerEn ?? ctx.site.footer) : ctx.site.footer;
  const updatedTime = html`<time datetime="${String(updated).slice(0, 10)}">${en ? enDate(updated) : fmt.date(updated)}</time>`;
  const brandText = en
    ? html`<p>Inflaatio.fi brings Finland’s official inflation figures together in clear charts and tables. The figures are based on statistics from Statistics Finland, Eurostat and the ECB and are updated monthly.</p>
      <p class="site-footer__disclaimer">The information on this site is general information, not investment or financial advice.</p>`
    : html`<p>Inflaatio.fi kokoaa Suomen viralliset inflaatioluvut yhteen paikkaan selkeinä kuvaajina ja taulukkoina. Luvut perustuvat Tilastokeskuksen, Eurostatin ja EKP:n tilastoihin ja päivittyvät kuukausittain.</p>
      <p class="site-footer__disclaimer">Sivuston tiedot ovat yleistä tietoa eivätkä ole sijoitus- tai talousneuvontaa.</p>`;
  const bottom = en
    ? html`© ${year} Inflaatio.fi · Operated by ${ctx.site.operator.name} · Sources: Statistics Finland (CPI), Eurostat (HICP) · Updated ${updatedTime}`
    : html`© ${year} Inflaatio.fi · Ylläpito: ${ctx.site.operator.name} · Lähteet: Tilastokeskus (KHI), Eurostat (YKHI) · Päivitetty ${updatedTime}`;
  return html`<footer class="site-footer">
  <div class="container site-footer__inner">
    <div class="site-footer__brand">
      <p class="site-footer__logo">Inflaatio.fi</p>
      ${brandText}
    </div>
    <nav class="site-footer__nav" aria-label="${T.footerNav}">${cols.map(
      (col, i) => html`<div${attrs({ class: 'site-footer__col', lang: col.lang })}><h2 class="site-footer__heading" id="alatunniste-${i}">${col.title}</h2><ul class="site-footer__list" aria-labelledby="alatunniste-${i}">${col.links.map((l) => html`<li>${link(l)}</li>`)}</ul></div>`,
    )}</nav>
    <p class="site-footer__bottom">${bottom}</p>
  </div>
</footer>`;
}

/* ---------------------------------------------------------------------------
 * Consent banner, consent settings dialog and contact dialog.
 * (Region owned by TRUST; behaviour: src/js/lib/{consent,analytics,contact}.js.
 * Texts must match the privacy policy on /kayttoehdot/.)
 * ------------------------------------------------------------------------- */

/** Fallback operator postal address (site.config OPERATOR.address is the source). */
const OPERATOR_ADDRESS = Object.freeze({ street: 'Kivikastintie 24', postalCode: '65300', city: 'Vaasa' });

/**
 * Operator postal address parts { street, postalCode, city }.
 * @param {object} ctx
 * @returns {{street: string, postalCode: string, city: string}}
 */
export function operatorPostal(ctx) {
  return ctx?.site?.operator?.address ?? OPERATOR_ADDRESS;
}

/**
 * Operator postal address on one line, e.g. "Kivikastintie 24, 65300 Vaasa"
 * (the only verified contact channel besides the contact form).
 * @param {object} ctx
 * @returns {string}
 */
export function operatorAddress(ctx) {
  const a = operatorPostal(ctx);
  return `${a.street}, ${a.postalCode} ${a.city}`;
}

/** Days → whole months for texts ("12 kuukautta"). */
const monthsOf = (days) => Math.round(days / 30.44);

/** Consent banner (hidden until consent.js finds no valid stored choice). */
function consentBanner() {
  return html`<section class="consent-banner" id="evasteilmoitus" aria-labelledby="evasteilmoitus-otsikko" hidden>
  <h2 class="consent-banner__title" id="evasteilmoitus-otsikko">Evästeet</h2>
  <p class="consent-banner__text">Käytämme Google Analyticsia sivuston kehittämiseen vain, jos sallit sen. Välttämätön eväste tallentaa ainoastaan tämän valintasi. Sivulatausten määrän laskemme ilman evästeitä ja tunnisteita. Voit muuttaa valintaa milloin tahansa sivun alareunan Evästeasetukset-painikkeesta.</p>
  <div class="consent-banner__actions">
    <button type="button" class="button button--primary" data-consent="necessary">Vain välttämättömät</button>
    <button type="button" class="button button--primary" data-consent="analytics">Salli analytiikka</button>
  </div>
  <p class="consent-banner__links">
    <button type="button" class="link-button" data-open-consent>Asetukset</button>
    <a href="/kayttoehdot/#evasteet">Evästeet ja tietosuoja</a>
  </p>
</section>`;
}

/**
 * Consent settings dialog: one instance per page; the analytics toggle is a
 * labelled checkbox. "Vain välttämättömät" and "Salli analytiikka" (the
 * same label as in the banner; analytics is the only optional category) have equal
 * weight; "Tallenna valinnat" stores the toggle state.
 * @param {object} ctx
 */
function consentDialog(ctx) {
  const consentMonths = monthsOf(ctx.site.consent.maxAgeDays);
  const gaMonths = monthsOf(GA_COOKIE_MAX_AGE_DAYS);
  const gaCookie = `_ga_${String(ctx.site.gaId).replace(/^G-/, '')}`;
  return html`<dialog class="dialog" id="evasteasetukset" aria-labelledby="evasteasetukset-otsikko" aria-describedby="evasteasetukset-kuvaus">
  <div class="dialog__inner">
    <div class="dialog__header">
      <h2 class="dialog__title" id="evasteasetukset-otsikko">Evästeasetukset</h2>
      <button type="button" class="icon-button" data-dialog-close aria-label="Sulje evästeasetukset">${icon('close')}</button>
    </div>
    <p class="dialog__lede" id="evasteasetukset-kuvaus">Valitse, mitä evästeitä sallit. Voit muuttaa valintaa milloin tahansa sivun alareunan Evästeasetukset-painikkeesta.</p>
    <fieldset class="consent-options">
      <legend class="sr-only">Evästeluokat</legend>
      <div class="consent-option check">
        <input type="checkbox" id="evaste-valttamattomat" checked disabled aria-describedby="evaste-valttamattomat-kuvaus">
        <div>
          <label class="check__label" for="evaste-valttamattomat">Välttämättömät (aina käytössä)</label>
          <p class="check__desc" id="evaste-valttamattomat-kuvaus">Yksi eväste (${ctx.site.consent.cookieName}) muistaa tämän valintasi ${consentMonths} kuukautta, jotta ilmoitusta ei näytetä joka käynnillä.</p>
        </div>
      </div>
      <div class="consent-option check">
        <input type="checkbox" id="evaste-analytiikka" name="analytics" aria-describedby="evaste-analytiikka-kuvaus">
        <div>
          <label class="check__label" for="evaste-analytiikka">Analytiikka (Google Analytics)</label>
          <p class="check__desc" id="evaste-analytiikka-kuvaus">Kertoo, miten sivustoa käytetään, esimerkiksi mitä sivuja luetaan ja mitä laskureita käytetään. Asettaa evästeet _ga ja ${gaCookie} (${gaMonths} kuukautta). Google voi käsitellä tietoja myös Yhdysvalloissa.</p>
        </div>
      </div>
    </fieldset>
    <p class="form__note">Evästeetön kävijälaskuri toimii valinnasta riippumatta: se tallentaa sivulatauksesta vain sivun osoitteen, viittaavan sivuston verkkotunnuksen, laitetyypin ja ajan – ei evästeitä eikä tunnisteita. Jos selaimesi lähettää GPC- tai Do Not Track -signaalin, mitään ei lähetetä. <a href="/kayttoehdot/#kavijatilasto">Tietosuojaseloste</a></p>
    <div class="dialog__actions">
      <button type="button" class="button button--secondary" data-consent="necessary">Vain välttämättömät</button>
      <button type="button" class="button button--secondary" data-consent="analytics">Salli analytiikka</button>
      <button type="button" class="button button--primary" data-consent-save>Tallenna valinnat</button>
    </div>
  </div>
</dialog>`;
}

/**
 * Contact dialog with the form (sent by contact.js via EmailJS). The limits
 * come from contact.js; data-fallback is the alternative channel shown when
 * sending fails (postal address – no unverified e-mail address).
 * @param {object} ctx
 */
function contactDialog(ctx) {
  const L = CONTACT_LIMITS;
  const fallback = `Voit myös lähettää viestin postitse: ${ctx.site.operator.name}, ${operatorAddress(ctx)}.`;
  return html`<dialog class="dialog" id="yhteydenotto" aria-labelledby="yhteydenotto-otsikko">
  <div class="dialog__inner">
    <div class="dialog__header">
      <h2 class="dialog__title" id="yhteydenotto-otsikko">Ota yhteyttä</h2>
      <button type="button" class="icon-button" data-dialog-close aria-label="Sulje">${icon('close')}</button>
    </div>
    <form class="form" id="yhteydenottolomake" data-contact-form data-fallback="${fallback}" novalidate>
      <p class="dialog__lede">Onko sinulla kysyttävää luvuista, huomasitko virheen tai onko sinulla idea sivuston parantamiseksi? Kirjoita meille – vastaamme yleensä muutaman arkipäivän kuluessa.</p>
      ${field({ id: 'yhteys-nimi', name: 'name', label: 'Nimi', optional: true, attrs: { autocomplete: 'name', maxlength: L.name } })}
      ${field({ id: 'yhteys-email', name: 'email', type: 'email', label: 'Sähköposti', required: true, hint: 'Vastaamme tähän osoitteeseen.', attrs: { autocomplete: 'email', maxlength: L.email, inputmode: 'email', spellcheck: 'false' } })}
      ${field({ id: 'yhteys-viesti', name: 'message', as: 'textarea', label: 'Viesti', required: true, hint: `Enintään ${fmt.num(L.message)} merkkiä. Jos viesti koskee lukua, kerro sivu ja kuukausi.`, attrs: { rows: 6, maxlength: L.message } })}
      <div class="field field--hp" aria-hidden="true">
        <label for="yhteys-sivusto">Jätä tämä kenttä tyhjäksi</label>
        <input type="text" id="yhteys-sivusto" name="website" tabindex="-1" autocomplete="off">
      </div>
      <p class="form__error" id="yhteys-virhe" role="alert"></p>
      <p class="form__note">Viesti välitetään sähköpostiimme EmailJS-palvelun kautta. Käytämme yhteystietojasi vain viestiisi vastaamiseen. <a href="/kayttoehdot/#yhteydenotot">Tietosuojaseloste</a></p>
      <div class="dialog__actions">
        <button type="button" class="button button--secondary" data-dialog-close>Peruuta</button>
        <button type="submit" class="button button--primary"><span class="button__label">Lähetä viesti</span></button>
      </div>
    </form>
    <div class="dialog__success" data-contact-success hidden>
      <p role="status" tabindex="-1" data-contact-success-message>Kiitos, viesti on lähetetty! Vastaamme osoitteeseen <strong data-contact-email></strong> yleensä muutaman arkipäivän kuluessa.</p>
      <div class="dialog__actions"><button type="button" class="button button--primary" data-dialog-close>Sulje</button></div>
    </div>
  </div>
</dialog>`;
}

/* English versions of the banner and dialogs (lang: 'en' pages). Same ids,
 * data hooks and behaviour; the policy itself is in Finnish, so its links say so. */

function consentBannerEn() {
  return html`<section class="consent-banner" id="evasteilmoitus" aria-labelledby="evasteilmoitus-otsikko" hidden>
  <h2 class="consent-banner__title" id="evasteilmoitus-otsikko">Cookies</h2>
  <p class="consent-banner__text">We use Google Analytics to improve the site only if you allow it. The necessary cookie only stores this choice. We count page loads without cookies or identifiers. You can change your choice at any time with the Cookie settings button at the bottom of the page.</p>
  <div class="consent-banner__actions">
    <button type="button" class="button button--primary" data-consent="necessary">Necessary only</button>
    <button type="button" class="button button--primary" data-consent="analytics">Allow analytics</button>
  </div>
  <p class="consent-banner__links">
    <button type="button" class="link-button" data-open-consent>Settings</button>
    <a href="/kayttoehdot/#evasteet" hreflang="fi">Cookies and privacy (in Finnish)</a>
  </p>
</section>`;
}

/** @param {object} ctx */
function consentDialogEn(ctx) {
  const consentMonths = monthsOf(ctx.site.consent.maxAgeDays);
  const gaMonths = monthsOf(GA_COOKIE_MAX_AGE_DAYS);
  const gaCookie = `_ga_${String(ctx.site.gaId).replace(/^G-/, '')}`;
  return html`<dialog class="dialog" id="evasteasetukset" aria-labelledby="evasteasetukset-otsikko" aria-describedby="evasteasetukset-kuvaus">
  <div class="dialog__inner">
    <div class="dialog__header">
      <h2 class="dialog__title" id="evasteasetukset-otsikko">Cookie settings</h2>
      <button type="button" class="icon-button" data-dialog-close aria-label="Close cookie settings">${icon('close')}</button>
    </div>
    <p class="dialog__lede" id="evasteasetukset-kuvaus">Choose which cookies you allow. You can change your choice at any time with the Cookie settings button at the bottom of the page.</p>
    <fieldset class="consent-options">
      <legend class="sr-only">Cookie categories</legend>
      <div class="consent-option check">
        <input type="checkbox" id="evaste-valttamattomat" checked disabled aria-describedby="evaste-valttamattomat-kuvaus">
        <div>
          <label class="check__label" for="evaste-valttamattomat">Necessary (always on)</label>
          <p class="check__desc" id="evaste-valttamattomat-kuvaus">One cookie (${ctx.site.consent.cookieName}) remembers this choice for ${consentMonths} months so that the notice is not shown on every visit.</p>
        </div>
      </div>
      <div class="consent-option check">
        <input type="checkbox" id="evaste-analytiikka" name="analytics" aria-describedby="evaste-analytiikka-kuvaus">
        <div>
          <label class="check__label" for="evaste-analytiikka">Analytics (Google Analytics)</label>
          <p class="check__desc" id="evaste-analytiikka-kuvaus">Tells us how the site is used, for example which pages are read and which calculators are used. Sets the cookies _ga and ${gaCookie} (${gaMonths} months). Google may also process the data in the United States.</p>
        </div>
      </div>
    </fieldset>
    <p class="form__note">The cookieless visitor counter works regardless of your choice: from a page load it stores only the page address, the referring domain, the device type and the time – no cookies or identifiers. Nothing is sent if your browser sends a GPC or Do Not Track signal. <a href="/kayttoehdot/#kavijatilasto" hreflang="fi">Privacy policy (in Finnish)</a></p>
    <div class="dialog__actions">
      <button type="button" class="button button--secondary" data-consent="necessary">Necessary only</button>
      <button type="button" class="button button--secondary" data-consent="analytics">Allow analytics</button>
      <button type="button" class="button button--primary" data-consent-save>Save choices</button>
    </div>
  </div>
</dialog>`;
}

/** @param {object} ctx */
function contactDialogEn(ctx) {
  const L = CONTACT_LIMITS;
  const F = EN_F;
  const fallback = `You can also send a message by post: ${ctx.site.operator.name}, ${operatorAddress(ctx)}, Finland.`;
  return html`<dialog class="dialog" id="yhteydenotto" aria-labelledby="yhteydenotto-otsikko">
  <div class="dialog__inner">
    <div class="dialog__header">
      <h2 class="dialog__title" id="yhteydenotto-otsikko">Contact us</h2>
      <button type="button" class="icon-button" data-dialog-close aria-label="Close">${icon('close')}</button>
    </div>
    <form class="form" id="yhteydenottolomake" data-contact-form data-fallback="${fallback}" novalidate>
      <p class="dialog__lede">Have a question about the figures, spotted an error or got an idea for improving the site? Write to us – we usually reply within a few working days.</p>
      ${field({ id: 'yhteys-nimi', name: 'name', label: 'Name', optional: true, lang: 'en', attrs: { autocomplete: 'name', maxlength: L.name } })}
      ${field({ id: 'yhteys-email', name: 'email', type: 'email', label: 'Email', required: true, hint: 'We will reply to this address.', attrs: { autocomplete: 'email', maxlength: L.email, inputmode: 'email', spellcheck: 'false' } })}
      ${field({ id: 'yhteys-viesti', name: 'message', as: 'textarea', label: 'Message', required: true, hint: `Up to ${F.num(L.message, 0)} characters. If your message is about a figure, tell us the page and the month.`, attrs: { rows: 6, maxlength: L.message } })}
      <div class="field field--hp" aria-hidden="true">
        <label for="yhteys-sivusto">Leave this field empty</label>
        <input type="text" id="yhteys-sivusto" name="website" tabindex="-1" autocomplete="off">
      </div>
      <p class="form__error" id="yhteys-virhe" role="alert"></p>
      <p class="form__note">Your message is forwarded to our email via EmailJS. We use your contact details only to reply to your message. <a href="/kayttoehdot/#yhteydenotot" hreflang="fi">Privacy policy (in Finnish)</a></p>
      <div class="dialog__actions">
        <button type="button" class="button button--secondary" data-dialog-close>Cancel</button>
        <button type="submit" class="button button--primary"><span class="button__label">Send message</span></button>
      </div>
    </form>
    <div class="dialog__success" data-contact-success hidden>
      <p role="status" tabindex="-1" data-contact-success-message>Thank you, your message has been sent! We usually reply to <strong data-contact-email></strong> within a few working days.</p>
      <div class="dialog__actions"><button type="button" class="button button--primary" data-dialog-close>Close</button></div>
    </div>
  </div>
</dialog>`;
}

/**
 * Default og:image:alt: the share image shows the latest KHI figure, so the
 * alt text names it (falls back to the static alt without data).
 * @param {object} ctx
 * @param {string} lang
 */
function defaultOgAlt(ctx, lang) {
  const k = ctx.latest?.khi;
  if (!k || !fmt.isNum(k.yoy)) return ctx.site.ogImage.alt;
  if (isEn(lang)) {
    const F = EN_F;
    return `Inflation in Finland in ${F.period(k.month)}: ${F.pct(k.yoy)} (Statistics Finland) – Inflaatio.fi`;
  }
  return `Inflaatio Suomessa ${fmt.inessive(k.month)}: ${fmt.pct(k.yoy)} (Tilastokeskus) – Inflaatio.fi`;
}

/**
 * BreadcrumbList JSON-LD object.
 * @param {object} ctx
 * @param {{name: string, href?: string}[]} items
 * @param {string} path
 */
function breadcrumbJsonLd(ctx, items, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absUrl(ctx, it.href ?? path),
    })),
  };
}

/**
 * Render a full HTML document.
 * @param {object} ctx build context
 * @param {LayoutOptions} o
 * @returns {string} the document (string, ready to write)
 */
export function layout(ctx, o) {
  const {
    title,
    description,
    path,
    lang = 'fi',
    alternates = [],
    ogType = 'website',
    jsonLd = [],
    scripts = [],
    main,
    noindex = false,
    breadcrumbs = [],
    page,
    bare = false,
    head,
  } = o;
  if (!title || !description || !path) throw new Error(`layout: title, description and path are required (${path ?? '?'})`);
  if (!path.startsWith('/')) throw new Error(`layout: path must start with "/" (${path})`);

  const brand = ctx.site.brand;
  const fullTitle = title.includes(brand) ? title : `${title} | ${brand}`;
  const shortTitle = title.replace(` | ${brand}`, '');
  if (fullTitle.length > TITLE_MAX) ctx.warn?.(`${path}: <title> is ${fullTitle.length} characters (max ${TITLE_MAX}): "${fullTitle}"`);
  if (description.length > DESCRIPTION_MAX) {
    ctx.warn?.(`${path}: meta description is ${description.length} characters (max ${DESCRIPTION_MAX})`);
  }

  const canonical = absUrl(ctx, path);
  const ogIn = typeof o.ogImage === 'string' ? { path: o.ogImage } : (o.ogImage ?? {});
  const og = typeof o.ogImage === 'string' ? ogIn : { ...ctx.site.ogImage, ...ogIn };
  const ogUrl = og.url ?? absUrl(ctx, og.path);
  // The default share image shows the latest figure: describe it from the data.
  const ogAlt = ogIn.alt ?? (!ogIn.path && !ogIn.url ? defaultOgAlt(ctx, lang) : ctx.site.ogImage.alt);
  const alts = alternates.length
    ? [{ hreflang: lang, href: canonical }, ...alternates.map((a) => ({ ...a, href: absUrl(ctx, a.href) }))].filter(
        (a, i, arr) => arr.findIndex((b) => b.hreflang === a.hreflang) === i,
      )
    : [];

  const crumbsLd = breadcrumbs.length ? [breadcrumbJsonLd(ctx, breadcrumbs, path)] : [];
  const ld = [...jsonLd, ...crumbsLd];
  // The bare widget document (/upotus/) gets only its own scripts: no site.js,
  // so no consent, Google Analytics, contact or theme-menu code is loaded in
  // an embedded card (the embed terms promise no cookies and no GA).
  const entries = bare ? [...scripts] : ['site.js', ...scripts];
  const preloads = [...new Set(entries.flatMap((e) => ctx.assetImports?.(e) ?? []))];
  const font = ctx.asset('fonts/inter-latin-wght-normal.woff2', { optional: true });

  const headMarkup = html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
${noindex ? html`<meta name="robots" content="noindex">` : html`<link rel="canonical" href="${canonical}">`}
${alts.map((a) => html`<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`)}
<meta name="theme-color" content="${ctx.site.themeColors.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${ctx.site.themeColors.dark}" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<script>${new SafeString(ctx.themeBoot.code)}</script>
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${brand}">
<meta property="og:locale" content="${lang === 'en' ? 'en_GB' : 'fi_FI'}">
<meta property="og:title" content="${o.ogTitle ?? shortTitle}">
<meta property="og:description" content="${o.ogDescription ?? description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogUrl}">
<meta property="og:image:width" content="${og.width ?? 1200}">
<meta property="og:image:height" content="${og.height ?? 630}">
<meta property="og:image:alt" content="${ogAlt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${o.ogTitle ?? shortTitle}">
<meta name="twitter:description" content="${o.ogDescription ?? description}">
<meta name="twitter:image" content="${ogUrl}">
<meta name="twitter:image:alt" content="${ogAlt}">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="Inflaatio.fi – uudet luvut" href="/feed.xml">
${font ? html`<link rel="preload" href="${font}" as="font" type="font/woff2" crossorigin>` : ''}
<link rel="stylesheet" href="${ctx.asset('main.css')}">
${preloads.map((p) => html`<link rel="modulepreload" href="${p}">`)}
${entries.map((e) => html`<script type="module" src="${ctx.asset(e)}"></script>`)}
${ld.map((d) => jsonLdScript(d))}
${head ?? ''}`;

  const bodyAttrs = attrs({ class: bare ? 'is-bare' : null, data: { page } });
  const T = chromeText(lang);
  const crumbsMarkup = breadcrumbs.length ? html`<div class="container page-crumbs">${breadcrumb(breadcrumbs, { label: T.breadcrumb })}</div>` : '';
  const mainMarkup = html`<main${attrs({ id: 'main', class: ['site-main', breadcrumbs.length && 'site-main--crumbs'], tabindex: '-1' })}>
${crumbsMarkup}
${main}
</main>`;

  const body = bare
    ? html`<body${bodyAttrs}>
${mainMarkup}
</body>`
    : html`<body${bodyAttrs}>
<a class="skip-link" href="#main">${T.skip}</a>
${isEn(lang) ? consentBannerEn() : consentBanner()}
${header(ctx, path, lang)}
${mainMarkup}
${footer(ctx, lang)}
${isEn(lang) ? consentDialogEn(ctx) : consentDialog(ctx)}
${isEn(lang) ? contactDialogEn(ctx) : contactDialog(ctx)}
<p class="toast" id="tilailmoitus" role="status" aria-live="polite" aria-atomic="true"></p>
</body>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
${headMarkup}
</head>
${body}
</html>
`;
}

export { SafeString };
