/**
 * Cookie consent (SPEC §0.2): Google Analytics runs only after an explicit
 * "Salli analytiikka". The own page-view counter (analytics.js) is cookieless
 * and does not depend on this choice.
 *
 * Storage: ONE first-party cookie, no localStorage fallback:
 *   inflaatio_cookie_consent = encodeURIComponent('{"v":2,"analytics":true|false,"d":"YYYY-MM-DD"}')
 *   Max-Age 12 months, Path=/, SameSite=Lax, Secure on https.
 * A stored choice is ignored (the banner is shown again) when
 *   - its version differs from CONSENT_VERSION (bump it whenever the purposes
 *     or the providers change, and describe the change in the privacy policy),
 *   - it is older than CONSENT.maxAgeDays, or the value is malformed.
 *
 * Revoking analytics (choosing "Vain välttämättömät", or unticking it in the
 * settings) disables gtag at once (window['ga-disable-<id>'] = true) and
 * deletes _ga / _ga_<id> cookies on every domain variant they may live on.
 *
 * Emits `consentchange` on document with detail { analytics: boolean }.
 * Markup (banner, settings dialog) is server-rendered in layout.js; this
 * module only toggles `hidden` and opens the native <dialog>.
 *
 * On every page load without a valid positive choice (refused, missing,
 * outdated version, expired, malformed) the GA cookies are deleted too, so a
 * consent given on the old site or over 12 months ago never keeps them alive.
 *
 * The pure helpers (getCookie, serializeConsent, parseConsent, consentCookie,
 * gaCookieNames, cookieDomains, expireCookies, shouldRevoke) are unit-tested
 * in test/trust.test.js.
 */
import { CONSENT, GA_ID } from '../../site.config.js';
import { isoDate } from './format.js';
import { announce, on, openDialog, closeDialog, byLang } from './dom.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ----------------------------------------------------------- pure helpers */

/**
 * Raw value of cookie `name` in a `document.cookie` string, or null.
 * @param {string} cookieString
 * @param {string} name
 * @returns {string|null}
 */
export function getCookie(cookieString, name) {
  if (typeof cookieString !== 'string' || !name) return null;
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Cookie value for a choice: URI-encoded JSON (RFC 6265 cookie-octets only).
 * @param {boolean} analytics
 * @param {{version?: number, date: string}} o date = 'YYYY-MM-DD' of the choice
 * @returns {string}
 */
export function serializeConsent(analytics, { version = CONSENT.version, date }) {
  return encodeURIComponent(JSON.stringify({ v: version, analytics: analytics === true, d: date }));
}

/**
 * Parse a stored cookie value. Returns null (= ask again) when the value is
 * missing or malformed, was stored under another CONSENT_VERSION, has no valid
 * date, is dated in the future, or is older than `maxAgeDays`.
 * Accepts the unencoded JSON of the old site too (it has no version, so it is
 * rejected like any other outdated choice).
 * @param {string|null|undefined} raw
 * @param {{version?: number, maxAgeDays?: number, now?: number}} [o]
 * @returns {{analytics: boolean, date: string}|null}
 */
export function parseConsent(raw, { version = CONSENT.version, maxAgeDays = CONSENT.maxAgeDays, now = Date.now() } = {}) {
  if (typeof raw !== 'string' || !raw) return null;
  let data;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== version || typeof data.analytics !== 'boolean') return null;
  const date = typeof data.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.d) ? data.d : null;
  const t = date ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(t)) return null;
  // A day of tolerance for time zones (the date is written in Helsinki time).
  if (t - now > DAY_MS || now - t > maxAgeDays * DAY_MS) return null;
  return { analytics: data.analytics, date };
}

/**
 * The string to assign to document.cookie for storing a value.
 * @param {string} value already encoded (serializeConsent)
 * @param {{secure?: boolean, maxAgeDays?: number, name?: string}} [o]
 * @returns {string}
 */
