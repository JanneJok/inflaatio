/**
 * Owner dashboard /tilastot/ (markup: src/pages/tilastot.js).
 *
 * 1. Sign in with Supabase Auth (e-mail + password, POST /auth/v1/token).
 *    The session (access + refresh token) lives in sessionStorage of this tab
 *    only; "Kirjaudu ulos" revokes it (POST /auth/v1/logout) and forgets it.
 * 2. Read the aggregates with POST /rest/v1/rpc/inflaatio_stats (a security
 *    definer function that only answers users listed in
 *    public.inflaatio_stats_admins; docs/supabase-tilastot.sql).
 * 3. Draw everything with SVG and DOM nodes (no HTML strings; CSP-safe:
 *    dynamic positions use style.setProperty).
 *
 * Pure parts (data model, alert rules, CSV, auth helpers) are in
 * lib/tilastot-model.js and unit-tested in test/tilastot.test.js.
 */
import { SUPABASE, pageName } from '../../site.config.js';
import { OWN_EVENTS, OWN_EVENT_NAMES } from '../lib/tilastot-events.js';
import {
  DEVICES,
  FIXED_MARKERS,
  SECTIONS,
  SOURCES,
  SOURCE_LABEL,
  VIEW_GROUPS,
  WEEKDAYS,
  WEEKDAY_NAMES,
  addDays,
  arrivals,
  computeAlerts,
  fiDate,
  groupKeys,
  helsinkiNow,
  isoWeek,
  loginMessage,
  needsRefresh,
  normalize,
  ownEventsTotal,
  pageViewSpikes,
  sessionFromToken,
  siteViews,
  statsMessage,
  sumOf,
  toCsv,
  totalOf,
  val,
  weekStart,
  weekday,
} from '../lib/tilastot-model.js';

const SESSION_KEY = 'inflaatio-tilastot-session';
const NS = 'http://www.w3.org/2000/svg';
const MIN_N = 20;
const PAGES_SHORT = 30;

const nf = new Intl.NumberFormat('fi-FI');
const nf1 = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 1 });
const pf = new Intl.NumberFormat('fi-FI', { style: 'percent', maximumFractionDigits: 0 });
const fmt = (v) => (v == null ? '–' : nf.format(v));
const fmtPct = (v) => (v == null || !Number.isFinite(v) ? '–' : v > 0 && v < 0.005 ? '<1 %' : pf.format(v));

/* ------------------------------------------------------------ DOM helpers */

function $(sel) {
  const found = document.querySelector(sel);
  if (!found) throw new Error(`missing ${sel}`);
  return found;
}

function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  if (parent) parent.append(e);
  return e;
}

function svgText(parent, attrs, text) {
  const t = s('text', attrs, parent);
  t.textContent = text;
  return t;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 8 ? 8 : 10) * e;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/* ------------------------------------------------------- session storage */

let memorySession = null;
const sessionStore = {
  get() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : memorySession;
    } catch {
      return memorySession;
    }
  },
  set(sess) {
    memorySession = sess;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(sess));
    } catch {
      /* memory only */
    }
  },
  clear() {
    memorySession = null;
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  },
};

/* -------------------------------------------------------------- Supabase */

