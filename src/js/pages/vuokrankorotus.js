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
import { byId as $, messages, setError, readPeriod, setPeriod, render, showResult, wireRecalc } from '../lib/calc-form.js';

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
  const msg = messages(form);
  const panel = document.getElementById('vuokra-tulos');
  const seriesById = new Map(data.series.map((s) => [s.id, { ...s, kind: 'month' }]));
  let tracked = false;

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
    const node = form.querySelector('[data-out="seriesInfo"]');
    const last = latestPeriod(s);
    if (node) {
      node.textContent = msg('seriesInfo', {
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
    const base = readPeriod('perus');
    const check = readPeriod('tarkistus');
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

    setError('vuokra', errors.vuokra);
    setError('perus', errors.perus, ['perus-kk', 'perus-v']);
    setError('tarkistus', errors.tarkistus, ['tarkistus-kk', 'tarkistus-v']);
    setError('vahintaan', errors.vahintaan);
    setError('enintaan', errors.enintaan);
    setError('lisa', errors.lisa);
    // Open the terms section when one of its fields has an error.
    if (errors.vahintaan || errors.enintaan || errors.lisa) form.querySelector('.calc__more')?.setAttribute('open', '');

    const failed = Object.keys(errors).length > 0;
    showResult(panel, !failed);
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
      showResult(panel, false);
      return;
    }
    render(panel, rentView(r, { series: f.s, base: f.base, check: f.check, lang }), ['rule']);

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
  if (isMonth(p(P.base))) setPeriod('perus', p(P.base));
  if (isMonth(p(P.check))) setPeriod('tarkistus', p(P.check));
  for (const [param, id] of [[P.min, 'vahintaan'], [P.max, 'enintaan'], [P.extra, 'lisa']]) {
    // The URL holds plain numbers ('2.555'); show them in the page's format
    // with the decimals they have (up to 4), as the calculation uses them.
    const n = parseDecimal(p(param) ?? '');
    if (n != null) {
      const decimals = Number.isInteger(n) ? 0 : Math.min(4, String(n).split('.')[1]?.length ?? 2);
      $(id).value = F.num(n, decimals);
      form.querySelector('.calc__more')?.setAttribute('open', '');
    }
  }
  if (p(P.noDecrease) === '1') $('eilaske').checked = true;
  if (ROUNDING.includes(p(P.rounding) ?? '')) $('pyoristys').value = p(P.rounding);
  calculate();

  wireRecalc(form, calculate, { onSubmit: () => document.getElementById('vuokra-tulos-otsikko')?.scrollIntoView({ block: 'nearest' }) });
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
}
