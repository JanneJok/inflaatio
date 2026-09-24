/**
 * Home page script (/). Enhances the server-rendered page:
 * - one global metric selector (KHI | YKHI): KPI panels, chart statistics and
 *   summary, price level and annual bars follow it; kept in ?mittari= and in
 *   localStorage ('inflaatio.mittari');
 * - one range selector (6 kk … Kaikki) for the main chart, its statistics,
 *   summary and month table, and the price level (chart, texts, table);
 *   kept in ?jakso=;
 * - toggles for euro area, core inflation and event markers; kept in
 *   ?nayta=ea+pohja+tapahtumat;
 * - the interactive charts (charts/home-charts.js, Chart.js loaded lazily).
 * Every text shown for a view is precomputed at build time (etusivu-data);
 * the month table is rebuilt from the same data with format.js.
 */
import { getParam, setParams } from '../lib/url-state.js';
import { setSegmented } from '../lib/segmented.js';
import { announce, readDataIsland, el } from '../lib/dom.js';
import { RANGE_KEYS, sliceRange } from '../lib/stats.js';
import * as fmt from '../lib/format.js';
import {
  METRICS,
  METRIC_INFO,
  DEFAULT_METRIC,
  DEFAULT_RANGE,
  DEFAULT_BASE,
  RANGE_LABELS,
  TABLE_ROWS,
  statsCaption,
  trendTableLabels,
  parseShow,
  formatShow,
  monthAxis,
  decodeSeries,
  priceLevel,
  priceLevelRows,
  priceLevelCaption,
} from '../charts/home-model.js';
import { initHomeCharts } from '../charts/home-charts.js';

const STORAGE_KEY = 'inflaatio.mittari';
const DEFAULTS = { mittari: DEFAULT_METRIC, jakso: DEFAULT_RANGE, nayta: '' };
/** Checkbox ids of the optional series. */
const TOGGLES = Object.freeze([
  ['kehitys-euroalue', 'ea'],
  ['kehitys-pohja', 'core'],
  ['kehitys-tapahtumat', 'events'],
]);

const root = document.querySelector('[data-home]');
const data = readDataIsland('etusivu-data');
const group = (name) => document.querySelector(`[data-segmented="${name}"]`);
const byId = (id) => document.getElementById(id);

function storedMetric() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return METRICS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function storeMetric(v) {
  try {
    if (v === DEFAULT_METRIC) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* storage unavailable: the choice lasts for this page view */
  }
}

const urlMetric = getParam('mittari', METRICS);
const shown = parseShow(getParam('nayta'));
const state = {
  mittari: urlMetric ?? storedMetric() ?? DEFAULT_METRIC,
  jakso: getParam('jakso', RANGE_KEYS) ?? DEFAULT_RANGE,
  ea: false,
  core: false,
  events: false,
};
for (const [id, key] of TOGGLES) {
  const box = byId(id);
  if (!(box instanceof HTMLInputElement)) continue;
  if (shown) box.checked = shown[key];
  state[key] = box.checked;
}
// A metric remembered from an earlier visit goes into the URL too, so
// "Kopioi linkki" shares the view that is on the screen.
if (!urlMetric && state.mittari !== DEFAULT_METRIC) setParams({ mittari: state.mittari }, { defaults: DEFAULTS });

/** Replace the rows of the statistics <dl> (texts precomputed at build time). */
function renderStats() {
  const caption = byId('kehitys-tilastot-mittari');
  if (caption) caption.textContent = statsCaption(state.mittari);
  const items = data?.text?.stats?.[state.mittari]?.[state.jakso];
  const dl = byId('kehitys-tilastot');
  if (!items || !dl) return;
  dl.querySelectorAll(':scope > div').forEach((row, i) => {
    const it = items[i];
    row.hidden = !it;
    if (!it) return;
    const dt = row.querySelector('dt');
    const dd = row.querySelector('dd');
    if (dt) dt.textContent = it.label;
    if (dd) dd.replaceChildren(it.value, el('span', { class: 'stats__note' }, it.note ?? ''));
  });
}

/** Texts of the main chart and the price level for the current view. */
function renderTexts() {
  const trend = data?.text?.trend?.[state.jakso];
  if (trend) {
    const period = byId('kehitys-jakso');
    if (period) period.textContent = trend.period;
    const summary = byId('kehitys-yhteenveto');
    const text = trend.summary?.[state.mittari];
    if (summary && text) summary.textContent = text;
  }
  const level = data?.text?.level?.[state.mittari]?.[state.jakso];
  if (level) {
    const period = byId('hintataso-jakso');
    if (period) period.textContent = level.period;
    const base = byId('hintataso-perusta');
    if (base && level.base) base.textContent = level.base;
    const summary = byId('hintataso-yhteenveto');
    if (summary) summary.textContent = level.summary;
  }
  for (const m of METRICS) {
    const item = document.querySelector(`#hintataso-kaavio [data-series="level-${m}"]`);
    if (item) item.hidden = m !== state.mittari;
  }
}

/** Legend items of the optional series follow the toggles. */
function renderLegend() {
  const show = { ea: state.ea, core: state.core, 'core-ea': state.core && state.ea, events: state.events };
  for (const [key, on] of Object.entries(show)) {
    const item = document.querySelector(`#kehitys-kaavio [data-series="${key}"]`);
    if (item) item.hidden = !on;
  }
}

/* ------------------------------------------------------------ month table */

const months = data ? monthAxis(data.start, data.n) : [];
const khi = data ? decodeSeries(data.s?.khi, data.n) : [];
const ykhi = data ? decodeSeries(data.s?.ykhi, data.n) : [];
let tableKey = DEFAULT_RANGE; // the server renders the default range

