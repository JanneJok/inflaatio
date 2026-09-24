/**
 * Value of money (/rahanarvo/ and /en/value-of-money/) + the savings
 * calculators of /rahanarvo/#saastot and /en/value-of-money/#savings.
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
import { byId as $, fill, messages, setError, readPeriod, setPeriod, render, showResult, wireRecalc } from '../lib/calc-form.js';
import { createChart, lineDataset, downloadPng } from '../charts/setup.js';

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
  const msg = messages(form);
  const panel = $('raha-tulos');
  const figure = $('raha-kaavio');
  const indexSelect = $('indeksi');
  let tracked = false;
  let lastPath = null;
  let lastTitle = '';
  let lastIndex = 'khi';

  /** 'khi' (the KHI chain, default) or 'ykhi' (Eurostat HICP, months only). */
  const readIndex = () => (indexSelect?.value === 'ykhi' && data.ykhi ? 'ykhi' : 'khi');

  function calculate({ user = false } = {}) {
    const amountRaw = $('summa').value;
    const amount = parseDecimal(amountRaw, lang);
    const currency = $('valuutta').value === 'mk' ? 'mk' : 'eur';
    const index = readIndex();
    const from = readPeriod('alku');
    const to = readPeriod('loppu');
    const errors = {};
    if (amount == null || amount < 0 || amount > 1e12) errors.summa = msg('amount');
    if (currency === 'mk' && periodYear(from) >= EURO_CASH_YEAR) errors.valuutta = msg('markka');

    const periodError = (p) => {
      if (index === 'ykhi') {
        if (isYear(p)) return msg('ykhiYear');
        if (p > data.ykhi.latest) return msg('futureYkhi', { aika: F.period(p), viimeisin: F.period(data.ykhi.latest) });
        if (p < data.ykhi.start) return msg('beforeYkhi');
        return null;
      }
      const future = isMonth(p) ? p > data.latestMonth : p > data.latestYear;
      return future ? msg('future', { aika: F.period(p), viimeisin: F.period(data.latestMonth), vuosi: data.latestYear }) : null;
    };
    const fromError = periodError(from);
    const toError = periodError(to);
    if (fromError) errors.alku = fromError;
    if (toError) errors.loppu = toError;
    let pick = null;
    if (!errors.alku && !errors.loppu) {
      pick = pickMoneySeries(list, from, to, { families: data.families[index] });
      if ('error' in pick) {
        const key = periodYear(from) <= periodYear(to) ? 'alku' : 'loppu';
        const p = key === 'alku' ? from : to;
        errors[key] = {
          future: periodError(p) ?? msg('future', { aika: F.period(p), viimeisin: F.period(data.latestMonth), vuosi: data.latestYear }),
          annual: msg('ykhiYear'),
        }[pick.error] ?? (index === 'ykhi' ? msg('beforeYkhi') : msg('before', { alku: String(data.firstYear) }));
      }
    }
    setError('summa', errors.summa);
    setError('valuutta', errors.valuutta);
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
    lastIndex = index;
    lastTitle = `${lang === 'en' ? 'Value of' : 'Rahan arvo:'} ${currency === 'mk' ? F.markka(amount) : F.eur(amount)} ${F.periodIn(pick.from)}`;
    updateChart(path, summary);

    setParams(
      { [P.amount]: amountRaw.trim(), [P.currency]: currency, [P.index]: index, [P.from]: from, [P.to]: to },
      { defaults: { [P.amount]: String(data.defaults.amount), [P.currency]: 'eur', [P.index]: 'khi', [P.from]: data.defaults.from, [P.to]: data.defaults.to } },
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
        locale: lang,
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

  // Restore from the URL, then calculate once (no GA event for page loads).
  const amountParam = getParam(P.amount);
  if (amountParam != null && parseDecimal(amountParam, lang) != null) $('summa').value = amountParam;
  if (getParam(P.currency, ['eur', 'mk'])) $('valuutta').value = getParam(P.currency, ['eur', 'mk']);
  if (indexSelect && data.ykhi && getParam(P.index, ['khi', 'ykhi'])) indexSelect.value = getParam(P.index, ['khi', 'ykhi']);
  setPeriod('alku', getParam(P.from));
  setPeriod('loppu', getParam(P.to));
  calculate();
  wireRecalc(form, calculate);

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
    const source = lastIndex === 'ykhi' ? data.chart?.sourceYkhi : data.chart?.source;
    if (chart) downloadPng(chart, `rahan-arvo-${readPeriod('alku')}-${readPeriod('loppu')}.png`, { title: lastTitle, source: source ?? '' });
  });
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}

/* -------------------------------------------------------------- savings */

const savings = readDataIsland('saasto-data');
if (savings && data) initSavings(savings, data);

/**
 * Historical and forecast savings calculators (Finnish and English page).
 * @param {any} s island { lang, params, defaults, messages }
 * @param {any} money the value-of-money island (series)
 */
