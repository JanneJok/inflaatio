/**
 * Theme: Automaattinen (follows the OS) / Vaalea / Tumma.
 * The choice is stored in localStorage key `theme` ('light' | 'dark'; absent =
 * automatic) and applied as data-theme on <html> (theme-boot.js does the same
 * before first paint). Dispatches `themechange` on document with
 * detail { mode: 'auto'|'light'|'dark', theme: 'light'|'dark' } whenever the
 * effective theme may have changed (charts re-read their colour tokens).
 */
import { THEME_COLORS } from '../../site.config.js';

const KEY = 'theme';
const MODES = ['auto', 'light', 'dark'];
const LABELS = { auto: 'automaattinen', light: 'vaalea', dark: 'tumma' };
const LABELS_EN = { auto: 'automatic', light: 'light', dark: 'dark' };
const english = () => String(document.documentElement.lang || '').startsWith('en');
const menuLabel = (mode) => (english() ? `Theme: ${LABELS_EN[mode]}` : `Teema: ${LABELS[mode]}`);
const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)');

/** @returns {'auto'|'light'|'dark'} */
export function getMode() {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Effective theme right now. @returns {'light'|'dark'} */
export function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return darkQuery()?.matches ? 'dark' : 'light';
}

function store(mode) {
  try {
    if (mode === 'auto') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, mode);
  } catch {
    /* storage unavailable: the choice lasts for this page view */
  }
}

function syncMeta(mode) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media') ?? '';
    const own = media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.setAttribute('content', mode === 'auto' ? own : THEME_COLORS[mode]);
  }
}

function dispatch(mode) {
  document.dispatchEvent(new CustomEvent('themechange', { detail: { mode, theme: currentTheme() } }));
}

/**
 * Apply and store a mode.
 * @param {'auto'|'light'|'dark'} mode
 */
export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  store(mode);
  syncMeta(mode);
  updateMenu(mode);
  dispatch(mode);
}

let menuEls = null;

function updateMenu(mode) {
  if (!menuEls) return;
  const { button, items } = menuEls;
  for (const item of items) item.setAttribute('aria-checked', String(item.dataset.themeValue === mode));
  button.setAttribute('aria-label', menuLabel(mode));
  button.setAttribute('title', menuLabel(mode));
}

/** Wire the header theme menu (menu button pattern with menuitemradio items). */
export function initTheme() {
  const wrap = document.querySelector('[data-theme-menu]');
  const mode = getMode();
  syncMeta(mode);
  darkQuery()?.addEventListener?.('change', () => {
    if (getMode() === 'auto') dispatch('auto');
  });
  if (!wrap) return;
  const button = wrap.querySelector('.theme-menu__button');
  const menu = wrap.querySelector('[role="menu"]');
  const items = Array.from(menu.querySelectorAll('[role="menuitemradio"]'));
  menuEls = { button, items };
  updateMenu(mode);

  const isOpen = () => !menu.hidden;
  const open = (focusIndex) => {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const idx = focusIndex ?? Math.max(0, items.findIndex((i) => i.getAttribute('aria-checked') === 'true'));
    items[(idx + items.length) % items.length]?.focus({ preventScroll: true });
  };
  const close = (returnFocus = true) => {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus({ preventScroll: true });
  };

  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open(e.key === 'ArrowUp' ? items.length - 1 : 0);
    }
  });
  menu.addEventListener('click', (e) => {
    const item = e.target instanceof Element ? e.target.closest('[role="menuitemradio"]') : null;
    if (!item) return;
    setMode(/** @type {any} */ (item.dataset.themeValue));
    close();
  });
  menu.addEventListener('keydown', (e) => {
    const i = items.indexOf(/** @type {any} */ (document.activeElement));
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[(i + 1) % items.length].focus({ preventScroll: true });
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[(i - 1 + items.length) % items.length].focus({ preventScroll: true });
        break;
      case 'Home':
        e.preventDefault();
        items[0].focus({ preventScroll: true });
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1].focus({ preventScroll: true });
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        close(false);
        break;
      default:
    }
  });
  document.addEventListener('click', (e) => {
    if (isOpen() && e.target instanceof Node && !wrap.contains(e.target)) close(false);
  });
}
