/**
 * Form helpers shared by the calculator page scripts
 * (src/js/pages/{vuokrankorotus,rahanarvo,oma-inflaatio,ostovoima}.js).
 * Browser only: they work on the server-rendered calculator markup of
 * src/pages/laskurit.js (monthYearField, out) and components.field().
 *
 * - message templates: data-msg-<key> attributes with {placeholders}
 * - field errors: text in #<id>-virhe + aria-invalid on the controls
 * - month + year pickers: selects #<id>-kk and #<id>-v
 * - result panels: [data-out] elements, [data-result-ok] / [data-result-error]
 * - debounced recalculation on input/change, immediate on submit
 */

/** @param {string} id @returns {any} */
export const byId = (id) => document.getElementById(id);

/**
 * Replace {name} placeholders: fill('Uusin on {kk}.', { kk: 'elokuu' }).
 * @param {string|undefined|null} template
 * @param {Record<string, string|number>} [vars]
 */
export function fill(template, vars = {}) {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template ?? '');
}

/**
 * Message lookup for a form with data-msg-* attributes (laskurit.js
 * messageData()): const msg = messages(form); msg('future', { kuukausi }).
 * @param {HTMLElement} form
 * @returns {(key: string, vars?: Record<string, string|number>) => string}
 */
export function messages(form) {
  return (key, vars) => fill(form.dataset[`msg${key.charAt(0).toUpperCase()}${key.slice(1)}`], vars);
}

/**
 * Show or clear a field error: text in #<errorId>-virhe, aria-invalid on `ids`.
 * @param {string} errorId
 * @param {string|null|undefined} text empty/undefined clears the error
 * @param {string[]} [ids] controls that get aria-invalid (default [errorId])
 */
export function setError(errorId, text, ids = [errorId]) {
  const p = byId(`${errorId}-virhe`);
  if (p) p.textContent = text ?? '';
  for (const id of ids) byId(id)?.setAttribute('aria-invalid', text ? 'true' : 'false');
}

/**
 * Value of a month + year picker: 'YYYY-MM', or 'YYYY' when the month select
 * is on "Koko vuosi" (value '').
 * @param {string} id base id of the picker
 */
export function readPeriod(id) {
  const m = byId(`${id}-kk`)?.value ?? '';
  const y = byId(`${id}-v`)?.value ?? '';
  return m ? `${y}-${m}` : y;
}

/**
 * Restore a picker from 'YYYY-MM' / 'YYYY'. Values that are not offered
 * (a year outside the list, "whole year" without that option) are ignored.
 * @param {string} id
 * @param {string|null|undefined} p
 * @returns {boolean} true when the picker was set
 */
export function setPeriod(id, p) {
  if (typeof p !== 'string' || !/^\d{4}(-(0[1-9]|1[0-2]))?$/.test(p)) return false;
  const [y, m = ''] = p.split('-');
  const ySel = byId(`${id}-v`);
  const mSel = byId(`${id}-kk`);
  if (!ySel || !mSel) return false;
  if (!Array.from(ySel.options).some((o) => o.value === y)) return false;
  if (!Array.from(mSel.options).some((o) => o.value === m)) return false;
  ySel.value = y;
  mSel.value = m;
  return true;
}

/**
 * Write a view model into the [data-out] elements of `root`.
 * @param {Element|null} root
 * @param {Record<string, string>} view
 * @param {string[]} [hideEmpty] keys whose element is hidden when the text is empty
 */
export function render(root, view, hideEmpty = []) {
  for (const node of root?.querySelectorAll('[data-out]') ?? []) {
    const key = node.getAttribute('data-out');
    if (!key || !(key in view)) continue;
    node.textContent = view[key];
    if (hideEmpty.includes(key)) /** @type {HTMLElement} */ (node).hidden = !view[key];
  }
}

/**
 * Show the result, the error box or (state 'hint') a neutral hint of a
 * result panel ([data-result-ok], [data-result-error], [data-result-hint]).
 * @param {Element|null} panel
 * @param {boolean|'hint'} state true = result, false = error, 'hint' = hint
 */
export function showResult(panel, state) {
  const set = (sel, visible) => {
    const node = /** @type {HTMLElement|null} */ (panel?.querySelector(sel) ?? null);
    if (node) node.hidden = !visible;
  };
  set('[data-result-ok]', state === true);
  set('[data-result-error]', state === false);
  set('[data-result-hint]', state === 'hint');
}

/**
 * Recalculate `fn({ user: true })` after input/change (debounced) and at once
 * on submit.
 * @param {HTMLFormElement} form
 * @param {(o: {user: boolean}) => void} fn
 * @param {{delay?: number, onSubmit?: () => void}} [o]
 */
export function wireRecalc(form, fn, { delay = 250, onSubmit } = {}) {
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn({ user: true }), delay);
  };
  form.addEventListener('input', later);
  form.addEventListener('change', later);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.clearTimeout(timer);
    fn({ user: true });
    onSubmit?.();
  });
}
