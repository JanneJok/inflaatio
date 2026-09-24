/**
 * Personal inflation calculator (/oma-inflaatio/).
 *
 * Two input modes (segmented control "oi-tapa"): shares with range sliders
 * (defaults = official KHI weights) or monthly spending in euros. Every
 * change recalculates with lib/calc.js (personalInflation,
 * inflationDifference, personalHistory), updates the result (aria-live), the
 * list of groups that explain the difference to the average basket, the
 * 5-year chart (Chart.js when it comes near the viewport, SVG before that)
 * with its table and summary, and the URL (?osuudet=… or ?tapa=eur&eurot=…,
 * ?profiili=…). One GA event per page view after the first user change
 * (only with consent).
 *
 * Euro mode starts empty: until the visitor has typed a euro amount the
 * result panel shows a neutral hint instead of an error.
 */
import { readDataIsland, el, onVisible } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { setSegmented, getSegmented } from '../lib/segmented.js';
import { track } from '../lib/analytics.js';
import { personalInflation, inflationDifference, personalHistory, parseDecimal } from '../lib/calc.js';
import * as fmt from '../lib/format.js';
import { byId as $, messages, render, showResult } from '../lib/calc-form.js';
import { createChart, lineDataset, downloadPng } from '../charts/setup.js';

const { pct, pp, eur, capitalize } = fmt;

const data = readDataIsland('oma-data');
const form = /** @type {HTMLFormElement|null} */ (document.getElementById('oi-lomake'));
if (data && form) init(data, form);

/**
 * @param {any} data island { month, official, groups, profiles, history }
 * @param {HTMLFormElement} form
 */