const baseHeaders = { apikey: SUPABASE.anonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
const fetchOpts = { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' };

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

class AuthError extends Error {}

async function tokenRequest(grant, body) {
  const res = await fetch(`${SUPABASE.url}/auth/v1/token?grant_type=${grant}`, {
    ...fetchOpts,
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(body),
  });
  const json = await readJson(res);
  if (!res.ok) throw new AuthError(loginMessage(res.status, json));
  const sess = sessionFromToken(json);
  if (!sess) throw new AuthError('Kirjautumisvastaus oli virheellinen. Yritä uudelleen.');
  return sess;
}

async function validSession() {
  let sess = sessionStore.get();
  if (!sess) return null;
  if (needsRefresh(sess)) {
    try {
      sess = await tokenRequest('refresh_token', { refresh_token: sess.refreshToken });
      sessionStore.set(sess);
    } catch {
      sessionStore.clear();
      return null;
    }
  }
  return sess;
}

async function fetchStats(from, to) {
  const sess = await validSession();
  if (!sess) throw new AuthError('Istunto päättyi. Kirjaudu uudelleen.');
  const res = await fetch(`${SUPABASE.url}/rest/v1/rpc/inflaatio_stats`, {
    ...fetchOpts,
    method: 'POST',
    headers: { ...baseHeaders, Authorization: `Bearer ${sess.accessToken}` },
    body: JSON.stringify({ p_from: from, p_to: to }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    const msg = statsMessage(res.status, json);
    if (res.status === 401 || res.status === 403 || json?.code === '42501') throw new AuthError(msg);
    throw new Error(msg);
  }
  return json;
}

async function logoutRemote(sess) {
  if (!sess) return;
  try {
    await fetch(`${SUPABASE.url}/auth/v1/logout`, {
      ...fetchOpts,
      method: 'POST',
      headers: { ...baseHeaders, Authorization: `Bearer ${sess.accessToken}` },
    });
  } catch {
    /* the local session is forgotten anyway */
  }
}

/* --------------------------------------------------------- state and page */

const state = { data: null, range: '30', loadedAt: '', lastWidth: 0, allPages: false };

const ui = {
  login: $('#login'),
  form: $('#login-form'),
  email: $('#email'),
  password: $('#password'),
  loginButton: $('#login-button'),
  loginError: $('#login-error'),
  app: $('#app'),
  meta: $('#meta'),
  status: $('#status'),
  range: $('#range'),
  refresh: $('#refresh'),
  csv: $('#csv'),
  logout: $('#logout'),
};

function showLogin(message = '') {
  ui.app.hidden = true;
  ui.login.hidden = false;
  ui.loginError.textContent = message;
  (ui.email.value ? ui.password : ui.email).focus();
}

function showApp() {
  ui.login.hidden = true;
  ui.app.hidden = false;
}

const setStatus = (text) => {
  ui.status.textContent = text;
};

function rangeBounds(range, today) {
  if (range === 'all') return { from: null, to: today };
  return { from: addDays(today, -(Number(range) - 1)), to: today };
}

async function load() {
  const today = helsinkiNow().date;
  const { from, to } = rangeBounds(state.range, today);
  ui.app.classList.add('is-loading');
  ui.refresh.disabled = true;
  try {
    const raw = await fetchStats(from, to);
    state.data = normalize(raw);
    state.loadedAt = helsinkiNow().time;
    showApp();
    render();
    setStatus(`Päivitetty klo ${state.loadedAt}.`);
  } catch (err) {
    if (err instanceof AuthError) {
      sessionStore.clear();
      state.data = null;
      showLogin(err.message);
    } else if (state.data) setStatus(`${err?.message || 'Päivitys epäonnistui.'} Näytetään edelliset tiedot.`);
    else showLogin(err?.message || 'Tilastoja ei saatu haettua. Tarkista yhteys ja yritä uudelleen.');
  } finally {
    ui.app.classList.remove('is-loading');
    ui.refresh.disabled = false;
  }
}

ui.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = ui.email.value.trim();
  const password = ui.password.value;
  if (!email || !password) {
    ui.loginError.textContent = 'Anna sähköposti ja salasana.';
    return;
  }
  ui.loginButton.disabled = true;
  ui.loginError.textContent = '';
  try {
    sessionStore.set(await tokenRequest('password', { email, password }));
    ui.password.value = '';
    await load();
  } catch (err) {
    showLogin(err instanceof AuthError ? err.message : 'Kirjautuminen epäonnistui. Tarkista yhteys ja yritä uudelleen.');
  } finally {
    ui.loginButton.disabled = false;
  }
});

ui.logout.addEventListener('click', async () => {
  const sess = sessionStore.get();
  sessionStore.clear();
  state.data = null;
  setStatus('');
  showLogin('Kirjauduit ulos.');
  await logoutRemote(sess);
});

ui.refresh.addEventListener('click', () => void load());
ui.csv.addEventListener('click', () => downloadCsv());
$('#pages-more').addEventListener('click', () => {
  state.allPages = !state.allPages;
  if (state.data) renderPages(state.data);
});

function setRange(range, { reload = true } = {}) {
  state.range = range;
  for (const b of ui.range.querySelectorAll('button[data-range]')) {
    const on = b.getAttribute('data-range') === range;
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
  }
  if (reload && state.data) void load();
}

ui.range.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button[data-range]') : null;
  if (b) setRange(String(b.getAttribute('data-range')));
});
ui.range.addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const buttons = [...ui.range.querySelectorAll('button[data-range]')];
  const i = buttons.findIndex((b) => b.getAttribute('aria-checked') === 'true');
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (back ? -1 : 1) + buttons.length) % buttons.length;
  setRange(String(buttons[next].getAttribute('data-range')));
  buttons[next].focus();
});

let resizeTimer = 0;
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const w = ui.app.clientWidth;
      if (state.data && !ui.app.hidden && w !== state.lastWidth) render();
    }, 150);
  }).observe(ui.app);
}

/* ------------------------------------------------------------- rendering */

/** The days of the selected range (the dataset also holds 35 days of history before it). */
function rangeDays(data) {
  return data.days.filter((d) => d.date >= data.from);
}

function render() {
  const data = state.data;
  if (!data) return;
  state.lastWidth = ui.app.clientWidth;
  const days = rangeDays(data);
  renderMeta(data);
  renderAlerts(data, days);
  renderKpis(data);
  renderViews(data, days);
  renderPages(data);
  renderAudience(data, days);
  renderTime(data, days);
  renderEvents(data, days);
  renderDayTable(data, days);
}

function renderMeta(data) {
  const parts = [];
  parts.push(data.first ? `Data alkaa ${fiDate(data.first)}` : 'Ei vielä dataa');
  parts.push(`aikaväli ${fiDate(data.from)}–${fiDate(data.to)}`);
  parts.push('Suomen aikaa');
  if (state.loadedAt) parts.push(`haettu klo ${state.loadedAt}`);
  const sess = sessionStore.get();
  if (sess?.email) parts.push(sess.email);
  ui.meta.textContent = parts.join(' · ');
}

