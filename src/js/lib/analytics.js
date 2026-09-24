/**
 * Analytics (SPEC §0.2). Two separate things:
 *
 * 1. Own page-view counter – cookieless and minimised, legitimate interest,
 *    no consent needed (described in /kayttoehdot/#tietosuoja).
 *    ONE Supabase insert per page load with exactly:
 *      { event_type: 'page_view', page, referrer, device }
 *    - page: the canonical path (no query string, no hash; the 404 page is
 *      reported as '/404.html' so mistyped URLs are never stored),
 *    - referrer: 'direct' | 'internal' | the referring host name (no path),
 *    - device: 'mobile' | 'tablet' | 'desktop' (coarse class).
 *    The time comes from the database (created_at default now()). No ids, no
 *    cookies, no storage, no search terms, no clicks, no polling, no timers.
 *    Skipped entirely when Global Privacy Control or Do Not Track is on,
 *    outside inflaatio.fi / www.inflaatio.fi, and while the page is being
 *    prerendered (it is sent when the prerendered page is actually shown).
 *    Table schema, RLS and retention: docs/supabase.sql.
 *
 * 2. Google Analytics 4 – gtag.js is loaded from googletagmanager.com ONLY
 *    after explicit consent (consent.js) and only on the production host.
 *    Product events (calculator used, CSV download, share, widget code copied)
 *    go to GA only, i.e. only with consent:
 *      track('calculator_used', { … })  or  <button data-track="csv_download">
 *
 * The pure helpers are unit-tested in test/trust.test.js.
 */
import { GA_ID, SUPABASE } from '../../site.config.js';
import { hasAnalyticsConsent } from './consent.js';
import { on } from './dom.js';

/** Hosts where analytics may run (never localhost, previews or fly.dev). */
export const PRODUCTION_HOSTS = Object.freeze(['inflaatio.fi', 'www.inflaatio.fi']);

/** Lifetime of the GA cookies we configure (matches the 12-month consent). */
export const GA_COOKIE_MAX_AGE_DAYS = 365;

/**
 * Retention of both the page-view rows (pg_cron job in docs/supabase.sql) and
 * the GA event data (set by the owner in GA: Admin → Data retention).
 * The privacy policy reads this constant.
 */
export const RETENTION_MONTHS = 14;

/** The only event type the page-view counter sends. */
export const PAGE_VIEW_EVENT = 'page_view';

/** Columns sent to Supabase, in this order (the privacy policy lists them). */
export const PAGE_VIEW_FIELDS = Object.freeze(['event_type', 'page', 'referrer', 'device']);

const MAX_PATH = 200;
const MAX_HOST = 100;

/* ----------------------------------------------------------- pure helpers */

/**
 * @param {string} hostname
 * @returns {boolean}
 */
export function isProductionHost(hostname) {
  return PRODUCTION_HOSTS.includes(String(hostname ?? '').toLowerCase());
}

/**
 * True when the browser asks not to be tracked (Global Privacy Control or
 * Do Not Track).
 * @param {{globalPrivacyControl?: boolean, doNotTrack?: string|null, msDoNotTrack?: string}} [nav]
 * @param {{doNotTrack?: string}} [win]
 * @returns {boolean}
 */
export function privacySignal(nav = globalThis.navigator ?? {}, win = globalThis.window ?? {}) {
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.msDoNotTrack === '1' || win.doNotTrack === '1';
}

/**
 * Referrer category: 'direct' (none or unparsable), 'internal' (same site,
 * www or not) or the external host name without "www." (no path, no query).
 * @param {string} referrer document.referrer
 * @param {string} hostname location.hostname
 * @returns {string}
 */
export function referrerCategory(referrer, hostname) {
  if (!referrer) return 'direct';
  let host;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'direct';
  }
  if (!host) return 'direct';
  const bare = (h) => String(h ?? '').toLowerCase().replace(/^www\./, '');
  if (bare(host) === bare(hostname)) return 'internal';
  host = bare(host);
  return /^[a-z0-9.-]+$/.test(host) && host.length <= MAX_HOST ? host : 'other';
}

/**
 * Coarse device class from the primary pointer and the screen's short side
 * (stable across window sizes; no user-agent parsing).
 * @param {{coarse: boolean, shortSide: number}} o
 * @returns {'mobile'|'tablet'|'desktop'}
 */
export function deviceClass({ coarse, shortSide }) {
  if (!coarse) return 'desktop';
  return Number.isFinite(shortSide) && shortSide >= 600 ? 'tablet' : 'mobile';
}

