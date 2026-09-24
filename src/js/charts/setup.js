/**
 * Themed, lazily loaded Chart.js for page scripts (browser only).
 *
 * Chart.js and chartjs-plugin-annotation are imported dynamically, so esbuild
 * puts them in a separate chunk that is downloaded only when a page actually
 * draws an interactive chart (the server-rendered SVG / table is the no-JS
 * fallback). Colours come from the CSS tokens (src/css/tokens.css) and are
 * re-applied whenever the theme changes (`themechange` from lib/theme.js and
 * the OS prefers-color-scheme media query). Numbers and months are formatted
 * with format.js (fi-FI: decimal comma, U+2212 minus, NBSP before %).
 *
 * Usage (src/js/pages/<name>.js):
 *
 *   import { createChart, lineDataset, targetLine } from '../charts/setup.js';
 *   const chart = await createChart(canvas, {
 *     type: 'line',
 *     months,                                   // 'YYYY-MM' labels
 *     datasets: [lineDataset({ series: 'khi', label: 'KHI', data: khi }),
 *                lineDataset({ series: 'ykhi', label: 'YKHI', data: ykhi })],
 *     annotations: { target: targetLine(2) },
 *     unit: '%',
 *   });
 *   chart.setMonths(newMonths, [newKhi, newYkhi]);   // range change
 *   chart.destroy();
 *
 * CSP: Chart.js only draws on <canvas> and sets canvas size through the CSSOM,
 * which `style-src 'self'` allows. Never pass HTML strings to the tooltip.
 */
import * as fmt from '../lib/format.js';
import { prefersReducedMotion } from '../lib/dom.js';

/* ----------------------------------------------------------------- loading */

let loading = null;

/**
 * Load Chart.js (only the registered parts, see chartjs.js) and the
 * annotation plugin once; later calls reuse the same promise.
 * @returns {Promise<typeof import('chart.js').Chart>}
 */
export function loadChartJs() {
  if (!loading) {
    loading = import('./chartjs.js').then(({ Chart }) => {
      Chart.register(lastValuePlugin);
      return Chart;
    });
    loading.catch(() => {
      loading = null; // allow a retry after a network error
    });
  }
  return loading;
}

/* ------------------------------------------------------------------ tokens */

/** Series key → CSS custom property (same keys as scripts/lib/svg.js classes). */
export const SERIES_TOKENS = Object.freeze({
  khi: '--series-khi',
  ykhi: '--series-ykhi',
  ea: '--series-ea',
  core: '--series-core',
  s3: '--series-3',
  s4: '--series-4',
  s5: '--series-5',
  s6: '--series-6',
  target: '--target',
  muted: '--border-strong',
  deflation: '--infl-deflation',
  low: '--infl-low',
  elevated: '--infl-elevated',
  high: '--infl-high',
  pos: '--series-khi',
  neg: '--series-6',
});

/** Text-safe variants for series whose line colour is below 4.5:1 as text. */
const TEXT_TOKENS = Object.freeze({ ykhi: '--series-ykhi-text', target: '--text-3', muted: '--text-3' });

/**
 * Read the design tokens that charts need from the computed style of `el`
 * (so a chart inside a [data-theme] subtree gets that subtree's colours).
 * @param {Element} [el=document.documentElement]
 */
export function readTokens(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const v = (name) => cs.getPropertyValue(name).trim();
  const series = {};
  const seriesText = {};
  for (const [key, prop] of Object.entries(SERIES_TOKENS)) {
    series[key] = v(prop);
    seriesText[key] = v(TEXT_TOKENS[key] ?? prop);
  }
  return {
    text: v('--text'),
    text2: v('--text-2'),
    text3: v('--text-3'),
    bg: v('--bg'),
    surface: v('--surface'),
    surface2: v('--surface-2'),
    border: v('--border'),
    borderStrong: v('--border-strong'),
    brand: v('--brand'),
    target: v('--target'),
    font: v('--font-sans') || 'system-ui, sans-serif',
    series,
    seriesText,
  };
}

