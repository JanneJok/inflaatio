/**
 * Small DOM helpers shared by browser modules. No HTML strings: build nodes
 * with el() / textContent, or toggle `hidden` on server-rendered markup.
 */

/** True on English pages (<html lang="en">). */
export const isEnglishPage = () => String(document.documentElement.lang || '').startsWith('en');

/**
 * Pick a UI text by page language: byLang('Kopioitu', 'Copied').
 * @param {string} fi
 * @param {string} en
 */
export const byLang = (fi, en) => (isEnglishPage() ? en : fi);

/** @param {string} sel @param {ParentNode} [root] */
export const $ = (sel, root = document) => root.querySelector(sel);
/** @param {string} sel @param {ParentNode} [root] */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Delegated event listener: handler(event, matchedElement).
 * @param {EventTarget} root
 * @param {string} type
 * @param {string} selector
 * @param {(e: Event, el: Element) => void} handler
 */
export function on(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const target = e.target instanceof Element ? e.target.closest(selector) : null;
    if (target) handler(e, target);
  });
}

/**
 * Create an element with attributes and text/element children.
 * @param {string} tag
 * @param {Record<string, string|boolean|null|undefined>} [attrs]
 * @param {...(Node|string|null|undefined|false)} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** @returns {boolean} */
export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Parse a JSON data island rendered by ctx.jsonScript(id, data)
 * (<script type="application/json" id="…">). Returns null if it is missing
 * or invalid.
 * @param {string} id
 * @returns {any}
 */
export function readDataIsland(id) {
  const node = document.getElementById(id);
  if (!node) return null;
  try {
    return JSON.parse(node.textContent ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Run `callback` once when `target` comes within `rootMargin` of the viewport
 * (lazy work such as loading Chart.js). Runs immediately without
 * IntersectionObserver support.
 * @param {Element} target
 * @param {() => void} callback
 * @param {string} [rootMargin='300px 0px']
 */
export function onVisible(target, callback, rootMargin = '300px 0px') {
  if (!('IntersectionObserver' in window)) {
    callback();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        callback();
      }
    },
    { rootMargin },
  );
  io.observe(target);
}

let toastTimer = 0;
/**
 * Announce a short status message (visible toast + polite live region).
 * @param {string} message
 * @param {number} [ms=4000]
 */
export function announce(message, ms = 4000) {
  const toast = document.getElementById('tilailmoitus');
  if (!toast) return;
  window.clearTimeout(toastTimer);
  // Clear first so the same message is announced again.
  toast.textContent = '';
  window.requestAnimationFrame(() => {
    toast.textContent = message;
    toast.classList.add('is-visible');
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      toastTimer = window.setTimeout(() => {
        toast.textContent = '';
      }, 300);
    }, ms);
  });
}

const openers = new WeakMap();

/**
 * Open a native <dialog> modally and return focus to `opener` when it closes.
 * @param {HTMLDialogElement} dialog
 * @param {Element|null} [opener]
 */
export function openDialog(dialog, opener = document.activeElement) {
  if (!dialog || dialog.open) return;
  if (opener instanceof HTMLElement) openers.set(dialog, opener);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/** @param {HTMLDialogElement|null} dialog */
export function closeDialog(dialog) {
  if (!dialog?.open) return;
  if (typeof dialog.close === 'function') dialog.close();
  else {
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));
  }
}

/**
 * Wire every dialog on the page: [data-dialog-close] buttons, backdrop click
 * and focus return. Esc is handled natively by showModal().
 */
export function initDialogs() {
  for (const dialog of $$('dialog')) {
    dialog.addEventListener('close', () => {
      const opener = openers.get(dialog);
      openers.delete(dialog);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    // A click on the ::backdrop targets the <dialog> itself (content has padding wrappers).
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog(dialog);
    });
  }
  on(document, 'click', '[data-dialog-close]', (e, btn) => {
    e.preventDefault();
    closeDialog(btn.closest('dialog'));
  });
}