/**
 * Path to record: the canonical path when the page has one (normalises
 * /index.html and similar), '/404.html' on the not-found page (the requested
 * URL may contain anything), otherwise the location path. Never a query
 * string or hash; at most 200 characters.
 * @param {{pathname: string, canonical?: string|null, notFound?: boolean}} o
 * @returns {string}
 */
export function pagePath({ pathname, canonical, notFound = false }) {
  if (notFound) return '/404.html';
  let p = null;
  if (canonical) {
    try {
      p = new URL(canonical).pathname;
    } catch {
      p = null;
    }
  }
  p ??= String(pathname ?? '/').split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  return p.slice(0, MAX_PATH);
}

/**
 * The page-view row (exactly PAGE_VIEW_FIELDS).
 * @param {{pathname: string, canonical?: string|null, notFound?: boolean, referrer: string, hostname: string, coarse: boolean, shortSide: number}} o
 * @returns {{event_type: string, page: string, referrer: string, device: string}}
 */
export function pageViewPayload({ pathname, canonical, notFound, referrer, hostname, coarse, shortSide }) {
  return {
    event_type: PAGE_VIEW_EVENT,
    page: pagePath({ pathname, canonical, notFound }),
    referrer: referrerCategory(referrer, hostname),
    device: deviceClass({ coarse, shortSide }),
  };
}

/**
 * GA4 event names: letters, digits and underscores, starting with a letter,
 * at most 40 characters.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidEventName(name) {
  return typeof name === 'string' && /^[a-z][a-z0-9_]{0,39}$/i.test(name);
}

/* ------------------------------------------------- page-view counter (1) */

let pageViewSent = false;

function collectPageView() {
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const s = window.screen;
  const shortSide = s ? Math.min(s.width, s.height) : Number.NaN;
  return pageViewPayload({
    pathname: window.location.pathname,
    canonical,
    notFound: document.body?.dataset.page === 'notfound',
    referrer: document.referrer,
    hostname: window.location.hostname,
    coarse,
    shortSide,
  });
}

function sendPageView() {
  try {
    fetch(`${SUPABASE.url}/rest/v1/${SUPABASE.table}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE.anonKey,
        Authorization: `Bearer ${SUPABASE.anonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(collectPageView()),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    /* analytics must never break the page */
  }
}

/** Record the cookieless page view (at most once per page load). */
export function pageView() {
  if (pageViewSent) return;
  pageViewSent = true;
  if (privacySignal() || !isProductionHost(window.location.hostname)) return;
  // A prerendered page may never be shown: count it only when it is activated.
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => sendPageView(), { once: true });
    return;
  }
  sendPageView();
}

/* ------------------------------------------------ Google Analytics (2) */

let gaLoaded = false;

/**
 * Load gtag.js – only with consent and only on the production host, so
 * development and QA never touch the production property.
 * @returns {boolean} true when gtag is available and enabled
 */
function loadGa() {
  if (!isProductionHost(window.location.hostname) || !hasAnalyticsConsent()) return false;
  window[`ga-disable-${GA_ID}`] = false;
  if (gaLoaded) {
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    return true;
  }
  gaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  // gtag() must push the `arguments` object itself (not an array).
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  // Loaded only after consent: analytics storage granted, advertising denied.
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_expires: GA_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
    cookie_flags: 'SameSite=Lax;Secure',
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.append(s);
  return true;
}

/** Consent withdrawn on this page (consent.js already set ga-disable and deleted the cookies). */
function stopGa() {
  window[`ga-disable-${GA_ID}`] = true;
  if (gaLoaded && typeof window.gtag === 'function') window.gtag('consent', 'update', { analytics_storage: 'denied' });
}

/**
 * Product event to Google Analytics (no-op without consent or outside the
 * production host).
 * @param {string} event e.g. 'calculator_used', 'csv_download', 'share', 'widget_code_copied'
 * @param {Record<string, string|number|boolean>} [params]
 */
export function track(event, params = {}) {
  if (!isValidEventName(event) || !hasAnalyticsConsent() || !loadGa()) return;
  try {
    window.gtag('event', event, params);
  } catch {
    /* never break the page */
  }
}

export function initAnalytics() {
  pageView();
  if (hasAnalyticsConsent()) loadGa();
  document.addEventListener('consentchange', (e) => {
    if (e.detail?.analytics) loadGa();
    else stopGa();
  });
  on(document, 'click', '[data-track]', (_e, el) => {
    // Download links also name the file (a site path such as /data/khi.csv, never user data).
    const href = el.hasAttribute('download') ? el.getAttribute('href') : null;
    const params = href && href.startsWith('/') ? { file_name: href.split(/[?#]/)[0] } : {};
    track(el.getAttribute('data-track') ?? '', params);
  });
}
