/**
 * Interactive charts of the TOPICS pages (/hinnat/, /polttoaineet/, /korot/).
 * Used as the page script of all three pages: layout({ scripts: ['pages/hinnat.js'] }).
 *
 * Every chart is declared on the server (src/pages/hinnat.js → interactiveChart()):
 *
 *   <div class="topic-chart" data-topic-chart="<id>">
 *     <div class="js-only">segmented control data-segmented="<id>-jakso"</div>   (optional)
 *     <div data-chart-fallback>server SVG</div>
 *     <div class="chart-canvas" hidden></div>
 *   </div>
 *   <script type="application/json" id="<id>-data">{ spec }</script>
 *   <span data-range-label="<id>">period</span>   (optional, in the figure subtitle)
 *
 * spec = { label, months, unit, decimals?, datasets: [{ type: 'line'|'bar', series, label,
 *          data, dashed?, stack?, decimals? }], stacked?, target?, yMin?, yMax?, beginAtZero?,
 *          ranges?: string[], range?: string, param?: string, download?: { filename, title, source } }
 *
 * The chart (Chart.js via charts/setup.js, lazily loaded) replaces the SVG
 * fallback when the figure comes near the viewport; if Chart.js cannot be
 * loaded the SVG stays. A range change redraws the chart, rewrites the period
 * in the subtitle and keeps the choice in the URL (`?<spec.param>=5v`).
 * Idempotent: a container is initialised only once.
 */
import { onVisible, readDataIsland, announce } from '../lib/dom.js';
import { sliceRange, isRangeKey } from '../lib/stats.js';
import { monthRange } from '../lib/format.js';
import { getSegmented, setSegmented } from '../lib/segmented.js';
import { getParam, setParams } from '../lib/url-state.js';
import { createChart, lineDataset, barDataset, targetLine, downloadPng } from '../charts/setup.js';

/** Build the Chart.js datasets of a spec for the given data arrays. */
export function datasetsOf(spec, arrays) {
  return spec.datasets.map((d, i) => {
    const base = d.type === 'bar'
      ? barDataset({ series: d.series, label: d.label, data: arrays[i] })
      : lineDataset({ series: d.series, label: d.label, data: arrays[i], dashed: Boolean(d.dashed) });
    if (d.stack) base.stack = d.stack;
    // A dataset's own decimals (e.g. KHI 1 next to rates with 2); setup.js uses
    // them in the tooltip and the end label.
    if (Number.isInteger(d.decimals)) base.decimals = d.decimals;
    if (d.type === 'line' && spec.stacked) base.order = -1; // draw the total line above the bars
    return base;
  });
}

/** The range key to show: `key` when the spec offers it, else the default. */
export function rangeKey(spec, key) {
  return isRangeKey(key) && spec.ranges?.includes(key) ? key : spec.range;
}

/** Months and data arrays of the selected range (the whole series without ranges). */
export function slice(spec, key) {
  const arrays = spec.datasets.map((d) => d.data);
  if (!spec.ranges?.length) return { months: spec.months, series: arrays };
  return sliceRange(spec.months, arrays, rangeKey(spec, key));
}

/** Period text of a sliced range ('elo 2016 – elo 2026'), '' when empty. */
export function periodOf(months) {
  return months?.length ? monthRange(months[0], months.at(-1)) : '';
}

/** @param {HTMLElement} box */
function init(box) {
  if (box.dataset.ready) return;
  box.dataset.ready = 'true';
  const id = box.getAttribute('data-topic-chart');
  const spec = readDataIsland(`${id}-data`);
  const holder = box.querySelector('.chart-canvas');
  if (!spec || !holder || !Array.isArray(spec.datasets)) return;
  const control = document.querySelector(`[data-segmented="${id}-jakso"]`);
  const labels = () => document.querySelectorAll(`[data-range-label="${id}"]`);

  // Restore the range from the URL before the chart loads (the control shows it at once).
  if (control && spec.param && spec.ranges?.length) {
    const fromUrl = getParam(spec.param, spec.ranges);
    if (fromUrl) setSegmented(control, fromUrl);
  }

  onVisible(box, async () => {
    const r = slice(spec, control ? getSegmented(control) : spec.range);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', spec.label ?? 'Kaavio');
    holder.append(canvas);
    holder.hidden = false;
    let chart;
    try {
      chart = await createChart(canvas, {
        type: spec.stacked ? 'bar' : 'line',
        months: r.months,
        datasets: datasetsOf(spec, r.series),
        annotations: spec.target != null ? { target: targetLine(spec.target) } : {},
        unit: spec.unit ?? '%',
        decimals: spec.decimals,
        yMin: spec.yMin,
        yMax: spec.yMax,
        beginAtZero: spec.beginAtZero,
      });
    } catch (err) {
      // Chart.js could not be loaded (offline): keep the server-rendered SVG.
      canvas.remove();
      holder.hidden = true;
      control?.closest('.topic-chart__controls')?.setAttribute('hidden', '');
      document.querySelector(`[data-chart-download="${id}"]`)?.setAttribute('hidden', '');
      console.error('[inflaatio] chart failed', err);
      return;
    }
    const o = chart.config.options;
    if (spec.stacked) {
      o.scales.x.stacked = true;
      o.scales.y.stacked = true;
    }
    chart.update('none');
    const fallback = box.querySelector('[data-chart-fallback]');
    if (fallback) fallback.hidden = true;
    const showPeriod = (months) => {
      const text = periodOf(months);
      if (text) for (const el of labels()) el.textContent = text;
    };
    showPeriod(r.months);

    if (control) {
      document.addEventListener('segmentedchange', (e) => {
        const detail = /** @type {CustomEvent} */ (e).detail;
        if (detail?.name !== `${id}-jakso`) return;
        const key = rangeKey(spec, detail.value);
        const next = slice(spec, key);
        chart.setMonths(next.months, next.series);
        showPeriod(next.months);
        if (spec.param) setParams({ [spec.param]: key }, { defaults: { [spec.param]: spec.range } });
        if (next.months.length) announce(`Kaavio näyttää jakson ${periodOf(next.months)}.`);
      });
    }
    const dl = document.querySelector(`[data-chart-download="${id}"]`);
    if (dl && spec.download) {
      dl.addEventListener('click', () => downloadPng(chart, spec.download.filename, spec.download));
    }
  });
}

// Guarded so the pure helpers above can be imported in node tests.
if (typeof document !== 'undefined') {
  for (const box of document.querySelectorAll('[data-topic-chart]')) {
    try {
      init(/** @type {HTMLElement} */ (box));
    } catch (err) {
      console.error('[inflaatio] chart init failed', err);
    }
  }
}
