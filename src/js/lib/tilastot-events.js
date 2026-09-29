/**
 * Own event statistics: the whitelist of product events that the site sends
 * to its own Supabase table (analytics.js → ownEvent()), ONLY with analytics
 * consent. Page views are separate (cookieless counter, no consent needed).
 *
 * ISOMORPHIC: imported by the browser (analytics.js, the /tilastot/ owner
 * dashboard) and by the build (the privacy policy on /kayttoehdot/ lists these
 * events). The database accepts exactly these names: keep the `event_type in
 * (…)` list in docs/supabase-tilastot.sql in sync (test/tilastot.test.js
 * compares them).
 *
 * Each event row has only: event_type, page (canonical path) and an optional
 * `detail` from the site's own vocabulary (calculator name, file path, chart
 * option, link host …) – never text the visitor typed, never amounts.
 */

/** @typedef {{label: string, desc: string}} OwnEvent */

/** @type {Readonly<Record<string, OwnEvent>>} */
export const OWN_EVENTS = Object.freeze({
  page_read: {
    label: 'Sivu luettu loppuun',
    desc: 'Alatunniste tuli näkyviin ja sivulla oltiin vähintään 10 sekuntia. Kerran sivulatausta kohden.',
  },
  calculator_used: {
    label: 'Laskuria käytetty',
    desc: 'Kävijä laski laskurilla (kerran sivulatausta kohden). Tarkenne: laskuri.',
  },
  result_shared: {
    label: 'Laskelma jaettu',
    desc: 'Laskelman linkki jaettiin tai kopioitiin.',
  },
  csv_download: {
    label: 'CSV ladattu',
    desc: 'CSV-tiedosto ladattiin. Tarkenne: tiedosto.',
  },
  json_download: {
    label: 'JSON ladattu',
    desc: 'JSON-tiedosto ladattiin. Tarkenne: tiedosto.',
  },
  widget_code_copied: {
    label: 'Upotuskoodi kopioitu',
    desc: 'Upotettavan inflaatiokortin koodi kopioitiin.',
  },
  text_copied: {
    label: 'Teksti kopioitu',
    desc: 'Kopioi-painiketta käytettiin (esim. lähdeviite tai luku). Tarkenne: mitä kopioitiin.',
  },
  contact_form_sent: {
    label: 'Yhteydenotto lähetetty',
    desc: 'Yhteydenottolomake lähetettiin (vain määrä, ei viestiä).',
  },
  chart_changed: {
    label: 'Kaavion valinta vaihdettu',
    desc: 'Kaavion tai näkymän valintaa vaihdettiin, esim. aikaväli tai mittari. Tarkenne: valinta.',
  },
  table_opened: {
    label: 'Taulukko avattu',
    desc: 'Kaavion taulukko tai taulukon kaikki rivit avattiin.',
  },
  faq_opened: {
    label: 'Kysymys avattu',
    desc: 'Usein kysytty kysymys tai muu lisätietolaatikko avattiin. Tarkenne: kysymys.',
  },
  outbound_click: {
    label: 'Ulkoinen linkki',
    desc: 'Linkki toiselle sivustolle avattiin (esim. Tilastokeskus). Tarkenne: verkkotunnus.',
  },
  page_printed: {
    label: 'Sivu tulostettu',
    desc: 'Sivu tulostettiin tai tallennettiin PDF:ksi.',
  },
  js_error: {
    label: 'Selainvirhe',
    desc: 'Sivuston oman JavaScriptin virhe (vain määrä, ei viestiä eikä osoitetta). Kerran sivulatausta kohden.',
  },
});

/** Event names in display order. */
export const OWN_EVENT_NAMES = Object.freeze(Object.keys(OWN_EVENTS));

/** Longest `detail` the database accepts (docs/supabase-tilastot.sql). */
export const DETAIL_MAX = 80;

/**
 * @param {unknown} name
 * @returns {boolean} true for a whitelisted own event
 */
export const isOwnEvent = (name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(OWN_EVENTS, name);

/**
 * Normalise a detail value to the database format: lower case a–z, digits and
 * _ . / : - only (Finnish letters folded: ä → a, ö → o, å → a), other runs
 * of characters become one "-", at most DETAIL_MAX characters. Returns null
 * for an empty result.
 * @param {unknown} value
 * @returns {string|null}
 */
export function eventDetail(value) {
  if (value == null) return null;
  const s = String(value)
    .toLowerCase()
    .replace(/[äå]/g, 'a')
    .replace(/ö/g, 'o')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_./:-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DETAIL_MAX)
    .replace(/-+$/, '');
  return s || null;
}
