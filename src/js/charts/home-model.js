/**
 * Home page (/) view-model helpers.
 *
 * ISOMORPHIC: pure ESM without DOM or Node APIs. The page module
 * (src/pages/home.js) uses these at build time to render the default view and
 * to precompute the texts of every metric × range combination; the page
 * script (src/js/pages/home.js, src/js/charts/home-charts.js) uses the small
 * data helpers (series decoding, price level) in the browser. esbuild
 * tree-shakes whatever the browser does not import.
 *
 * Every text is built with format.js (fi-FI) from data; nothing is hard-coded.
 */
import * as fmt from '../lib/format.js';
import * as stats from '../lib/stats.js';

/** Metrics of the global selector (URL ?mittari=…). */
export const METRICS = Object.freeze(['khi', 'ykhi']);
export const DEFAULT_METRIC = 'khi';
/** Default chart range (URL ?jakso=…). */
export const DEFAULT_RANGE = '5v';
/** Button labels of the range keys (stats.RANGE_KEYS). */
export const RANGE_LABELS = Object.freeze({ '6kk': '6 kk', '1v': '1 v', '3v': '3 v', '5v': '5 v', '10v': '10 v', kaikki: 'Kaikki' });

/** Display names of the metrics. */
export const METRIC_INFO = Object.freeze({
  khi: Object.freeze({ short: 'KHI', name: 'kuluttajahintaindeksi', source: 'Tilastokeskus' }),
  ykhi: Object.freeze({ short: 'YKHI', name: 'yhdenmukaistettu kuluttajahintaindeksi', source: 'Eurostat' }),
});

/**
 * Caption of the statistics row under the main chart (follows the metric).
 * @param {'khi'|'ykhi'} metric
 */
export function statsCaption(metric) {
  const info = METRIC_INFO[metric];
  return `Jakson tilastot: ${info.short} (${info.source})`;
}

/* --------------------------------------------------------- series coding */

/**
 * Compact form of a series aligned with a month axis: leading and trailing
 * missing values are dropped ({ o: offset of the first value, v: values }).
 * @param {(number|null)[]} arr
 * @returns {{o: number, v: (number|null)[]}}
 */
export function encodeSeries(arr) {
  const first = stats.firstIndex(arr);
  if (first < 0) return { o: 0, v: [] };
  return { o: first, v: arr.slice(first, stats.latestIndex(arr) + 1).map((v) => (fmt.isNum(v) ? v : null)) };
}

/**
 * Inverse of encodeSeries(): an array of length `n` with nulls around the values.
 * @param {{o?: number, v?: (number|null)[]}|null|undefined} enc
 * @param {number} n length of the month axis
 * @returns {(number|null)[]}
 */
export function decodeSeries(enc, n) {
  const out = new Array(n).fill(null);
  const o = enc?.o ?? 0;
  (enc?.v ?? []).forEach((v, i) => {
    if (o + i < n && fmt.isNum(v)) out[o + i] = v;
  });
  return out;
}

/**
 * Contiguous month axis of `n` months from `start` ('YYYY-MM').
 * @param {string} start
 * @param {number} n
 * @returns {string[]}
 */
export function monthAxis(start, n) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => fmt.ymAdd(start, i));
}

/* ------------------------------------------------------------ month text */

/**
 * Split a sorted list of months into runs of consecutive months.
 * @param {string[]} months ascending 'YYYY-MM'
 * @returns {string[][]}
 */
export function consecutiveRuns(months) {
  const runs = [];
  for (const m of months ?? []) {
    const cur = runs.at(-1);
    if (cur && fmt.ymDiff(cur.at(-1), m) === 1) cur.push(m);
    else runs.push([m]);
  }
  return runs;
}

/**
 * Short text of a month list (ties of a minimum or maximum):
 * ['2022-11', '2022-12'] → 'marras–joulu 2022'; ['2025-10', '2026-01'] →
 * 'loka 2025, tammi 2026'. More than three runs are shortened with the count.
 * @param {string[]} months
 * @returns {string}
 */
