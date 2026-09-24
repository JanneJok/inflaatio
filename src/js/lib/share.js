/**
 * Share buttons: [data-share="native"] opens the system share sheet when
 * available, otherwise (and for [data-share="copy"]) the current URL, including
 * the view state in the query string, is copied to the clipboard.
 */
import { announce, on, byLang } from './dom.js';
import { copyText } from './copy.js';

/** URL of the current view (path + query state + hash). */
export function currentUrl() {
  return window.location.href;
}

export function initShare() {
  on(document, 'click', '[data-share]', async (e, button) => {
    e.preventDefault();
    const url = currentUrl();
    if (button.getAttribute('data-share') === 'native' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        /* share failed: copy instead */
      }
    }
    if (await copyText(url)) announce(byLang('Linkki kopioitu leikepöydälle.', 'Link copied to the clipboard.'));
    else announce(byLang(`Kopioi linkki osoiteriviltä: ${url}`, `Copy the link from the address bar: ${url}`), 8000);
  });
}