/**
 * Rebuild the rows of the month table under the main chart for the selected
 * range (same cells as the server-rendered default: newest month first).
 */
function renderTable() {
  if (!data || state.jakso === tableKey) return;
  const table = byId('kehitys-taulukko');
  const body = table?.querySelector('tbody');
  if (!table || !body) return;
  tableKey = state.jakso;
  const r = sliceRange(months, [khi, ykhi], state.jakso);
  const rows = [];
  for (let i = r.months.length - 1; i >= 0; i--) {
    const extra = rows.length >= TABLE_ROWS;
    rows.push(
      el(
        'tr',
        { 'data-extra': extra },
        el('th', { scope: 'row' }, fmt.monthShort(r.months[i])),
        el('td', { class: 'num' }, fmt.pct(r.series[0][i])),
        el('td', { class: 'num' }, fmt.pct(r.series[1][i])),
      ),
    );
  }
  body.replaceChildren(...rows);

  const caption = byId('kehitys-taulukko-caption');
  const period = data.text?.trend?.[state.jakso]?.period ?? fmt.monthRange(r.months[0], r.months.at(-1));
  if (caption) caption.textContent = `Vuosi-inflaatio kuukausittain, ${period}`;

  const toggle = document.querySelector('[data-table-toggle][aria-controls="kehitys-taulukko"]');
  const collapsible = rows.length > TABLE_ROWS;
  if (toggle) {
    const labels = trendTableLabels(rows.length);
    toggle.setAttribute('data-label-more', labels.more);
    toggle.setAttribute('data-label-less', labels.less);
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    const label = toggle.querySelector('.button__label') ?? toggle;
    label.textContent = expanded ? labels.less : labels.more;
    toggle.hidden = !collapsible;
    table.setAttribute('data-collapsed', collapsible && !expanded ? 'true' : 'false');
  } else {
    table.removeAttribute('data-collapsed');
  }
}

/** Decoded price-level index series by "metric base" (see data.lvl). */
const levelSeries = {};
let levelKey = `${DEFAULT_METRIC} ${DEFAULT_RANGE}`; // the server renders the default view

/** Rebuild the price-level table (one row a year) for the selected metric and range. */
function renderLevelTable() {
  const key = `${state.mittari} ${state.jakso}`;
  if (!data || key === levelKey) return;
  const table = byId('hintataso-taulukko');
  const body = table?.querySelector('tbody');
  const base = data.text?.level?.[state.mittari]?.[state.jakso]?.base ?? DEFAULT_BASE;
  const series = (levelSeries[`${state.mittari} ${base}`] ??= decodeSeries(data.lvl?.[state.mittari]?.[base], data.n));
  const pl = priceLevel(months, series, state.jakso);
  if (!table || !body || !pl.start) return;
  levelKey = key;
  body.replaceChildren(
    ...priceLevelRows(pl).map(([m, level, index]) =>
      el('tr', {}, el('th', { scope: 'row' }, m), el('td', { class: 'num' }, level), el('td', { class: 'num' }, index)),
    ),
  );
  const caption = byId('hintataso-taulukko-caption');
  if (caption) caption.textContent = priceLevelCaption(pl, state.mittari);
  const head = table.querySelectorAll('thead th')[2];
  if (head) head.textContent = `Pisteluku (${base})`;
}

/* ------------------------------------------------------------------ view */

const charts = data ? initHomeCharts(data, () => state) : null;

function render() {
  if (root) root.setAttribute('data-mittari', state.mittari);
  setSegmented(group('mittari'), state.mittari);
  setSegmented(group('jakso'), state.jakso);
  renderStats();
  renderTexts();
  renderLegend();
  renderTable();
  renderLevelTable();
  charts?.update();
}

// One announcement per change (the chart summaries are not live regions).
document.addEventListener('segmentedchange', (e) => {
  const { name, value } = /** @type {CustomEvent} */ (e).detail;
  if (name === 'mittari' && METRICS.includes(value)) {
    state.mittari = value;
    storeMetric(value);
    setParams({ mittari: value }, { defaults: DEFAULTS });
    render();
    const info = METRIC_INFO[value];
    announce(`Mittari: ${info.short} (${info.source}). Tunnusluvut, tilastot, hintataso ja vuosikaavio päivitettiin.`);
  } else if (name === 'jakso' && RANGE_KEYS.includes(value)) {
    state.jakso = value;
    setParams({ jakso: value }, { defaults: DEFAULTS });
    render();
    announce(`Aikaväli ${RANGE_LABELS[value]}: ${data?.text?.trend?.[value]?.period ?? ''}.`);
  }
});

for (const [id, key] of TOGGLES) {
  byId(id)?.addEventListener('change', (e) => {
    state[key] = /** @type {HTMLInputElement} */ (e.target).checked;
    setParams({ nayta: formatShow(state) }, { defaults: DEFAULTS });
    renderLegend();
    charts?.update();
  });
}

// "Mitä eroa niillä on?" opens the explainer.
const explainer = () => {
  const d = byId('khi-vai-ykhi-selite');
  if (d instanceof HTMLDetailsElement) d.open = true;
};
document.addEventListener('click', (e) => {
  if (e.target instanceof Element && e.target.closest('a[href="#khi-vai-ykhi"]')) explainer();
});
if (window.location.hash === '#khi-vai-ykhi') explainer();

// "Kopioi linkki" of the main chart links to the chart with the current view.
document.querySelector('#kehitys [data-share]')?.addEventListener('click', () => {
  try {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#kehitys`);
  } catch {
    /* ignore */
  }
});

render();