/* ---- alerts ---- */

function renderAlerts(data, days) {
  const series = (metric) => data.days.map((d) => ({ date: d.date, value: metric(d) }));
  const alerts = computeAlerts({
    from: data.from,
    today: data.today,
    views: series(siteViews),
    errors: series((d) => val(d, 'ev.js_error')),
    events: series(ownEventsTotal),
    totals: { views: totalOf(days, siteViews), notFound: totalOf(days, (d) => val(d, 'sec.notfound')) },
  });
  $('#alerts-list').replaceChildren(
    ...alerts.map((a) => h('li', { class: 'dash-alert', 'data-alert': a.id }, h('strong', { text: a.title }), h('span', { text: a.text }))),
  );
  $('#alerts').hidden = !alerts.length;
}

/* ---- KPI tiles ---- */

function renderKpis(data) {
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const tiles = [
    { label: 'Sivukatselut', metric: siteViews },
    { label: 'Saapumiset', metric: arrivals },
    { label: 'Hakukoneista', metric: (d) => val(d, 'src.search') },
    { label: 'Laskurisivut', metric: (d) => val(d, 'sec.laskurit') },
    { label: 'Laskurin käytöt*', metric: (d) => val(d, 'ev.calculator_used') },
    { label: 'Upotetut kortit', metric: (d) => val(d, 'sec.upotus') },
  ];
  const today = data.today;
  const yesterday = addDays(today, -1);
  const box = $('#kpis');
  box.replaceChildren();
  for (const tile of tiles) {
    const y = tile.metric(byDate.get(yesterday));
    const prev = [];
    for (let i = 1; i <= 7; i++) {
      const v = tile.metric(byDate.get(addDays(yesterday, -i)));
      if (v != null) prev.push(v);
    }
    const avg = prev.length >= 4 ? mean(prev) : null;
    let delta = '';
    if (y != null && avg != null) {
      if (avg < MIN_N) delta = `ka. ${nf1.format(avg)} · n liian pieni`;
      else {
        const change = (y - avg) / avg;
        const sign = change > 0.005 ? '+' : change < -0.005 ? '−' : '±';
        delta = `${sign}${pf.format(Math.abs(change))} vs. ka. ${nf1.format(avg)}`;
      }
    } else if (y != null) delta = 'ei vertailua (liian vähän päiviä)';
    const svg = s('svg', { 'aria-hidden': 'true', focusable: 'false' });
    box.append(
      h(
        'div',
        { class: 'dash-tile' },
        h('p', { class: 'dash-tile__label', text: tile.label }),
        h('p', { class: 'dash-tile__value', text: fmt(y) }),
        h('p', { class: 'dash-tile__delta', text: delta || ' ' }),
        h('p', { class: 'dash-tile__today', text: `Tänään tähän mennessä: ${fmt(tile.metric(byDate.get(today)))}` }),
        svg,
      ),
    );
    const series = [];
    for (let i = 29; i >= 0; i--) series.push(tile.metric(byDate.get(addDays(yesterday, -i))));
    drawSparkline(svg, series);
  }
}

function drawSparkline(svg, values) {
  const w = Math.max(60, Math.floor(svg.getBoundingClientRect().width || 120));
  const hgt = 28;
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  const nums = values.filter((v) => v != null);
  if (!nums.length) return;
  const max = Math.max(1, ...nums);
  const step = values.length > 1 ? (w - 8) / (values.length - 1) : 0;
  const x = (i) => 4 + i * step;
  const y = (v) => hgt - 4 - (v / max) * (hgt - 8);
  let run = [];
  const flush = () => {
    if (run.length > 1) s('polyline', { class: 'dash-spark', points: run.join(' ') }, svg);
    run = [];
  };
  values.forEach((v, i) => {
    if (v == null) flush();
    else run.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  flush();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) {
      s('circle', { class: 'dash-spark-dot', cx: x(i).toFixed(1), cy: y(values[i]).toFixed(1), r: 3 }, svg);
      break;
    }
  }
}

/* ---- column charts ---- */

function roundedTop(x, y, w, hh, r) {
  const rr = Math.max(0, Math.min(r, w / 2, hh));
  return `M${x},${y + hh}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hh}Z`;
}

/**
 * Vertical columns, stacked when there are several series. One y-axis.
 * cols: {short, title, vals[], partial?, marker?, anomaly?, valueLabel?}
 */
