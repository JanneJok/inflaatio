/**
 * Server-side SVG charts (build time). Every function returns a SafeString.
 *
 * Styling is done ONLY with classes (CSS in src/css/components.css, colours
 * from tokens), never with style attributes, so the output is CSP-safe and
 * follows the light/dark theme automatically:
 *   .chart-line--khi { stroke: var(--series-khi) }   .chart-bar--high { fill: var(--infl-high) }
 * Series/bar classes: khi, ykhi, ea, core, s3, s4, s5, s6, target, muted,
 * deflation, low, elevated, high, pos, neg.
 *
 * Responsive layout: the outer <svg> has a fixed pixel height and fluid width
 * (percent coordinates for text, dots and grid lines, so labels keep their size
 * at every width). The data itself is drawn in a nested, viewBox-based <svg>
 * with preserveAspectRatio="none" that stretches horizontally; lines use
 * vector-effect="non-scaling-stroke" so they stay 2 px wide. Axis labels are
 * drawn slightly outside the plot (overflow: visible); the CSS classes
 * .chart-svg--line / .chart-svg--bar reserve that room with margins.
 *
 * Every chart needs a text alternative: `ariaLabel` (required) becomes the
 * accessible name (role="img"); pages add a summary sentence and a data table
 * (see chartFigure() in src/templates/components.js).
 */
import { html, raw, attrs, SafeString, classes } from './html.js';
import { pct, pp, num, isNum, round, parseYm, MONTHS_SHORT, NBSP } from '../../src/js/lib/format.js';

/** Allowed series/bar class suffixes (anything else is a programming error). */
export const SERIES_CLASSES = Object.freeze([
  'khi', 'ykhi', 'ea', 'core', 's3', 's4', 's5', 's6', 'target', 'muted',
  'deflation', 'low', 'elevated', 'high', 'pos', 'neg',
]);

const YM_RE = /^\d{4}-\d{2}$/;

/** @param {string} cls */
function checkCls(cls) {
  if (!SERIES_CLASSES.includes(cls)) {
    throw new Error(`svg: unknown series class "${cls}" (allowed: ${SERIES_CLASSES.join(', ')})`);
  }
  return cls;
}

/** Coordinate with at most 2 decimals. @param {number} v */
const c2 = (v) => String(Math.round(v * 100) / 100);
/** Percentage string for a fraction 0…1 ('37.5%'). @param {number} f */
const pctPos = (f) => `${Math.round(f * 100000) / 1000}%`;

/**
 * "Nice" axis scale covering [lo, hi] with about `target` ticks (steps 1-2-5).
 * @param {number} lo
 * @param {number} hi
 * @param {number} [target=5]
 * @returns {{min: number, max: number, step: number, ticks: number[]}}
 */
export function niceScale(lo, hi, target = 5) {
  if (!isNum(lo) || !isNum(hi)) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const rough = (hi - lo) / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(rough));
  const f = rough / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  // A value only slightly below zero (−0,2 % on a 0–10 % axis) extends the
  // plot by a fifth of a step instead of a whole step; ticks stay on the step.
  const fine = step / 5;
  const min = lo < 0 && lo >= -step / 2 ? round(Math.floor(lo / fine + 1e-9) * fine, 10) : round(Math.floor(lo / step + 1e-9) * step, 10);
  const max = round(Math.ceil(hi / step - 1e-9) * step, 10);
  const ticks = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step / 2; v += step) ticks.push(round(v, 10));
  return { min, max, step, ticks };
}

/**
 * Ticks inside fixed bounds [min, max] (explicit yMin/yMax).
 * @param {number} min
 * @param {number} max
 * @param {number} target
 */
function ticksWithin(min, max, target) {
  const s = niceScale(min, max, target);
  return s.ticks.filter((t) => t >= min - 1e-9 && t <= max + 1e-9);
}

/** Decimals needed to show a tick step (0.5 → 1, 2 → 0). @param {number} step */
const stepDecimals = (step) => (step >= 1 || !isNum(step) ? 0 : Math.min(2, Math.ceil(-Math.log10(step) - 1e-9)));

