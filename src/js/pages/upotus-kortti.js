/**
 * Embeddable card /upotus/ (module script of the bare widget document).
 *
 * The card promises embedders that it sets no cookies and never loads Google
 * Analytics, so it needs none of site.js (consent, GA, contact form, theme
 * menu). Its only job here is the cookieless page-view counter of
 * lib/analytics.js (no consent needed; skipped with GPC/DNT and outside
 * inflaatio.fi). The live preview on /upotus/ohje/ loads the card with
 * ?esikatselu=1 and is not counted as a widget load.
 * The theme (?teema=) is applied before first paint by upotus-ohje.js.
 */
import { pageView } from '../lib/analytics.js';

/**
 * True for the preview iframe on /upotus/ohje/ (never in published embed code).
 * @param {string} search location.search
 * @returns {boolean}
 */
export function isPreview(search) {
  try {
    return new URLSearchParams(search).has('esikatselu');
  } catch {
    return false;
  }
}

if (typeof window !== 'undefined') {
  try {
    if (!isPreview(window.location.search)) pageView();
  } catch (err) {
    console.error('[inflaatio] widget page view failed', err);
  }
}
