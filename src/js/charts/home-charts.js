/**
 * Interactive charts of the home page (browser only): the main "Kehitys"
 * chart (KHI + YKHI, optional euro area, core inflation and event markers)
 * and the "Hintataso" price-level chart. Both replace a server-rendered SVG
 * of the same size, so nothing moves when Chart.js arrives. Chart.js itself
 * is loaded lazily by charts/setup.js: when a chart comes near the viewport,
 * or earlier on idle time as a prefetch.
 *
 * Data come from the `etusivu-data` island (src/pages/home.js); the texts
 * that go with every view (summary, stats, labels) are precomputed there.
 */
import * as fmt from '../lib/format.js';
import { onVisible } from '../lib/dom.js';
import { sliceRange } from '../lib/stats.js';
import { createChart, lineDataset, targetLine, eventLine, downloadPng, applyTheme, loadChartJs } from './setup.js';
import { decodeSeries, monthAxis, priceLevel, wrapText, METRIC_INFO, DEFAULT_BASE } from './home-model.js';

/** Series of the main chart, in dataset order. */
const TREND = [
  { key: 'khi', series: 'khi', label: 'KHI' },
  { key: 'ykhi', series: 'ykhi', label: 'YKHI' },
  { key: 'ea', series: 'ea', label: 'Euroalue', toggle: 'ea' },
  { key: 'coreFi', series: 'core', label: 'Pohjainflaatio, Suomi', toggle: 'core', dashed: true },
  { key: 'coreEa', series: 'ea', label: 'Pohjainflaatio, euroalue', toggle: 'core', dashed: true, needs: 'ea' },
];

/** Event labels are drawn only when the range has at most this many events. */
const MAX_EVENT_LABELS = 6;

/**
 * Put a canvas into a chart box (absolutely positioned over the fallback,
 * invisible until the chart has been drawn).
 * @param {HTMLElement} box
 */
function mountCanvas(box) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', box.getAttribute('data-label') ?? 'Kaavio');
  box.classList.add('is-loading');
  box.append(canvas);
  box.hidden = false;
  return canvas;
}

/** Chart drawn: show it and hide the SVG fallback. */
function reveal(box) {
  box.classList.remove('is-loading');
  const fallback = box.parentElement?.querySelector('[data-chart-fallback]');
  if (fallback) fallback.hidden = true;
}

/** Chart.js failed (offline, blocked): keep the SVG. */
function abandon(box, err) {
  box.replaceChildren();
  box.hidden = true;
  box.classList.remove('is-loading');
  console.error('[inflaatio] chart failed', err);
}

/**
 * @param {any} data the etusivu-data island
 * @param {() => {mittari: 'khi'|'ykhi', jakso: string, ea: boolean, core: boolean, events: boolean}} getState
 */
