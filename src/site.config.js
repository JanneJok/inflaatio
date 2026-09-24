/**
 * Site constants, navigation, footer and the page registry (SPEC §11).
 *
 * ISOMORPHIC: imported by the build (as `ctx.site`) and bundled into browser
 * code (consent, analytics, contact). Keep it free of Node/DOM APIs. Browser
 * code should import the named exports it needs so esbuild can tree-shake the
 * rest; the build uses the default export.
 */

/** Canonical origin, no trailing slash. */
export const BASE_URL = 'https://inflaatio.fi';
export const BRAND = 'Inflaatio.fi';
export const LANG = 'fi';

/** Operator (rekisterinpitäjä), as in the previous site's terms of use. */
export const OPERATOR = Object.freeze({
  name: 'Opak Oy',
  businessId: '2950233-8',
  address: Object.freeze({ street: 'Kivikastintie 24', postalCode: '65300', city: 'Vaasa' }),
});

/**
 * Consent cookie (the only cookie set without consent). Bumping
 * CONSENT_VERSION asks every visitor again.
 */
export const CONSENT_VERSION = 2;
export const CONSENT = Object.freeze({
  cookieName: 'inflaatio_cookie_consent',
  version: CONSENT_VERSION,
  maxAgeDays: 365,
});

/** Google Analytics 4 – loaded only after explicit consent (SPEC §0.2). */
export const GA_ID = 'G-Y6YW3W445P';

/**
 * Own cookieless page-view counter (Supabase REST insert, legitimate interest).
 * The anon key is public by design (row level security allows insert only).
 */
export const SUPABASE = Object.freeze({
  url: 'https://ysuhexvvgjoizrcdrxso.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlzdWhleHZ2Z2pvaXpyY2RyeHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2MDQzODksImV4cCI6MjA3ODE4MDM4OX0.0UFYz-xd_QmUEdVcKWqRo6D4QcwvAmlKDKSdu7M4ENA',
  table: 'inflaatio_analytics',
});

/** EmailJS (contact form). Public identifiers, not secrets. */
export const EMAILJS = Object.freeze({
  serviceId: 'service_nnxux1e',
  templateId: 'template_evci98f',
  publicKey: 'EV6UX6GIPG231yXUd',
});

/** Theme colours for <meta name="theme-color"> (must equal --bg in tokens.css). */
export const THEME_COLORS = Object.freeze({ light: '#F7F8FA', dark: '#0B1117' });

/** Default social image (1200×630 PNG, produced by the `og` page module). */
export const OG_IMAGE = Object.freeze({
  path: '/og/inflaatio.png',
  width: 1200,
  height: 630,
  alt: 'Inflaatio.fi – Suomen inflaatio nyt',
});

/**
 * Primary navigation. `match` lists path prefixes that belong to the section
 * (the item gets aria-current="true"; an exact href match gets "page").
 */
export const NAV = Object.freeze([
  { label: 'Nyt', href: '/', match: ['/'] },
  { label: 'Historia', href: '/inflaatio/', match: ['/inflaatio/', '/katsaus/', '/pisteluvut/'] },
  { label: 'Hinnat', href: '/hinnat/', match: ['/hinnat/', '/polttoaineet/'] },
  { label: 'Vertailu', href: '/vertailu/', match: ['/vertailu/', '/korot/'] },
  {
    label: 'Laskurit',
    href: '/laskurit/',
    match: ['/laskurit/', '/vuokrankorotus/', '/rahanarvo/', '/oma-inflaatio/', '/ostovoima/'],
  },
  { label: 'Tietoa', href: '/tietoa/', match: ['/tietoa/', '/menetelmat/', '/kayttoehdot/', '/data/', '/upotus/'] },
]);

/**
 * Footer link columns. Items with `action` render as buttons
 * ('consent' opens the cookie settings, 'contact' the contact form).
 */
