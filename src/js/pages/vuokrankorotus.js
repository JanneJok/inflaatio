/**
 * Rent increase calculator (/vuokrankorotus/ and /en/rent-increase-calculator/).
 *
 * The page is complete without JS (server-rendered default result, formula
 * and point-figure table). This script recalculates on every input with the
 * same isomorphic functions the build used (lib/calc.js), shows field errors
 * as text (aria-invalid + #<id>-virhe), keeps the inputs in the URL for
 * sharing and sends one GA event per page view (only with consent).
 */
import { readDataIsland } from '../lib/dom.js';
import { getParam, setParams } from '../lib/url-state.js';
import { track } from '../lib/analytics.js';
import { rentIncrease, rentView, pointAt, latestPeriod, parseDecimal, formatter, isMonth, ROUNDING } from '../lib/calc.js';

const data = readDataIsland('vuokra-data');
const form = /** @type {HTMLFormElement|null} */ (document.getElementById('vuokra-lomake'));

if (data && form) init(data, form);

/**
 * @param {any} data island { lang, params, defaults, series }
 * @param {HTMLFormElement} form
 */
function init(data, form) {
  const lang = data.lang === 'en' ? 'en' : 'fi';
  const F = formatter(lang);
  const P = data.params;
  const msg = (key, vars = {}) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), form.dataset[`msg${key.charAt(0).toUpperCase()}${key.slice(1)}`] ?? '');
  const $ = (id) => /** @type {any} */ (document.getElementById(id));
  const panel = document.getElementById('vuokra-tulos');
  const ok = panel?.querySelector('[data-result-ok]');
  const errBox = panel?.querySelector('[data-result-error]');
  const seriesById = new Map(data.series.map((s) => [s.id, { ...s, kind: 'month' }]));
  let tracked = false;
  let timer = 0;

  const readMonth = (id) => `${$(`${id}-v`).value}-${$(`${id}-kk`).value}`;
  const setMonth = (id, ym) => {
    if (!isMonth(ym)) return;
    const [y, m] = ym.split('-');
    const ySel = $(`${id}-v`);
    if (Array.from(ySel.options).some((o) => o.value === y)) {
      ySel.value = y;
      $(`${id}-kk`).value = m;
    }
  };

  /** Show or clear a field error. `ids` = controls that get aria-invalid. */
  const setError = (errorId, text, ids) => {
    const p = $(`${errorId}-virhe`);
    if (p) p.textContent = text ?? '';
    for (const id of ids) $(id)?.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  const optionalPct = (id) => {
    const raw = $(id).value.trim();
    if (!raw) return { value: null, error: null };
    const v = parseDecimal(raw, lang);
    return v == null || Math.abs(v) > 100 ? { value: null, error: msg('percent') } : { value: v, error: null };
  };

  const monthError = (s, ym) => {
    const last = latestPeriod(s);
    if (ym > last) return msg('future', { kuukausi: F.period(ym), viimeisin: F.period(last) });
    if (ym < s.start) return msg('before', { sarja: s.name, alku: F.period(s.start) });
    return msg('missing', { kuukausi: F.period(ym) });
  };

  function updateSeriesInfo(s) {
    const el = form.querySelector('[data-out="seriesInfo"]');
    const last = latestPeriod(s);
    if (el) {
      el.textContent = msg('seriesInfo', {
        alku: F.periodNumeric(s.start),
        loppu: F.periodNumeric(last),
        arvo: F.idx(pointAt(s, last), s.decimals),
        kuukausi: F.period(last),
      });
    }
  }

  function readForm() {
    const s = seriesById.get($('sarja').value) ?? seriesById.get(data.defaults.series);
    const rentRaw = $('vuokra').value;
    const rent = parseDecimal(rentRaw, lang);
    const base = readMonth('perus');
    const check = readMonth('tarkistus');
    const min = optionalPct('vahintaan');
    const max = optionalPct('enintaan');
    const extra = optionalPct('lisa');
    const rounding = ROUNDING.includes($('pyoristys').value) ? $('pyoristys').value : 'cent';
    const noDecrease = Boolean($('eilaske').checked);
    return { s, rentRaw, rent, base, check, min, max, extra, rounding, noDecrease };
  }

  function calculate({ user = false } = {}) {
    const f = readForm();
    updateSeriesInfo(f.s);
    const errors = {};
    if (f.rent == null || f.rent <= 0 || f.rent > 1e7) errors.vuokra = msg('rent');
    const baseIdx = pointAt(f.s, f.base);
    const checkIdx = pointAt(f.s, f.check);
    if (baseIdx == null) errors.perus = monthError(f.s, f.base);
    if (checkIdx == null) errors.tarkistus = monthError(f.s, f.check);
    if (f.min.error) errors.vahintaan = f.min.error;
    if (f.max.error) errors.enintaan = f.max.error;
    if (f.extra.error) errors.lisa = f.extra.error;
    if (!errors.vahintaan && !errors.enintaan && f.min.value != null && f.max.value != null && f.min.value > f.max.value) errors.enintaan = msg('minMax');

    setError('vuokra', errors.vuokra, ['vuokra']);
    setError('perus', errors.perus, ['perus-kk', 'perus-v']);
    setError('tarkistus', errors.tarkistus, ['tarkistus-kk', 'tarkistus-v']);
    setError('vahintaan', errors.vahintaan, ['vahintaan']);
    setError('enintaan', errors.enintaan, ['enintaan']);
    setError('lisa', errors.lisa, ['lisa']);
    // Open the terms section when one of its fields has an error.
    if (errors.vahintaan || errors.enintaan || errors.lisa) form.querySelector('.calc__more')?.setAttribute('open', '');

    const failed = Object.keys(errors).length > 0;
    if (ok) ok.hidden = failed;
    if (errBox) errBox.hidden = !failed;
    if (failed) return;

    const r = rentIncrease({
      rent: f.rent,
      baseIndex: baseIdx,
      checkIndex: checkIdx,
      rounding: f.rounding,
      minPct: f.min.value,
      maxPct: f.max.value,
      extraPct: f.extra.value,
      noDecrease: f.noDecrease,
    });
    if ('error' in r) {
      if (ok) ok.hidden = true;
      if (errBox) errBox.hidden = false;
      return;
    }
    const view = rentView(r, { series: f.s, base: f.base, check: f.check, lang });
    for (const el of panel?.querySelectorAll('[data-out]') ?? []) {
      const key = el.getAttribute('data-out');
      if (key && key in view) {
        el.textContent = view[key];
        if (key === 'rule') el.hidden = !view.rule;
      }
    }

    setParams(
      {
        [P.rent]: f.rentRaw.trim(),
        [P.series]: f.s.id,
        [P.base]: f.base,
        [P.check]: f.check,
        [P.min]: f.min.value ?? '',
        [P.max]: f.max.value ?? '',
        [P.extra]: f.extra.value ?? '',
        [P.noDecrease]: f.noDecrease ? '1' : '',
        [P.rounding]: f.rounding,
      },
      {
        defaults: {
          [P.rent]: String(data.defaults.rent),
          [P.series]: data.defaults.series,
          [P.base]: data.defaults.base,
          [P.check]: data.defaults.check,
          [P.rounding]: data.defaults.rounding,
        },
      },
    );
    if (user && !tracked) {
      tracked = true;
      track('calculator_used', { laskuri: 'vuokrankorotus', sarja: f.s.id, kieli: lang });
    }
  }

  // Restore a shared calculation from the URL (invalid values are ignored).
  const p = (name) => getParam(name);
  if (p(P.rent) != null && parseDecimal(p(P.rent), lang) != null) $('vuokra').value = p(P.rent);
  if (seriesById.has(p(P.series))) $('sarja').value = p(P.series);
  setMonth('perus', p(P.base));
  setMonth('tarkistus', p(P.check));
  for (const [param, id] of [[P.min, 'vahintaan'], [P.max, 'enintaan'], [P.extra, 'lisa']]) {
    const n = parseDecimal(p(param) ?? '');
    if (n != null) {
      // Show the number in the page's format with the decimals it has (max 2).
      const decimals = Number.isInteger(n) ? 0 : Math.min(2, String(n).split('.')[1]?.length ?? 2);
      $(id).value = F.num(n, decimals);
      form.querySelector('.calc__more')?.setAttribute('open', '');
    }
  }
  if (p(P.noDecrease) === '1') $('eilaske').checked = true;
  if (ROUNDING.includes(p(P.rounding) ?? '')) $('pyoristys').value = p(P.rounding);
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
    document.getElementById('vuokra-tulos-otsikko')?.scrollIntoView({ block: 'nearest' });
  });
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}