export function monthsText(months) {
  if (!months?.length) return fmt.DASH;
  const runs = consecutiveRuns(months).map((r) => {
    const a = r[0];
    const b = r.at(-1);
    if (a === b) return fmt.monthShort(a);
    if (fmt.yearOf(a) === fmt.yearOf(b)) return `${fmt.monthsSpan(a, b)} ${fmt.yearOf(a)}`;
    return fmt.monthRange(a, b);
  });
  if (runs.length <= 3) return runs.join(', ');
  return `${runs.slice(0, 2).join(', ')} ym. (${months.length} kk)`;
}

/**
 * Inessive phrase of one run of consecutive months:
 * ['2016-02'] → 'helmikuussa 2016'; ['2025-10','2025-11'] → 'loka–marraskuussa 2025';
 * ['2009-06' … '2010-01'] → 'kesäkuusta 2009 tammikuuhun 2010'.
 * @param {string[]} run
 * @param {{year?: boolean}} [o] year=false omits the year of a single-year run
 */
export function runInessive(run, { year = true } = {}) {
  const a = run[0];
  const b = run.at(-1);
  if (a === b) return fmt.inessive(a, { year });
  if (fmt.yearOf(a) !== fmt.yearOf(b)) return `${fmt.elative(a)} ${fmt.illative(b)}`;
  const { m: mb } = fmt.parseYm(b);
  const text = `${fmt.MONTHS_SHORT[fmt.parseYm(a).m - 1]}${fmt.DASH}${fmt.MONTHS[mb - 1]}ssa`;
  return year ? `${text} ${fmt.yearOf(a)}` : text;
}

/**
 * Finnish list "a, b ja c" / "a, b sekä c".
 * @param {string[]} parts
 * @param {string} [last=' ja ']
 */
export function listText(parts, last = ' ja ') {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')}${last}${parts.at(-1)}`;
}

/**
 * Inessive text of many months, runs of the same calendar year grouped:
 * 'maalis–kesäkuussa 2004, tammi–huhtikuussa ja kesä–joulukuussa 2015 sekä helmikuussa 2016'.
 * @param {string[]} months ascending
 * @returns {string}
 */
export function monthsInessive(months) {
  const runs = consecutiveRuns(months);
  const groups = [];
  for (const run of runs) {
    const single = fmt.yearOf(run[0]) === fmt.yearOf(run.at(-1));
    const prev = groups.at(-1);
    if (single && prev?.year === fmt.yearOf(run[0])) prev.runs.push(run);
    else groups.push({ year: single ? fmt.yearOf(run[0]) : null, runs: [run] });
  }
  const parts = groups.map((g) =>
    g.year == null || g.runs.length === 1
      ? runInessive(g.runs[0])
      : `${listText(g.runs.map((r) => runInessive(r, { year: false })))} ${g.year}`,
  );
  return listText(parts, ' sekä ');
}

/* ---------------------------------------------------------------- stats */

/**
 * Statistics row of a chart range (stats <dl>): lowest and highest annual
 * rate with their months, the mean, and the average annual price change
 * (geometric, from the official index) — or the total change for ranges
 * shorter than 12 months (never annualised).
 * @param {object} p
 * @param {string[]} p.months months of the range
 * @param {(number|null)[]} p.yoy annual rates, aligned
 * @param {(number|null)[]} p.index official point figures, aligned
 * @returns {{label: string, value: string, note: string}[]}
 */
export function rangeStatItems({ months, yoy, index }) {
  const s = stats.rangeStats(months, yoy, index);
  const period = fmt.monthRange(s.start, s.end);
  const items = [
    { label: 'Alin', value: fmt.pct(s.min?.value), note: monthsText(s.min?.months) },
    { label: 'Keskiarvo', value: fmt.pct(s.mean), note: period },
    { label: 'Korkein', value: fmt.pct(s.max?.value), note: monthsText(s.max?.months) },
  ];
  if (fmt.isNum(s.annual)) {
    items.push({
      label: 'Hinnat vuodessa',
      value: fmt.pct(s.annual, { sign: true }),
      note: `keskimäärin, ${fmt.monthRange(s.indexStart, s.indexEnd)}`,
    });
  } else if (fmt.isNum(s.total)) {
    items.push({ label: 'Hinnat jaksolla', value: fmt.pct(s.total, { sign: true }), note: fmt.monthRange(s.indexStart, s.indexEnd) });
  }
  return items;
}