export const FOOTER = Object.freeze([
  {
    title: 'Sivusto',
    links: [
      { label: 'Etusivu', href: '/' },
      { label: 'Inflaatio vuosittain', href: '/inflaatio/' },
      { label: 'Kuukausikatsaukset', href: '/katsaus/' },
      { label: 'Pisteluvut', href: '/pisteluvut/' },
      { label: 'Avoin data', href: '/data/' },
      { label: 'Upota sivullesi', href: '/upotus/ohje/' },
    ],
  },
  {
    title: 'Laskurit',
    links: [
      { label: 'Vuokrankorotus', href: '/vuokrankorotus/' },
      { label: 'Rahan arvo', href: '/rahanarvo/' },
      { label: 'Oma inflaatio', href: '/oma-inflaatio/' },
      { label: 'Ostovoima', href: '/ostovoima/' },
    ],
  },
  {
    title: 'Aiheet',
    links: [
      { label: 'Hinnat', href: '/hinnat/' },
      { label: 'Polttoaineet', href: '/polttoaineet/' },
      { label: 'Vertailu', href: '/vertailu/' },
      { label: 'Korot', href: '/korot/' },
    ],
  },
  {
    title: 'Tietoa',
    links: [
      { label: 'Menetelmät', href: '/menetelmat/' },
      { label: 'Tietoa palvelusta', href: '/tietoa/' },
      { label: 'Käyttöehdot ja tietosuoja', href: '/kayttoehdot/' },
      { label: 'Evästeasetukset', action: 'consent' },
      { label: 'Ota yhteyttä', action: 'contact' },
      { label: 'RSS-syöte', href: '/feed.xml' },
      { label: 'In English', href: '/en/', lang: 'en', hreflang: 'en' },
    ],
  },
]);

/**
 * English chrome for the pages with lang: 'en' (/en/ and the two English
 * calculators): header navigation and footer columns. Links to Finnish pages
 * carry lang/hreflang 'fi'.
 */
export const NAV_EN = Object.freeze([
  { label: 'Overview', href: '/en/', match: [] },
  { label: 'Rent increase', href: '/en/rent-increase-calculator/', match: ['/en/rent-increase-calculator/'] },
  { label: 'Value of money', href: '/en/value-of-money/', match: ['/en/value-of-money/'] },
  { label: 'Suomeksi', href: '/', lang: 'fi', hreflang: 'fi', match: [] },
]);

export const FOOTER_EN = Object.freeze([
  {
    title: 'In English',
    links: [
      { label: 'Inflation in Finland', href: '/en/' },
      { label: 'Rent increase calculator', href: '/en/rent-increase-calculator/' },
      { label: 'Value of money calculator', href: '/en/value-of-money/' },
    ],
  },
  {
    title: 'Suomeksi',
    lang: 'fi',
    links: [
      { label: 'Etusivu', href: '/', lang: 'fi', hreflang: 'fi' },
      { label: 'Inflaatio vuosittain', href: '/inflaatio/', lang: 'fi', hreflang: 'fi' },
      { label: 'Laskurit', href: '/laskurit/', lang: 'fi', hreflang: 'fi' },
      { label: 'Avoin data', href: '/data/', lang: 'fi', hreflang: 'fi' },
    ],
  },
  {
    title: 'About',
    links: [
      { label: 'Methods (in Finnish)', href: '/menetelmat/', hreflang: 'fi' },
      { label: 'Terms and privacy (in Finnish)', href: '/kayttoehdot/', hreflang: 'fi' },
      { label: 'Cookie settings', action: 'consent' },
      { label: 'Contact us', action: 'contact' },
    ],
  },
]);

/**
 * Page registry: every planned route (SPEC §9) → Finnish name (nav, footer,
 * breadcrumbs), owning page module and phase-2 owner. Dynamic routes
 * (/inflaatio/<yyyy>/, /hinnat/<slug>/ …) are listed as patterns.
 */
