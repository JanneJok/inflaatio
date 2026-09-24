/**
 * Segmented controls rendered by components.segmented():
 *   <div role="radiogroup" data-segmented="<name>"><button role="radio" data-value="…">
 * Adds radio-group keyboard behaviour (roving tabindex; arrows/Home/End move
 * and select) and dispatches a bubbling `segmentedchange` CustomEvent with
 * detail { name, value, group } on every user selection.
 */

/** @param {Element} group */
const optionsOf = (group) => Array.from(group.querySelectorAll('[role="radio"]'));

/**
 * Select a value programmatically (e.g. restored from the URL).
 * @param {Element|null} group the [data-segmented] element
 * @param {string} value
 * @param {{silent?: boolean}} [o] silent = no segmentedchange event
 * @returns {boolean} true if the value exists
 */
export function setSegmented(group, value, { silent = true } = {}) {
  if (!group) return false;
  const opts = optionsOf(group);
  const target = opts.find((o) => o.getAttribute('data-value') === value);
  if (!target) return false;
  for (const o of opts) {
    const on = o === target;
    o.setAttribute('aria-checked', String(on));
    o.setAttribute('tabindex', on ? '0' : '-1');
  }
  if (!silent) {
    group.dispatchEvent(
      new CustomEvent('segmentedchange', {
        bubbles: true,
        detail: { name: group.getAttribute('data-segmented'), value, group },
      }),
    );
  }
  return true;
}

/**
 * Current value of a segmented control.
 * @param {Element|null} group
 * @returns {string|null}
 */
export function getSegmented(group) {
  return group?.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute('data-value') ?? null;
}

/** Wire every segmented control inside `root`. @param {ParentNode} [root] */
export function initSegmented(root = document) {
  for (const group of root.querySelectorAll('[data-segmented]')) {
    if (group.hasAttribute('data-segmented-ready')) continue;
    group.setAttribute('data-segmented-ready', '');
    group.addEventListener('click', (e) => {
      const opt = e.target instanceof Element ? e.target.closest('[role="radio"]') : null;
      if (!opt || opt.getAttribute('aria-checked') === 'true') return;
      setSegmented(group, opt.getAttribute('data-value'), { silent: false });
    });
    group.addEventListener('keydown', (e) => {
      const opts = optionsOf(group);
      const i = opts.indexOf(/** @type {any} */ (document.activeElement));
      if (i < 0) return;
      let next = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % opts.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + opts.length) % opts.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = opts.length - 1;
      if (next < 0) return;
      e.preventDefault();
      opts[next].focus();
      setSegmented(group, opts[next].getAttribute('data-value'), { silent: false });
    });
  }
}
