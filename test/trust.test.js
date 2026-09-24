// TRUST area: consent cookie logic, analytics payload minimisation, contact
// form validation, the helpers of the /menetelmat/ page and the built
// /kayttoehdot/, /tietoa/, /menetelmat/ pages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CONSENT, CONSENT_VERSION, GA_ID } from '../src/site.config.js';
import {
  getCookie,
  serializeConsent,
  parseConsent,
  consentCookie,
  gaCookieNames,
  cookieDomains,
  expireCookies,
  shouldRevoke,
  initConsent,
} from '../src/js/lib/consent.js';
import {
  isProductionHost,
  privacySignal,
  referrerCategory,
  deviceClass,
  pagePath,
  pageViewPayload,
  isValidEventName,
  countsPageView,
  gaPageUrl,
  PAGE_VIEW_FIELDS,
  RETENTION_MONTHS,
  GA_COOKIE_MAX_AGE_DAYS,
} from '../src/js/lib/analytics.js';
import { validateContact, initialFocusTarget, CONTACT_LIMITS, MIN_FILL_MS } from '../src/js/lib/contact.js';
import { SOURCES } from '../scripts/fetch/index.js';
import { formatPeriod, releaseTime, upcomingReleases, officialVsMonthlyMean, kkiBaseRows } from '../src/pages/menetelmat.js';
import * as fmt from '../src/js/lib/format.js';
import * as stats from '../src/js/lib/stats.js';
import { build } from '../scripts/build.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T10:00:00Z');