/**
 * X-axis ticks for monthly labels ('YYYY-MM'): months (January shows the year)
 * for short ranges, whole years for long ranges. Month ticks sit on a fixed
 * calendar step (every 1, 2 or 3 months counted from January), so they are
 * evenly spaced: '2022 · maalis · touko · heinä · syys · marras'. The density
 * fits a ~260 px wide phone plot; with more than five ticks every other one
 * (January stays major) is marked `minor` and hidden on narrow screens by CSS.
 * Non-month labels get every k-th label.
 * @param {string[]} labels
 * @returns {{index: number, text: string, minor: boolean}[]}
 */
export function monthTicks(labels) {
  const n = labels?.length ?? 0;
  if (n === 0) return [];
  if (n === 1) return [{ index: 0, text: String(labels[0]), minor: false }];
  if (!YM_RE.test(labels[0])) {
    const k = Math.max(1, Math.ceil(n / 10));
    const out = [];
    for (let i = n - 1; i >= 0; i -= k) out.unshift({ index: i, text: String(labels[i]), minor: false });
    return markMinor(out);
  }
  if (n <= 25) {
    const step = n <= 7 ? 1 : n <= 13 ? 2 : 3;
    const out = [];
    let anchor = -1;
    labels.forEach((ym, index) => {
      const { y, m } = parseYm(ym);
      if ((m - 1) % step !== 0) return;
      if (m === 1 && anchor < 0) anchor = out.length;
      out.push({ index, text: m === 1 ? String(y) : MONTHS_SHORT[m - 1], minor: false });
    });
    // Alternate major/minor counted from a January, so the year label stays
    // visible on phones and the visible ticks are evenly spaced too.
    if (out.length <= 5) return out;
    const a = Math.max(0, anchor);
    return out.map((t, k) => ({ ...t, minor: Math.abs(k - a) % 2 === 1 }));
  }
  const januaries = [];
  labels.forEach((ym, i) => {
    const { y, m } = parseYm(ym);
    if (m === 1) januaries.push({ index: i, year: y });
  });
  if (!januaries.length) return [{ index: 0, text: String(parseYm(labels[0]).y), minor: false }];
  let yearStep = 1;
  for (const s of [1, 2, 5, 10, 20, 50]) {
    yearStep = s;
    if (januaries.filter((j) => j.year % s === 0).length <= 10) break;
  }
  const picked = januaries.filter((j) => j.year % yearStep === 0);
  const out = picked.map((j) => ({ index: j.index, text: String(j.year), minor: false }));
  return markMinor(out);
}

/** Mark every other tick minor when there are more than 5 (hidden on phones). */
function markMinor(ticks) {
  if (ticks.length <= 5) return ticks;
  // Keep the latest tick major so the newest period is always labelled.
  const last = ticks.length - 1;
  return ticks.map((t, i) => ({ ...t, minor: (last - i) % 2 === 1 }));
}

/**
 * Resolve the xTicks option into [{index, text, minor}].
 * @param {'auto'|false|{index:number,text:string,minor?:boolean}[]|((label:string,i:number)=>string|null)} xTicks
 * @param {string[]} labels
 */
function resolveTicks(xTicks, labels) {
  if (xTicks === false || xTicks == null) return [];
  if (xTicks === 'auto') return monthTicks(labels);
  if (typeof xTicks === 'function') {
    return labels
      .map((l, i) => ({ index: i, text: xTicks(l, i), minor: false }))
      .filter((t) => t.text != null && t.text !== '');
  }
  if (Array.isArray(xTicks)) return xTicks.map((t) => ({ minor: false, ...t }));
  throw new Error('svg: invalid xTicks option');
}

/**
 * Separate overlapping end labels vertically (min gap in px), keeping them
 * inside [top, bottom].
 * @param {{y: number}[]} items
 * @param {number} gap
 * @param {number} top
 * @param {number} bottom
 */
