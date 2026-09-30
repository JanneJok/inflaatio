// Own event statistics and the owner dashboard /tilastot/:
// src/js/lib/tilastot-events.js, the own-event helpers of analytics.js,
// src/js/lib/tilastot-model.js, docs/supabase-tilastot.sql and the built page.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWN_EVENTS, OWN_EVENT_NAMES, DETAIL_MAX, eventDetail, isOwnEvent } from '../src/js/lib/tilastot-events.js';
import { detailFromParams, outboundHost, ownEventPayload, OWN_EVENT_FIELDS, isValidEventName } from '../src/js/lib/analytics.js';
import {
  addDays,
  arrivals,
  computeAlerts,
  isoWeek,
  loginMessage,
  needsRefresh,
  normalize,
  ownEventsTotal,
  pageViewSpikes,
  sessionFromToken,
  siteViews,
  sortKeys,
  statsMessage,
  toCsv,
  val,
  weekday,
} from '../src/js/lib/tilastot-model.js';
import { build } from '../scripts/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRoot = (p) => fs.readFile(path.join(ROOT, p), 'utf8');

describe('own events whitelist (tilastot-events.js)', () => {
  test('names are valid event names with a Finnish label and description', () => {
    assert.ok(OWN_EVENT_NAMES.length >= 10);
    for (const name of OWN_EVENT_NAMES) {
      assert.ok(isValidEventName(name), name);
      assert.ok(OWN_EVENTS[name].label && OWN_EVENTS[name].desc, name);
      assert.ok(isOwnEvent(name));
    }
    assert.equal(isOwnEvent('page_view'), false);
    assert.equal(isOwnEvent('toString'), false);
  });

  test('the database accepts exactly the same event names (docs/supabase-tilastot.sql)', async () => {
    const sql = await readRoot('docs/supabase-tilastot.sql');
    const block = sql.match(/event_type in \(([^)]*)\)\s*and referrer is null/);
    assert.ok(block, 'event list in the insert policy');
    const names = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(names, [...OWN_EVENT_NAMES]);
  });

  test('eventDetail normalises to the database format', () => {
    const re = /^[a-z0-9_./:-]+$/;
    assert.equal(eventDetail('vuokrankorotus'), 'vuokrankorotus');
    assert.equal(eventDetail('/data/khi.csv'), '/data/khi.csv');
    assert.equal(eventDetail('Mitä inflaatio tarkoittaa?'), 'mita-inflaatio-tarkoittaa');
    assert.equal(eventDetail('aikavali-5v'), 'aikavali-5v');
    assert.equal(eventDetail('Åland Öö'), 'aland-oo');
    assert.equal(eventDetail(''), null);
    assert.equal(eventDetail('???'), null);
    assert.equal(eventDetail(null), null);
    const long = eventDetail('x'.repeat(200));
    assert.equal(long.length, DETAIL_MAX);
    for (const v of ['Hello World', 'tilastokeskus.fi', 'a--b', 'é', '#lahdeviite']) {
      const d = eventDetail(v);
      assert.ok(d === null || (re.test(d) && d.length <= DETAIL_MAX), `${v} → ${d}`);
    }
  });
});