export function consentCookie(value, { secure = true, maxAgeDays = CONSENT.maxAgeDays, name = CONSENT.cookieName } = {}) {
  return `${name}=${value}; Max-Age=${Math.round(maxAgeDays * 86400)}; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * Names of Google Analytics cookies present in a document.cookie string
 * (_ga, _ga_<container>, and the legacy Universal Analytics _gid / _gat*).
 * @param {string} cookieString
 * @returns {string[]}
 */
export function gaCookieNames(cookieString) {
  if (typeof cookieString !== 'string') return [];
  const names = cookieString
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter((n) => n === '_ga' || n.startsWith('_ga_') || n === '_gid' || n.startsWith('_gat'));
  return [...new Set(names)];
}

/**
 * Domain attributes a cookie may have been set with on `hostname`: none
 * (host-only), the host itself and every parent domain with at least two
 * labels, each with and without a leading dot. GA sets its cookies on the
 * top-level registrable domain (".inflaatio.fi") by default.
 * @param {string} hostname e.g. 'www.inflaatio.fi'
 * @returns {string[]} e.g. ['', 'www.inflaatio.fi', '.www.inflaatio.fi', 'inflaatio.fi', '.inflaatio.fi']
 */
export function cookieDomains(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  const out = [''];
  // IP addresses and single-label hosts (localhost) only have host-only cookies.
  if (!host || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) return out;
  const labels = host.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    const d = labels.slice(i).join('.');
    out.push(d, `.${d}`);
  }
  return out;
}

/**
 * document.cookie assignments that expire `names` on every domain variant.
 * @param {string[]} names
 * @param {string} hostname
 * @returns {string[]}
 */
export function expireCookies(names, hostname) {
  const domains = cookieDomains(hostname);
  return names.flatMap((name) =>
    domains.map((d) => `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/${d ? `; Domain=${d}` : ''}`),
  );
}

/**
 * Whether Google Analytics must be stopped and its cookies deleted on page
 * load: whenever there is no valid, current, positive choice – refused,
 * missing, stored under an older CONSENT_VERSION (e.g. the old site's
 * unversioned "analytics: true"), expired or malformed (those parse to null).
 * @param {{analytics: boolean}|null|undefined} stored parseConsent() result
 * @returns {boolean}
 */
export function shouldRevoke(stored) {
  return stored?.analytics !== true;
}

/* ---------------------------------------------------------------- browser */

/** The choice made on this page when the cookie could not be stored (cookies blocked). */
let pageChoice = null;

/**
 * Stored consent for the current version, or null when the visitor has not
 * chosen (or chose under an older policy version, or over 12 months ago).
 * @returns {{analytics: boolean, date: string|null}|null}
 */
export function readConsent() {
  let raw = null;
  try {
    raw = getCookie(document.cookie, CONSENT.cookieName);
  } catch {
    /* cookies unavailable */
  }
  return parseConsent(raw) ?? pageChoice;
}

/** @returns {boolean} true only with a stored, current, positive choice */
export function hasAnalyticsConsent() {
  return readConsent()?.analytics === true;
}

function writeConsent(analytics) {
  pageChoice = { analytics: Boolean(analytics), date: isoDate() };
  try {
    document.cookie = consentCookie(serializeConsent(analytics, { date: pageChoice.date }), {
      secure: window.location.protocol === 'https:',
    });
  } catch {
    /* cookies blocked: the choice still applies to this page */
  }
}

/**
 * Stop Google Analytics on this page and delete its cookies (all domain
 * variants). Safe to call when GA was never loaded.
 */
export function revokeAnalytics() {
  window[`ga-disable-${GA_ID}`] = true;
  try {
    for (const c of expireCookies(gaCookieNames(document.cookie), window.location.hostname)) document.cookie = c;
  } catch {
    /* cookies unavailable */
  }
}

const banner = () => document.getElementById('evasteilmoitus');
const dialog = () => /** @type {HTMLDialogElement|null} */ (document.getElementById('evasteasetukset'));
const analyticsBox = () => /** @type {HTMLInputElement|null} */ (document.getElementById('evaste-analytiikka'));

function showBanner() {
  const b = banner();
  if (!b) return;
  b.hidden = false;
  document.documentElement.classList.add('has-consent-banner');
}

function hideBanner() {
  const b = banner();
  if (!b || b.hidden) return;
  const hadFocus = b.contains(document.activeElement);
  b.hidden = true;
  document.documentElement.classList.remove('has-consent-banner');
  // Do not leave keyboard focus on a hidden button.
  if (hadFocus) document.getElementById('main')?.focus({ preventScroll: true });
}

/**
 * Store a choice, apply it (revoke deletes GA cookies), hide the banner,
 * notify listeners and announce it.
 * @param {boolean} analytics
 * @param {{fromSettings?: boolean}} [o]
 */
export function setConsent(analytics, { fromSettings = false } = {}) {
  const allow = Boolean(analytics);
  writeConsent(allow);
  if (!allow) revokeAnalytics();
  hideBanner();
  document.dispatchEvent(new CustomEvent('consentchange', { detail: { analytics: allow } }));
  let msg;
  if (fromSettings) {
    msg = allow
      ? byLang('Valinnat tallennettu: analytiikka sallittu.', 'Choices saved: analytics allowed.')
      : byLang('Valinnat tallennettu: vain välttämättömät evästeet.', 'Choices saved: necessary cookies only.');
  } else {
    msg = allow ? byLang('Analytiikka sallittu.', 'Analytics allowed.') : byLang('Vain välttämättömät evästeet käytössä.', 'Necessary cookies only.');
  }
  announce(msg);
}

/**
 * Open the consent settings dialog (banner "Asetukset", footer
 * "Evästeasetukset", the button on /kayttoehdot/#evasteet). There is exactly
 * one server-rendered dialog; the toggle shows the stored choice.
 * @param {Element|null} [opener]
 */
export function openConsentSettings(opener) {
  const d = dialog();
  if (!d) return;
  const box = analyticsBox();
  if (box) box.checked = hasAnalyticsConsent();
  openDialog(d, opener);
}

export function initConsent() {
  // The old site kept a copy of the choice in localStorage; remove it so an
  // outdated "analytics: true" can never come back.
  try {
    window.localStorage?.removeItem(CONSENT.cookieName);
  } catch {
    /* storage unavailable */
  }

  // Ask again when there is no current choice, and delete GA cookies whenever
  // there is no valid positive consent – also for an outdated or expired
  // "analytics: true", which must not keep old _ga cookies alive.
  const stored = readConsent();
  if (!stored) showBanner();
  if (shouldRevoke(stored)) revokeAnalytics();

  // Opened from the banner's "Asetukset": the opener is hidden once a choice
  // is saved, so dom.js cannot return focus to it – move it to <main>.
  // (Registered after initDialogs(), so this runs after its focus return.)
  dialog()?.addEventListener('close', () => {
    const b = banner();
    const active = document.activeElement;
    if (b?.hidden && (!active || active === document.body || b.contains(active))) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
  });

  on(document, 'click', '[data-consent]', (e, btn) => {
    e.preventDefault();
    setConsent(btn.getAttribute('data-consent') === 'analytics', { fromSettings: Boolean(btn.closest('dialog')) });
    closeDialog(btn.closest('dialog'));
  });
  on(document, 'click', '[data-open-consent]', (e, btn) => {
    e.preventDefault();
    openConsentSettings(btn);
  });
  on(document, 'click', '[data-consent-save]', (e, btn) => {
    e.preventDefault();
    setConsent(Boolean(analyticsBox()?.checked), { fromSettings: true });
    closeDialog(btn.closest('dialog'));
  });
}