function drawColumns(figure, o) {
  figure.replaceChildren();
  if (!o.cols.some((c) => c.vals.some((v) => v != null && v > 0))) {
    figure.append(h('p', { class: 'dash-empty', text: o.empty || 'Ei dataa tällä aikavälillä.' }));
    return;
  }
  const width = Math.max(280, Math.floor(figure.clientWidth || 600));
  const height = o.height || 220;
  const m = { top: 20, right: 10, bottom: 24, left: 44 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const totals = o.cols.map((c) => c.vals.reduce((a, v) => a + (v || 0), 0));
  const yMax = niceMax(Math.max(...totals));
  const yOf = (v) => m.top + plotH - (v / yMax) * plotH;
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': o.ariaLabel });

  for (const t of [0, yMax / 2, yMax]) {
    const y = Math.round(yOf(t)) + 0.5;
    s('line', { class: t === 0 ? 'dash-baseline' : 'dash-grid', x1: m.left, x2: width - m.right, y1: y, y2: y }, svg);
    svgText(svg, { class: 'dash-axis', x: m.left - 6, y: y + 4, 'text-anchor': 'end' }, o.format(t));
  }

  const n = o.cols.length;
  const band = plotW / n;
  const barW = Math.max(1, Math.min(24, band * 0.7));
  const gap = barW >= 4 ? 2 : 0;
  o.cols.forEach((c, i) => {
    const g = s('g', { class: `dash-col${c.partial ? ' is-partial' : ''}`, 'data-i': i }, svg);
    const x = m.left + i * band + (band - barW) / 2;
    const segs = c.vals.map((v, j) => ({ v: v || 0, j })).filter((q) => q.v > 0);
    let cursor = m.top + plotH;
    segs.forEach((q, k) => {
      const hh = (q.v / yMax) * plotH;
      const top = cursor - hh;
      const isTop = k === segs.length - 1;
      const drawTop = isTop ? top : Math.min(cursor, top + gap);
      const drawH = cursor - drawTop;
      if (drawH > 0.2) {
        const d = isTop ? roundedTop(x, drawTop, barW, drawH, 4) : `M${x},${drawTop}h${barW}v${drawH}h${-barW}Z`;
        s('path', { class: `dash-seg-rect s${q.j + 1}`, d }, g);
      }
      cursor = top;
    });
    const topY = yOf(totals[i]);
    if (c.valueLabel) svgText(g, { class: 'dash-value', x: x + barW / 2, y: topY - 5, 'text-anchor': 'middle' }, c.valueLabel);
    if (c.anomaly) svgText(g, { class: 'dash-anomaly', x: x + barW / 2, y: topY - 5, 'text-anchor': 'middle' }, '!');
    s('rect', { class: 'dash-hit', x: m.left + i * band, y: m.top, width: band, height: plotH, 'data-i': i }, g);
  });

  o.cols.forEach((c, i) => {
    if (!c.marker) return;
    const x = Math.round(m.left + i * band + band / 2) + 0.5;
    s('line', { class: 'dash-marker-line', x1: x, x2: x, y1: m.top - 4, y2: m.top + plotH }, svg);
    svgText(svg, { class: 'dash-marker-label', x, y: m.top - 8, 'text-anchor': 'middle' }, String(c.marker));
  });

  const maxLabels = Math.max(2, Math.floor(plotW / 58));
  const step = Math.max(1, Math.ceil(n / maxLabels));
  const shown = [];
  for (let i = 0; i < n; i += step) shown.push(i);
  if (shown[shown.length - 1] !== n - 1) {
    if (n - 1 - shown[shown.length - 1] < step / 2) shown.pop();
    shown.push(n - 1);
  }
  for (const i of shown) {
    svgText(svg, { class: 'dash-axis', x: m.left + i * band + band / 2, y: height - 6, 'text-anchor': 'middle' }, o.cols[i].short);
  }
  figure.append(svg);
  attachTip(figure, svg, (i) => o.tip(o.cols[i]), '.dash-col');
}

/** One tooltip per figure, driven by the [data-i] hit targets. */
function attachTip(figure, svg, content, markSelector) {
  const tip = h('div', { class: 'dash-tip', hidden: true });
  figure.append(tip);
  let current = -1;
  const hide = () => {
    tip.hidden = true;
    current = -1;
    for (const e of svg.querySelectorAll('.is-hover')) e.classList.remove('is-hover');
  };
  const move = (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-i]') : null;
    if (!target) return hide();
    const i = Number(target.getAttribute('data-i'));
    if (i !== current) {
      current = i;
      const c = content(i);
      tip.replaceChildren(h('p', { class: 'dash-tip__title', text: c.title }));
      for (const r of c.rows) {
        tip.append(
          h(
            'div',
            { class: 'dash-tip__row' },
            h('span', {}, r.cls ? h('span', { class: `dash-key ${r.cls}` }) : null, ` ${r.label}`),
            h('strong', { text: r.value }),
          ),
        );
      }
      for (const el of svg.querySelectorAll('.is-hover')) el.classList.remove('is-hover');
      for (const el of svg.querySelectorAll(`${markSelector}[data-i="${i}"]`)) el.classList.add('is-hover');
      tip.hidden = false;
    }
    const box = figure.getBoundingClientRect();
    let x = e.clientX - box.left + 14;
    const y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = Math.max(0, e.clientX - box.left - tip.offsetWidth - 14);
    tip.style.setProperty('left', `${Math.round(x)}px`);
    tip.style.setProperty('top', `${Math.round(y)}px`);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

/** Daily columns (≤ 60 days) or weekly sums. metrics: (d) => number|null per series. */
function timeColumns(days, today, metrics, { markers = [], anomalies = new Set() } = {}) {
  const weekly = days.length > 60;
  if (!weekly) {
    return {
      weekly,
      cols: days.map((d) => ({
        short: fiDate(d.date, false),
        title: `${WEEKDAYS[weekday(d.date)]} ${fiDate(d.date)}${d.date === today ? ' (tänään, kesken)' : ''}`,
        vals: metrics.map((f) => f(d)),
        partial: d.date === today,
        anomaly: anomalies.has(d.date),
        marker: markers.findIndex((mk) => mk.date === d.date) + 1 || undefined,
      })),
    };
  }
  const weeks = new Map();
  for (const d of days) {
    const w = weekStart(d.date);
    if (!weeks.has(w)) weeks.set(w, []);
    weeks.get(w).push(d);
  }
  return {
    weekly,
    cols: [...weeks.entries()].map(([w, ds]) => {
      const end = ds[ds.length - 1].date;
      const mi = markers.findIndex((mk) => mk.date >= ds[0].date && mk.date <= end);
      return {
        short: `vk ${isoWeek(w)}`,
        title: `Viikko ${isoWeek(w)}: ${fiDate(ds[0].date, false)}–${fiDate(end)}${end === today ? ' (kesken)' : ''}`,
        vals: metrics.map((f) => totalOf(ds, f)),
        partial: ds.some((d) => d.date === today),
        anomaly: ds.some((d) => anomalies.has(d.date)),
        marker: mi >= 0 ? mi + 1 : undefined,
      };
    }),
  };
}

/* ---- page views ---- */

function renderViews(data, days) {
  const first = days.length ? days[0].date : data.today;
  const last = days.length ? days[days.length - 1].date : data.today;
  const markers = FIXED_MARKERS.filter((mk) => mk.date >= first && mk.date <= last);
  const anomalies = new Set(pageViewSpikes(data.days.map((d) => ({ date: d.date, value: siteViews(d) })), first).map((x) => x.date));
  const groups = groupKeys();
  const { weekly, cols } = timeColumns(
    days,
    data.today,
    groups.map((keys) => (d) => sumOf(d, keys)),
    { markers, anomalies },
  );
  $('#pv-note').textContent = `${weekly ? 'Viikkosummat (maanantaista sunnuntaihin). Haaleampi pylväs on kesken.' : 'Päivittäin. Tämän päivän pylväs on haaleampi, koska päivä on kesken.'} Upotetun inflaatiokortin lataukset eivät ole mukana (ks. Suosituimmat sivut).`;
  drawColumns($('#pv-chart'), {
    cols,
    format: (v) => nf.format(Math.round(v)),
    ariaLabel: `Sivukatselut osioittain ${weekly ? 'viikoittain' : 'päivittäin'}, ${fiDate(first)}–${fiDate(last)}. Luvut myös päivätaulukossa.`,
    empty: 'Ei sivukatseluja tällä aikavälillä.',
    tip: (c) => {
      const t = c.vals.reduce((a, v) => (v == null ? a : (a ?? 0) + v), null);
      return {
        title: c.title,
        rows: [...VIEW_GROUPS.map((g, j) => ({ cls: `s${j + 1}`, label: g, value: fmt(c.vals[j]) })).reverse(), { label: 'Yhteensä', value: fmt(t) }],
      };
    },
  });
  $('#pv-legend').replaceChildren(...VIEW_GROUPS.map((g, j) => h('li', {}, h('span', { class: `dash-key s${j + 1}` }), g)));
  $('#pv-markers').replaceChildren(...markers.map((mk) => h('li', { text: `${fiDate(mk.date)}: ${mk.text}` })));
  const warn = $('#pv-anomalies');
  const flagged = [...anomalies].sort();
  warn.hidden = !flagged.length;
  warn.textContent = flagged.length
    ? `”!” = yli viisinkertainen määrä edeltävän 28 päivän mediaaniin nähden: ${flagged.map((d) => fiDate(d, false)).join(', ')}. Tarkista lähteet: näkyvyys jossain vai botti?`
    : '';
}

/* ---- pages ---- */

const MONTHS = ['tammikuu', 'helmikuu', 'maaliskuu', 'huhtikuu', 'toukokuu', 'kesäkuu', 'heinäkuu', 'elokuu', 'syyskuu', 'lokakuu', 'marraskuu', 'joulukuu'];

/** Readable name of a site path (registry names; dynamic routes from the path). */
function pageLabel(p) {
  if (p === '/upotus/') return 'Upotettu inflaatiokortti (lataukset muilla sivustoilla)';
  if (p === '/404.html') return '404: sivua ei löytynyt';
  const named = pageName(p);
  if (named) return named;
  let m = p.match(/^\/inflaatio\/(\d{4})\/(\d{2})\/$/);
  if (m) return `Inflaatio ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
  m = p.match(/^\/inflaatio\/(\d{4})\/$/);
  if (m) return `Inflaatio ${m[1]}`;
  m = p.match(/^\/katsaus\/([^/]+)\/$/);
  if (m) return `Katsaus ${m[1]}`;
  m = p.match(/^\/hinnat\/([^/]+)\/$/);
  if (m) return `Hinnat: ${m[1].replace(/-/g, ' ')}`;
  return p;
}

function fillTable(table, caption, head, rows) {
  table.replaceChildren(
    h('caption', { text: caption }),
    h('thead', {}, h('tr', {}, ...head.map((t) => h('th', { scope: 'col', text: t })))),
    h(
      'tbody',
      {},
      ...rows.map((r) =>
        h(
          'tr',
          {},
          ...r.map((c, i) => {
            const cell = typeof c === 'string' ? { text: c } : c;
            return h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null, class: cell.cls || null, text: cell.text, title: cell.title || null });
          }),
        ),
      ),
    ),
  );
}

function renderPages(data) {
  const pages = data.pages;
  const views = pages.filter((p) => p.p !== '/upotus/').reduce((a, p) => a + p.n, 0);
  const shown = state.allPages ? pages : pages.slice(0, PAGES_SHORT);
  fillTable(
    $('#pages-table'),
    `${fiDate(data.from)}–${fiDate(data.to)}: ${nf.format(pages.length)} eri sivua${pages.length >= 500 ? ' (500 suosituinta)' : ''}`,
    ['Sivu', 'Osoite', 'Katselut', 'Saapumiset', 'Osuus'],
    shown.map((p) => [
      { text: pageLabel(p.p), cls: 'is-text' },
      { text: p.p, cls: 'is-path is-text', title: p.p },
      fmt(p.n),
      fmt(p.e),
      p.p === '/upotus/' ? '' : fmtPct(views ? p.n / views : null),
    ]),
  );
  const more = $('#pages-more');
  more.hidden = pages.length <= PAGES_SHORT;
  more.textContent = state.allPages ? `Näytä vain ${PAGES_SHORT} suosituinta` : `Näytä kaikki ${nf.format(pages.length)} sivua`;
}

/* ---- audience ---- */

function drawHBars(box, rows) {
  box.replaceChildren();
  for (const r of rows) {
    const fill = h('div', { class: `dash-hbar__fill${!r.value ? ' is-zero' : ''}` });
    fill.style.setProperty('width', `${r.max > 0 && r.value ? Math.max(0.5, (r.value / r.max) * 100) : 0}%`);
    box.append(
      h(
        'div',
        { class: 'dash-hbar' },
        h('span', { text: r.label }),
        h('span', { class: 'dash-hbar__value' }, fmt(r.value), r.share != null ? h('small', { text: fmtPct(r.share) }) : null),
        h('div', { class: 'dash-hbar__track' }, fill),
      ),
    );
  }
}

function drawStackbar(box, parts) {
  box.replaceChildren();
  const sum = parts.reduce((a, p) => a + (p.value || 0), 0);
  if (!sum) {
    box.append(h('p', { class: 'dash-muted dash-small', text: 'Ei katseluja tällä aikavälillä.' }));
    return;
  }
  const track = h('div', {
    class: 'dash-stackbar__track',
    role: 'img',
    'aria-label': parts.map((p) => `${p.label} ${fmtPct((p.value || 0) / sum)}`).join(', '),
  });
  parts.forEach((p, i) => {
    if (!p.value) return;
    const part = h('span', { class: `dash-stackbar__part s${i + 1}` });
    part.style.setProperty('flex', `${p.value} 1 0`);
    track.append(part);
  });
  box.append(
    track,
    h(
      'ul',
      { class: 'dash-legend' },
      ...parts
        .filter((p) => p.value)
        .map((p) => h('li', {}, h('span', { class: `dash-key s${parts.indexOf(p) + 1}` }), `${p.label} ${fmt(p.value)} (${fmtPct(p.value / sum)})`)),
    ),
  );
}

function renderAudience(data, days) {
  const src = SOURCES.map((x) => ({ label: x.label, value: totalOf(days, (d) => val(d, `src.${x.key}`)) }));
  const sum = src.reduce((a, r) => a + (r.value || 0), 0);
  const max = Math.max(1, ...src.map((r) => r.value || 0));
  drawHBars(
    $('#sources'),
    src.map((r) => ({ ...r, share: sum ? (r.value || 0) / sum : null, max })),
  );
  drawStackbar(
    $('#devices'),
    DEVICES.map((x) => ({ label: x.label, value: totalOf(days, (d) => val(d, `dev.${x.key}`)) })),
  );
  fillTable(
    $('#ref-table'),
    data.referrers.length ? 'Ulkoiset sivustot, joilta tultiin (vain verkkotunnus tallennetaan)' : 'Ei viittaavia sivustoja tällä aikavälillä',
    ['Sivusto', 'Tyyppi', 'Saapumiset'],
    data.referrers.map((r) => [{ text: r.r, cls: 'is-text' }, { text: SOURCE_LABEL[r.c] ?? r.c, cls: 'is-text' }, fmt(r.n)]),
  );
}

/* ---- time of day ---- */

function renderTime(data, days) {
  const figure = $('#heat-chart');
  const note = $('#heat-note');
  const scale = $('#heat-scale');
  figure.replaceChildren();
  scale.replaceChildren();
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const x of data.hours) grid[x.w - 1][x.h] += x.n;
  const dayCount = new Array(7).fill(0);
  for (const d of days) if (d.measured) dayCount[weekday(d.date)] += 1;
  const max = Math.max(0, ...grid.flat());
  if (!max) {
    note.textContent = '';
    figure.append(h('p', { class: 'dash-empty', text: 'Ei sivukatseluja tällä aikavälillä.' }));
  } else {
    let peak = { wd: 0, hour: 0, avg: 0 };
    for (let wd = 0; wd < 7; wd++) {
      for (let hr = 0; hr < 24; hr++) {
        const avg = dayCount[wd] ? grid[wd][hr] / dayCount[wd] : 0;
        if (avg > peak.avg) peak = { wd, hour: hr, avg };
      }
    }
    note.textContent = `Kaikki sivulataukset viikonpäivän ja tunnin mukaan (Suomen aikaa). Vilkkain tunti: ${WEEKDAY_NAMES[peak.wd]} klo ${peak.hour}–${peak.hour + 1}, keskimäärin ${nf1.format(peak.avg)} katselua.`;
    const width = Math.max(280, Math.floor(figure.clientWidth || 600));
    const labelW = 28;
    const cell = Math.max(8, Math.floor((width - labelW) / 24));
    const rowH = Math.max(14, Math.min(cell, 26));
    const height = rowH * 7 + 22;
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Sivukatselut viikonpäivän ja tunnin mukaan, suurin solu ${max}.` });
    const bucket = (v) => (v <= 0 ? 0 : 1 + Math.min(3, Math.floor((v / max) * 4 - 1e-9)));
    for (let wd = 0; wd < 7; wd++) {
      svgText(svg, { class: 'dash-axis', x: 0, y: wd * rowH + rowH / 2 + 4 }, WEEKDAYS[wd]);
      for (let hr = 0; hr < 24; hr++) {
        s('rect', { class: `dash-cell h${bucket(grid[wd][hr])}`, x: labelW + hr * cell, y: wd * rowH, width: Math.max(1, cell - 2), height: rowH - 2, rx: 2, 'data-i': wd * 24 + hr }, svg);
      }
    }
    for (let hr = 0; hr < 24; hr += 3) svgText(svg, { class: 'dash-axis', x: labelW + hr * cell, y: height - 6 }, String(hr).padStart(2, '0'));
    figure.append(svg);
    attachTip(
      figure,
      svg,
      (i) => {
        const wd = Math.floor(i / 24);
        const hr = i % 24;
        const v = grid[wd][hr];
        return {
          title: `${WEEKDAY_NAMES[wd]} klo ${hr}–${hr + 1}`,
          rows: [
            { label: 'Katseluja yhteensä', value: nf.format(v) },
            { label: `Keskimäärin / ${WEEKDAYS[wd]}`, value: dayCount[wd] ? nf1.format(v / dayCount[wd]) : '–' },
          ],
        };
      },
      '.dash-cell',
    );
    scale.append(
      h('span', {}, h('span', { class: 'dash-key h0' }), '0'),
      h('span', {}, '1', h('span', { class: 'dash-key h1' }), h('span', { class: 'dash-key h2' }), h('span', { class: 'dash-key h3' }), h('span', { class: 'dash-key h4' }), `${nf.format(max)} (suurin solu)`),
    );
  }

  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);
  for (const d of days) {
    if (d.date === data.today) continue;
    const v = siteViews(d);
    if (v == null) continue;
    sums[weekday(d.date)] += v;
    counts[weekday(d.date)] += 1;
  }
  drawColumns($('#week-chart'), {
    cols: WEEKDAYS.map((wd, i) => {
      const avg = counts[i] ? sums[i] / counts[i] : null;
      return { short: wd, title: `${WEEKDAY_NAMES[i]} (${counts[i]} päivää)`, vals: [avg], valueLabel: avg == null ? '' : nf.format(Math.round(avg)) };
    }),
    format: (v) => nf.format(Math.round(v)),
    height: 180,
    ariaLabel: 'Sivukatseluja päivässä keskimäärin viikonpäivittäin.',
    empty: 'Ei sivukatseluja tällä aikavälillä.',
    tip: (c) => ({ title: c.title, rows: [{ cls: 's1', label: 'Keskimäärin', value: c.vals[0] == null ? '–' : nf1.format(c.vals[0]) }] }),
  });
}

