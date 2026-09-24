/**
 * Embeddable widget (/upotus/) and its instructions page (/upotus/ohje/).
 *
 * The same file runs in two ways, so it must not import anything:
 * 1. /upotus/ loads it as a CLASSIC blocking script in <head> with
 *    data-upotus="widget": it applies ?teema=vaalea|tumma as data-theme on
 *    <html> before first paint. Without the parameter the widget follows the
 *    reader's prefers-color-scheme (a theme saved on inflaatio.fi is ignored,
 *    the embedding site decides). Never throws: storage/URL access can be
 *    restricted inside third-party frames.
 * 2. /upotus/ohje/ loads it as a module (layout scripts): the theme and width
 *    options (segmented controls) update the iframe code and the live preview.
 *    Copying is handled by site.js (data-copy-target); the GA event
 *    'widget_code_copied' is sent by analytics.js track() via data-track.
 */

const THEMES = { vaalea: 'light', tumma: 'dark', light: 'light', dark: 'dark' };

function applyWidgetTheme() {
  const root = document.documentElement;
  let param;
  try {
    param = new URLSearchParams(window.location.search).get('teema');
  } catch {
    param = null;
  }
  const theme = THEMES[String(param ?? '').toLowerCase()];
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}

function initGenerator() {
  const island = document.getElementById('upotus-koodit');
  const code = document.getElementById('upotuskoodi');
  const frame = document.getElementById('upotus-esikatselu');
  if (!island || !code) return;
  let variants;
  try {
    variants = JSON.parse(island.textContent || '{}');
  } catch {
    return;
  }
  const state = { teema: 'auto', leveys: '320' };
  const update = () => {
    const v = variants[`${state.teema}|${state.leveys}`];
    if (!v) return;
    code.textContent = v.code;
    if (frame) {
      if (frame.getAttribute('src') !== v.preview) frame.setAttribute('src', v.preview);
      frame.closest('[data-embed-preview]')?.setAttribute('data-leveys', state.leveys);
    }
  };
  document.addEventListener('segmentedchange', (e) => {
    const detail = /** @type {CustomEvent} */ (e).detail ?? {};
    if (detail.name === 'upotus-teema') state.teema = detail.value;
    else if (detail.name === 'upotus-leveys') state.leveys = detail.value;
    else return;
    update();
  });
}

try {
  if (document.currentScript?.getAttribute('data-upotus') === 'widget') applyWidgetTheme();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGenerator, { once: true });
  else initGenerator();
} catch (err) {
  console.error('[inflaatio] upotus init failed', err);
}