/**
 * Colour with alpha from a hex token ('#0B5C7A', 0.12 → 'rgb(11 92 122 / 0.12)').
 * @param {string} hex
 * @param {number} alpha 0…1
 */
export function withAlpha(hex, alpha) {
  const m = String(hex).trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

/* -------------------------------------------------------------- formatters */

/**
 * Value formatter for a unit: '%' → pct, 'pp' → pp (%-yks.), '€' → eur,
 * 'index' → idx, anything else → num + unit.
 * @param {string} [unit='%']
 * @param {number} [decimals]
 * @returns {(v: number|null) => string}
 */
export function valueFormatter(unit = '%', decimals) {
  switch (unit) {
    case '%':
      return (v) => fmt.pct(v, { decimals: decimals ?? 1 });
    case 'pp':
      return (v) => fmt.pp(v, { decimals: decimals ?? 1 });
    case '€':
      return (v) => fmt.eur(v, decimals ?? 2);
    case 'index':
      return (v) => fmt.idx(v, decimals ?? 2);
    default:
      return (v) => (v == null ? fmt.DASH : `${fmt.num(v, decimals ?? 1)}${unit ? `${fmt.NBSP}${unit}` : ''}`);
  }
}

/**
 * y-axis tick label: as few decimals as the tick step needs ('2 %', '0,5 %').
 * @param {string} [unit='%']
 */
export function axisFormatter(unit = '%') {
  const suffix = unit === 'pp' ? `${fmt.NBSP}%-yks.` : unit === 'index' ? '' : unit ? `${fmt.NBSP}${unit}` : '';
  return (v) => {
    const n = Number(v);
    const d = Number.isInteger(n) ? 0 : Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? 1 : 2;
    return `${fmt.num(n, d)}${suffix}`;
  };
}

/** Month steps for short ranges and year steps for long ranges. */
const MONTH_STEPS = [1, 2, 3, 6];
const YEAR_STEPS = [1, 2, 5, 10, 20];

/**
 * Which x labels to show on a category axis of 'YYYY-MM' months, and their
 * text. Ranges over 36 months get year labels at January ('2022', every 1/2/5/10
 * years); shorter ranges get month abbreviations anchored at the latest month,
 * with the year on the first label and whenever it changes ('syys 2025', 'marras',
 * 'tammi 2026'). About one label per 64 px of chart width.
 * @param {string[]} months
 * @param {number} width chart width in px
 * @returns {Map<number, string>} label index → tick text
 */
export function monthTicks(months, width) {
  const n = months.length;
  const out = new Map();
  if (!n) return out;
  const max = Math.max(3, Math.floor(width / 64));
  if (n > 36) {
    const januaries = months.map((ym, i) => [fmt.parseYm(ym), i]).filter(([p]) => p.m === 1);
    const step = YEAR_STEPS.find((s) => Math.ceil(januaries.length / s) <= max) ?? YEAR_STEPS.at(-1);
    for (const [p, i] of januaries) if (p.y % step === 0) out.set(i, String(p.y));
    if (!out.size) out.set(0, String(fmt.yearOf(months[0])));
    return out;
  }
  const step = MONTH_STEPS.find((s) => Math.ceil(n / s) <= max) ?? MONTH_STEPS.at(-1);
  const picked = [];
  for (let i = n - 1; i >= 0; i -= step) picked.unshift(i);
  let prevYear = null;
  for (const i of picked) {
    const y = fmt.yearOf(months[i]);
    out.set(i, fmt.monthShort(months[i], { year: y !== prevYear }));
    prevYear = y;
  }
  return out;
}

/* ---------------------------------------------------------------- datasets */

/**
 * Line dataset with the site's line style (2 px, no points until hover,
 * straight segments). `series` picks the colour token and is kept on the
 * dataset so re-theming can recolour it.
 * @param {{series: string, label: string, data: (number|null)[], dashed?: boolean, hidden?: boolean, fill?: boolean}} o
 */
export function lineDataset({ series, label, data, dashed = false, hidden = false, fill = false }) {
  return {
    type: 'line',
    series,
    label,
    data,
    hidden,
    fill: fill ? 'origin' : false,
    borderWidth: 2,
    borderDash: dashed ? [5, 4] : [],
    tension: 0,
    spanGaps: false,
    pointRadius: 0,
    pointHitRadius: 8,
    pointHoverRadius: 4,
    pointHoverBorderWidth: 2,
  };
}

/**
 * Bar dataset. `series` may be a single key or an array of keys per bar (e.g.
 * level bands from stats.levelBand()). `partial` marks bars drawn lighter
 * (incomplete current year).
 * @param {{series: string|string[], label: string, data: (number|null)[], partial?: boolean[]}} o
 */
export function barDataset({ series, label, data, partial = [] }) {
  return { type: 'bar', series, partial, label, data, borderWidth: 0, borderRadius: 2, maxBarThickness: 28, categoryPercentage: 0.8, barPercentage: 0.9 };
}

/**
 * Horizontal reference line (default: the ECB 2 % target), dashed, in --target.
 * @param {number} [value=2]
 * @param {string} [label] drawn at the right end when given
 */
export function targetLine(value = 2, label) {
  return { type: 'line', themeKey: 'target', yMin: value, yMax: value, borderWidth: 1, borderDash: [4, 4], label: { display: Boolean(label), content: label ?? '', position: 'end' } };
}

/**
 * Vertical event marker (src/content/tapahtumat.json) at a month label.
 * @param {string} month 'YYYY-MM' (must be one of the chart labels)
 * @param {string} label short text
 */
export function eventLine(month, label) {
  return { type: 'line', themeKey: 'event', xMin: month, xMax: month, borderWidth: 1, label: { display: true, content: label, position: 'start' } };
}

/* ------------------------------------------------------- last value labels */

/**
 * Plugin: draws the latest value at the end of each visible line in the
 * series' text colour (ui-suunta: "viimeinen arvo viivan päässä"). Labels are
 * nudged apart vertically when they would overlap.
 * Options: plugins.lastValue = { enabled: true, format: (v) => string, color: (ds) => string }.
 */
const lastValuePlugin = {
  id: 'lastValue',
  defaults: { enabled: false },
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled) return;
    const { ctx, chartArea } = chart;
    const items = [];
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.type !== 'line' || !chart.isDatasetVisible(di)) return;
      for (let i = ds.data.length - 1; i >= 0; i--) {
        const v = ds.data[i];
        if (fmt.isNum(v) && meta.data[i]) {
          items.push({ x: meta.data[i].x, y: meta.data[i].y, text: opts.format(v), color: opts.color(ds) });
          break;
        }
      }
    });
    items.sort((a, b) => a.y - b.y);
    const gap = 16;
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < gap) items[i].y = items[i - 1].y + gap;
    ctx.save();
    ctx.font = `600 12px ${chart.options.font?.family ?? 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const it of items) {
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, Math.min(it.x + 8, chartArea.right + 8), Math.max(chartArea.top, Math.min(chartArea.bottom, it.y)));
    }
    ctx.restore();
  },
};

/* ------------------------------------------------------------------ theming */

/**
 * Apply the current tokens to a chart (colours of datasets, axes, grid,
 * tooltip and annotations) and redraw without animation.
 * @param {import('chart.js').Chart} chart
 * @param {ReturnType<typeof readTokens>} [t]
 */
export function applyTheme(chart, t = readTokens(chart.canvas)) {
  const colorOf = (key) => t.series[key] ?? t.series.khi;
  for (const ds of chart.data.datasets) {
    if (Array.isArray(ds.series)) {
      const partial = ds.partial ?? [];
      ds.backgroundColor = ds.series.map((k, i) => (partial[i] ? withAlpha(colorOf(k), 0.45) : colorOf(k)));
      ds.hoverBackgroundColor = ds.backgroundColor;
      continue;
    }
    const c = colorOf(ds.series);
    ds.borderColor = c;
    ds.pointBackgroundColor = c;
    ds.pointHoverBackgroundColor = c;
    ds.pointHoverBorderColor = t.surface;
    if (ds.type === 'bar') {
      const partial = ds.partial ?? [];
      ds.backgroundColor = ds.data.map((_, i) => (partial[i] ? withAlpha(c, 0.45) : c));
      ds.hoverBackgroundColor = ds.backgroundColor;
    } else {
      ds.backgroundColor = ds.fill ? withAlpha(c, 0.12) : c;
    }
  }
  // Mutate the raw config (chart.options is a resolver proxy with defaults).
  const o = chart.config.options;
  const sub = (obj, key) => (obj[key] ??= {});
  o.font = { ...(o.font ?? {}), family: t.font };
  o.color = t.text2;
  for (const scale of Object.values(o.scales ?? {})) {
    sub(scale, 'ticks').color = t.text3;
    sub(scale, 'grid').color = t.border;
    sub(scale, 'border').color = t.borderStrong;
  }
  const plugins = sub(o, 'plugins');
  Object.assign(sub(plugins, 'tooltip'), {
    backgroundColor: t.surface,
    titleColor: t.text,
    bodyColor: t.text2,
    footerColor: t.text3,
    borderColor: t.borderStrong,
  });
  for (const a of Object.values(plugins.annotation?.annotations ?? {})) {
    a.borderColor = a.themeKey === 'event' ? t.borderStrong : t.target;
    if (a.label) Object.assign(a.label, { color: t.text3, backgroundColor: withAlpha(t.bg, 0.85), font: { family: t.font, size: 11 } });
  }
  if (plugins.lastValue?.enabled) plugins.lastValue.color = (ds) => t.seriesText[ds.series] ?? t.text2;
  chart.update('none');
}

/** Live charts to re-theme (removed on destroy or when detached from the DOM). */
const live = new Set();
let listening = false;

function listenForThemeChanges() {
  if (listening) return;
  listening = true;
  let queued = false;
  const retheme = () => {
    if (queued) return;
    queued = true;
    // Wait a frame so the new data-theme / media state is in the computed style.
    requestAnimationFrame(() => {
      queued = false;
      for (const chart of live) {
        if (!chart.canvas?.isConnected) live.delete(chart);
        else applyTheme(chart);
      }
    });
  };
  document.addEventListener('themechange', retheme);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', retheme);
}

/* ------------------------------------------------------------------ create */

/**
 * Create a themed chart on `canvas`.
 * @param {HTMLCanvasElement} canvas a canvas inside a sized container (.chart-canvas)
 * @param {object} o
 * @param {'line'|'bar'} [o.type='line']
 * @param {string[]} o.months x labels ('YYYY-MM'); for non-month labels pass `labels`
 * @param {string[]} [o.labels] non-month x labels (years etc.) instead of months
 * @param {object[]} o.datasets lineDataset() / barDataset() results
 * @param {Record<string, object>} [o.annotations] targetLine() / eventLine() results by id
 * @param {'%'|'pp'|'€'|'index'|string} [o.unit='%'] value unit for tooltip and axis
 * @param {number} [o.decimals] value decimals in the tooltip
 * @param {number} [o.yMin] fixed y min
 * @param {number} [o.yMax] fixed y max
 * @param {boolean} [o.lastValue=true] latest value at the end of each line
 * @param {boolean} [o.beginAtZero=false]
 * @param {(ctx: object) => string|string[]} [o.tooltipFooter] extra tooltip line(s)
 * @param {object} [o.options] extra Chart.js options (merged shallowly last)
 * @returns {Promise<import('chart.js').Chart & {setMonths: (months: string[], data: (number|null)[][]) => void}>}
 */
export async function createChart(canvas, o) {
  const Chart = await loadChartJs();
  const t = readTokens(canvas);
  const unit = o.unit ?? '%';
  const format = valueFormatter(unit, o.decimals);
  const isMonths = !o.labels;
  const labels = o.labels ?? o.months;
  let ticks = new Map();
  const lastValue = o.lastValue ?? (o.type ?? 'line') === 'line';

  const chart = new Chart(canvas, {
    type: o.type ?? 'line',
    data: { labels: [...labels], datasets: o.datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReducedMotion() ? false : { duration: 200 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: lastValue ? 52 : 8, top: 8 } },
      locale: 'fi-FI',
      font: { family: t.font, size: 12 },
      scales: {
        x: {
          grid: { display: false },
          border: { display: true },
          ticks: {
            autoSkip: !isMonths,
            maxRotation: 0,
            callback(value, index) {
              if (!isMonths) return this.getLabelForValue(value);
              if (index === 0) ticks = monthTicks(this.chart.data.labels, this.chart.width);
              return ticks.get(index) ?? null;
            },
          },
        },
        y: {
          min: o.yMin,
          max: o.yMax,
          beginAtZero: o.beginAtZero ?? false,
          border: { display: false },
          ticks: { maxTicksLimit: 7, callback: axisFormatter(unit) },
        },
      },
      plugins: {
        legend: { display: false }, // the server-rendered legend() is the legend
        tooltip: {
          borderWidth: 1,
          cornerRadius: 6,
          padding: 10,
          boxWidth: 10,
          boxHeight: 2,
          usePointStyle: false,
          titleFont: { weight: '600' },
          callbacks: {
            title: (items) => {
              const l = items[0]?.label ?? '';
              return isMonths && /^\d{4}-\d{2}$/.test(l) ? fmt.capitalize(fmt.monthName(l)) : l;
            },
            label: (item) => `${item.dataset.label}: ${format(item.raw)}`,
            footer: o.tooltipFooter,
          },
        },
        annotation: { annotations: o.annotations ?? {} },
        lastValue: { enabled: lastValue, format, color: () => t.text2 },
      },
      ...(o.options ?? {}),
    },
  });

  /** Replace labels and data (e.g. range change) without re-creating the chart. */
  chart.setMonths = (months, data) => {
    chart.data.labels = [...months];
    data.forEach((arr, i) => {
      if (chart.data.datasets[i]) chart.data.datasets[i].data = arr;
    });
    chart.update(prefersReducedMotion() ? 'none' : undefined);
  };

  applyTheme(chart, t);
  live.add(chart);
  const destroy = chart.destroy.bind(chart);
  chart.destroy = () => {
    live.delete(chart);
    destroy();
  };
  listenForThemeChanges();
  return /** @type {any} */ (chart);
}

/* ------------------------------------------------------------------ export */

/**
 * Download the chart as a PNG with the current surface colour as background
 * ("Lataa kuva"). Uses a temporary canvas and an <a download> element.
 * @param {import('chart.js').Chart} chart
 * @param {string} filename e.g. 'inflaatio-khi-ykhi-2026-08.png'
 * @param {{title?: string, source?: string}} [o] optional caption lines drawn on the image
 */
export function downloadPng(chart, filename, { title, source } = {}) {
  const t = readTokens(chart.canvas);
  const src = chart.canvas;
  const ratio = src.width / (chart.width || src.width);
  const pad = Math.round(16 * ratio);
  const head = title ? Math.round(28 * ratio) : 0;
  const foot = source ? Math.round(24 * ratio) : 0;
  const out = document.createElement('canvas');
  out.width = src.width + pad * 2;
  out.height = src.height + pad * 2 + head + foot;
  const c = out.getContext('2d');
  if (!c) return;
  c.fillStyle = t.surface;
  c.fillRect(0, 0, out.width, out.height);
  c.textBaseline = 'top';
  if (title) {
    c.fillStyle = t.text;
    c.font = `600 ${Math.round(16 * ratio)}px ${t.font}`;
    c.fillText(title, pad, pad);
  }
  c.drawImage(src, pad, pad + head);
  if (source) {
    c.fillStyle = t.text3;
    c.font = `${Math.round(12 * ratio)}px ${t.font}`;
    c.fillText(source, pad, pad + head + src.height + Math.round(6 * ratio));
  }
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
