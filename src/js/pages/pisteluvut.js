/**
 * /pisteluvut/ page script: switch the index and base year.
 *
 * The page is complete without JS (latest month on every base, 36 months and
 * the full history on 2025=100). This script reads the JSON data island
 * `pisteluvut-data`, and when the visitor picks another index from the select
 * it rebuilds the 36-month table body and the per-year history with DOM
 * methods (no HTML strings). The choice is kept in the URL (?indeksi=2015).
 */
import { el, readDataIsland } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { capitalize, idx, isNum, monthName, monthNameOnly, monthRange, num, pct, toYm, ymAdd, ymDiff } from '../lib/format.js';

/** Value of a trimmed series at a month (null when missing). */
export function valueAt(s, ym) {
  const i = ymDiff(s.start, ym);
  const v = i >= 0 ? s.values[i] : null;
  return isNum(v) ? v : null;
}

/** Last month with a value. */
export function lastMonth(s) {
  for (let i = s.values.length - 1; i >= 0; i--) if (isNum(s.values[i])) return ymAdd(s.start, i);
  return s.start;
}

const points = (s, v) => (s.decimals === 0 ? num(v, 0) : idx(v));

/** Formatted value with its unit in <span class="unit"> (same as components.numUnit). */
function numUnit(text) {
  const i = text.lastIndexOf(' ');
  if (i < 0) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  frag.append(text.slice(0, i + 1), el('span', { class: 'unit' }, text.slice(i + 1)));
  return frag;
}

/** 12-month change in % computed from the point figures. */
export function change12(s, ym) {
  const a = valueAt(s, ymAdd(ym, -12));
  const b = valueAt(s, ym);
  return a == null || b == null || a === 0 ? null : (b / a - 1) * 100;
}

/** Rebuild the 36-month table for series `s`. */
function renderRecent(table, data, s) {
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const caption = table.querySelector('caption');
  const end = lastMonth(s) < data.latest ? lastMonth(s) : data.latest;
  const months = Array.from({ length: data.recentMonths }, (_, i) => ymAdd(end, -i));
  if (caption) caption.textContent = `${s.label}, ${monthRange(months.at(-1), end)}`;
  const collapsible = table.hasAttribute('data-collapsed');
  const rows = months.map((ym, i) =>
    el(
      'tr',
      { 'data-extra': collapsible && i >= 12 },
      el('th', { scope: 'row' }, capitalize(monthName(ym))),
      el('td', { class: 'num' }, points(s, valueAt(s, ym))),
      el('td', { class: 'num' }, numUnit(pct(change12(s, ym), { decimals: 2, sign: true }))),
    ),
  );
  tbody?.replaceChildren(...rows);
}

/** Rebuild the per-year history for series `s` (same markup as the server). */
function renderHistory(history, historyTitle, s) {
  if (!history) return;
  const first = Number(s.start.slice(0, 4));
  const last = Number(lastMonth(s).slice(0, 4));
  const blocks = [];
  for (let y = last; y >= first; y--) {
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const ym = toYm(y, m);
      const v = valueAt(s, ym);
      if (v != null) rows.push(el('tr', {}, el('th', { scope: 'row' }, capitalize(monthNameOnly(ym))), el('td', { class: 'num' }, points(s, v))));
    }
    if (rows.length === 12 && s.annual) {
      const v = s.annual.values[y - Number(s.annual.start)];
      if (isNum(v)) {
        rows.push(el('tr', { class: 'pisteluvut-vuosi__keskiarvo' }, el('th', { scope: 'row' }, 'Vuoden keskiarvo'), el('td', { class: 'num' }, s.decimals === 0 ? num(v, 0) : num(v, 1))));
      }
    }
    blocks.push(
      el(
        'details',
        { class: 'disclosure pisteluvut-vuosi' },
        el('summary', {}, String(y)),
        el(
          'div',
          { class: 'disclosure__body' },
          el(
            'table',
            { class: 'data-table data-table--compact pisteluvut-vuosi__taulukko' },
            el('caption', { class: 'sr-only' }, `Pisteluvut ${y}, ${s.label}`),
            el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Kuukausi'), el('th', { scope: 'col', class: 'num' }, 'Pisteluku'))),
            el('tbody', {}, ...rows),
          ),
        ),
      ),
    );
  }
  history.replaceChildren(...blocks);
  if (historyTitle) historyTitle.textContent = s.label;
  const intro = historyTitle?.parentElement;
  if (intro && intro.lastChild && intro.lastChild.nodeType === Node.TEXT_NODE) {
    intro.lastChild.textContent = `, ${first}–${last}. Avaa vuosi nähdäksesi sen kuukaudet.`;
  }
}

/**
 * Wire the base selector. Returns the `show(key)` function (null when the
 * page does not have the selector or the data island).
 */
export function init() {
  const data = readDataIsland('pisteluvut-data');
  const select = /** @type {HTMLSelectElement|null} */ (document.getElementById('pisteluvut-perusvuosi'));
  if (!data?.bases?.length || !select) return null;
  const table = document.getElementById('pisteluvut-taulukko');
  const history = document.getElementById('pisteluvut-historia');
  const historyTitle = document.getElementById('pisteluvut-historia-otsikko');
  const status = document.getElementById('pisteluvut-tila');

  const show = (key, { user = false } = {}) => {
    const s = data.bases.find((b) => b.key === key) ?? data.bases.find((b) => b.key === data.defaultKey);
    if (!s) return;
    renderRecent(table, data, s);
    renderHistory(history, historyTitle, s);
    if (select.value !== s.key) select.value = s.key;
    if (user) {
      setParams({ indeksi: s.key }, { defaults: { indeksi: data.defaultKey } });
      // The page's own polite live region announces the change; the shared
      // toast announcer is not used here, so screen readers hear it once.
      if (status) status.textContent = `Näytetään ${s.label}.`;
    }
  };

  const fromUrl = getParam('indeksi', data.bases.map((b) => b.key));
  if (fromUrl && fromUrl !== data.defaultKey) show(fromUrl);
  select.addEventListener('change', () => show(select.value, { user: true }));
  return show;
}

if (typeof document !== 'undefined') init();
