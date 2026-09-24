/**
 * Personal inflation calculator (/oma-inflaatio/).
 *
 * Two input modes (segmented control "oi-tapa"): shares with range sliders
 * (defaults = official KHI weights) or monthly spending in euros. Every
 * change recalculates with lib/calc.js (personalInflation,
 * inflationDifference), updates the result (aria-live), the list of groups
 * that explain the difference to the average basket and the URL
 * (?osuudet=… or ?tapa=eur&eurot=…, ?profiili=…). One GA event per page view
 * after the first user change (only with consent).
 */
import { readDataIsland, el } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { setSegmented, getSegmented } from '../lib/segmented.js';
import { track } from '../lib/analytics.js';
import { personalInflation, inflationDifference, parseDecimal } from '../lib/calc.js';
import { pct, pp, eur, capitalize } from '../lib/format.js';

const data = readDataIsland('oma-data');
const form = /** @type {HTMLFormElement|null} */ (document.getElementById('oi-lomake'));
if (data && form) init(data, form);

/**
 * @param {any} data island { month, official, groups, profiles }
 * @param {HTMLFormElement} form
 */
function init(data, form) {
  const $ = (id) => /** @type {any} */ (document.getElementById(id));
  const msg = (key, vars = {}) =>
    Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), form.dataset[`msg${key.charAt(0).toUpperCase()}${key.slice(1)}`] ?? '');
  const groups = data.groups;
  const codes = groups.map((g) => g.code);
  const nameOf = new Map(groups.map((g) => [g.code, g.name]));
  const officialWeights = Object.fromEntries(groups.map((g) => [g.code, g.weight ?? 0]));
  const rates = Object.fromEntries(groups.map((g) => [g.code, g.yoy]));
  const sumW = codes.reduce((s, c) => s + officialWeights[c], 0);
  const baseShares = Object.fromEntries(codes.map((c) => [c, (officialWeights[c] / sumW) * 100]));
  const modeGroup = form.querySelector('[data-segmented="oi-tapa"]');
  const panel = $('oi-tulos');
  let tracked = false;
  let timer = 0;

  const range = (code) => $(`oi-${code}`);
  const euroInput = (code) => $(`oi-${code}-eur`);
  const mode = () => (getSegmented(modeGroup) === 'eur' ? 'eur' : 'osuus');

  function showMode(m) {
    for (const node of form.querySelectorAll('[data-mode]')) node.hidden = node.getAttribute('data-mode') !== m;
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
    for (const b of form.querySelectorAll('[data-profile]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-profile') === id));
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
    for (const c of codes) {
      const errEl = $(`oi-${c}-eur-virhe`);
      if (errEl) errEl.textContent = m === 'eur' ? (errors[c] ?? '') : '';
      euroInput(c)?.setAttribute('aria-invalid', m === 'eur' && errors[c] ? 'true' : 'false');
    }
    const sumEl = $('oi-summa');
    if (sumEl) sumEl.textContent = m === 'eur' ? msg('sumEuros', { summa: eur(total, 0) }) : msg('sumShares', { summa: pct(total) });
    const empty = !(total > 0);
    $('oi-virhe').textContent = empty ? msg('empty') : '';
    const failed = empty || Object.keys(errors).length > 0;
    panel.querySelector('[data-result-ok]').hidden = failed;
    panel.querySelector('[data-result-error]').hidden = !failed;
    if (failed) return;

    const own = personalInflation({ weights, rates });
    const diff = inflationDifference({ weights, baseWeights: officialWeights, rates });
    const top = [...own.parts].sort((a, b) => b.contribution - a.contribution)[0];
    const out = {
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
    };
    for (const node of panel.querySelectorAll('[data-out]')) {
      const key = node.getAttribute('data-out');
      if (key in out) node.textContent = out[key];
    }

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

  const schedule = (e) => {
    const t = e?.target;
    if (t instanceof HTMLInputElement && t.type === 'range') {
      updateOutput(t.id.slice(3));
      for (const b of form.querySelectorAll('[data-profile]')) b.setAttribute('aria-pressed', 'false');
    }
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
    showMode('osuus');
    applyProfile('keskiarvo');
    for (const c of codes) euroInput(c).value = '';
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
  } else if (shares && shares.length === codes.length && shares.every((v) => Number.isFinite(v) && v >= 0)) {
    codes.forEach((c, i) => setShare(c, shares[i]));
    for (const b of form.querySelectorAll('[data-profile]')) b.setAttribute('aria-pressed', 'false');
  } else if (getParam('profiili')) {
    applyProfile(getParam('profiili'));
  }
  for (const c of codes) updateOutput(c);
  showMode(mode());
  calculate();
  const profile = getParam('profiili');
  if (profile && profile !== 'keskiarvo' && data.profiles.some((p) => p.id === profile)) setParams({ profiili: profile });
}