function init(data, form) {
  const msg = messages(form);
  const groups = data.groups;
  const codes = groups.map((g) => g.code);
  const nameOf = new Map(groups.map((g) => [g.code, g.name]));
  const officialWeights = Object.fromEntries(groups.map((g) => [g.code, g.weight ?? 0]));
  const rates = Object.fromEntries(groups.map((g) => [g.code, g.yoy]));
  const sumW = codes.reduce((s, c) => s + officialWeights[c], 0);
  const baseShares = Object.fromEntries(codes.map((c) => [c, (officialWeights[c] / sumW) * 100]));
  const modeGroup = form.querySelector('[data-segmented="oi-tapa"]');
  const panel = $('oi-tulos');
  const history = data.history;
  let tracked = false;
  let timer = 0;
  let activeProfile = 'keskiarvo';
  let euroTouched = false;

  const range = (code) => $(`oi-${code}`);
  const euroInput = (code) => $(`oi-${code}-eur`);
  const mode = () => (getSegmented(modeGroup) === 'eur' ? 'eur' : 'osuus');

  /** Profiles set shares, so no profile is "selected" in euro mode. */
  function markProfile() {
    const id = mode() === 'osuus' ? activeProfile : null;
    for (const b of form.querySelectorAll('[data-profile]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-profile') === id));
  }

  function showMode(m) {
    for (const node of form.querySelectorAll('[data-mode]')) node.hidden = node.getAttribute('data-mode') !== m;
    markProfile();
  }

  function setShare(code, v) {
    const r = range(code);
    if (!r) return;
    r.value = String(Math.max(0, Math.min(Number(r.max) || 60, Math.round(v * 10) / 10)));
    updateOutput(code);
  }

  function updateOutput(code) {
    const r = range(code);
    const text = pct(Number(r.value));
    const o = form.querySelector(`[data-value-for="oi-${code}"]`);
    if (o) o.textContent = text;
    r.setAttribute('aria-valuetext', text);
  }

  function applyProfile(id) {
    const p = data.profiles.find((x) => x.id === id);
    if (!p) return false;
    const w = Object.fromEntries(codes.map((c) => [c, officialWeights[c] * (p.multipliers[c] ?? 1)]));
    const total = codes.reduce((s, c) => s + w[c], 0);
    for (const c of codes) setShare(c, (w[c] / total) * 100);
    activeProfile = id;
    markProfile();
    return true;
  }

  /** Read the weights of the active mode; null values mark input errors. */
  function readWeights() {
    const m = mode();
    const weights = {};
    const errors = {};
    let total = 0;
    for (const c of codes) {
      if (m === 'osuus') {
        const v = Number(range(c).value);
        weights[c] = Number.isFinite(v) && v >= 0 ? v : 0;
      } else {
        const raw = euroInput(c).value.trim();
        const v = raw === '' ? 0 : parseDecimal(raw);
        if (v == null || v < 0 || v > 1e7) {
          errors[c] = msg('euro');
          weights[c] = 0;
        } else weights[c] = v;
      }
      total += weights[c];
    }
    return { m, weights, errors, total };
  }

  function calculate({ user = false } = {}) {
    const { m, weights, errors, total } = readWeights();
    const sumEl = $('oi-summa');
    if (sumEl) sumEl.textContent = m === 'eur' ? msg('sumEuros', { summa: eur(total, 0) }) : msg('sumShares', { summa: pct(total) });
    // Euro mode before any amount: a neutral hint, no error yet.
    const waiting = m === 'eur' && !euroTouched && !(total > 0) && Object.keys(errors).length === 0;
    for (const c of codes) {
      const errEl = $(`oi-${c}-eur-virhe`);
      if (errEl) errEl.textContent = m === 'eur' ? (errors[c] ?? '') : '';
      euroInput(c)?.setAttribute('aria-invalid', m === 'eur' && errors[c] ? 'true' : 'false');
    }
    const empty = !(total > 0);
    $('oi-virhe').textContent = empty && !waiting ? msg('empty') : '';
    if (waiting) {
      showResult(panel, 'hint');
      return;
    }
    const failed = empty || Object.keys(errors).length > 0;
    showResult(panel, !failed);
    if (failed) return;

    const own = personalInflation({ weights, rates });
    const diff = inflationDifference({ weights, baseWeights: officialWeights, rates });
    const top = [...own.parts].sort((a, b) => b.contribution - a.contribution)[0];
    render(panel, {
      rate: pct(own.rate),
      rateFact: pct(own.rate, { decimals: 2 }),
      largest: msg('largest', { ryhma: nameOf.get(top.key).toLowerCase(), vaikutus: pp(top.contribution, { decimals: 2 }) }),
      diff:
        Math.abs(diff.difference) < 0.05
          ? msg('same')
          : msg('diff', {
              ero: pp(Math.abs(diff.difference), { sign: false }),
              suunta: diff.difference > 0 ? msg('bigger') : msg('smaller'),
              oletus: pct(diff.base),
            }),
    });

    // Groups that explain most of the difference (|effect| ≥ 0,05 %-yks.).
    const drivers = diff.drivers.filter((d) => Math.abs(d.effect) >= 0.05).slice(0, 3);
    const box = panel.querySelector('[data-drivers]');
    const list = panel.querySelector('[data-drivers-list]');
    list.replaceChildren(
      ...drivers.map((d) =>
        el(
          'li',
          {},
          msg('driver', {
            ryhma: capitalize(nameOf.get(d.key)),
            vaikutus: pp(d.effect, { decimals: 2 }),
            oma: pct(d.share * 100),
            virallinen: pct(d.baseShare * 100),
            muutos: pct(d.rate, { sign: true }),
          }),
        ),
      ),
    );
    box.hidden = drivers.length === 0;
    updateHistory(weights);

    // URL state: shares (1 decimal) or euros; defaults stay out of the URL.
    const isDefault = m === 'osuus' && codes.every((c) => Math.abs(weights[c] - Math.round(baseShares[c] * 10) / 10) < 0.05);
    setParams({
      tapa: m === 'eur' ? 'eur' : '',
      osuudet: m === 'osuus' && !isDefault ? codes.map((c) => weights[c]).join('_') : '',
      eurot: m === 'eur' ? codes.map((c) => weights[c]).join('_') : '',
      profiili: '',
    });
    if (user && !tracked) {
      tracked = true;
      track('calculator_used', { laskuri: 'oma_inflaatio', tapa: m });
    }
  }

  /* ------------------------------------------------ 5-year chart + table */

  const chartBox = document.querySelector('[data-chart="oi-kehitys"]');
  const chartFallback = chartBox?.parentElement?.querySelector('[data-chart-fallback]');
  const historyFigure = $('oi-kehitys');
  let chart = null;
  let chartVisible = false;
  let chartBuilding = false;
  let chartFailed = false;
  let ownHistory = null;

  function updateHistory(weights) {
    if (!history) return;
    ownHistory = personalHistory({ weights, series: history.series, length: history.months.length });
    const summary = historySummaryText(ownHistory);
    render(historyFigure, { historySummary: summary });
    chartBox?.setAttribute('data-label', summary);
    const tbody = document.querySelector('#oi-kehitys-taulukko tbody');
    if (tbody) {
      const rows = [...tbody.rows];
      // Rows are newest first; keep their data-extra flags (collapsed table).
      rows.forEach((row, r) => {
        const i = history.months.length - 1 - r;
        if (row.cells[1] && i >= 0) row.cells[1].textContent = pct(ownHistory[i]);
      });
    }
    if (chart) {
      chart.canvas?.setAttribute('aria-label', summary);
      chart.setMonths(history.months, [ownHistory, history.official]);
    } else if (chartVisible) buildChart();
  }

  /** Same wording as the server (oma-inflaatio.js historySummary). */
  function historySummaryText(own) {
    const months = history.months;
    const last = months.length - 1;
    let hi = -1;
    let lo = -1;
    own.forEach((v, i) => {
      if (!fmt.isNum(v)) return;
      if (hi < 0 || v > own[hi]) hi = i;
      if (lo < 0 || v < own[lo]) lo = i;
    });
    if (hi < 0) return '';
    return msg('history', {
      kuukausi: fmt.inessive(months[last]),
      oma: pct(own[last]),
      khi: pct(history.official[last]),
      jakso: fmt.monthRange(months[0], months[last]),
      max: pct(own[hi]),
      maxkk: fmt.monthShort(months[hi]),
      min: pct(own[lo]),
      minkk: fmt.monthShort(months[lo]),
    });
  }

  async function buildChart() {
    if (!chartBox || !history || !ownHistory || chartBuilding || chart || chartFailed) return;
    chartBuilding = true;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', chartBox.getAttribute('data-label') ?? '');
    chartBox.replaceChildren(canvas);
    chartBox.hidden = false;
    try {
      chart = await createChart(canvas, {
        months: history.months,
        datasets: [
          lineDataset({ series: 's3', label: 'Oma arvio', data: ownHistory }),
          lineDataset({ series: 'khi', label: 'KHI', data: history.official }),
        ],
        unit: '%',
        decimals: 1,
      });
      if (chartFallback) chartFallback.hidden = true;
      // The weights may have changed while Chart.js was loading.
      chart.setMonths(history.months, [ownHistory, history.official]);
    } catch (err) {
      canvas.remove();
      chartBox.hidden = true;
      chartFailed = true;
      console.error('[inflaatio] chart failed', err);
    } finally {
      chartBuilding = false;
    }
  }

  if (chartBox && history) {
    onVisible(chartBox.parentElement ?? chartBox, () => {
      chartVisible = true;
      buildChart();
    });
  }
  document.querySelector('[data-chart-download="oi-kehitys"]')?.addEventListener('click', () => {
    if (chart) downloadPng(chart, `oma-inflaatio-${data.month}.png`, { title: 'Oma inflaatio ja KHI, vuosimuutos %', source: 'Lähde: Tilastokeskus (15b5), oma arvio · inflaatio.fi' });
  });

  /* ------------------------------------------------------------- events */

  const schedule = (e) => {
    const t = e?.target;
    if (t instanceof HTMLInputElement && t.type === 'range') {
      updateOutput(t.id.slice(3));
      activeProfile = null;
      markProfile();
    }
    if (t instanceof HTMLInputElement && t.id.endsWith('-eur') && e.type === 'input') euroTouched = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => calculate({ user: true }), 150);
  };
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    calculate({ user: true });
  });
  document.addEventListener('segmentedchange', (e) => {
    const d = /** @type {CustomEvent} */ (e).detail;
    if (d?.name !== 'oi-tapa') return;
    showMode(d.value);
    calculate({ user: true });
  });
  for (const b of form.querySelectorAll('[data-profile]')) {
    b.addEventListener('click', () => {
      setSegmented(modeGroup, 'osuus');
      showMode('osuus');
      applyProfile(b.getAttribute('data-profile'));
      calculate({ user: true });
      const id = b.getAttribute('data-profile');
      if (id !== 'keskiarvo') setParams({ profiili: id, osuudet: '' });
    });
  }
  form.querySelector('[data-reset]')?.addEventListener('click', () => {
    setSegmented(modeGroup, 'osuus');
    for (const c of codes) euroInput(c).value = '';
    euroTouched = false;
    showMode('osuus');
    applyProfile('keskiarvo');
    calculate({ user: true });
  });

  // Restore from the URL.
  const list = (s) => (s ? s.split('_').map(Number) : null);
  const shares = list(getParam('osuudet'));
  const euros = list(getParam('eurot'));
  if (getParam('tapa', ['eur']) && euros && euros.length === codes.length && euros.every((v) => Number.isFinite(v) && v >= 0)) {
    setSegmented(modeGroup, 'eur');
    codes.forEach((c, i) => {
      euroInput(c).value = euros[i] ? String(euros[i]).replace('.', ',') : '';
    });
    euroTouched = true;
  } else if (shares && shares.length === codes.length && shares.every((v) => Number.isFinite(v) && v >= 0)) {
    codes.forEach((c, i) => setShare(c, shares[i]));
    activeProfile = null;
  } else if (getParam('profiili')) {
    applyProfile(getParam('profiili'));
  }
  for (const c of codes) updateOutput(c);
  showMode(mode());
  calculate();
  const profile = getParam('profiili');
  if (profile && profile !== 'keskiarvo' && data.profiles.some((p) => p.id === profile)) setParams({ profiili: profile });
}