function spreadLabels(items, gap, top, bottom) {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) {
    for (let i = sorted.length - 1; i >= 0; i--) {
      const limit = i === sorted.length - 1 ? bottom : sorted[i + 1].y - gap;
      sorted[i].y = Math.min(sorted[i].y, limit);
    }
  }
  for (const s of sorted) s.y = Math.max(top, s.y);
  return items;
}

/**
 * Value text with its unit in a separate <tspan class="chart-unit"> (tabular
 * figures would otherwise widen the hyphen in "%-yks.").
 * @param {string} s formatted value, unit after the last NBSP
 */
function valueText(s) {
  const str = String(s);
  const i = str.lastIndexOf(NBSP);
  if (i < 0) return str;
  return html`${str.slice(0, i + 1)}<tspan class="chart-unit">${str.slice(i + 1)}</tspan>`;
}

/** Default y-axis label: '4 %', '0,5 %' (NBSP before %). */
const defaultFormatY = (v, step) => `${num(v, stepDecimals(step))}${NBSP}%`;

/**
 * Line chart for monthly series (server-rendered, no JS).
 *
 * @param {object} o
 * @param {{values: (number|null)[], cls?: string, label?: string, endLabel?: boolean,
 *   formatValue?: (v:number)=>string}[]} o.series one or more series aligned with `labels`;
 *   `cls` picks the colour class (default 'khi'); null values leave a gap
 * @param {string[]} o.labels x labels, usually 'YYYY-MM' months
 * @param {string} o.ariaLabel accessible name, e.g. "Vuosi-inflaatio syys 2024 – elo 2026, …" (required)
 * @param {number} [o.yMin] fixed lower bound (default: nice bound from data and refLines)
 * @param {number} [o.yMax] fixed upper bound
 * @param {{value: number, cls?: string, label?: string}[]} [o.refLines] horizontal reference
 *   lines (e.g. { value: 2, cls: 'target', label: 'EKP:n tavoite 2 %' })
 * @param {number} [o.height=280] total height in CSS px (fixed)
 * @param {number} [o.width=1000] internal viewBox width of the plot (precision only)
 * @param {'auto'|false|Array|Function} [o.xTicks='auto'] x ticks: auto (months/years),
 *   false, [{index, text, minor}] or (label, i) => text|null
 * @param {number[]} [o.yTicks] explicit y tick values
 * @param {number} [o.yTickCount=5] approximate number of y ticks
 * @param {(v:number, step:number)=>string} [o.formatY] y-axis label formatter
 * @param {(v:number)=>string} [o.formatValue] end-label formatter (default pct)
 * @param {boolean} [o.endLabels=true] dot + value at the end of each line
 * @param {boolean} [o.sparkline=false] compact mode: no axes, grid or text
 * @param {string} [o.className] extra classes on the <svg>
 * @param {string} [o.id]
 * @returns {SafeString}
 */