describe('consent cookie (pure helpers)', () => {
  test('getCookie finds a value among other cookies and tolerates spaces', () => {
    const jar = '_ga=GA1.1.1.2; inflaatio_cookie_consent=%7B%22v%22%3A2%7D;other=x=y';
    assert.equal(getCookie(jar, 'inflaatio_cookie_consent'), '%7B%22v%22%3A2%7D');
    assert.equal(getCookie(jar, 'other'), 'x=y');
    assert.equal(getCookie(jar, 'missing'), null);
    assert.equal(getCookie('', 'a'), null);
    assert.equal(getCookie(undefined, 'a'), null);
  });

  test('serialise → parse round trip; the value is URI-encoded (RFC 6265 octets)', () => {
    const v = serializeConsent(true, { date: '2026-09-20' });
    assert.doesNotMatch(v, /[",;\s{}]/, 'no quotes, commas, semicolons, spaces or braces');
    assert.deepEqual(parseConsent(v, { now: NOW }), { analytics: true, date: '2026-09-20' });
    assert.deepEqual(parseConsent(serializeConsent(false, { date: '2026-09-24' }), { now: NOW }), { analytics: false, date: '2026-09-24' });
    assert.equal(JSON.parse(decodeURIComponent(v)).v, CONSENT_VERSION);
  });

  test('another CONSENT_VERSION or the old unversioned value asks again', () => {
    assert.equal(parseConsent(serializeConsent(true, { version: CONSENT_VERSION - 1, date: '2026-09-20' }), { now: NOW }), null);
    assert.equal(parseConsent(serializeConsent(true, { version: CONSENT_VERSION + 1, date: '2026-09-20' }), { now: NOW }), null);
    // The old site stored raw JSON without a version (and with a timestamp).
    const old = JSON.stringify({ analytics: true, necessary: true, timestamp: '2026-09-01T10:00:00.000Z' });
    assert.equal(parseConsent(old, { now: NOW }), null);
    assert.equal(parseConsent(encodeURIComponent(old), { now: NOW }), null);
  });

  test('malformed values are ignored', () => {
    for (const raw of [null, undefined, '', 'true', '%E0%A4%A', '{"v":2}', encodeURIComponent('{"v":2,"analytics":"yes","d":"2026-09-20"}'), encodeURIComponent('{"v":2,"analytics":true}'), encodeURIComponent('{"v":2,"analytics":true,"d":"20.9.2026"}')]) {
      assert.equal(parseConsent(raw, { now: NOW }), null, String(raw));
    }
  });

  test('a choice expires after CONSENT.maxAgeDays (12 months) and a future date is rejected', () => {
    assert.equal(CONSENT.maxAgeDays, 365);
    const at = (daysAgo) => fmt.isoDate(new Date(NOW - daysAgo * DAY));
    assert.ok(parseConsent(serializeConsent(true, { date: at(364) }), { now: NOW }));
    assert.equal(parseConsent(serializeConsent(true, { date: at(367) }), { now: NOW }), null);
    assert.equal(parseConsent(serializeConsent(true, { date: '2026-09-30' }), { now: NOW }), null);
    assert.ok(parseConsent(serializeConsent(true, { date: '2026-09-25' }), { now: NOW }), 'one day of time-zone tolerance');
  });

  test('consentCookie: 12-month Max-Age, Path=/, SameSite=Lax, Secure on https only', () => {
    const c = consentCookie('abc', { secure: true });
    assert.equal(c, `${CONSENT.cookieName}=abc; Max-Age=31536000; Path=/; SameSite=Lax; Secure`);
    assert.doesNotMatch(consentCookie('abc', { secure: false }), /Secure/);
  });

  test('gaCookieNames picks only Google Analytics cookies', () => {
    const jar = `_ga=GA1.1.2.3; _ga_${GA_ID.slice(2)}=GS1.1; inflaatio_cookie_consent=x; _gid=1; _gat_UA-1=1; _gaxyz=1; theme=dark`;
    assert.deepEqual(gaCookieNames(jar).sort(), ['_ga', `_ga_${GA_ID.slice(2)}`, '_gat_UA-1', '_gid'].sort());
    assert.deepEqual(gaCookieNames(''), []);
  });

  test('cookieDomains covers host-only, the host and the parent domain, with and without a dot', () => {
    assert.deepEqual(cookieDomains('www.inflaatio.fi'), ['', 'www.inflaatio.fi', '.www.inflaatio.fi', 'inflaatio.fi', '.inflaatio.fi']);
    assert.deepEqual(cookieDomains('inflaatio.fi'), ['', 'inflaatio.fi', '.inflaatio.fi']);
    assert.deepEqual(cookieDomains('localhost'), ['']);
    assert.deepEqual(cookieDomains('127.0.0.1'), ['']);
    assert.deepEqual(cookieDomains('[::1]'), ['']);
  });

  test('expireCookies deletes every name on every domain variant', () => {
    const out = expireCookies(['_ga', '_ga_ABC'], 'www.inflaatio.fi');
    assert.equal(out.length, 2 * 5);
    assert.ok(out.every((c) => /=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\//.test(c)));
    assert.ok(out.includes('_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=.inflaatio.fi'));
    assert.ok(out.includes('_ga_ABC=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'));
  });
});

describe('initConsent: GA cookies without a valid positive choice', () => {
  const GA_CONTAINER = `_ga_${GA_ID.slice(2)}`;

  test('shouldRevoke: everything but a current "analytics: true" revokes', () => {
    assert.equal(shouldRevoke({ analytics: true, date: '2026-09-20' }), false);
    assert.equal(shouldRevoke({ analytics: false, date: '2026-09-20' }), true);
    assert.equal(shouldRevoke(null), true, 'missing, outdated version, expired or malformed');
    assert.equal(shouldRevoke(undefined), true);
  });

  /**
   * Run initConsent() against a minimal document/window stub with a cookie
   * jar (Max-Age=0 deletes; the Domain attribute is ignored like a host-only jar).
   * @param {Record<string, string>} cookies
   */
  function runInit(cookies) {
    const jar = new Map(Object.entries(cookies));
    const banner = { hidden: true, contains: () => false };
    const doc = {
      get cookie() {
        return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      },
      set cookie(str) {
        const [pair, ...attrs] = str.split(';');
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
        else jar.set(name, pair.slice(eq + 1).trim());
      },
      getElementById: (id) => (id === 'evasteilmoitus' ? banner : null),
      addEventListener() {},
      documentElement: { classList: { add() {}, remove() {} } },
      activeElement: null,
    };
    const win = { location: { hostname: 'inflaatio.fi', protocol: 'https:' }, localStorage: { removeItem() {} } };
    const saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = doc;
    globalThis.window = win;
    try {
      initConsent();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    }
    return { names: [...jar.keys()].sort(), bannerShown: !banner.hidden, gaDisabled: win[`ga-disable-${GA_ID}`] === true };
  }

  const today = fmt.isoDate();
  const ga = { _ga: 'GA1.1.123.456', [GA_CONTAINER]: 'GS1.1.1' };

  test('a choice made under an older version (the old site) asks again AND deletes the _ga cookies', () => {
    const old = encodeURIComponent(JSON.stringify({ analytics: true, necessary: true, timestamp: '2026-09-01T10:00:00.000Z' }));
    const r = runInit({ ...ga, [CONSENT.cookieName]: old, theme: 'dark' });
    assert.equal(r.bannerShown, true);
    assert.deepEqual(r.names, [CONSENT.cookieName, 'theme'].sort(), 'GA cookies deleted, others kept');
    assert.equal(r.gaDisabled, true);
    const v1 = runInit({ ...ga, [CONSENT.cookieName]: serializeConsent(true, { version: CONSENT_VERSION - 1, date: today }) });
    assert.equal(v1.bannerShown, true);
    assert.deepEqual(v1.names, [CONSENT.cookieName]);
  });

  test('an expired positive choice asks again and deletes the _ga cookies', () => {
    const r = runInit({ ...ga, [CONSENT.cookieName]: serializeConsent(true, { date: '2020-01-01' }) });
    assert.equal(r.bannerShown, true);
    assert.deepEqual(r.names, [CONSENT.cookieName]);
  });

  test('no choice at all: banner, and stray GA cookies are deleted', () => {
    const r = runInit({ ...ga });
    assert.equal(r.bannerShown, true);
    assert.deepEqual(r.names, []);
  });

  test('a current refusal deletes the GA cookies without showing the banner', () => {
    const r = runInit({ ...ga, [CONSENT.cookieName]: serializeConsent(false, { date: today }) });
    assert.equal(r.bannerShown, false);
    assert.deepEqual(r.names, [CONSENT.cookieName]);
  });

  test('a current consent keeps the GA cookies and shows no banner', () => {
    const r = runInit({ ...ga, [CONSENT.cookieName]: serializeConsent(true, { date: today }) });
    assert.equal(r.bannerShown, false);
    assert.deepEqual(r.names, ['_ga', GA_CONTAINER, CONSENT.cookieName].sort());
    assert.equal(r.gaDisabled, false);
  });
});

describe('cookieless page-view counter (analytics.js)', () => {
  test('production hosts only', () => {
    assert.ok(isProductionHost('inflaatio.fi'));
    assert.ok(isProductionHost('www.inflaatio.fi'));
    assert.ok(isProductionHost('INFLAATIO.FI'));
    for (const h of ['localhost', '127.0.0.1', 'inflaatio.fly.dev', 'preview.inflaatio.fi', 'inflaatio.fi.evil.com', 'xinflaatio.fi', '']) {
      assert.equal(isProductionHost(h), false, h);
    }
  });

  test('Global Privacy Control and Do Not Track disable it', () => {
    assert.equal(privacySignal({}, {}), false);
    assert.equal(privacySignal({ globalPrivacyControl: true }, {}), true);
    assert.equal(privacySignal({ globalPrivacyControl: false, doNotTrack: '1' }, {}), true);
    assert.equal(privacySignal({ doNotTrack: 'yes' }, {}), true);
    assert.equal(privacySignal({ doNotTrack: '0' }, {}), false);
    assert.equal(privacySignal({ doNotTrack: 'unspecified' }, { doNotTrack: '1' }), true);
  });

  test('referrer is reduced to direct / internal / host name', () => {
    assert.equal(referrerCategory('', 'inflaatio.fi'), 'direct');
    assert.equal(referrerCategory('not a url', 'inflaatio.fi'), 'direct');
    assert.equal(referrerCategory('https://inflaatio.fi/hinnat/?q=kahvi', 'inflaatio.fi'), 'internal');
    assert.equal(referrerCategory('https://www.inflaatio.fi/', 'inflaatio.fi'), 'internal');
    assert.equal(referrerCategory('https://www.google.com/search?q=inflaatio+2026', 'inflaatio.fi'), 'google.com');
    assert.equal(referrerCategory('https://news.ycombinator.com/item?id=1', 'inflaatio.fi'), 'news.ycombinator.com');
    assert.equal(referrerCategory('android-app://com.google.android.gm/', 'inflaatio.fi'), 'com.google.android.gm');
    assert.equal(referrerCategory(`https://${'a'.repeat(120)}.fi/`, 'inflaatio.fi'), 'other');
  });

  test('device class from the primary pointer and the screen short side', () => {
    assert.equal(deviceClass({ coarse: false, shortSide: 390 }), 'desktop');
    assert.equal(deviceClass({ coarse: true, shortSide: 390 }), 'mobile');
    assert.equal(deviceClass({ coarse: true, shortSide: 820 }), 'tablet');
    assert.equal(deviceClass({ coarse: true, shortSide: Number.NaN }), 'mobile');
  });

  test('page path: canonical path, no query or hash, 404 normalised, capped length', () => {
    assert.equal(pagePath({ pathname: '/index.html', canonical: 'https://inflaatio.fi/' }), '/');
    assert.equal(pagePath({ pathname: '/hinnat/', canonical: null }), '/hinnat/');
    assert.equal(pagePath({ pathname: '/hinnat/?q=x#y', canonical: null }), '/hinnat/');
    assert.equal(pagePath({ pathname: '/matti.meikalainen@example.com', canonical: null, notFound: true }), '/404.html');
    assert.equal(pagePath({ pathname: `/${'a'.repeat(300)}` }).length, 200);
    assert.equal(pagePath({ pathname: '/x/', canonical: 'not a url' }), '/x/');
  });

  test('the payload contains exactly the documented fields and nothing identifying', () => {
    const p = pageViewPayload({
      pathname: '/vuokrankorotus/',
      canonical: 'https://inflaatio.fi/vuokrankorotus/',
      referrer: 'https://www.google.com/search?q=vuokrankorotus',
      hostname: 'inflaatio.fi',
      coarse: true,
      shortSide: 390,
    });
    assert.deepEqual(Object.keys(p), [...PAGE_VIEW_FIELDS]);
    assert.deepEqual(p, { event_type: 'page_view', page: '/vuokrankorotus/', referrer: 'google.com', device: 'mobile' });
    assert.doesNotMatch(JSON.stringify(p), /vuokrankorotus"?,?.*q=|search_query|session|date|count/);
  });

  test('retention and GA cookie lifetime constants', () => {
    assert.equal(RETENTION_MONTHS, 14);
    assert.equal(GA_COOKIE_MAX_AGE_DAYS, 365);
  });

  test('countsPageView: privacy signals, other hosts and our own preview frame are not counted', () => {
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false }), true);
    assert.equal(countsPageView({ hostname: 'www.inflaatio.fi', privacy: false, search: '?teema=tumma' }), true, 'a real embed with options');
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: true }), false);
    assert.equal(countsPageView({ hostname: 'localhost', privacy: false }), false);
    assert.equal(countsPageView({ hostname: 'inflaatio.fly.dev', privacy: false }), false);
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false, framedBySameOrigin: true }), false, 'preview iframe on /upotus/ohje/');
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false, search: '?esikatselu=1' }), false);
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false, search: '?teema=vaalea&esikatselu' }), false);
  });

  test('gaPageUrl drops the query string and hash (calculator inputs never reach GA)', () => {
    assert.equal(gaPageUrl('https://inflaatio.fi/ostovoima/?ennen=3200&nyt=3300#tulos'), 'https://inflaatio.fi/ostovoima/');
    assert.equal(gaPageUrl('https://inflaatio.fi/oma-inflaatio/?eurot=500,120,80'), 'https://inflaatio.fi/oma-inflaatio/');
    assert.equal(gaPageUrl('https://inflaatio.fi/'), 'https://inflaatio.fi/');
    assert.equal(gaPageUrl('https://www.google.com/'), 'https://www.google.com/');
    for (const bad of ['', null, undefined, 'not a url', 'android-app://com.google.android.gm/', 'mailto:matti@example.fi', 'data:text/plain,1']) {
      assert.equal(gaPageUrl(bad), '', String(bad));
    }
  });

  test('GA gets page_location/page_referrer without query strings and never loads in the bare widget', async () => {
    const src = await fs.readFile(new URL('../src/js/lib/analytics.js', import.meta.url), 'utf8');
    assert.match(src, /page_location: gaPageUrl\(window\.location\.href\)/);
    assert.match(src, /page_referrer: gaPageUrl\(document\.referrer\)/);
    assert.match(src, /window\.gtag\('set', page\)/);
    assert.match(src, /window\.gtag\('config', GA_ID, \{\s*\.\.\.page,/);
    assert.match(src, /window\.gtag\('event', event, \{ \.\.\.params, \.\.\.gaPageParams\(\) \}\)/);
    assert.match(src, /function loadGa\(\) \{\s*if \(isBarePage\(\) \|\|/);
    assert.match(src, /if \(isBarePage\(\)\) return;/);
  });

  test('GA event names are validated', () => {
    for (const ok of ['calculator_used', 'csv_download', 'share', 'widget_code_copied', 'contact_form_sent']) assert.ok(isValidEventName(ok), ok);
    for (const bad of ['', '1abc', 'with space', 'a'.repeat(41), 'x-y', null]) assert.equal(isValidEventName(bad), false, String(bad));
  });

  test('docs/supabase.sql matches the client: whitelist, columns, no anon select, 14-month retention', async () => {
    const sql = await fs.readFile(new URL('../docs/supabase.sql', import.meta.url), 'utf8');
    assert.match(sql, /enable row level security/);
    assert.match(sql, /grant insert \(event_type, page, referrer, device\) on table public\.inflaatio_analytics to anon;/);
    assert.match(sql, /revoke all on table public\.inflaatio_analytics from anon, authenticated;/);
    assert.match(sql, /event_type in \('page_view'\)/);
    assert.match(sql, /created_at\s+timestamptz not null default now\(\)/);
    assert.match(sql, new RegExp(`interval '${RETENTION_MONTHS} months'`));
    assert.match(sql, /cron\.schedule\(/);
    const code = sql.replace(/--.*$/gm, '');
    assert.doesNotMatch(code, /for select|grant select/i, 'no read access for the API roles');
    for (const f of PAGE_VIEW_FIELDS) assert.match(sql, new RegExp(`\\b${f}\\b`));
  });
});

describe('contact form validation (contact.js)', () => {
  test('valid input is trimmed; the name is optional', () => {
    const { values, errors } = validateContact({ name: '  ', email: ' matti@example.fi ', message: '  Hei, luku näyttää väärältä.  ' });
    assert.deepEqual(errors, {});
    assert.deepEqual(values, { name: '', email: 'matti@example.fi', message: 'Hei, luku näyttää väärältä.' });
  });

  test('errors in Finnish per field', () => {
    const { errors } = validateContact({ email: '', message: '' });
    assert.equal(errors.email, 'Anna sähköpostiosoite, johon voimme vastata.');
    assert.equal(errors.message, 'Kirjoita viesti.');
    assert.match(validateContact({ email: 'matti@', message: 'Hei hei' }).errors.email, /Tarkista sähköpostiosoite/);
    assert.match(validateContact({ email: 'a b@c.fi', message: 'Hei hei' }).errors.email, /Tarkista/);
  });

  test('touch screens focus the dialog title, not a field (no on-screen keyboard on open)', () => {
    assert.equal(initialFocusTarget(true), 'title');
    assert.equal(initialFocusTarget(false), 'field');
  });

  test('length limits are enforced (pasted text can exceed maxlength)', () => {
    assert.equal(CONTACT_LIMITS.message, 3000);
    const long = validateContact({ name: 'x'.repeat(CONTACT_LIMITS.name + 1), email: `${'a'.repeat(250)}@example.fi`, message: 'y'.repeat(CONTACT_LIMITS.message + 1) });
    assert.match(long.errors.name, /liian pitkä/);
    assert.match(long.errors.email, /Tarkista/);
    assert.match(long.errors.message, /liian pitkä \(3001 merkkiä, enintään 3000\)/);
    assert.equal(MIN_FILL_MS, 3000);
  });
});

describe('/menetelmat/ helpers', () => {
  test('formatPeriod and releaseTime', () => {
    assert.equal(formatPeriod(fmt, '2026-08'), 'elo 2026');
    assert.equal(formatPeriod(fmt, '2025'), '2025');
    assert.equal(formatPeriod(fmt, '2026-Q2'), '2. neljännes 2026');
    assert.equal(formatPeriod(fmt, null), fmt.DASH);
    assert.equal(releaseTime('08:00'), '8.00');
    assert.equal(releaseTime('12:00'), '12.00');
    assert.equal(releaseTime('8'), null);
  });

  test('upcomingReleases keeps only periods that are not in the data yet', () => {
    const cal = [
      { date: '2026-10-16', source: 'ykhi', period: '2026-09' },
      { date: '2026-09-17', source: 'ykhi', period: '2026-08' },
      { date: '2026-10-02', source: 'ykhi-ennakko', period: '2026-09' },
      { date: '2026-10-14', source: 'khi', period: '2026-09' },
      { date: '2026-09-14', source: 'khi', period: '2026-08' },
      { date: '2026-10-01', source: 'other', period: '2026-09' },
    ];
    const final = upcomingReleases(cal, { khi: { month: '2026-08' }, ykhi: { month: '2026-08', provisional: false } });
    assert.deepEqual(final.map((e) => `${e.source} ${e.period}`), ['ykhi-ennakko 2026-09', 'khi 2026-09', 'ykhi 2026-09']);
    const flash = upcomingReleases(cal, { khi: { month: '2026-08' }, ykhi: { month: '2026-08', provisional: true } });
    assert.ok(flash.some((e) => e.source === 'ykhi' && e.period === '2026-08'), 'final release of the flash month is still due');
    assert.deepEqual(upcomingReleases(undefined, {}), []);
  });

  test('officialVsMonthlyMean finds the latest year where the official figure differs', () => {
    const months = [];
    const yoy = [];
    for (const [y, vals] of [['2022', Array(12).fill(7.1)], ['2023', [...Array(6).fill(6.2), ...Array(6).fill(6.4)]], ['2024', Array(12).fill(1.6)]]) {
      vals.forEach((v, i) => {
        months.push(`${y}-${String(i + 1).padStart(2, '0')}`);
        yoy.push(v);
      });
    }
    const r = officialVsMonthlyMean(stats, { months, yoy }, { years: ['2022', '2023', '2024'], yoy: [7.1, 6.2, 1.6] });
    assert.deepEqual(r, { year: 2023, official: 6.2, mean: 6.3 });
    assert.equal(officialVsMonthlyMean(stats, { months, yoy }, { years: ['2022', '2024'], yoy: [7.1, 1.6] }), null);
    assert.equal(officialVsMonthlyMean(stats, null, null), null);
  });

  test('kkiBaseRows lists every base, newest first, with its first month and latest value', () => {
    const rows = kkiBaseRows({ months: ['2014-12', '2015-01', '2025-01'], index: { '1972=100': [900, 901, 927], '2025=100': [null, null, 101], '2015=100': [null, 100, 125] } });
    assert.deepEqual(rows, [
      { base: '2025=100', first: '2025-01', value: 101 },
      { base: '2015=100', first: '2015-01', value: 125 },
      { base: '1972=100', first: '2014-12', value: 927 },
    ]);
    assert.deepEqual(kkiBaseRows(null), []);
  });
});

describe('built TRUST pages', () => {
  let tmp;
  const pages = {};
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-trust-'));
    await build({ out: path.join(tmp, 'dist'), only: ['kayttoehdot', 'tietoa', 'menetelmat'], quiet: true });
    for (const p of ['kayttoehdot', 'tietoa', 'menetelmat']) pages[p] = await fs.readFile(path.join(tmp, 'dist', p, 'index.html'), 'utf8');
  });
  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  const title = (h) => h.match(/<title>([^<]*)<\/title>/)[1].replace(/&amp;/g, '&');
  const description = (h) => h.match(/<meta name="description" content="([^"]*)"/)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  test('titles ≤ 60, descriptions ≤ 155, canonical, breadcrumbs, JSON-LD', () => {
    for (const [p, h] of Object.entries(pages)) {
      assert.ok(title(h).length <= 60, `${p} title`);
      assert.ok(description(h).length <= 155, `${p} description`);
      assert.match(h, new RegExp(`<link rel="canonical" href="https://inflaatio\\.fi/${p}/">`));
      assert.match(h, /<nav class="breadcrumbs" aria-label="Murupolku">/);
      const ld = [...h.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((m) => JSON.parse(m[1]));
      assert.ok(ld.some((d) => d['@type'] === 'BreadcrumbList'), `${p} BreadcrumbList`);
      assert.ok(ld.some((d) => ['WebPage', 'AboutPage', 'TechArticle'].includes(d['@type'])), `${p} page JSON-LD`);
      assert.doesNotMatch(h, /reaaliaikai/i);
    }
  });

  test('/kayttoehdot/ is one document with the four anchors and a table of contents', () => {
    const h = pages.kayttoehdot;
    for (const id of ['kayttoehdot', 'tietosuoja', 'evasteet', 'vastuuvapaus', 'kavijatilasto', 'yhteydenotot', 'google-analytics', 'oikeutesi', 'lisenssit']) {
      assert.match(h, new RegExp(`id="${id}"`), id);
    }
    assert.match(h, /<nav class="toc toc--sticky" aria-label="Sisällys" data-scrollspy>/);
    for (const id of ['kayttoehdot', 'tietosuoja', 'evasteet', 'vastuuvapaus']) assert.match(h, new RegExp(`href="#${id}"`));
    assert.doesNotMatch(h, /role="tab"/);
  });

  test('/kayttoehdot/ describes what the code actually does', () => {
    const t = textOf(pages.kayttoehdot);
    assert.match(t, new RegExp(CONSENT.cookieName));
    assert.match(t, new RegExp(`_ga_${GA_ID.replace(/^G-/, '')}`));
    assert.match(t, /Opak Oy \(Y-tunnus 2950233-8\)/);
    assert.match(t, /Kivikastintie 24, 65300 Vaasa/);
    assert.match(t, new RegExp(`${RETENTION_MONTHS} kuukauden kuluttua`));
    assert.match(t, /Supabase/);
    assert.match(t, /EmailJS/);
    assert.match(t, /Fly\.io/);
    assert.match(t, /Cloudflare/);
    assert.match(t, /Tietosuojavaltuutetun toimisto/);
    assert.match(t, /Global Privacy Control/);
    assert.match(t, /CC BY 4\.0/);
    assert.match(t, /Saat lainata ja jakaa/);
    assert.doesNotMatch(t, /26 kuukautta|Helsingin käräjäoikeu|anonymize_ip/);
    assert.doesNotMatch(t, /@inflaatio\.fi/, 'no unverified e-mail address');
    // Consent button (JS) + a no-JS explanation.
    assert.match(pages.kayttoehdot, /data-open-consent=""/);
    assert.match(pages.kayttoehdot, /class="no-js-only"/);
  });

  test('/tietoa/ and /menetelmat/ show numbers with month and source from the data', () => {
    const t = textOf(pages.tietoa);
    assert.match(t, /Opak Oy/);
    assert.match(t, /Muutosloki/);
    assert.match(pages.tietoa, /data-open-contact=""/);
    for (const href of ['/menetelmat/', '/data/', '/feed.xml', '/kayttoehdot/']) assert.match(pages.tietoa, new RegExp(`href="${href}"`));
    const m = textOf(pages.menetelmat);
    for (const id of ['khi-ja-ykhi', 'vuosiluvut', 'kuukausimuutos', 'keskimaarainen-muutos', 'perusvuodet', 'ennakkotiedot', 'paivitykset', 'lahteet']) {
      assert.match(pages.menetelmat, new RegExp(`id="${id}"`), id);
    }
    assert.match(m, /2025=100/);
    assert.match(m, /1951:10=100/);
    assert.match(m, /%-yks\./);
    assert.match(m, /prc_hicp_minr/);
    assert.match(m, /122q/);
    // Finnish number formatting only: NBSP before %, no dot decimals before %.
    for (const h of Object.values(pages)) {
      const text = textOf(h);
      assert.doesNotMatch(text, /\d %/, 'space before % must be NBSP');
      assert.doesNotMatch(text, /\d\.\d\s?%/, 'decimal comma');
    }
  });

  test('update and changelog claims match the workflow and the fetch pipeline', async () => {
    const wf = await fs.readFile(new URL('../.github/workflows/update-data.yml', import.meta.url), 'utf8');
    const crons = [...wf.matchAll(/^\s*-\s*cron:/gm)].length;
    assert.equal(crons, 2, 'the pages say the data is checked twice a day');
    const m = textOf(pages.menetelmat);
    const t = textOf(pages.tietoa);
    assert.match(m, /kahdesti päivässä/);
    assert.match(t, /kahdesti päivässä/);
    for (const text of [m, t]) {
      assert.doesNotMatch(text, /julkaisuaamuina useammin|joka päivä ja|näyttää uusimman luvun heti/);
      assert.match(text, /seuraavan kuukauden puolivälissä/);
      assert.match(text, /noin kaksi viikkoa myöhemmin/);
    }
    // Changelog: exactly the sources that emit events.
    const logged = SOURCES.filter((s) => typeof s.events === 'function').map((s) => s.key).sort();
    assert.deepEqual(logged, ['ansiot', 'khi', 'korot', 'ykhi']);
    assert.match(t, /kirjaa muutoslokiin kuluttajahintaindeksin, YKHI:n ja ansiotasoindeksin uudet julkaisut sekä EKP:n talletuskoron muutokset/);
  });

  test('corrected claims: longest index, hand-entered forecasts, licences, legal basis', () => {
    const m = textOf(pages.menetelmat);
    const t = textOf(pages.tietoa);
    const k = textOf(pages.kayttoehdot);
    assert.doesNotMatch(m, /pisin yhtäjaksoinen/);
    assert.match(m, /vuokrasopimuksissa yleisimmin käytetty hintaindeksi/);
    assert.doesNotMatch(m, /virallinen vuosiluku|ulottuu vuoteen 1995/);
    assert.match(m, /Perusvuoden 2025=100 sarja alkaa vuodesta 1995/);
    assert.match(m, /itse lasketut luvut on merkitty/);
    assert.match(m, /elinkustannusindeksi julkaistaan kokonaislukuina/);
    assert.match(pages.menetelmat, /<span class="sr-only"> potenssiin \(12 jaettuna n:llä\)<\/span><sup aria-hidden="true">/);
    assert.doesNotMatch(description(pages.menetelmat), /vuosiluku/);
    assert.match(t, /Kaikki tilastoluvut haetaan suoraan/);
    assert.match(t, /inflaatioennusteet, jotka kirjataan käsin/);
    assert.doesNotMatch(t, /matalammat/);
    assert.doesNotMatch(k, /lisenssillä\s+CC BY 4\.0/);
    assert.match(k, /tilastotietoihin sovelletaan alla lueteltuja tuottajien lisenssejä/);
    assert.match(k, /Välttämätön eväste \(ei vaadi suostumusta\)/);
    assert.doesNotMatch(k, /Välttämätön valintasi toteuttamiseksi/);
    assert.match(k, /tarkistetaan automaattisesti ennen julkaisua/);
    assert.match(k, /Tilastokeskuksen ansiotasoindeksin uusimmat neljännekset/);
    assert.match(k, /ilman hakuparametreja, joten esimerkiksi laskureihin syöttämäsi summat eivät välity Googlelle/);
  });

  test('layout dialogs: consent settings and contact form wired to the policy', () => {
    const h = pages.kayttoehdot;
    assert.match(h, /<dialog class="dialog" id="evasteasetukset"/);
    assert.match(h, /data-consent="necessary">Vain välttämättömät<\/button>[\s\S]*data-consent="analytics">Salli analytiikka<\/button>[\s\S]*data-consent-save>Tallenna valinnat<\/button>/);
    assert.match(h, /<label class="check__label" for="evaste-analytiikka">Analytiikka \(Google Analytics\)<\/label>/);
    assert.match(h, /data-fallback="Voit myös lähettää viestin postitse: Opak Oy, Kivikastintie 24, 65300 Vaasa\."/);
    assert.match(h, /id="yhteys-email"[^>]*maxlength="254"/);
    assert.match(h, /id="yhteys-viesti"[^>]*maxlength="3000"/);
    assert.match(h, /href="\/kayttoehdot\/#yhteydenotot"/);
    assert.match(h, /href="\/kayttoehdot\/#kavijatilasto"/);
  });
});