/* ---- events ---- */

const eventLabel = (e) => OWN_EVENTS[e]?.label ?? `Vanha tapahtuma (${e})`;

function renderEvents(data, days) {
  const { weekly, cols } = timeColumns(days, data.today, [ownEventsTotal]);
  drawColumns($('#ev-chart'), {
    cols,
    format: (v) => nf.format(Math.round(v)),
    height: 180,
    ariaLabel: `Tapahtumat yhteensä ${weekly ? 'viikoittain' : 'päivittäin'}.`,
    empty: 'Ei tapahtumia tällä aikavälillä. Tapahtumia tulee vain analytiikan sallineilta, ja ne alkavat, kun docs/supabase-tilastot.sql on ajettu.',
    tip: (c) => ({ title: c.title, rows: [{ cls: 's1', label: 'Tapahtumia', value: fmt(c.vals[0]) }] }),
  });

  const views = totalOf(days, siteViews) || 0;
  const names = new Set([...OWN_EVENT_NAMES, ...data.keys.filter((k) => k.startsWith('ev.')).map((k) => k.slice(3))]);
  const rows = [...names].map((e) => ({ e, n: totalOf(days, (d) => val(d, `ev.${e}`)) }));
  rows.sort((a, b) => (b.n ?? -1) - (a.n ?? -1) || a.e.localeCompare(b.e));
  fillTable(
    $('#events-table'),
    'Tapahtumat valitulla aikavälillä',
    ['Tapahtuma', 'Määrä', '/ 1 000 katselua', 'Selite'],
    rows.map((r) => [
      { text: eventLabel(r.e), cls: 'is-text', title: r.e },
      fmt(r.n),
      r.n != null && views ? nf1.format((r.n / views) * 1000) : '–',
      { text: OWN_EVENTS[r.e]?.desc ?? 'Edellisen sivuston tapahtuma; poistuu säilytysajan myötä.', cls: 'is-desc' },
    ]),
  );
  fillTable(
    $('#details-table'),
    'Tarkenteet (esim. laskuri, tiedosto, kaavion valinta, linkin verkkotunnus)',
    ['Tapahtuma', 'Tarkenne', 'Määrä'],
    data.details.filter((x) => x.x).map((x) => [{ text: eventLabel(x.e), cls: 'is-text' }, { text: x.x, cls: 'is-path is-text', title: x.x }, fmt(x.n)]),
  );
  fillTable(
    $('#event-pages-table'),
    'Millä sivuilla tapahtumat syntyivät',
    ['Tapahtuma', 'Sivu', 'Määrä'],
    data.eventPages.map((x) => [{ text: eventLabel(x.e), cls: 'is-text' }, { text: pageLabel(x.p), cls: 'is-text', title: x.p }, fmt(x.n)]),
  );
}