export function lineChart(o) {
  const {
    series,
    labels,
    ariaLabel,
    refLines = [],
    height = 280,
    width = 1000,
    xTicks = 'auto',
    yTicks,
    yTickCount = 5,
    formatY = defaultFormatY,
    formatValue = (v) => pct(v),
    sparkline = false,
    className,
    id,
  } = o;
  const endLabels = o.endLabels ?? !sparkline;
  if (!ariaLabel) throw new Error('lineChart: ariaLabel is required');
  if (!Array.isArray(series) || !series.length) throw new Error('lineChart: series is required');
  if (!Array.isArray(labels)) throw new Error('lineChart: labels is required');
  const n = labels.length;
  series.forEach((s, k) => {
    if (s.values.length !== n) throw new Error(`lineChart: series ${k} has ${s.values.length} values, expected ${n}`);
    checkCls(s.cls ?? 'khi');
  });
  refLines.forEach((r) => checkCls(r.cls ?? 'target'));

  const values = series.flatMap((s) => s.values.filter(isNum));
  const refValues = refLines.map((r) => r.value).filter(isNum);
  const lo = Math.min(...values, ...refValues);
  const hi = Math.max(...values, ...refValues);
  const fixed = isNum(o.yMin) && isNum(o.yMax);
  const scale = fixed
    ? { min: o.yMin, max: o.yMax, step: niceScale(o.yMin, o.yMax, yTickCount).step, ticks: ticksWithin(o.yMin, o.yMax, yTickCount) }
    : niceScale(isNum(o.yMin) ? o.yMin : lo, isNum(o.yMax) ? o.yMax : hi, yTickCount);
  if (isNum(o.yMin)) scale.min = Math.min(scale.min, o.yMin);
  if (isNum(o.yMax)) scale.max = Math.max(scale.max, o.yMax);
  const ticks = (yTicks ?? scale.ticks).filter((t) => t >= scale.min - 1e-9 && t <= scale.max + 1e-9);

  const top = sparkline ? 4 : 12;
  const bottom = sparkline ? 4 : 28;
  const plotH = Math.max(10, height - top - bottom);
  const span = scale.max - scale.min || 1;
  const yIn = (v) => (1 - (v - scale.min) / span) * plotH;
  const yOut = (v) => top + yIn(v);
  const fx = (i) => (n > 1 ? i / (n - 1) : 0.5);

  const parts = [];
  if (!sparkline) {
    for (const t of ticks) {
      const y = c2(yOut(t));
      parts.push(html`<line${attrs({ class: ['chart-grid', Math.abs(t) < 1e-9 && 'chart-grid--zero'], x1: 0, x2: '100%', y1: y, y2: y })}/>`);
      parts.push(html`<text class="chart-axis chart-axis--y" x="-8" y="${y}" dy="0.32em" text-anchor="end">${formatY(t, scale.step)}</text>`);
    }
    parts.push(html`<line class="chart-axis-line" x1="0" x2="100%" y1="${c2(top + plotH)}" y2="${c2(top + plotH)}"/>`);
  }
  const refLabels = [];
  for (const r of refLines) {
    if (!isNum(r.value) || r.value < scale.min || r.value > scale.max) continue;
    const y = c2(yOut(r.value));
    parts.push(html`<line class="chart-ref chart-ref--${r.cls ?? 'target'}" x1="0" x2="100%" y1="${y}" y2="${y}"/>`);
    // Drawn after the data lines so the label's halo keeps it readable.
    if (r.label && !sparkline) refLabels.push(html`<text class="chart-ref-label" x="6" y="${c2(yOut(r.value) - 6)}">${r.label}</text>`);
  }

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (!isNum(v)) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${c2(fx(i) * width)} ${c2(yIn(v))}`;
      pen = true;
    });
    // A single isolated point would be invisible as a path: draw a tiny segment.
    if (/^M[^L]*$/.test(d)) d += `h0.01`;
    const title = s.label ? html`<title>${s.label}</title>` : '';
    return html`<path class="chart-line chart-line--${s.cls ?? 'khi'}" d="${d}" vector-effect="non-scaling-stroke">${title}</path>`;
  });
  parts.push(html`<svg class="chart-plot" x="0" y="${top}" width="100%" height="${plotH}" viewBox="0 0 ${width} ${plotH}" preserveAspectRatio="none" overflow="visible">${paths}</svg>`);
  parts.push(...refLabels);

  if (!sparkline) {
    const bottomY = c2(height - 8);
    for (const t of resolveTicks(xTicks, labels)) {
      const x = pctPos(fx(t.index));
      parts.push(html`<line${attrs({ class: ['chart-tick', t.minor && 'chart-tick--minor'], x1: x, x2: x, y1: c2(top + plotH), y2: c2(top + plotH + 4) })}/>`);
      parts.push(html`<text${attrs({ class: ['chart-axis', 'chart-axis--x', t.minor && 'chart-tick--minor'], x, y: bottomY, 'text-anchor': 'middle' })}>${t.text}</text>`);
    }
  }

  const ends = [];
  series.forEach((s) => {
    let li = -1;
    for (let i = s.values.length - 1; i >= 0; i--) if (isNum(s.values[i])) { li = i; break; }
    if (li < 0) return;
    const cls = s.cls ?? 'khi';
    const y = yOut(s.values[li]);
    parts.push(html`<circle class="chart-dot chart-dot--${cls}" cx="${pctPos(fx(li))}" cy="${c2(y)}" r="3.5"/>`);
    if (endLabels && s.endLabel !== false) {
      ends.push({ y, cls, x: pctPos(fx(li)), text: (s.formatValue ?? formatValue)(s.values[li]) });
    }
  });
  spreadLabels(ends, 15, top + 4, top + plotH);
  for (const e of ends) {
    parts.push(html`<text class="chart-endlabel chart-endlabel--${e.cls}" x="${e.x}" dx="8" y="${c2(e.y)}" dy="0.32em">${valueText(e.text)}</text>`);
  }

  return html`<svg${attrs({
    xmlns: 'http://www.w3.org/2000/svg',
    class: classes('chart-svg', sparkline ? 'chart-svg--spark' : 'chart-svg--line', !endLabels && 'chart-svg--no-end', className),
    id,
    role: 'img',
    'aria-label': ariaLabel,
    width: '100%',
    height,
    overflow: 'visible',
    focusable: 'false',
  })}>${parts}</svg>`;
}

/**
 * Sparkline: a compact line chart without axes (e.g. hero, 24 months).
 * @param {(number|null)[]} values
 * @param {object} o same options as lineChart (labels default to indices)
 * @returns {SafeString}
 */
export function sparkline(values, o = {}) {
  return lineChart({
    labels: o.labels ?? values.map((_, i) => String(i)),
    height: 64,
    ...o,
    series: [{ values, cls: o.cls ?? 'khi', label: o.label }],
    sparkline: true,
  });
}

/**
 * Vertical bar chart (e.g. annual inflation 1980→, one bar per year).
 *
 * @param {object} o
 * @param {{label: string, value: number|null, cls?: string, partial?: boolean, title?: string}[]} o.bars
 *   `cls` colour class (default 'khi'; use levelBand() → 'low'/'elevated'/'high'/'deflation');
 *   `partial` = incomplete period (lighter bar); `title` = hover text (default "label: value")
 * @param {string} o.ariaLabel accessible name (required)
 * @param {{value: number, cls?: string, label?: string, labelInside?: boolean}[]} [o.refLines]
 *   reference lines; the label is drawn in the plot only with labelInside: true
 *   (bars would hide it) – normally list the line in the legend instead
 * @param {number} [o.yMin]
 * @param {number} [o.yMax]
 * @param {number} [o.height=240]
 * @param {'auto'|false|Array|Function} [o.xTicks='auto'] auto = thinned bar labels
 * @param {(v:number)=>string} [o.formatValue] value formatter (titles, value labels)
 * @param {(v:number, step:number)=>string} [o.formatY]
 * @param {boolean} [o.valueLabels] value above each bar (default when ≤ 16 bars)
 * @param {number} [o.yTickCount=5]
 * @param {string} [o.className]
 * @param {string} [o.id]
 * @returns {SafeString}
 */
export function barChart(o) {
  const {
    bars,
    ariaLabel,
    refLines = [],
    height = 240,
    xTicks = 'auto',
    formatValue = (v) => pct(v),
    formatY = defaultFormatY,
    yTickCount = 5,
    className,
    id,
  } = o;
  if (!ariaLabel) throw new Error('barChart: ariaLabel is required');
  if (!Array.isArray(bars) || !bars.length) throw new Error('barChart: bars is required');
  bars.forEach((b) => checkCls(b.cls ?? 'khi'));
  refLines.forEach((r) => checkCls(r.cls ?? 'target'));
  const n = bars.length;
  const valueLabels = o.valueLabels ?? n <= 16;

  const values = bars.map((b) => b.value).filter(isNum);
  const refValues = refLines.map((r) => r.value).filter(isNum);
  const scale = niceScale(
    Math.min(0, ...values, ...refValues, isNum(o.yMin) ? o.yMin : 0),
    Math.max(0, ...values, ...refValues, isNum(o.yMax) ? o.yMax : 0),
    yTickCount,
  );
  const top = valueLabels ? 22 : 12;
  const bottom = 28;
  const plotH = Math.max(10, height - top - bottom);
  const span = scale.max - scale.min || 1;
  const yIn = (v) => (1 - (v - scale.min) / span) * plotH;
  const yOut = (v) => top + yIn(v);
  const slot = 10;
  const pad = n > 40 ? 1.5 : n > 20 ? 2 : 2.5;
  const W = n * slot;
  const fx = (i) => (i + 0.5) / n;

  const parts = [];
  for (const t of scale.ticks) {
    const y = c2(yOut(t));
    parts.push(html`<line${attrs({ class: ['chart-grid', Math.abs(t) < 1e-9 && 'chart-grid--zero'], x1: 0, x2: '100%', y1: y, y2: y })}/>`);
    parts.push(html`<text class="chart-axis chart-axis--y" x="-8" y="${y}" dy="0.32em" text-anchor="end">${formatY(t, scale.step)}</text>`);
  }

  const rects = bars.map((b, i) => {
    if (!isNum(b.value)) return '';
    const y0 = yIn(0);
    const y1 = yIn(b.value);
    const h = Math.max(Math.abs(y1 - y0), 0.75);
    const y = b.value >= 0 ? Math.min(y1, y0 - 0.75) : y0;
    const title = b.title ?? `${b.label}: ${formatValue(b.value)}`;
    return html`<rect${attrs({
      class: ['chart-bar', `chart-bar--${b.cls ?? 'khi'}`, b.partial && 'chart-bar--partial'],
      x: c2(i * slot + pad),
      y: c2(y),
      width: c2(slot - 2 * pad),
      height: c2(h),
    })}><title>${title}</title></rect>`;
  });
  parts.push(html`<svg class="chart-plot" x="0" y="${top}" width="100%" height="${plotH}" viewBox="0 0 ${W} ${plotH}" preserveAspectRatio="none" overflow="visible">${rects}</svg>`);

  for (const r of refLines) {
    if (!isNum(r.value) || r.value < scale.min || r.value > scale.max) continue;
    const y = c2(yOut(r.value));
    parts.push(html`<line class="chart-ref chart-ref--${r.cls ?? 'target'}" x1="0" x2="100%" y1="${y}" y2="${y}"/>`);
    // Dense bars would hide an in-plot label: show it only when asked
    // (labelInside: true); otherwise put the line in the legend.
    if (r.label && r.labelInside) parts.push(html`<text class="chart-ref-label" x="6" y="${c2(yOut(r.value) - 6)}">${r.label}</text>`);
  }

  if (valueLabels) {
    bars.forEach((b, i) => {
      if (!isNum(b.value)) return;
      const y = b.value >= 0 ? yOut(b.value) - 6 : yOut(b.value) + 14;
      parts.push(html`<text class="chart-bar-value" x="${pctPos(fx(i))}" y="${c2(y)}" text-anchor="middle">${valueText(formatValue(b.value))}</text>`);
    });
  }

  let ticks;
  if (xTicks === 'auto') {
    const labels = bars.map((b) => String(b.label));
    let k = 1;
    for (const s of [1, 2, 5, 10, 20]) {
      k = s;
      if (Math.ceil(n / s) <= 12) break;
    }
    const numeric = labels.every((l) => /^\d{4}$/.test(l));
    ticks = labels
      .map((text, index) => ({ index, text, minor: false }))
      .filter((t) => (numeric ? Number(t.text) % k === 0 : (n - 1 - t.index) % k === 0));
    ticks = markMinor(ticks);
  } else {
    ticks = resolveTicks(xTicks, bars.map((b) => String(b.label)));
  }
  const bottomY = c2(height - 8);
  for (const t of ticks) {
    parts.push(html`<text${attrs({ class: ['chart-axis', 'chart-axis--x', t.minor && 'chart-tick--minor'], x: pctPos(fx(t.index)), y: bottomY, 'text-anchor': 'middle' })}>${t.text}</text>`);
  }

  return html`<svg${attrs({
    xmlns: 'http://www.w3.org/2000/svg',
    class: classes('chart-svg', 'chart-svg--bar', className),
    id,
    role: 'img',
    'aria-label': ariaLabel,
    width: '100%',
    height,
    overflow: 'visible',
    focusable: 'false',
  })}>${parts}</svg>`;
}

/**
 * Horizontal bar chart, one row per item: label on the left, value on the
 * right, bar underneath (full width, so long Finnish labels fit on phones).
 * Handles negative values (bars grow left from the zero line).
 *
 * @param {object} o
 * @param {{label: string, value: number|null, cls?: string, title?: string}[]} o.bars
 *   `cls` default: 'pos' for ≥ 0, 'neg' for < 0
 * @param {string} o.ariaLabel accessible name (required)
 * @param {(v:number)=>string} [o.formatValue] default pp() with 2 decimals ("+0,52 %-yks.")
 * @param {[number, number]} [o.domain] fixed [min, max] (default from data, incl. 0)
 * @param {number} [o.rowHeight=44]
 * @param {number} [o.barHeight=10]
 * @param {number} [o.maxLabelChars=36] longer labels are shortened with "…" (full text in <title>);
 *   36 characters + the value fit a 358 px wide phone column
 * @param {string} [o.className]
 * @param {string} [o.id]
 * @returns {SafeString}
 */
export function hBarChart(o) {
  const {
    bars,
    ariaLabel,
    formatValue = (v) => pp(v, { decimals: 2 }),
    rowHeight = 44,
    barHeight = 10,
    maxLabelChars = 36,
    className,
    id,
  } = o;
  if (!ariaLabel) throw new Error('hBarChart: ariaLabel is required');
  if (!Array.isArray(bars) || !bars.length) throw new Error('hBarChart: bars is required');
  const values = bars.map((b) => b.value).filter(isNum);
  const lo = o.domain ? o.domain[0] : Math.min(0, ...values);
  const hi = o.domain ? o.domain[1] : Math.max(0, ...values);
  const span = hi - lo || 1;
  const fx = (v) => (v - lo) / span;
  const zero = fx(0);
  const height = bars.length * rowHeight + 2;

  const parts = [];
  bars.forEach((b, r) => {
    const y0 = r * rowHeight;
    const cls = checkCls(b.cls ?? (isNum(b.value) && b.value < 0 ? 'neg' : 'pos'));
    const label = String(b.label);
    const short = label.length > maxLabelChars ? `${label.slice(0, maxLabelChars - 1).trimEnd()}…` : label;
    parts.push(html`<text class="chart-hbar-label" x="0" y="${y0 + 15}">${short}${short !== label ? html`<title>${label}</title>` : ''}</text>`);
    parts.push(html`<text class="chart-hbar-value" x="100%" y="${y0 + 15}" text-anchor="end">${isNum(b.value) ? valueText(formatValue(b.value)) : '–'}</text>`);
    parts.push(html`<rect class="chart-hbar-track" x="0" y="${y0 + 22}" width="100%" height="${barHeight}"/>`);
    if (isNum(b.value)) {
      const a = Math.min(zero, fx(b.value));
      const w = Math.max(Math.abs(fx(b.value) - zero), 0.003);
      const title = b.title ?? `${label}: ${formatValue(b.value)}`;
      parts.push(html`<rect class="chart-hbar chart-hbar--${cls}" x="${pctPos(a)}" y="${y0 + 22}" width="${pctPos(w)}" height="${barHeight}"><title>${title}</title></rect>`);
    }
  });
  if (lo < 0) {
    // Zero line through the bar bands only, so it never crosses the labels.
    bars.forEach((_, r) => {
      const y0 = r * rowHeight;
      parts.push(html`<line class="chart-grid chart-grid--zero" x1="${pctPos(zero)}" x2="${pctPos(zero)}" y1="${y0 + 19}" y2="${y0 + 25 + barHeight}"/>`);
    });
  }

  return html`<svg${attrs({
    xmlns: 'http://www.w3.org/2000/svg',
    class: classes('chart-svg', 'chart-svg--hbar', className),
    id,
    role: 'img',
    'aria-label': ariaLabel,
    width: '100%',
    height,
    focusable: 'false',
  })}>${parts}</svg>`;
}

export { raw, SafeString };
