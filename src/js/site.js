/**
 * Site-wide browser entry (every page, <script type="module">): theme menu,
 * navigation, dialogs, consent, analytics, contact form, copy/share buttons,
 * segmented controls, table toggles and print preparation.
 * Page-specific code lives in src/js/pages/<name>.js (layout({ scripts })).
 * Each module is initialised in isolation so one failure cannot break the rest.
 */
import { initTheme } from './lib/theme.js';
import { initNav } from './lib/nav.js';
import { initDialogs } from './lib/dom.js';
import { initConsent } from './lib/consent.js';
import { initAnalytics } from './lib/analytics.js';
import { initContact } from './lib/contact.js';
import { initCopy } from './lib/copy.js';
import { initShare } from './lib/share.js';
import { initSegmented } from './lib/segmented.js';
import { initTableToggles } from './lib/table-toggle.js';

/** Open every <details> for printing and restore afterwards. */
function initPrint() {
  let opened = [];
  window.addEventListener('beforeprint', () => {
    opened = Array.from(document.querySelectorAll('details:not([open])'));
    opened.forEach((d) => d.setAttribute('open', ''));
  });
  window.addEventListener('afterprint', () => {
    opened.forEach((d) => d.removeAttribute('open'));
    opened = [];
  });
}

const modules = {
  theme: initTheme,
  nav: initNav,
  dialogs: initDialogs,
  consent: initConsent,
  analytics: initAnalytics,
  contact: initContact,
  copy: initCopy,
  share: initShare,
  segmented: initSegmented,
  tables: initTableToggles,
  print: initPrint,
};

for (const [name, init] of Object.entries(modules)) {
  try {
    init();
  } catch (err) {
    console.error(`[inflaatio] ${name} init failed`, err);
  }
}
