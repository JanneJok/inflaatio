/**
 * Cross-module integration checks (phase-2 integrator): the page registry,
 * navigation and footer agree with the page modules; English pages get
 * English chrome; shared components accept a language; the default share
 * image alt text is built from the data.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, ROOT } from '../scripts/build.js';
import site, { NAV, NAV_EN, FOOTER, FOOTER_EN, PAGES, OPERATOR } from '../src/site.config.js';
import { breadcrumb, sourceLine, field, pageHeader, legend } from '../src/templates/components.js';
import { validateContact } from '../src/js/lib/contact.js';
import { LEVEL_BANDS } from '../src/js/lib/stats.js';

const NBSP = ' ';

describe('page registry, navigation and footer', () => {
  test('every registry module exists as a page module', () => {
    for (const [route, p] of Object.entries(PAGES)) {
      assert.ok(existsSync(path.join(ROOT, 'src', 'pages', `${p.module}.js`)), `${route}: src/pages/${p.module}.js`);
    }
  });

  test('the English calculators are registered to the module that builds them', () => {
    assert.equal(PAGES['/en/rent-increase-calculator/'].module, 'en-calculators');
    assert.equal(PAGES['/en/value-of-money/'].module, 'en-calculators');
  });

  test('every nav and footer link points to a registered route', () => {
    const links = [...NAV, ...NAV_EN, ...FOOTER.flatMap((c) => c.links), ...FOOTER_EN.flatMap((c) => c.links)].filter((l) => l.href);
    for (const l of links) assert.ok(PAGES[l.href], `${l.label}: ${l.href} is in PAGES`);
  });

  test('operator address lives in site.config', () => {
    assert.deepEqual({ ...OPERATOR.address }, { street: 'Kivikastintie 24', postalCode: '65300', city: 'Vaasa' });
    assert.equal(site.navEn, NAV_EN);
    assert.equal(site.footerEn, FOOTER_EN);
  });
});

describe('shared components with a language', () => {
  test('breadcrumb label, sourceLine and optional marker in English', () => {
    assert.match(String(breadcrumb([{ name: 'Home', href: '/' }, { name: 'X' }], { label: 'Breadcrumb' })), /aria-label="Breadcrumb"/);
    assert.match(String(breadcrumb([{ name: 'Etusivu', href: '/' }, { name: 'X' }])), /aria-label="Murupolku"/);
    const en = String(sourceLine({ sources: [{ name: 'Statistics Finland' }], updated: '2026-09-14T05:00:00Z', lang: 'en' }));
    assert.match(en, /Source: Statistics Finland · Updated <time datetime="2026-09-14">14 September 2026<\/time>/);
    assert.match(String(sourceLine({ sources: [{ name: 'A' }, { name: 'B' }], lang: 'en' })), /Sources: A, B/);
    assert.match(String(sourceLine({ sources: [{ name: 'Tilastokeskus' }], updated: '2026-09-14T05:00:00Z' })), /Lähde: Tilastokeskus · Päivitetty/);
    assert.match(String(field({ id: 'x', label: 'Name', optional: true, lang: 'en' })), /\(optional\)/);
    assert.match(String(field({ id: 'x', label: 'Nimi', optional: true })), /\(valinnainen\)/);
  });

  test('pageHeader meta may hold block markup (rendered in a div)', () => {
    const h = String(pageHeader({ title: 'T', meta: sourceLine({ sources: [{ name: 'Tilastokeskus' }] }) }));
    assert.match(h, /<div class="page-header__meta"><p class="source-line">/);
  });

  test('legend items can start hidden and carry a data hook', () => {
    const l = String(legend([{ cls: 'khi', label: 'KHI' }, { cls: 'ea', label: 'Euroalue', hidden: true, key: 'ea' }]));
    assert.match(l, /<li class="legend__item" hidden data-series="ea">/);
    assert.match(l, /<li class="legend__item"><span/);
  });

  test('contact form validation messages in English', () => {
    const { errors } = validateContact({ email: '', message: '' }, 'en');
    assert.match(errors.email, /Enter an email address/);
    assert.match(errors.message, /Write a message/);
    assert.match(validateContact({ email: 'x@', message: 'Hello there' }, 'en').errors.email, /Check the email address/);
    assert.match(validateContact({ email: '', message: '' }).errors.email, /Anna sähköpostiosoite/);
  });

  test('level band labels use a no-break space before %', () => {
    for (const b of LEVEL_BANDS) assert.ok(!/\d %/.test(b.label), `${b.label} has a normal space`);
    assert.ok(LEVEL_BANDS.some((b) => b.label.includes(`${NBSP}%`)));
  });
});

describe('built pages', () => {
  let tmp;
  let out;
  const read = (p) => fs.readFile(path.join(out, p), 'utf8');

  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-integration-'));
    out = path.join(tmp, 'dist');
    await build({ out, only: ['home', 'en', 'en-calculators'], quiet: true });
  });

  after(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  });

  test('English pages have English chrome', async () => {
    for (const p of ['en/index.html', 'en/rent-increase-calculator/index.html', 'en/value-of-money/index.html']) {
      const doc = await read(p);
      assert.match(doc, /<html lang="en">/, p);
      assert.match(doc, /<a class="skip-link" href="#main">Skip to content<\/a>/, p);
      assert.match(doc, /aria-label="Main menu"/, p);
      assert.match(doc, /<a class="site-nav__link" href="\/" lang="fi" hreflang="fi">Suomeksi<\/a>/, p);
      assert.match(doc, /Necessary only/, p);
      assert.match(doc, /Contact us/, p);
      assert.match(doc, /Operated by Opak Oy/, p);
      assert.match(doc, /data-label-close="Close menu"/, p);
      for (const fi of ['Siirry sisältöön', 'Päävalikko', 'Murupolku', 'Vain välttämättömät', 'Ota yhteyttä', 'Alatunniste', '(valinnainen)']) {
        assert.ok(!doc.includes(fi), `${p}: Finnish chrome "${fi}"`);
      }
      assert.match(doc, /<meta property="og:image:alt" content="[^"]*Inflation in Finland/, p);
    }
  });

  test('home page: Finnish chrome, hreflang pair and a data-based share image alt', async () => {
    const doc = await read('index.html');
    assert.match(doc, /<html lang="fi">/);
    assert.match(doc, /Siirry sisältöön/);
    assert.match(doc, /<link rel="alternate" hreflang="en" href="https:\/\/inflaatio\.fi\/en\/">/);
    assert.match(doc, /<link rel="alternate" hreflang="x-default" href="https:\/\/inflaatio\.fi\/">/);
    assert.match(doc, /<meta property="og:image:alt" content="Inflaatio Suomessa [a-zäö]+ssa \d{4}: \d+,\d(&nbsp;| )% \(Tilastokeskus\)/);
    assert.match(doc, /data-label-open="Avaa valikko"/);
  });
});
