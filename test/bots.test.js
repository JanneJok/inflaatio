// Bots and automated browsers are not counted (src/js/lib/analytics.js,
// since 2026-09-30): the pure detector, and the real pageView() run against a
// minimal fake browser – a human browser sends exactly one page-view insert,
// a crawler or an automated browser sends nothing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_UA_RE, countsPageView, isAutomatedBrowser } from '../src/js/lib/analytics.js';

const HUMANS = {
  'Chrome, Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Safari, iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Firefox, Linux': 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Samsung Internet': 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  'Edge, Mac': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  'Facebook in-app browser': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0;]',
  'Cubot phone (brand, not a bot)': 'Mozilla/5.0 (Linux; Android 13; CUBOT X70) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
};

const BOTS = {
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Googlebot smartphone (runs JavaScript)':
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Google-InspectionTool': 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
  GoogleOther: 'Mozilla/5.0 (compatible; GoogleOther)',
  'AdsBot-Google': 'AdsBot-Google (+http://www.google.com/adsbot.html)',
  YandexBot: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
  Applebot: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Baidu spider': 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  'generic crawler': 'SomeCompany-Crawler/1.0 (+https://example.com)',
  HeadlessChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/129.0.0.0 Safari/537.36',
  Lighthouse: 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  PageSpeed: 'Mozilla/5.0 (compatible; Google Page Speed Insights) PageSpeed',
  Playwright: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Playwright/1.56',
  Puppeteer: 'Mozilla/5.0 Puppeteer',
  facebookexternalhit: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'uptime monitor': 'Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
  curl: 'curl/8.9.1',
  'python-requests': 'python-requests/2.32.3',
  empty: '',
};

describe('bot and automated-browser detection', () => {
  test('real browsers (also in-app browsers and a Cubot phone) are not bots', () => {
    for (const [name, ua] of Object.entries(HUMANS)) {
      assert.equal(isAutomatedBrowser({ userAgent: ua, webdriver: false }), false, name);
    }
  });

  test('crawlers, headless/test browsers, previews, monitors and HTTP libraries are bots', () => {
    for (const [name, ua] of Object.entries(BOTS)) {
      assert.equal(isAutomatedBrowser({ userAgent: ua }), true, name);
    }
    assert.equal(isAutomatedBrowser({ userAgent: null }), true, 'missing User-Agent');
    assert.ok(BOT_UA_RE.flags.includes('i'));
  });

  test('navigator.webdriver marks any browser as automated, whatever its User-Agent', () => {
    assert.equal(isAutomatedBrowser({ userAgent: HUMANS['Chrome, Windows'], webdriver: true }), true);
  });

  test('countsPageView: a bot is never counted, a real browser is', () => {
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false, bot: false }), true);
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false, bot: true }), false);
    assert.equal(countsPageView({ hostname: 'inflaatio.fi', privacy: false }), true, 'bot defaults to false');
  });
});

/**
 * Runs the real pageView() of analytics.js in a minimal fake browser on
 * https://inflaatio.fi/hinnat/ and returns the bodies it POSTed.
 * @param {{userAgent: string, webdriver?: boolean, doNotTrack?: string|null, gpc?: boolean}} o
 */
async function pageViewsSent({ userAgent, webdriver = false, doNotTrack = null, gpc = false }, n) {
  const posts = [];
  const listeners = {};
  const fakeWindow = {
    location: { hostname: 'inflaatio.fi', pathname: '/hinnat/', search: '', origin: 'https://inflaatio.fi', href: 'https://inflaatio.fi/hinnat/' },
    matchMedia: () => ({ matches: false }),
    screen: { width: 1920, height: 1080 },
    requestIdleCallback: (cb) => cb(),
    setTimeout: (cb) => cb(),
    addEventListener: (type, cb) => {
      listeners[type] = cb;
    },
  };
  fakeWindow.top = fakeWindow;
  fakeWindow.self = fakeWindow;
  const saved = {};
  const globals = {
    window: fakeWindow,
    document: {
      readyState: 'complete',
      referrer: 'https://www.google.com/',
      prerendering: false,
      cookie: '',
      body: { dataset: { page: 'hinnat' }, classList: { contains: () => false } },
      querySelector: () => ({ getAttribute: () => 'https://inflaatio.fi/hinnat/' }),
      addEventListener: () => {},
    },
    navigator: { userAgent, webdriver, doNotTrack, globalPrivacyControl: gpc },
    fetch: async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: true };
    },
  };
  for (const [k, v] of Object.entries(globals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try {
    // A fresh module instance per case (pageView() runs once per page load).
    const mod = await import(`../src/js/lib/analytics.js?case=${n}`);
    mod.pageView();
    await new Promise((r) => setImmediate(r));
  } finally {
    for (const [k, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  }
  return posts;
}

describe('pageView() in a fake browser', () => {
  let n = 0;

  test('a real browser sends exactly one minimised page view', async () => {
    for (const [name, ua] of Object.entries(HUMANS)) {
      const posts = await pageViewsSent({ userAgent: ua }, ++n);
      assert.equal(posts.length, 1, name);
      assert.match(posts[0].url, /\/rest\/v1\/inflaatio_analytics$/);
      assert.deepEqual(posts[0].body, { event_type: 'page_view', page: '/hinnat/', referrer: 'google.com', device: 'desktop' });
    }
  });

  test('Googlebot, other crawlers and automated browsers send nothing', async () => {
    for (const [name, ua] of Object.entries(BOTS)) {
      assert.deepEqual(await pageViewsSent({ userAgent: ua }, ++n), [], name);
    }
    assert.deepEqual(await pageViewsSent({ userAgent: HUMANS['Chrome, Windows'], webdriver: true }, ++n), [], 'navigator.webdriver');
  });

  test('privacy signals are still respected (GPC, Do Not Track)', async () => {
    assert.deepEqual(await pageViewsSent({ userAgent: HUMANS['Firefox, Linux'], gpc: true }, ++n), []);
    assert.deepEqual(await pageViewsSent({ userAgent: HUMANS['Firefox, Linux'], doNotTrack: '1' }, ++n), []);
  });
});