/* ---------------------------------------------------------- price level */

/**
 * Price level of a range, rebased so that the first month of the range is
 * 100 € ("mitä 100 € on nyt"). Uses one official index series.
 * @param {string[]} months axis
 * @param {(number|null)[]} index official point figures aligned with `months`
 * @param {string} key range key
 * @returns {{months: string[], values: (number|null)[], index: (number|null)[], start: string|null, end: string|null, last: number|null}}
 */
export function priceLevel(months, index, key) {
  const r = stats.sliceRange(months, index, key);
  const values = r.series.length ? stats.rebase(r.series, 0, 100) : [];
  const li = stats.latestIndex(values);
  return {
    months: r.months,
    values,
    index: r.series,
    start: r.months[0] ?? null,
    end: li >= 0 ? r.months[li] : null,
    last: li >= 0 ? values[li] : null,
  };
}

/**
 * Texts of the price-level chart for one metric and range.
 * @param {ReturnType<typeof priceLevel>} pl
 * @param {'khi'|'ykhi'} metric
 * @param {string} base index base shown to the reader, e.g. '2025=100'
 * @returns {{period: string, summary: string, aria: string}}
 */
export function priceLevelText(pl, metric, base) {
  const info = METRIC_INFO[metric];
  const period = fmt.monthRange(pl.start, pl.end);
  if (!fmt.isNum(pl.last) || !pl.start) return { period, summary: fmt.DASH, aria: `Hintataso (${info.short}).` };
  const change = pl.last - 100;
  const dir = stats.deltaClass(change);
  const verb = dir === 'up' ? 'nousi' : dir === 'down' ? 'laski' : 'pysyi ennallaan';
  const changeText = dir === 'flat' ? '' : ` ${fmt.pct(Math.abs(change))}`;
  const summary =
    `Ostokset, jotka maksoivat ${fmt.inessive(pl.start)} 100 €, maksoivat ${fmt.inessive(pl.end)} ${fmt.eur(pl.last)}. ` +
    `Hintataso ${verb} jaksolla${changeText} (${info.short}, ${info.source}, pisteluvut ${base}).`;
  const aria = `Hintataso ${period}: jakson alussa 100 €, ${fmt.monthShort(pl.end)} ${fmt.eur(pl.last)} (${info.short}).`;
  return { period, summary, aria };
}

/* ------------------------------------------------------------- phrasing */

/**
 * "Kuluttajahinnat olivat elokuussa 2026 2,2 % korkeammat kuin vuotta aiemmin."
 * (sign-aware; 0,0 % → "samalla tasolla").
 * @param {string} month
 * @param {number} yoy
 */
export function annualChangeSentence(month, yoy) {
  const dir = stats.deltaClass(yoy);
  if (dir === 'flat') return `Kuluttajahinnat olivat ${fmt.inessive(month)} samalla tasolla kuin vuotta aiemmin.`;
  return `Kuluttajahinnat olivat ${fmt.inessive(month)} ${fmt.pct(Math.abs(yoy))} ${dir === 'up' ? 'korkeammat' : 'alemmat'} kuin vuotta aiemmin.`;
}

/**
 * Month phrase pair for "from A to B": ('2026-07','2026-08') → ['heinäkuusta', 'elokuuhun'];
 * across a year boundary both carry the year.
 * @param {string} a
 * @param {string} b
 */
export function fromTo(a, b) {
  const year = fmt.yearOf(a) !== fmt.yearOf(b);
  return [fmt.elative(a, { year }), fmt.illative(b, { year })];
}

/**
 * Note of the "Hinnat kuukaudessa" card (official monthly change, %).
 * @param {string} prevMonth
 * @param {string} month
 * @param {number|null} mom
 */
