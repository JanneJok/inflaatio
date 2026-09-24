/**
 * Value of money (/rahanarvo/ and /en/value-of-money/) + the savings
 * calculators of /rahanarvo/#saastot.
 *
 * The page works without JS (server-rendered default results, SVG chart,
 * tables). This script recalculates with lib/calc.js on input, shows field
 * errors as text, replaces the SVG with an interactive Chart.js chart
 * (charts/setup.js, loaded when the chart comes near the viewport), rebuilds
 * the chart's data table, keeps the inputs in the URL and sends one GA event
 * per calculator and page view (only with consent).
 */
import { readDataIsland, onVisible, el } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { track } from '../lib/analytics.js';
import {
  pickMoneySeries,
  valueOfMoney,
  moneyPath,
  moneyView,
  savingsReal,
  savingsView,
  toEuros,
  parseDecimal,
  formatter,
  isMonth,
  isYear,
  periodYear,
  EURO_CASH_YEAR,
} from '../lib/calc.js';
import { ymDiff } from '../lib/format.js';
import { createChart, lineDataset, downloadPng, monthTicks } from '../charts/setup.js';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const fill = (tpl, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl ?? '');

/** Month + year picker value: 'YYYY-MM', or 'YYYY' when the month is "whole year". */
function readPeriod(id) {
  const m = $(`${id}-kk`)?.value ?? '';
  const y = $(`${id}-v`)?.value ?? '';
  return m ? `${y}-${m}` : y;
}

/** Restore a picker from 'YYYY-MM' / 'YYYY' (ignored when not selectable). */
function setPeriod(id, p) {
  if (!isMonth(p) && !isYear(p)) return false;
  const [y, m = ''] = p.split('-');
  const ySel = $(`${id}-v`);
  const mSel = $(`${id}-kk`);
  if (!ySel || !mSel) return false;
  if (!Array.from(ySel.options).some((o) => o.value === y)) return false;
  if (!Array.from(mSel.options).some((o) => o.value === m)) return false;
  ySel.value = y;
  mSel.value = m;
  return true;
}

/** Field error text + aria-invalid on its controls. */
function setError(errorId, text, ids) {
  const p = $(`${errorId}-virhe`);
  if (p) p.textContent = text ?? '';
  for (const id of ids) $(id)?.setAttribute('aria-invalid', text ? 'true' : 'false');
}

/** Write a view model into the [data-out] elements of `root`. */
function render(root, view, hideEmpty = []) {
  for (const node of root?.querySelectorAll('[data-out]') ?? []) {
    const key = node.getAttribute('data-out');
    if (!key || !(key in view)) continue;
    node.textContent = view[key];
    if (hideEmpty.includes(key)) node.hidden = !view[key];
  }
}

/** Show the result or the error box of a result panel. */
function showResult(panel, okState) {
  const ok = panel?.querySelector('[data-result-ok]');
  const err = panel?.querySelector('[data-result-error]');
  if (ok) ok.hidden = !okState;
  if (err) err.hidden = okState;
}

/** Debounced recalculation on input/change + immediate on submit. */
function wire(form, fn) {
  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn({ user: true }), 250);
  };
  form.addEventListener('input', later);
  form.addEventListener('change', later);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.clearTimeout(timer);
    fn({ user: true });
  });
}

/* ------------------------------------------------------- value of money */

const data = readDataIsland('raha-data');
const form = $('raha-lomake');
if (data && form) initMoney(data, form);

/**
 * @param {any} data island
 * @param {HTMLFormElement} form
 */