describe('own event helpers (analytics.js)', () => {
  test('ownEventPayload has exactly event_type, page and detail', () => {
    const row = ownEventPayload({ event: 'calculator_used', detail: 'Vuokrankorotus', pathname: '/vuokrankorotus/?vuokra=900', canonical: 'https://inflaatio.fi/vuokrankorotus/' });
    assert.deepEqual(Object.keys(row), [...OWN_EVENT_FIELDS]);
    assert.deepEqual(row, { event_type: 'calculator_used', page: '/vuokrankorotus/', detail: 'vuokrankorotus' });
    // Query strings (calculator inputs) never reach the row.
    assert.equal(ownEventPayload({ event: 'page_read', pathname: '/rahanarvo/?summa=5000' }).page, '/rahanarvo/');
    assert.equal(ownEventPayload({ event: 'page_read', pathname: '/x/', notFound: true }).page, '/404.html');
  });

  test('detailFromParams: explicit detail, calculator name or file', () => {
    assert.equal(detailFromParams('calculator_used', { laskuri: 'ostovoima', kieli: 'fi' }), 'ostovoima');
    assert.equal(detailFromParams('csv_download', { file_name: '/data/khi.csv' }), '/data/khi.csv');
    assert.equal(detailFromParams('result_shared', {}), null);
    assert.equal(detailFromParams('chart_changed', { detail: 'aikavali-5v', laskuri: 'x' }), 'aikavali-5v');
  });

  test('outboundHost: other sites only, without www', () => {
    assert.equal(outboundHost('https://www.stat.fi/til/khi/', 'inflaatio.fi'), 'stat.fi');
    assert.equal(outboundHost('https://ec.europa.eu/eurostat', 'inflaatio.fi'), 'ec.europa.eu');
    assert.equal(outboundHost('/hinnat/', 'inflaatio.fi'), null);
    assert.equal(outboundHost('https://www.inflaatio.fi/korot/', 'inflaatio.fi'), null);
    assert.equal(outboundHost('mailto:x@example.fi', 'inflaatio.fi'), null);
    assert.equal(outboundHost('#main', 'inflaatio.fi'), null);
    assert.equal(outboundHost('', 'inflaatio.fi'), null);
  });

  test('own events are sent only with consent and respect privacy signals', async () => {
    const src = await readRoot('src/js/lib/analytics.js');
    assert.match(src, /function canSendOwn\(\) \{\s*return \(\s*!isBarePage\(\) &&\s*isProductionHost\(window\.location\.hostname\) &&\s*hasAnalyticsConsent\(\) &&\s*!privacySignal\(\) &&\s*!automated\(\) &&\s*!isOwnFrame\(\)/);
    assert.match(src, /if \(!isOwnEvent\(event\) \|\| !canSendOwn\(\)\) return;/);
    assert.match(src, /ownCount >= MAX_OWN_EVENTS_PER_PAGE/);
    // track() checks consent before anything is sent anywhere.
    assert.match(src, /if \(!isValidEventName\(event\) \|\| !hasAnalyticsConsent\(\)\) return;\s*ownEvent\(/);
  });
});

/** Counters of a synthetic API response: `perDay(d, i)` → {key: n}. */
function response({ from, to, first, days, perDay, today = to }) {
  const counters = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(to, -(days - 1) + i);
    for (const [k, n] of Object.entries(perDay(d, i))) counters.push({ d, k, n });
  }
  return { today, from, to, first, counters, pages: [], referrers: [], hours: [], details: [], eventPages: [] };
}

describe('dashboard data model (tilastot-model.js)', () => {
  test('dates: weekday, ISO week', () => {
    assert.equal(weekday('2026-09-28'), 0); // Monday
    assert.equal(weekday('2026-10-04'), 6);
    assert.equal(isoWeek('2026-09-29'), 40);
    assert.equal(isoWeek('2027-01-01'), 53);
  });

  test('normalize: contiguous days, missing = 0 from the first day, null before it', () => {
    const data = normalize({
      today: '2026-09-29',
      from: '2026-09-27',
      to: '2026-09-29',
      first: '2026-09-25',
      counters: [
        { d: '2026-09-25', k: 'pv', n: 10 },
        { d: '2026-09-27', k: 'pv', n: 5 },
        { d: '2026-09-27', k: 'sec.upotus', n: 2 },
        { d: '2026-09-27', k: 'src.internal', n: 1 },
        { d: 'bad', k: 'pv', n: 1 },
      ],
    });
    // History window: from − 35 days.
    assert.equal(data.days[0].date, '2026-08-23');
    assert.equal(data.days.at(-1).date, '2026-09-29');
    const by = new Map(data.days.map((d) => [d.date, d]));
    assert.equal(val(by.get('2026-09-24'), 'pv'), null);
    assert.equal(val(by.get('2026-09-26'), 'pv'), 0);
    assert.equal(siteViews(by.get('2026-09-27')), 3);
    assert.equal(arrivals(by.get('2026-09-27')), 2);
    assert.deepEqual(data.keys, ['pv', 'sec.upotus', 'src.internal']);
  });

  test('sortKeys: page views, sections, sources, devices, events', () => {
    assert.deepEqual(sortKeys(['ev.zzz', 'dev.mobile', 'ev.page_read', 'src.search', 'sec.hinnat', 'pv', 'sec.etusivu']), [
      'pv',
      'sec.etusivu',
      'sec.hinnat',
      'src.search',
      'dev.mobile',
      'ev.page_read',
      'ev.zzz',
    ]);
  });

  test('ownEventsTotal counts whitelisted events only (not the previous site\'s)', () => {
    const data = normalize(response({ from: '2026-09-29', to: '2026-09-29', first: '2026-09-01', days: 1, perDay: () => ({ 'ev.page_read': 3, 'ev.session_end': 7 }) }));
    assert.equal(ownEventsTotal(data.days.at(-1)), 3);
  });

  test('alerts: a spike, a silent counter, errors, quiet events and many 404s', () => {
    const to = '2026-09-29';
    const data = normalize(
      response({
        from: '2026-09-23',
        to,
        first: '2026-07-01',
        days: 60,
        perDay: (d) => {
          const spike = d === '2026-09-25';
          const silent = d === '2026-09-27';
          return {
            pv: silent ? 0 : spike ? 1000 : 100,
            'ev.js_error': d === '2026-09-26' ? 30 : d === '2026-09-28' ? 0 : 1,
            'ev.page_read': d === '2026-09-28' ? 0 : 20,
            'sec.notfound': d >= '2026-09-23' ? 20 : 0,
          };
        },
      }),
    );
    const series = (m) => data.days.map((d) => ({ date: d.date, value: m(d) }));
    const days = data.days.filter((d) => d.date >= data.from);
    const alerts = computeAlerts({
      from: data.from,
      today: data.today,
      views: series(siteViews),
      errors: series((d) => val(d, 'ev.js_error')),
      events: series(ownEventsTotal),
      totals: { views: days.reduce((a, d) => a + siteViews(d), 0), notFound: days.reduce((a, d) => a + val(d, 'sec.notfound'), 0) },
    });
    assert.deepEqual(
      alerts.map((a) => a.id),
      ['no-page-views', 'page-view-spike', 'client-errors', 'no-events', 'not-found'],
    );
    assert.match(alerts[1].text, /^25\.9\. \(1\s000; mediaani 100\)/);
    assert.deepEqual(pageViewSpikes(series(siteViews), data.from).map((s) => s.date), ['2026-09-25']);
  });

  test('alerts: nothing on a normal range, and today (partial) never counts as silent', () => {
    const data = normalize(response({ from: '2026-09-23', to: '2026-09-29', first: '2026-07-01', days: 60, perDay: (d) => ({ pv: d === '2026-09-29' ? 0 : 100 }) }));
    const series = (m) => data.days.map((d) => ({ date: d.date, value: m(d) }));
    const alerts = computeAlerts({ from: data.from, today: data.today, views: series(siteViews), errors: series(() => 0), events: series(() => 0), totals: { views: 600, notFound: 0 } });
    assert.deepEqual(alerts, []);
  });

  test('toCsv: header, derived columns and empty cells for unmeasured days', () => {
    const data = normalize({ today: '2026-09-02', from: '2026-09-01', to: '2026-09-02', first: '2026-09-02', counters: [{ d: '2026-09-02', k: 'pv', n: 4 }, { d: '2026-09-02', k: 'src.internal', n: 1 }] });
    const csv = toCsv(data.days.slice(-2), data.keys);
    assert.equal(csv, 'date,site_views,arrivals,pv,src.internal\n2026-09-01,,,,\n2026-09-02,4,3,4,1\n');
  });

  test('auth helpers: session, refresh window and messages', () => {
    const s = sessionFromToken({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'x@y.fi' } }, 1000);
    assert.deepEqual(s, { accessToken: 'a', refreshToken: 'r', expiresAt: 4600, email: 'x@y.fi' });
    assert.equal(sessionFromToken({ error: 'invalid_grant' }), null);
    assert.equal(needsRefresh(s, 4000), false);
    assert.equal(needsRefresh(s, 4550), true);
    assert.equal(needsRefresh(null), true);
    assert.match(loginMessage(400, { error_code: 'invalid_credentials' }), /Sähköposti tai salasana on väärin/);
    assert.match(loginMessage(429), /Liian monta/);
    assert.match(statsMessage(400, { code: '42501' }), /inflaatio_stats_admins/);
    assert.match(statsMessage(404, { code: 'PGRST202' }), /supabase-tilastot\.sql/);
  });
});

describe('the stats function (docs/supabase-tilastot.sql)', () => {
  test('only listed admins can read; anon cannot execute; nothing readable directly', async () => {
    const sql = await readRoot('docs/supabase-tilastot.sql');
    assert.match(sql, /security definer\s+set search_path = ''/);
    assert.match(sql, /if auth\.uid\(\) is null\s+or not exists \(select 1 from public\.inflaatio_stats_admins a where a\.user_id = auth\.uid\(\)\) then\s+raise exception/);
    assert.match(sql, /revoke all on function public\.inflaatio_stats\(date, date\) from public, anon;/);
    assert.match(sql, /grant execute on function public\.inflaatio_stats\(date, date\) to authenticated;/);
    assert.match(sql, /revoke all on table public\.inflaatio_stats_admins from anon, authenticated;/);
    assert.match(sql, /revoke all on table public\.inflaatio_analytics from anon, authenticated;/);
    assert.doesNotMatch(sql, /grant select/i);
  });
});

describe('built dashboard page /tilastot/', () => {
  let tmp;
  let page;
  let sitemap;
  let mainCss;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-tilastot-'));
    await build({ out: path.join(tmp, 'dist'), only: ['tilastot', 'home'], quiet: true });
    page = await fs.readFile(path.join(tmp, 'dist', 'tilastot', 'index.html'), 'utf8');
    sitemap = await fs.readFile(path.join(tmp, 'dist', 'sitemap.xml'), 'utf8');
    const cssName = (await fs.readdir(path.join(tmp, 'dist', 'assets'))).find((f) => /^main-.*\.css$/.test(f));
    mainCss = await fs.readFile(path.join(tmp, 'dist', 'assets', cssName), 'utf8');
  });
  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  test('noindex, not in the sitemap, no referrer', () => {
    assert.match(page, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(page, /rel="canonical"/);
    assert.doesNotMatch(sitemap, /\/tilastot\//);
    assert.match(page, /<meta name="referrer" content="no-referrer">/);
  });

  test('bare document: no site.js (no consent banner, GA or page-view counting), own script and stylesheet', () => {
    assert.doesNotMatch(page, /\/assets\/site-[A-Z0-9]+\.js/);
    assert.doesNotMatch(page, /id="evasteilmoitus"/);
    assert.match(page, /<script type="module" src="\/assets\/pages\/tilastot-[A-Z0-9]+\.js"><\/script>/);
    assert.match(page, /<link rel="stylesheet" href="\/assets\/tilastot-[A-Z0-9]+\.css">/);
    // Visitors never download the dashboard styles.
    assert.doesNotMatch(mainCss, /dash-kpis/);
  });

  test('login form: e-mail + password with autocomplete, POST (never GET), no data in the HTML', () => {
    assert.match(page, /<form id="login-form" class="dash-login__form" method="post" action="\/tilastot\/">/);
    assert.match(page, /<input id="email" name="email" type="email" autocomplete="username" required/);
    assert.match(page, /<input id="password" name="password" type="password" autocomplete="current-password" required>/);
    assert.match(page, /<div id="app" class="dash-app" hidden>/);
    assert.doesNotMatch(page, /"counters"/);
  });
});
