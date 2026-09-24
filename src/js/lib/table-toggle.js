/**
 * "Show all" buttons of collapsible tables (components.dataTable with
 * visibleRows): [data-table-toggle][aria-controls=<table id>] toggles the
 * table's data-collapsed attribute; CSS hides tr[data-extra] only while
 * collapsed and only with JS, so every row is available without JS and in print.
 */
import { on } from './dom.js';

export function initTableToggles() {
  on(document, 'click', '[data-table-toggle]', (e, button) => {
    const table = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!table) return;
    const expand = button.getAttribute('aria-expanded') !== 'true';
    table.setAttribute('data-collapsed', expand ? 'false' : 'true');
    button.setAttribute('aria-expanded', String(expand));
    const label = button.querySelector('.button__label') ?? button;
    label.textContent = (expand ? button.getAttribute('data-label-less') : button.getAttribute('data-label-more')) ?? label.textContent;
    if (!expand) table.closest('.table-wrap')?.scrollIntoView({ block: 'nearest' });
  });
}
