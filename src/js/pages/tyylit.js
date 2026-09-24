/**
 * Style guide page script: demonstrates the page-script patterns —
 * 1. listen to `segmentedchange`, keep the choice in the URL (?mittari=…&jakso=…)
 *    and update an aria-live text;
 * 2. an interactive Chart.js chart that is loaded only when the figure comes
 *    near the viewport, reads its data from a JSON data island, replaces the
 *    server-rendered SVG fallback and follows the theme (charts/setup.js).
 * Other pages follow the same patterns.
 */
import { getParam, setParams } from '../lib/url-state.js';
import { setSegmented, getSegmented } from '../lib/segmented.js';
import { announce, onVisible, readDataIsland } from '../lib/dom.js';
import { sliceRange, isRangeKey } from '../lib/stats.js';
import { monthRange } from '../lib/format.js';
import { createChart, lineDataset, targetLine, downloadPng } from '../charts/setup.js';

const DEFAULTS = { mittari: 'khi', jakso: '5v' };
const output = document.getElementById('segmentoitu-tulos');
const group = (name) => document.querySelector(`[data-segmented="${name}"]`);

function describe() {
  if (!output) return;
  const mittari = group('mittari')?.querySelector('[aria-checked="true"] .segmented__main')?.textContent ?? '';
  const jakso = group('jakso')?.querySelector('[aria-checked="true"] .segmented__main')?.textContent ?? '';
  output.textContent = `Valittu: ${mittari.trim()}, ${jakso.trim()}`;
}

// Restore state from the URL (unknown values are ignored).
for (const name of Object.keys(DEFAULTS)) {
  const g = group(name);
  const allowed = Array.from(g?.querySelectorAll('[data-value]') ?? []).map((b) => b.getAttribute('data-value'));
  const v = getParam(name, allowed);
  if (v) setSegmented(g, v);
}
describe();

document.addEventListener('segmentedchange', (e) => {
  const { name, value } = /** @type {CustomEvent} */ (e).detail;
  if (!(name in DEFAULTS)) return;
  setParams({ [name]: value }, { defaults: DEFAULTS });
  describe();
});

/* ------------------------------------------------------ interactive chart */

const box = document.querySelector('[data-chart="kehitys"]');
const data = readDataIsland('kaavio-chartjs-data');

if (box && data) {
  onVisible(box.parentElement ?? box, async () => {
    const range = () => {
      const key = getSegmented(group('kaavio-jakso')) ?? '5v';
      return sliceRange(data.months, [data.khi, data.ykhi], isRangeKey(key) ? key : '5v');
    };
    const r = range();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', box.getAttribute('data-label') ?? 'Kaavio');
    box.append(canvas);
    box.hidden = false;
    let chart;
    try {
      chart = await createChart(canvas, {
        months: r.months,
        datasets: [
          lineDataset({ series: 'khi', label: 'KHI', data: r.series[0] }),
          lineDataset({ series: 'ykhi', label: 'YKHI', data: r.series[1] }),
        ],
        annotations: { target: targetLine(2) },
        unit: '%',
      });
    } catch (err) {
      // Chart.js could not be loaded (offline): keep the SVG fallback.
      canvas.remove();
      box.hidden = true;
      console.error('[inflaatio] chart failed', err);
      return;
    }
    const fallback = box.parentElement?.querySelector('[data-chart-fallback]');
    if (fallback) fallback.hidden = true;

    document.addEventListener('segmentedchange', (e) => {
      if (/** @type {CustomEvent} */ (e).detail.name !== 'kaavio-jakso') return;
      const next = range();
      chart.setMonths(next.months, next.series);
      announce(`Kaavio näyttää jakson ${monthRange(next.months[0], next.months.at(-1))}.`);
    });
    document.querySelector('[data-chart-download="kehitys"]')?.addEventListener('click', () => {
      downloadPng(chart, `inflaatio-khi-ykhi-${data.months.at(-1)}.png`, {
        title: 'Inflaatio Suomessa (vuosimuutos, %)',
        source: 'Lähteet: Tilastokeskus (KHI), Eurostat (YKHI) · inflaatio.fi',
      });
    });
  });
}
