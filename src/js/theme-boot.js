/*
 * Blocking theme script (classic script in <head>, runs before first paint).
 * - adds the `js` class to <html> (CSS shows JS-only controls without a layout shift)
 * - applies the saved theme ('light' | 'dark') as data-theme on <html>;
 *   no value = automatic (follows prefers-color-scheme)
 * - syncs <meta name="theme-color"> with the chosen theme
 * Must never throw: storage can be blocked (private mode, disabled cookies).
 */
(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  let theme;
  try {
    theme = window.localStorage.getItem('theme');
  } catch {
    theme = null;
  }
  if (theme !== 'light' && theme !== 'dark') return;
  root.setAttribute('data-theme', theme);
  // Must match THEME_COLORS in src/site.config.js (--bg in tokens.css).
  const color = theme === 'dark' ? '#0B1117' : '#F7F8FA';
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color);
})();
