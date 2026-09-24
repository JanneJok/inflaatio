/**
 * Design-token regression tests: WCAG contrast of the colour tokens in both
 * themes, light/dark block consistency and theme-colour consistency between
 * tokens.css, site.config.js and theme-boot.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../scripts/build.js';
import { THEME_COLORS } from '../src/site.config.js';

const tokensCss = await fs.readFile(path.join(ROOT, 'src', 'css', 'tokens.css'), 'utf8');

/** Custom properties of the first block whose selector starts with `selector`. */
function block(selector, from = 0) {
  const i = tokensCss.indexOf(selector, from);
  assert.ok(i >= 0, `block ${selector}`);
  const open = tokensCss.indexOf('{', i);
  const close = tokensCss.indexOf('}', open);
  const vars = {};
  for (const m of tokensCss.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

const light = block(":root,\n[data-theme='light']");
const darkMedia = block(":root:not([data-theme='light'])");
const dark = block("[data-theme='dark'] {", tokensCss.indexOf("@media (prefers-color-scheme: dark)") + 200);

const lum = (hex) => {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXT = ['--text', '--text-2', '--text-3', '--brand', '--series-khi', '--series-ykhi-text', '--series-ea', '--series-core', '--series-3', '--series-4', '--series-5', '--series-6', '--target', '--delta-up', '--delta-down', '--delta-flat'];
const GRAPHIC = ['--series-ykhi', '--infl-deflation', '--infl-low', '--infl-elevated', '--infl-high', '--border-control', '--focus'];
const SURFACES = ['--bg', '--surface', '--surface-2'];

for (const [name, t] of [['light', light], ['dark', dark]]) {
  test(`${name} theme: text tokens ≥ 4.5:1 and graphics ≥ 3:1 on every surface`, () => {
    for (const s of SURFACES) {
      for (const tok of TEXT) assert.ok(ratio(t[tok], t[s]) >= 4.5, `${name} ${tok} on ${s}: ${ratio(t[tok], t[s]).toFixed(2)}`);
      for (const tok of GRAPHIC) assert.ok(ratio(t[tok], t[s]) >= 3, `${name} ${tok} on ${s}: ${ratio(t[tok], t[s]).toFixed(2)}`);
    }
    for (const d of ['up', 'down', 'flat']) {
      const r = ratio(t[`--delta-${d}`], t[`--delta-${d}-soft`]);
      assert.ok(r >= 4.5, `${name} delta-${d} on soft ${r.toFixed(2)}`);
    }
    assert.ok(ratio(t['--on-brand'], t['--brand']) >= 4.5, `${name} on-brand`);
    assert.ok(ratio(t['--on-brand'], t['--brand-hover']) >= 4.5, `${name} on-brand hover`);
    assert.ok(ratio(t['--brand'], t['--brand-soft']) >= 4.5, `${name} brand on brand-soft`);
  });
}

test('SPEC corrections are in place', () => {
  assert.equal(light['--text-3'], '#56616D');
  assert.equal(light['--series-ykhi-text'], '#9C5205');
});

test('dark tokens are identical in the media query and [data-theme="dark"]', () => {
  assert.deepEqual(darkMedia, dark);
  for (const k of Object.keys(dark)) assert.ok(k in light, `${k} also defined for light`);
});

test('theme colours agree across tokens.css, site.config.js and theme-boot.js', async () => {
  assert.equal(THEME_COLORS.light, light['--bg']);
  assert.equal(THEME_COLORS.dark, dark['--bg']);
  const boot = await fs.readFile(path.join(ROOT, 'src', 'js', 'theme-boot.js'), 'utf8');
  assert.ok(boot.includes(`'${THEME_COLORS.light}'`) && boot.includes(`'${THEME_COLORS.dark}'`));
});