export const PAGES = Object.freeze({
  '/': { name: 'Etusivu', module: 'home', owner: 'HOME' },
  '/laskurit/': { name: 'Laskurit', module: 'laskurit', owner: 'CALC' },
  '/vuokrankorotus/': { name: 'Vuokrankorotuslaskuri', module: 'vuokrankorotus', owner: 'CALC' },
  '/rahanarvo/': { name: 'Rahan arvo', module: 'rahanarvo', owner: 'CALC' },
  '/oma-inflaatio/': { name: 'Oma inflaatio', module: 'oma-inflaatio', owner: 'CALC' },
  '/ostovoima/': { name: 'Ostovoima', module: 'ostovoima', owner: 'CALC' },
  '/inflaatio/': { name: 'Inflaatio vuosittain', module: 'inflaatio', owner: 'ARCHIVE' },
  '/inflaatio/:vuosi/': { name: 'Inflaatio {vuosi}', module: 'inflaatio', owner: 'ARCHIVE', pattern: true },
  '/inflaatio/:vuosi/:kuukausi/': { name: '{Kuukausi} {vuosi}', module: 'inflaatio', owner: 'ARCHIVE', pattern: true },
  '/katsaus/': { name: 'Kuukausikatsaukset', module: 'katsaus', owner: 'ARCHIVE' },
  '/katsaus/:kuukausi/': { name: 'Katsaus {kuukausi}', module: 'katsaus', owner: 'ARCHIVE', pattern: true },
  '/pisteluvut/': { name: 'Pisteluvut', module: 'pisteluvut', owner: 'ARCHIVE' },
  '/feed.xml': { name: 'RSS-syöte', module: 'feed', owner: 'ARCHIVE' },
  '/hinnat/': { name: 'Hinnat', module: 'hinnat', owner: 'TOPICS' },
  '/hinnat/:hyodyke/': { name: '{Hyödyke}', module: 'hinnat', owner: 'TOPICS', pattern: true },
  '/polttoaineet/': { name: 'Polttoaineet', module: 'polttoaineet', owner: 'TOPICS' },
  '/vertailu/': { name: 'Vertailu', module: 'vertailu', owner: 'TOPICS' },
  '/korot/': { name: 'Korot', module: 'korot', owner: 'TOPICS' },
  '/kayttoehdot/': { name: 'Käyttöehdot ja tietosuoja', module: 'kayttoehdot', owner: 'TRUST' },
  '/tietoa/': { name: 'Tietoa palvelusta', module: 'tietoa', owner: 'TRUST' },
  '/menetelmat/': { name: 'Menetelmät', module: 'menetelmat', owner: 'TRUST' },
  '/en/': { name: 'In English', module: 'en', owner: 'EXTRAS' },
  '/en/rent-increase-calculator/': { name: 'Rent increase calculator', module: 'en-calculators', owner: 'CALC' },
  '/en/value-of-money/': { name: 'Value of money', module: 'en-calculators', owner: 'CALC' },
  '/upotus/': { name: 'Upotettava inflaatiokortti', module: 'upotus', owner: 'EXTRAS' },
  '/upotus/ohje/': { name: 'Upota sivullesi', module: 'upotus', owner: 'EXTRAS' },
  '/data/': { name: 'Avoin data', module: 'data', owner: 'EXTRAS' },
  '/404.html': { name: 'Sivua ei löytynyt', module: 'notfound', owner: 'EXTRAS' },
  '/og/inflaatio.png': { name: 'Jakokuva', module: 'og', owner: 'EXTRAS' },
  '/tyylit/': { name: 'Tyylit', module: 'tyylit', owner: 'BUILD' },
});

/**
 * Finnish name of a static route from the registry, or null.
 * @param {string} path e.g. '/hinnat/'
 * @returns {string|null}
 */
export function pageName(path) {
  const p = PAGES[path];
  return p && !p.pattern ? p.name : null;
}

const site = Object.freeze({
  baseUrl: BASE_URL,
  brand: BRAND,
  lang: LANG,
  operator: OPERATOR,
  consent: CONSENT,
  CONSENT_VERSION,
  gaId: GA_ID,
  supabase: SUPABASE,
  emailjs: EMAILJS,
  themeColors: THEME_COLORS,
  ogImage: OG_IMAGE,
  nav: NAV,
  footer: FOOTER,
  navEn: NAV_EN,
  footerEn: FOOTER_EN,
  pages: PAGES,
  pageName,
});

export default site;