export function momNote(prevMonth, month, mom) {
  if (!fmt.isNum(mom) || !prevMonth) return 'Kuukausimuutosta ei ole vielä julkaistu.';
  const [from, to] = fromTo(prevMonth, month);
  const dir = stats.deltaClass(mom);
  if (dir === 'flat') return `Kuluttajahinnat pysyivät ${from} ${to} ennallaan.`;
  return `Kuluttajahinnat ${dir === 'up' ? 'nousivat' : 'laskivat'} ${from} ${to} ${fmt.pct(Math.abs(mom))}.`;
}

/** "2,1 prosentista" style number + word (no % sign, reads naturally with case endings). */
const pctWord = (v, ending) => `${fmt.num(v, 1)} ${ending}`;

/**
 * Note of the "Muutos edellisestä kuukaudesta" card (difference of annual rates):
 * "Inflaatio kiihtyi heinäkuun 2,1 prosentista elokuun 2,2 prosenttiin."
 * @param {string} prevMonth
 * @param {number|null} prevYoy
 * @param {string} month
 * @param {number} yoy
 */
export function deltaNote(prevMonth, prevYoy, month, yoy) {
  if (!fmt.isNum(prevYoy) || !prevMonth) return 'Edellisen kuukauden lukua ei ole.';
  const year = fmt.yearOf(prevMonth) !== fmt.yearOf(month);
  const a = fmt.genitive(prevMonth, { year });
  const b = fmt.genitive(month, { year });
  const dir = stats.deltaClass(stats.ppChange(yoy, prevYoy));
  if (dir === 'flat') return `Inflaatio pysyi ${fmt.inessive(month, { year })} ${a} tasolla (${fmt.pct(yoy)}).`;
  return `Inflaatio ${dir === 'up' ? 'kiihtyi' : 'hidastui'} ${a} ${pctWord(prevYoy, 'prosentista')} ${b} ${pctWord(yoy, 'prosenttiin')}.`;
}

/**
 * Note of the "Vuosi sitten" card: "Elokuussa 2025. Nyt inflaatio on 1,7 prosenttiyksikköä korkeampi."
 * @param {string} month latest month
 * @param {number} yoy latest rate
 * @param {number|null} yearAgo rate a year earlier
 */
export function yearAgoNote(month, yoy, yearAgo) {
  const then = fmt.capitalize(fmt.inessive(fmt.ymAdd(month, -12)));
  if (!fmt.isNum(yearAgo)) return `${then} ei lukua.`;
  const d = stats.ppChange(yoy, yearAgo);
  const dir = stats.deltaClass(d);
  if (dir === 'flat') return `${then}. Nyt inflaatio on samalla tasolla.`;
  return `${then}. Nyt inflaatio on ${fmt.num(Math.abs(d), 1)} prosenttiyksikköä ${dir === 'up' ? 'korkeampi' : 'matalampi'}.`;
}

/**
 * Wrap a text into lines of at most `width` characters (tooltip footers).
 * @param {string} text
 * @param {number} [width=44]
 * @returns {string[]}
 */
export function wrapText(text, width = 44) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Page <title> "Inflaatio Suomessa nyt: 2,2 % (elokuu 2026)" that fits in
 * `max` characters together with the brand suffix (" | Inflaatio.fi");
 * shorter variants for long month names and negative values.
 * @param {string} month
 * @param {number} yoy
 * @param {{max?: number, suffix?: string}} [o]
 */
export function pageTitle(month, yoy, { max = 60, suffix = ' | Inflaatio.fi' } = {}) {
  const v = fmt.pct(yoy);
  const candidates = [
    `Inflaatio Suomessa nyt: ${v} (${fmt.monthName(month)})`,
    `Inflaatio nyt: ${v} (${fmt.monthName(month)})`,
    `Inflaatio nyt: ${v} (${fmt.monthShort(month)})`,
  ];
  return candidates.find((t) => t.length + suffix.length <= max) ?? candidates.at(-1);
}
