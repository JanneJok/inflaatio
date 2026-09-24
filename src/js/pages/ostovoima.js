/**
 * "Riittääkö palkankorotukseni?" (/ostovoima/): recalculates the real change
 * of a pay rise with lib/calc.js (realWageChange, deflated with the official
 * consumer price index), shows field errors as text, keeps the inputs in the
 * URL and sends one GA event per page view (only with consent). The page is
 * complete without JS (server-rendered example, chart and table).
 */
import { readDataIsland } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { track } from '../lib/analytics.js';
import { pickMoneySeries, realWageChange, wageView, parseDecimal, formatter, isMonth } from '../lib/calc.js';
import { ymDiff } from '../lib/format.js';

const data = readDataIsland('palkka-data');
const form = /** @type {HTMLFormElement|null} */ (document.getElementById('palkka-lomake'));
if (data && form) init(data, form);

/**
 * @param {any} data island { latestMonth, firstMonth, defaults, series }
 * @param {HTMLFormElement} form
 */
function init(data, form) {
  const F = formatter('fi');
  const $ = (id) => /** @type {any} */ (document.getElementById(id));
  const msg = (key, vars = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), form.dataset[`msg${key.charAt(0).toUpperCase()}${key.slice(1)}`] ?? '');
  const panel = $('palkka-tulos');
  const D = data.defaults;
  let tracked = false;
  let timer = 0;

  const readMonth = (id) => `${$(`${id}-v`).value}-${$(`${id}-kk`).value}`;
  const setMonth = (id, ym) => {
    if (!isMonth(ym)) return;
    const [y, m] = ym.split('-');
    if (Array.from($(`${id}-v`).options).some((o) => o.value === y)) {
      $(`${id}-v`).value = y;
      $(`${id}-kk`).value = m;
    }
  };
  const setError = (id, text, ids) => {
    const p = $(`${id}-virhe`);
    if (p) p.textContent = text ?? '';
    for (const x of ids) $(x)?.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  function calculate({ user = false } = {}) {
    const beforeRaw = $('palkka-ennen').value.trim();
    const afterRaw = $('palkka-nyt').value.trim();
    const before = parseDecimal(beforeRaw);
    const after = parseDecimal(afterRaw);
    const from = readMonth('palkka-alku');
    const to = readMonth('palkka-loppu');
    const errors = {};
    if (before == null || before <= 0 || before > 1e7) errors['palkka-ennen'] = msg('salary');
    if (after == null || after <= 0 || after > 1e7) errors['palkka-nyt'] = msg('salary');
    const future = (ym) => msg('future', { kuukausi: F.period(ym), viimeisin: F.period(data.latestMonth) });
    if (from > data.latestMonth) errors['palkka-alku'] = future(from);
    if (to > data.latestMonth) errors['palkka-loppu'] = future(to);
    if (data.firstMonth && from < data.firstMonth) errors['palkka-alku'] = msg('before', { alku: F.period(data.firstMonth) });
    if (!errors['palkka-alku'] && !errors['palkka-loppu'] && ymDiff(from, to) <= 0) errors['palkka-loppu'] = msg('order');
    let pick = null;
    if (!errors['palkka-alku'] && !errors['palkka-loppu']) {
      pick = pickMoneySeries(data.series, from, to);
      if ('error' in pick) errors['palkka-alku'] = msg('before', { alku: F.period(data.firstMonth) });
    }
    setError('palkka-ennen', errors['palkka-ennen'], ['palkka-ennen']);
    setError('palkka-nyt', errors['palkka-nyt'], ['palkka-nyt']);
    setError('palkka-alku', errors['palkka-alku'], ['palkka-alku-kk', 'palkka-alku-v']);
    setError('palkka-loppu', errors['palkka-loppu'], ['palkka-loppu-kk', 'palkka-loppu-v']);
    const failed = Object.keys(errors).length > 0;
    panel.querySelector('[data-result-ok]').hidden = failed;
    panel.querySelector('[data-result-error]').hidden = !failed;
    if (failed) return;

    const r = realWageChange({ before, after, cpiFrom: pick.fromIdx, cpiTo: pick.toIdx });
    if ('error' in r) return;
    const view = wageView(r, { before, after, from, to });
    for (const node of panel.querySelectorAll('[data-out]')) {
      const key = node.getAttribute('data-out');
      if (key in view) node.textContent = view[key];
    }
    setParams(
      { ennen: beforeRaw, nyt: afterRaw, alku: from, loppu: to },
      { defaults: { ennen: String(D.before), nyt: String(D.after), alku: D.from, loppu: D.to } },
    );
    if (user && !tracked) {
      tracked = true;
      track('calculator_used', { laskuri: 'ostovoima' });
    }
  }

  for (const [param, id] of [['ennen', 'palkka-ennen'], ['nyt', 'palkka-nyt']]) {
    const v = getParam(param);
    if (v != null && parseDecimal(v) != null) $(id).value = v;
  }
  setMonth('palkka-alku', getParam('alku'));
  setMonth('palkka-loppu', getParam('loppu'));
  calculate();

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => calculate({ user: true }), 250);
  };
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    window.clearTimeout(timer);
    calculate({ user: true });
  });
}
