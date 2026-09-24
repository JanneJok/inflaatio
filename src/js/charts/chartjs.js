/**
 * The parts of Chart.js the site uses, registered once. Imported ONLY through
 * `import('./chartjs.js')` in setup.js, so esbuild emits it (tree-shaken) as a
 * lazily loaded chunk. Add controllers/elements here when a page needs them.
 */
import {
  Chart,
  LineController,
  BarController,
  LineElement,
  PointElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(LineController, BarController, LineElement, PointElement, BarElement, CategoryScale, LinearScale, Tooltip, Filler, annotationPlugin);

export { Chart };
