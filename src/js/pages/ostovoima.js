/**
 * "Riittääkö palkankorotuksesi?" (/ostovoima/): recalculates the real change
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
import { byId as $, messages, setError, readPeriod, setPeriod, render, showResult, wireRecalc } from '../lib/calc-form.js';

const data = readDataIsland('palkka-data');
const form = /** @type {HTMLFormElement|null} */ (document.getElementById('palkka-lomake'));
if (data && form) init(data, form);

/**
 * @param {any} data island { latestMonth, firstMonth, defaults, series }
 * @param {HTMLFormElement} form
 */
function init(data, form) {
  const F = formatter('fi');
  const msg = messages(form);
  const panel = $('palkka-tulos');
  const D = data.defaults;
  let tracked = false;

  function calculate({ user = false } = {}) {
    const beforeRaw = $('palkka-ennen').value.trim();
    const afterRaw = $('palkka-nyt').value.trim();
    const before = parseDecimal(beforeRaw);
    const after = parseDecimal(afterRaw);
    const from = readPeriod('palkka-alku');
    const to = readPeriod('palkka-loppu');
    const errors = {};
    if (before == null || before <= 0 || before > 1e7) errors['palkka-ennen'] = msg('salary');
    if (after == null || after <= 0 || after > 1e7) errors['palkka-nyt'] = msg('salary');
    const future = (ym) => msg('future', { kuukausi: F.period(ym), viimeisin: F.period(data.latestMonth) });
    if (!isMonth(from)) errors['palkka-alku'] = msg('before', { alku: F.period(data.firstMonth) });
    else if (from > data.latestMonth) errors['palkka-alku'] = future(from);
    if (!isMonth(to)) errors['palkka-loppu'] = msg('order');
    else if (to > data.latestMonth) errors['palkka-loppu'] = future(to);
    if (data.firstMonth && from < data.firstMonth) errors['palkka-alku'] = msg('before', { alku: F.period(data.firstMonth) });
    if (!errors['palkka-alku'] && !errors['palkka-loppu'] && ymDiff(from, to) <= 0) errors['palkka-loppu'] = msg('order');
    let pick = null;
    if (!errors['palkka-alku'] && !errors['palkka-loppu']) {
      pick = pickMoneySeries(data.series, from, to);
      if ('error' in pick) errors['palkka-alku'] = msg('before', { alku: F.period(data.firstMonth) });
    }
    setError('palkka-ennen', errors['palkka-ennen']);
    setError('palkka-nyt', errors['palkka-nyt']);
    setError('palkka-alku', errors['palkka-alku'], ['palkka-alku-kk', 'palkka-alku-v']);
    setError('palkka-loppu', errors['palkka-loppu'], ['palkka-loppu-kk', 'palkka-loppu-v']);
    const failed = Object.keys(errors).length > 0;
    showResult(panel, !failed);
    if (failed) return;

    const r = realWageChange({ before, after, cpiFrom: pick.fromIdx, cpiTo: pick.toIdx });
    if ('error' in r) return;
    render(panel, wageView(r, { before, after, from, to }));
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
  if (isMonth(getParam('alku'))) setPeriod('palkka-alku', getParam('alku'));
  if (isMonth(getParam('loppu'))) setPeriod('palkka-loppu', getParam('loppu'));
  calculate();
  wireRecalc(form, calculate);
}
