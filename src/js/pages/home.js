/**
 * Home page script (/). Enhances the server-rendered page:
 * - one global metric selector (KHI | YKHI): KPI panels, chart statistics,
 *   price level and annual bars follow it; kept in ?mittari= and in
 *   localStorage ('inflaatio.mittari');
 * - one range selector (6 kk … Kaikki) for the main chart, its statistics and
 *   the price level; kept in ?jakso=;
 * - toggles for euro area, core inflation and event markers;
 * - the interactive charts (charts/home-charts.js, Chart.js loaded lazily).
 * Every text shown for a view is precomputed at build time (etusivu-data).
 */
import { getParam, setParams } from '../lib/url-state.js';
import { setSegmented } from '../lib/segmented.js';
import { announce, readDataIsland, el } from '../lib/dom.js';
import { RANGE_KEYS } from '../lib/stats.js';
import { METRICS, METRIC_INFO, DEFAULT_METRIC, DEFAULT_RANGE, RANGE_LABELS, statsCaption } from '../charts/home-model.js';
import { initHomeCharts } from '../charts/home-charts.js';

const STORAGE_KEY = 'inflaatio.mittari';
const DEFAULTS = { mittari: DEFAULT_METRIC, jakso: DEFAULT_RANGE };

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

const state = {
  mittari: getParam('mittari', METRICS) ?? storedMetric() ?? DEFAULT_METRIC,
  jakso: getParam('jakso', RANGE_KEYS) ?? DEFAULT_RANGE,
  ea: false,
  core: false,
  events: Boolean(byId('kehitys-tapahtumat')?.checked ?? false),
};

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
    if (summary) summary.textContent = trend.summary;
  }
  const level = data?.text?.level?.[state.mittari]?.[state.jakso];
  if (level) {
    const period = byId('hintataso-jakso');
    if (period) period.textContent = level.period;
    const summary = byId('hintataso-yhteenveto');
    if (summary) summary.textContent = level.summary;
  }
  for (const m of METRICS) {
    const item = document.querySelector(`[data-legend="level-${m}"]`);
    if (item) item.hidden = m !== state.mittari;
  }
}

/** Legend items of the optional series follow the toggles. */
function renderLegend() {
  const show = { ea: state.ea, core: state.core, 'core-ea': state.core && state.ea, events: state.events };
  for (const [hook, on] of Object.entries(show)) {
    const item = document.querySelector(`#kehitys-selite [data-legend="${hook}"]`);
    if (item) item.hidden = !on;
  }
}

const charts = data ? initHomeCharts(data, () => state) : null;

function render() {
  if (root) root.setAttribute('data-mittari', state.mittari);
  setSegmented(group('mittari'), state.mittari);
  setSegmented(group('jakso'), state.jakso);
  renderStats();
  renderTexts();
  renderLegend();
  charts?.update();
}

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

for (const [id, key] of [
  ['kehitys-euroalue', 'ea'],
  ['kehitys-pohja', 'core'],
  ['kehitys-tapahtumat', 'events'],
]) {
  byId(id)?.addEventListener('change', (e) => {
    state[key] = /** @type {HTMLInputElement} */ (e.target).checked;
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