export function initHomeCharts(data, getState) {
  const months = monthAxis(data.start, data.n);
  /** @type {Record<string, (number|null)[]>} */
  const S = Object.fromEntries(Object.entries(data.s ?? {}).map(([k, enc]) => [k, decodeSeries(enc, data.n)]));
  const flags = { ykhi: new Set(data.flags?.ykhi ?? []), ea: new Set(data.flags?.ea ?? []) };
  const events = Array.isArray(data.events) ? data.events : [];

  /* ------------------------------------------------------------ Kehitys */

  const trendBox = document.querySelector('[data-chart="kehitys"]');
  const download = document.querySelector('[data-chart-download="kehitys"]');
  let trend = null;
  let trendMonths = [];

  // The range is fixed by KHI and YKHI (as in the texts and the month table);
  // the optional series are cut to the same months.
  const trendSlice = (key) => {
    const r = sliceRange(months, [S.khi, S.ykhi].map((a) => a ?? months.map(() => null)), key);
    const pick = (a) => (r.end < 0 ? [] : (a ?? months.map(() => null)).slice(r.start, r.end + 1));
    return { months: r.months, series: TREND.map((t) => pick(S[t.key])) };
  };

  function trendAnnotations(labels, st) {
    const out = { target: targetLine(2) };
    if (!st.events) return out;
    const inRange = events.filter((e) => labels.includes(e.month));
    inRange.forEach((e, i) => {
      const a = eventLine(e.month, e.label);
      a.label.display = inRange.length <= MAX_EVENT_LABELS;
      a.borderDash = [2, 3];
      out[`tapahtuma${i}`] = a;
    });
    return out;
  }

  function trendFooter(items) {
    const month = items[0]?.label;
    const lines = [];
    const shown = new Set(items.map((it) => it.dataset?.series));
    if (flags.ykhi.has(month) && shown.has('ykhi')) lines.push('YKHI: ennakko');
    if (flags.ea.has(month) && shown.has('ea')) lines.push('Euroalue: ennakko');
    if (getState().events) {
      for (const e of events.filter((x) => x.month === month)) lines.push(...wrapText(`${e.label}: ${e.text}`));
    }
    return lines;
  }

  function trendView(st) {
    const r = trendSlice(st.jakso);
    return {
      months: r.months,
      data: r.series,
      hidden: TREND.map((t) => (t.toggle ? !st[t.toggle] || (t.needs && !st[t.needs]) : false)),
    };
  }

  async function createTrend() {
    if (!trendBox || trend) return;
    const canvas = mountCanvas(trendBox);
    const st = getState();
    const v = trendView(st);
    trendMonths = v.months;
    try {
      trend = await createChart(canvas, {
        months: v.months,
        datasets: TREND.map((t, i) => lineDataset({ series: t.series, label: t.label, data: v.data[i], dashed: t.dashed, hidden: v.hidden[i] })),
        annotations: trendAnnotations(v.months, st),
        unit: '%',
        tooltipFooter: trendFooter,
      });
    } catch (err) {
      abandon(trendBox, err);
      if (download) download.hidden = true;
      return;
    }
    reveal(trendBox);
    updateTrend();
    if (download) {
      download.disabled = false;
      download.addEventListener('click', () => {
        const period = fmt.monthRange(trendMonths[0], trendMonths.at(-1));
        downloadPng(trend, `inflaatio-suomessa-${trendMonths.at(-1)}.png`, {
          title: `Inflaatio Suomessa, vuosimuutos % (${period})`,
          source: 'Lähteet: Tilastokeskus (KHI), Eurostat (YKHI) · inflaatio.fi',
        });
      });
    }
  }

  function updateTrend() {
    if (!trend) return;
    const st = getState();
    const v = trendView(st);
    trendMonths = v.months;
    trend.data.labels = [...v.months];
    trend.data.datasets.forEach((ds, i) => {
      ds.data = v.data[i];
      ds.hidden = v.hidden[i];
    });
    trend.config.options.plugins.annotation.annotations = trendAnnotations(v.months, st);
    trendBox?.querySelector('canvas')?.setAttribute('aria-label', data.text?.trend?.[st.jakso]?.aria ?? '');
    applyTheme(trend); // colours the new annotations and redraws
  }

  /* ---------------------------------------------------------- Hintataso */

  const levelBox = document.querySelector('[data-chart="hintataso"]');
  let level = null;
  let levelView = null;

  /** Official base of the price level for a view (the newest base covering the range start). */
  const levelBase = (st) => data.text?.level?.[st.mittari]?.[st.jakso]?.base ?? DEFAULT_BASE;
  /** @type {Record<string, (number|null)[]>} decoded index series by "metric base" */
  const levelSeries = {};

  function levelData(st) {
    const base = levelBase(st);
    const id = `${st.mittari} ${base}`;
    levelSeries[id] ??= decodeSeries(data.lvl?.[st.mittari]?.[base], data.n);
    return priceLevel(months, levelSeries[id], st.jakso);
  }

  async function createLevel() {
    if (!levelBox || level) return;
    const canvas = mountCanvas(levelBox);
    const st = getState();
    levelView = levelData(st);
    try {
      level = await createChart(canvas, {
        months: levelView.months,
        datasets: [lineDataset({ series: st.mittari, label: `Hintataso (${METRIC_INFO[st.mittari].short})`, data: levelView.values })],
        annotations: { alku: targetLine(100) },
        unit: '€',
        decimals: 2,
        options: { layout: { padding: { right: 72, top: 8 } } }, // room for "175,39 €" at the line end
        tooltipFooter: (items) => {
          const i = items[0]?.dataIndex;
          const v = levelView?.index?.[i];
          return fmt.isNum(v) ? `Pisteluku ${fmt.idx(v)} (${levelBase(getState())})` : '';
        },
      });
    } catch (err) {
      abandon(levelBox, err);
      return;
    }
    reveal(levelBox);
    updateLevel();
  }

  function updateLevel() {
    if (!level) return;
    const st = getState();
    levelView = levelData(st);
    level.data.labels = [...levelView.months];
    const ds = level.data.datasets[0];
    ds.data = levelView.values;
    ds.series = st.mittari;
    ds.label = `Hintataso (${METRIC_INFO[st.mittari].short})`;
    levelBox?.querySelector('canvas')?.setAttribute('aria-label', data.text?.level?.[st.mittari]?.[st.jakso]?.aria ?? '');
    applyTheme(level);
  }

  /* ------------------------------------------------------------ loading */

  if (trendBox) onVisible(trendBox.parentElement ?? trendBox, createTrend);
  if (levelBox) onVisible(levelBox.parentElement ?? levelBox, createLevel);

  // Prefetch the Chart.js chunk when the browser is idle (not on data saver).
  const saveData = /** @type {any} */ (navigator).connection?.saveData === true;
  if (!saveData) {
    const idle = window.requestIdleCallback ?? ((cb) => window.setTimeout(cb, 2500));
    window.addEventListener('load', () => idle(() => loadChartJs().catch(() => {}), { timeout: 5000 }), { once: true });
  }

  return {
    update() {
      updateTrend();
      updateLevel();
    },
  };
}