/* ---- day table ---- */

function labelOf(key) {
  if (key === 'pv') return 'Kaikki lataukset';
  if (key === 'sec.upotus') return 'Upotetut kortit';
  if (key.startsWith('sec.')) return SECTIONS.find((x) => `sec.${x.key}` === key)?.label ?? key.slice(4);
  if (key.startsWith('src.')) return `Lähde: ${SOURCE_LABEL[key.slice(4)] ?? key.slice(4)}`;
  if (key.startsWith('dev.')) return `Laite: ${DEVICES.find((x) => `dev.${x.key}` === key)?.label ?? key.slice(4)}`;
  if (key.startsWith('ev.')) return eventLabel(key.slice(3));
  return key;
}

function descOf(key) {
  if (key === 'pv') return 'Kaikki sivulataukset, myös upotetun kortin lataukset muilla sivustoilla';
  if (key === 'sec.upotus') return 'Upotetun inflaatiokortin lataukset muilla sivustoilla';
  if (key.startsWith('sec.')) return 'Sivukatselut tässä sivuston osiossa';
  if (key === 'src.internal') return 'Siirtymät sivuston sivulta toiselle (ei saapuminen)';
  if (key.startsWith('src.')) return 'Saapumiset tästä lähteestä';
  if (key.startsWith('dev.')) return 'Sivukatselut tällä laitetyypillä';
  if (key.startsWith('ev.')) return OWN_EVENTS[key.slice(3)]?.desc ?? 'Edellisen sivuston tapahtuma';
  return '';
}