function initMoney(data, form) {
  const lang = data.lang === 'en' ? 'en' : 'fi';
  const F = formatter(lang);
  const P = data.params;
  const list = data.series;
  const msg = (key, vars) => fill(form.dataset[`msg${key.charAt(0).toUpperCase()}${key.slice(1)}`], vars);
  const panel = $('raha-tulos');
  const figure = $('raha-kaavio');
  let tracked = false;
  let lastPath = null;
  let lastTitle = '';

  const isFuture = (p) => (isMonth(p) ? p > data.latestMonth : p > data.latestYear);

  function calculate({ user = false } = {}) {
    const amountRaw = $('summa').value;
    const amount = parseDecimal(amountRaw, lang);
    const currency = $('valuutta').value === 'mk' ? 'mk' : 'eur';
    const from = readPeriod('alku');
    const to = readPeriod('loppu');
    const errors = {};
    if (amount == null || amount < 0 || amount > 1e12) errors.summa = msg('amount');
    if (currency === 'mk' && periodYear(from) >= EURO_CASH_YEAR) errors.valuutta = msg('markka');
    const futureVars = (p) => ({ aika: F.period(p), viimeisin: F.period(data.latestMonth), vuosi: data.latestYear });
    if (isFuture(from)) errors.alku = msg('future', futureVars(from));
    if (isFuture(to)) errors.loppu = msg('future', futureVars(to));
    let pick = null;
    if (!errors.alku && !errors.loppu) {
      pick = pickMoneySeries(list, from, to);
      if ('error' in pick) {
        const key = periodYear(from) <= periodYear(to) ? 'alku' : 'loppu';
        errors[key] = pick.error === 'future' ? msg('future', futureVars(key === 'alku' ? from : to)) : msg('before', { alku: String(data.firstYear) });
      }
    }
    setError('summa', errors.summa, ['summa']);
    setError('valuutta', errors.valuutta, ['valuutta']);
    setError('alku', errors.alku, ['alku-kk', 'alku-v']);
    setError('loppu', errors.loppu, ['loppu-kk', 'loppu-v']);
    const failed = Object.keys(errors).length > 0;
    showResult(panel, !failed);
    if (failed) return;

    const amountEur = toEuros(amount, currency, pick.from);
    const v = valueOfMoney({ amount: amountEur, fromIdx: pick.fromIdx, toIdx: pick.toIdx });
    const view = moneyView({ amount, currency, pick, value: v.value, factor: v.factor }, lang);
    render(panel, view, ['buys', 'note']);

    const path = moneyPath(list, pick, amountEur);
    const summary = `${view.sentence} ${view.change}`;
    render(figure, { chartSummary: summary });
    rebuildTable(path);
    lastTitle = `${lang === 'en' ? 'Value of' : 'Rahan arvo:'} ${currency === 'mk' ? F.markka(amount) : F.eur(amount)} ${F.periodIn(pick.from)}`;
    updateChart(path, summary);

    setParams(
      { [P.amount]: amountRaw.trim(), [P.currency]: currency, [P.from]: from, [P.to]: to },
      { defaults: { [P.amount]: String(data.defaults.amount), [P.currency]: 'eur', [P.from]: data.defaults.from, [P.to]: data.defaults.to } },
    );
    if (user && !tracked) {
      tracked = true;
      track('calculator_used', { laskuri: 'rahanarvo', sarja: pick.family, kieli: lang });
    }
  }

  /** Rebuild the chart's data table (every January / every year + the last point). */
  function rebuildTable(path) {
    const tbody = document.querySelector('#raha-kaavio-taulukko tbody');
    if (!tbody) return;
    const monthly = path.kind === 'month';
    const rows = path.labels
      .map((p, i) => ({ p, v: path.values[i], i }))
      .filter((r) => !monthly || r.p.endsWith('-01') || r.i === path.labels.length - 1)
      .reverse();
    tbody.replaceChildren(
      ...rows.map((r) => el('tr', {}, el('th', { scope: 'row' }, monthly ? F.period(r.p) : r.p), el('td', { class: 'num' }, F.eur(r.v)))),
    );
  }

  /* Chart.js: created lazily, recreated when the path switches month ↔ year. */
  const box = document.querySelector('[data-chart="raha-kaavio"]');
  const fallback = box?.parentElement?.querySelector('[data-chart-fallback]');
  let chart = null;
  let chartKind = null;
  let visible = false;
  let building = false;
  let chartFailed = false; // Chart.js could not be loaded: keep the SVG, stop retrying

  async function buildChart() {
    if (!box || !lastPath || building) return;
    building = true;
    const path = lastPath;
    chart?.destroy();
    chart = null;
    box.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', box.getAttribute('data-label') ?? '');
    box.append(canvas);
    box.hidden = false;
    try {
      const monthly = path.kind === 'month';
      chart = await createChart(canvas, {
        ...(monthly ? { months: path.labels } : { labels: path.labels }),
        datasets: [lineDataset({ series: 'khi', label: lang === 'en' ? 'Value' : 'Rahan arvo', data: path.values })],
        unit: '€',
        decimals: 2,
        ...(lang === 'en' ? { options: englishOptions(monthly) } : {}),
      });
      chartKind = path.kind;
      if (fallback) fallback.hidden = true;
    } catch (err) {
      canvas.remove();
      box.hidden = true;
      chartFailed = true;
      console.error('[inflaatio] chart failed', err);
    } finally {
      building = false;
    }
    // The inputs may have changed while Chart.js was loading.
    if (chart && lastPath !== path) updateChart(lastPath);
  }

  function updateChart(path, label) {
    lastPath = path;
    if (label) box?.setAttribute('data-label', label);
    if (!visible || building || chartFailed) return;
    if (!chart || chartKind !== path.kind) {
      buildChart();
      return;
    }
    chart.canvas?.setAttribute('aria-label', box?.getAttribute('data-label') ?? '');
    chart.setMonths(path.labels, [path.values]);
  }

  /** English axis/tooltip formatting (setup.js formats in Finnish by default). */
  function englishOptions(monthly) {
    const axis = (v) => F.eur(Number(v), Math.abs(Number(v)) < 10 ? 2 : 0);
    let ticks = new Map();
    return {
      locale: 'en-GB',
      scales: {
        x: {
          grid: { display: false },
          border: { display: true },
          ticks: {
            autoSkip: !monthly,
            maxRotation: 0,
            callback(value, index) {
              if (!monthly) return this.getLabelForValue(value);
              if (index === 0) {
                // Same positions as the Finnish ticks, English month names.
                const labels = this.chart.data.labels;
                ticks = new Map([...monthTicks(labels, this.chart.width)].map(([i, text]) => [i, /^\d{4}$/.test(text) ? text : text.includes(' ') ? F.periodShort(labels[i]) : F.periodShort(labels[i]).split(' ')[0]]));
              }
              return ticks.get(index) ?? null;
            },
          },
        },
        y: { beginAtZero: false, border: { display: false }, ticks: { maxTicksLimit: 7, callback: axis } },
      },
      plugins: {
        legend: { display: false },
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
              return isMonth(l) ? F.period(l) : l;
            },
            label: (item) => `${item.dataset.label}: ${F.eur(item.raw)}`,
          },
        },
        annotation: { annotations: {} },
        lastValue: { enabled: true, format: (v) => F.eur(v, v >= 1000 ? 0 : 2), color: () => '' },
      },
    };
  }

  // Restore from the URL, then calculate once (no GA event for page loads).
  const amountParam = getParam(P.amount);
  if (amountParam != null && parseDecimal(amountParam, lang) != null) $('summa').value = amountParam;
  if (getParam(P.currency, ['eur', 'mk'])) $('valuutta').value = getParam(P.currency, ['eur', 'mk']);
  setPeriod('alku', getParam(P.from));
  setPeriod('loppu', getParam(P.to));
  calculate();
  wire(form, calculate);

  for (const b of form.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => {
      if (setPeriod('alku', b.getAttribute('data-preset'))) {
        $('valuutta').value = periodYear(b.getAttribute('data-preset')) < EURO_CASH_YEAR ? $('valuutta').value : 'eur';
        calculate({ user: true });
      }
    });
  }

  if (box) {
    onVisible(box.parentElement ?? box, () => {
      visible = true;
      buildChart();
    });
  }
  document.querySelector('[data-chart-download="raha-kaavio"]')?.addEventListener('click', () => {
    if (chart) downloadPng(chart, `rahan-arvo-${readPeriod('alku')}-${readPeriod('loppu')}.png`, { title: lastTitle, source: data.chart?.source ?? '' });
  });
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}