function initSavings(s, money) {
  const lang = s.lang === 'en' ? 'en' : 'fi';
  const F = formatter(lang);
  const M = s.messages;
  const D = s.defaults;
  const P = s.params;
  // Server-rendered values are the defaults (left out of the URL).
  const initial = (id) => $(id)?.value?.trim() ?? '';
  const defaultsH = { [P.hAmount]: initial('h-summa'), [P.hFrom]: D.hFrom, [P.hTo]: D.hTo, [P.hRate]: initial('h-korko') };
  const defaultsE = { [P.eAmount]: initial('e-summa'), [P.eYears]: initial('e-vuodet'), [P.eRate]: initial('e-korko'), [P.eInflation]: initial('e-inflaatio') };
  let trackedH = false;
  let trackedE = false;
  const num = (id) => parseDecimal($(id).value, lang);
  const pct = (id, { min = -50, max = 50 } = {}) => {
    const raw = $(id).value.trim();
    const v = raw === '' ? 0 : parseDecimal(raw, lang);
    return v == null || v < min || v > max ? null : v;
  };
  const futureText = (p) => fill(M.future, { aika: F.period(p), viimeisin: F.period(money.latestMonth), vuosi: money.latestYear });

  const histForm = $('saasto-historia');
  const histPanel = $('saasto-historia-tulos');
  function history({ user = false } = {}) {
    const amount = num('h-summa');
    const from = readPeriod('h-alku');
    const to = readPeriod('h-loppu');
    const rate = pct('h-korko', { min: -10, max: 50 });
    const errors = {};
    if (amount == null || amount <= 0 || amount > 1e12) errors['h-summa'] = M.amount;
    if (rate == null) errors['h-korko'] = M.rate;
    if (!isMonth(from)) errors['h-alku'] = M.beforeMonthly;
    else if (from > money.latestMonth) errors['h-alku'] = futureText(from);
    if (!isMonth(to)) errors['h-loppu'] = M.beforeMonthly;
    else if (to > money.latestMonth) errors['h-loppu'] = futureText(to);
    if (!errors['h-alku'] && !errors['h-loppu'] && ymDiff(from, to) <= 0) errors['h-loppu'] = M.order;
    let pick = null;
    if (!errors['h-alku'] && !errors['h-loppu']) {
      pick = pickMoneySeries(money.series, from, to);
      if ('error' in pick || pick.annualFallback) errors['h-alku'] = M.beforeMonthly;
    }
    setError('h-summa', errors['h-summa']);
    setError('h-korko', errors['h-korko']);
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
    render(histPanel, savingsView(r, { kind: 'history', from, to, lang }), ['realReturn']);
    setParams(
      { [P.hAmount]: $('h-summa').value.trim(), [P.hFrom]: from, [P.hTo]: to, [P.hRate]: $('h-korko').value.trim() },
      { defaults: defaultsH },
    );
    if (user && !trackedH) {
      trackedH = true;
      track('calculator_used', { laskuri: 'saastot_historia', kieli: lang });
    }
  }

  const fcForm = $('saasto-ennuste');
  const fcPanel = $('saasto-ennuste-tulos');
  function forecast({ user = false } = {}) {
    const amount = num('e-summa');
    const years = num('e-vuodet');
    const rate = pct('e-korko', { min: -10, max: 50 });
    const infl = pct('e-inflaatio', { min: -10, max: 30 });
    const errors = {};
    if (amount == null || amount <= 0 || amount > 1e12) errors['e-summa'] = M.amount;
    if (years == null || years < 1 || years > 50) errors['e-vuodet'] = M.years;
    if (rate == null) errors['e-korko'] = M.rate;
    if (infl == null) errors['e-inflaatio'] = M.inflation;
    for (const id of ['e-summa', 'e-vuodet', 'e-korko', 'e-inflaatio']) setError(id, errors[id]);
    const failed = Object.keys(errors).length > 0;
    showResult(fcPanel, !failed);
    if (failed) return;
    const r = savingsReal({ amount, nominalRate: rate, months: Math.round(years * 12), assumedInflation: infl });
    if ('error' in r) {
      showResult(fcPanel, false);
      return;
    }
    render(fcPanel, savingsView(r, { kind: 'forecast', lang }), ['realReturn']);
    setParams(
      { [P.eAmount]: $('e-summa').value.trim(), [P.eYears]: $('e-vuodet').value.trim(), [P.eRate]: $('e-korko').value.trim(), [P.eInflation]: $('e-inflaatio').value.trim() },
      { defaults: defaultsE },
    );
    if (user && !trackedE) {
      trackedE = true;
      track('calculator_used', { laskuri: 'saastot_ennuste', kieli: lang });
    }
  }

  // Restore from the URL.
  const restore = (param, id) => {
    const v = getParam(param);
    if (v != null && parseDecimal(v, lang) != null) $(id).value = v;
  };
  restore(P.hAmount, 'h-summa');
  restore(P.hRate, 'h-korko');
  setPeriod('h-alku', getParam(P.hFrom));
  setPeriod('h-loppu', getParam(P.hTo));
  restore(P.eAmount, 'e-summa');
  restore(P.eYears, 'e-vuodet');
  restore(P.eRate, 'e-korko');
  restore(P.eInflation, 'e-inflaatio');
  if (histForm) {
    history();
    wireRecalc(histForm, history);
  }
  if (fcForm) {
    forecast();
    wireRecalc(fcForm, forecast);
  }
}