function renderDayTable(data, days) {
  const cols = data.keys;
  const head = h(
    'tr',
    {},
    h('th', { scope: 'col', text: 'Päivä' }),
    h('th', { scope: 'col', title: 'Sivukatselut ilman upotetun kortin latauksia', text: 'Sivukatselut' }),
    h('th', { scope: 'col', title: 'Katselut, joihin ei tultu sivuston toiselta sivulta', text: 'Saapumiset' }),
    ...cols.map((k) => h('th', { scope: 'col', title: `${k} – ${descOf(k)}`, text: labelOf(k) })),
  );
  const body = h('tbody');
  for (const d of [...days].reverse()) {
    const tr = h('tr');
    tr.append(h('th', { scope: 'row', text: `${WEEKDAYS[weekday(d.date)]} ${fiDate(d.date)}${d.date === data.today ? ' (kesken)' : ''}` }));
    for (const v of [siteViews(d), arrivals(d), ...cols.map((k) => val(d, k))]) tr.append(h('td', { class: v == null ? 'is-missing' : null, text: fmt(v) }));
    body.append(tr);
  }
  $('#day-table').replaceChildren(h('caption', { class: 'sr-only', text: 'Kaikki laskurit päivittäin, uusin ensin' }), h('thead', {}, head), body);
}

/* ---- CSV ---- */

function downloadCsv() {
  const data = state.data;
  if (!data) return;
  const blob = new Blob([toCsv(rangeDays(data), data.keys)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `inflaatio-tilastot-${data.from}-${data.to}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------ start */

setRange(state.range, { reload: false });
if (sessionStore.get()) void load();
else showLogin();