/* -------------------------------------------------------------- savings */

const savings = readDataIsland('saasto-data');
if (savings && data) initSavings(savings, data);

/**
 * Historical and forecast savings calculators (Finnish page only).
 * @param {any} s island { defaults, messages }
 * @param {any} money the value-of-money island (series)
 */
function initSavings(s, money) {
  const M = s.messages;
  const D = s.defaults;
  // Server-rendered values are the defaults (left out of the URL).
  const initial = (id) => $(id)?.value?.trim() ?? '';
  const defaultsH = { hsumma: initial('h-summa'), halku: D.hFrom, hloppu: D.hTo, hkorko: initial('h-korko') };
  const defaultsE = { esumma: initial('e-summa'), evuodet: initial('e-vuodet'), ekorko: initial('e-korko'), einfl: initial('e-inflaatio') };
  let trackedH = false;
  let trackedE = false;
  const pct = (id, { min = -50, max = 50 } = {}) => {
    const raw = $(id).value.trim();
    const v = raw === '' ? 0 : parseDecimal(raw);
    return v == null || v < min || v > max ? null : v;
  };

  const histForm = $('saasto-historia');
  const histPanel = $('saasto-historia-tulos');
  function history({ user = false } = {}) {
    const amount = parseDecimal($('h-summa').value);
    const from = readPeriod('h-alku');
    const to = readPeriod('h-loppu');
    const rate = pct('h-korko', { min: -10, max: 50 });
    const errors = {};
    if (amount == null || amount <= 0 || amount > 1e12) errors['h-summa'] = M.amount;
    if (rate == null) errors['h-korko'] = M.rate;
    if (from > money.latestMonth) errors['h-alku'] = fill(M.future, { aika: formatter('fi').period(from), viimeisin: formatter('fi').period(money.latestMonth), vuosi: money.latestYear });
    if (to > money.latestMonth) errors['h-loppu'] = fill(M.future, { aika: formatter('fi').period(to), viimeisin: formatter('fi').period(money.latestMonth), vuosi: money.latestYear });
    if (!errors['h-alku'] && !errors['h-loppu'] && ymDiff(from, to) <= 0) errors['h-loppu'] = M.order;
    let pick = null;
    if (!errors['h-alku'] && !errors['h-loppu']) {
      pick = pickMoneySeries(money.series, from, to);
      if ('error' in pick || pick.annualFallback) errors['h-alku'] = M.beforeMonthly;
    }
    setError('h-summa', errors['h-summa'], ['h-summa']);
    setError('h-korko', errors['h-korko'], ['h-korko']);
    setError('h-alku', errors['h-alku'], ['h-alku-kk', 'h-alku-v']);
    setError('h-loppu', errors['h-loppu'], ['h-loppu-kk', 'h-loppu-v']);
    const failed = Object.keys(errors).length > 0;
    showResult(histPanel, !failed);
    if (failed) return;
    const r = savingsReal({ amount, nominalRate: rate, months: ymDiff(from, to), fromIdx: pick.fromIdx, toIdx: pick.toIdx });
    if ('error' in r) {
      showResult(histPanel, false);
      return;
    }
    render(histPanel, savingsView(r, { kind: 'history', from, to }), ['realReturn']);
    setParams(
      { hsumma: $('h-summa').value.trim(), halku: from, hloppu: to, hkorko: $('h-korko').value.trim() },
      { defaults: defaultsH },
    );
    if (user && !trackedH) {
      trackedH = true;
      track('calculator_used', { laskuri: 'saastot_historia' });
    }
  }

  const fcForm = $('saasto-ennuste');
  const fcPanel = $('saasto-ennuste-tulos');
  function forecast({ user = false } = {}) {
    const amount = parseDecimal($('e-summa').value);
    const years = parseDecimal($('e-vuodet').value);
    const rate = pct('e-korko', { min: -10, max: 50 });
    const infl = pct('e-inflaatio', { min: -10, max: 30 });
    const errors = {};
    if (amount == null || amount <= 0 || amount > 1e12) errors['e-summa'] = M.amount;
    if (years == null || years < 1 || years > 50) errors['e-vuodet'] = M.years;
    if (rate == null) errors['e-korko'] = M.rate;
    if (infl == null) errors['e-inflaatio'] = M.inflation;
    for (const id of ['e-summa', 'e-vuodet', 'e-korko', 'e-inflaatio']) setError(id, errors[id], [id]);
    const failed = Object.keys(errors).length > 0;
    showResult(fcPanel, !failed);
    if (failed) return;
    const r = savingsReal({ amount, nominalRate: rate, months: Math.round(years * 12), assumedInflation: infl });
    if ('error' in r) {
      showResult(fcPanel, false);
      return;
    }
    render(fcPanel, savingsView(r, { kind: 'forecast' }), ['realReturn']);
    setParams(
      { esumma: $('e-summa').value.trim(), evuodet: $('e-vuodet').value.trim(), ekorko: $('e-korko').value.trim(), einfl: $('e-inflaatio').value.trim() },
      { defaults: defaultsE },
    );
    if (user && !trackedE) {
      trackedE = true;
      track('calculator_used', { laskuri: 'saastot_ennuste' });
    }
  }

  // Restore from the URL.
  const restore = (param, id) => {
    const v = getParam(param);
    if (v != null && parseDecimal(v) != null) $(id).value = v;
  };
  restore('hsumma', 'h-summa');
  restore('hkorko', 'h-korko');
  setPeriod('h-alku', getParam('halku'));
  setPeriod('h-loppu', getParam('hloppu'));
  restore('esumma', 'e-summa');
  restore('evuodet', 'e-vuodet');
  restore('ekorko', 'e-korko');
  restore('einfl', 'e-inflaatio');
  if (histForm) {
    history();
    wire(histForm, history);
  }
  if (fcForm) {
    forecast();
    wire(fcForm, forecast);
  }
}
