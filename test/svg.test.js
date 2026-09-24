import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineChart, barChart, hBarChart, sparkline, niceScale, monthTicks, SERIES_CLASSES } from '../scripts/lib/svg.js';
import { SafeString } from '../scripts/lib/html.js';
import { cspProblems } from '../scripts/build.js';
import { ymAdd } from '../src/js/lib/format.js';

const months = (start, n) => Array.from({ length: n }, (_, i) => ymAdd(start, i));

test('niceScale produces 1-2-5 steps covering the range', () => {
  const s = niceScale(-0.2, 9.1, 5);
  assert.equal(s.step, 2);
  // slightly negative data extends the axis by a fifth of a step only
  assert.equal(s.min, -0.4);
  assert.equal(s.max, 10);
  assert.deepEqual(s.ticks, [0, 2, 4, 6, 8, 10]);
  const neg = niceScale(-3.1, 9.1, 5);
  assert.equal(neg.min, -5);
  assert.deepEqual(neg.ticks, [-5, 0, 5, 10]);
  const flat = niceScale(2, 2);
  assert.ok(flat.min < 2 && flat.max > 2);
  const small = niceScale(0.1, 0.9, 4);
  assert.equal(small.step, 0.2);
});

test('monthTicks: years for long ranges, months (January = year) for short', () => {
  const long = monthTicks(months('2021-08', 61));
  assert.deepEqual(long.map((t) => t.text), ['2022', '2023', '2024', '2025', '2026']);
  const all = monthTicks(months('1980-01', 560));
  assert.ok(all.length <= 10);
  assert.ok(all.every((t) => Number(t.text) % 5 === 0));
  assert.ok(all.some((t) => t.minor) && !all.at(-1).minor);
  // Short ranges: a fixed calendar step counted from January, so ticks are
  // evenly spaced ('syys · marras · 2026 · maalis · touko · heinä').
  const year = monthTicks(months('2025-08', 13));
  assert.deepEqual(year.map((t) => t.text), ['syys', 'marras', '2026', 'maalis', 'touko', 'heinä']);
  const gaps = (ticks) => ticks.slice(1).map((t, i) => t.index - ticks[i].index);
  assert.ok(gaps(year).every((g) => g === 2), 'every 2 months');
  // Phones show every other tick; the January (year) tick stays visible.
  assert.deepEqual(year.filter((t) => !t.minor).map((t) => t.text), ['syys', '2026', 'touko']);
  const y2022 = monthTicks(months('2022-01', 12));
  assert.deepEqual(y2022.map((t) => t.text), ['2022', 'maalis', 'touko', 'heinä', 'syys', 'marras']);
  const two = monthTicks(months('2024-08', 25));
  assert.ok(gaps(two).every((g) => g === 3), 'every 3 months');
  assert.ok(two.every((t) => /^(2025|2026|huhti|heinä|loka)$/.test(t.text)), two.map((t) => t.text).join());
  assert.ok(gaps(two.filter((t) => !t.minor)).every((g) => g === 6), 'phones: every 6 months');
});

test('lineChart renders an accessible, class-styled, CSP-safe SVG', () => {
  const labels = months('2024-01', 24);
  const khi = labels.map((_, i) => 1 + Math.sin(i / 3));
  const ykhi = labels.map((_, i) => (i < 3 || i === 10 ? null : 1.5 + Math.cos(i / 4)));
  const out = lineChart({
    series: [
      { values: khi, cls: 'khi', label: 'KHI' },
      { values: ykhi, cls: 'ykhi', label: 'YKHI' },
    ],
    labels,
    refLines: [{ value: 2, cls: 'target', label: 'EKP:n tavoite 2 % <x>' }],
    ariaLabel: 'Vuosi-inflaatio "testi" <b>',
  });
  assert.ok(out instanceof SafeString);
  const s = String(out);
  assert.match(s, /^<svg [^>]*role="img"/);
  assert.match(s, /aria-label="Vuosi-inflaatio &quot;testi&quot; &lt;b&gt;"/);
  assert.match(s, /class="chart-svg chart-svg--line"/);
  assert.match(s, /class="chart-line chart-line--khi"/);
  assert.match(s, /class="chart-line chart-line--ykhi"/);
  assert.match(s, /class="chart-ref chart-ref--target"/);
  assert.match(s, /EKP:n tavoite 2 % &lt;x&gt;/);
  assert.match(s, /viewBox="0 0 1000 \d+" preserveAspectRatio="none"/);
  assert.match(s, /vector-effect="non-scaling-stroke"/);
  // the YKHI line has gaps → two separate sub paths
  const ykhiPath = s.match(/chart-line--ykhi" d="([^"]+)"/)[1];
  assert.equal((ykhiPath.match(/M/g) ?? []).length, 2);
  assert.equal((s.match(/class="chart-dot /g) ?? []).length, 2);
  assert.equal((s.match(/class="chart-endlabel /g) ?? []).length, 2);
  assert.doesNotMatch(s, /\sstyle=/);
  assert.deepEqual(cspProblems(`<div>${s}</div>`), []);
});

test('lineChart validates its input', () => {
  const labels = months('2024-01', 3);
  assert.throws(() => lineChart({ series: [{ values: [1, 2, 3] }], labels }), /ariaLabel/);
  assert.throws(() => lineChart({ series: [{ values: [1, 2] }], labels, ariaLabel: 'x' }), /expected 3/);
  assert.throws(() => lineChart({ series: [{ values: [1, 2, 3], cls: 'red' }], labels, ariaLabel: 'x' }), /unknown series class/);
});

test('sparkline has no axis text', () => {
  const s = String(sparkline([1, 2, 1.5, 2.2], { ariaLabel: 'KHI 24 kk', refLines: [{ value: 0, cls: 'muted' }] }));
  assert.match(s, /chart-svg--spark/);
  assert.doesNotMatch(s, /<text/);
  assert.match(s, /chart-dot--khi/);
});

test('barChart: one rect per value, partial and level classes, negative bars', () => {
  const bars = [
    { label: '2014', value: 1, cls: 'low' },
    { label: '2015', value: -0.2, cls: 'deflation' },
    { label: '2016', value: null },
    { label: '2022', value: 7.1, cls: 'high' },
    { label: '2026', value: 1.5, cls: 'low', partial: true },
  ];
  const s = String(barChart({ bars, ariaLabel: 'Vuosi-inflaatio', refLines: [{ value: 2, cls: 'target' }] }));
  assert.equal((s.match(/<rect /g) ?? []).length, 4);
  assert.match(s, /chart-bar chart-bar--low chart-bar--partial/);
  assert.match(s, /chart-bar--deflation/);
  assert.match(s, /<title>2022: 7,1\s%<\/title>/);
  assert.match(s, /class="chart-bar-value"/);
  assert.match(s, /chart-grid--zero/);
  assert.deepEqual(cspProblems(s), []);
});

test('barChart thins year labels for long series', () => {
  const bars = Array.from({ length: 47 }, (_, i) => ({ label: String(1980 + i), value: i % 7 }));
  const s = String(barChart({ bars, ariaLabel: 'x' }));
  const labels = [...s.matchAll(/chart-axis--x[^>]*>(\d{4})</g)].map((m) => Number(m[1]));
  assert.ok(labels.length <= 12);
  assert.ok(labels.every((y) => y % 5 === 0));
  assert.doesNotMatch(s, /chart-bar-value/);
});

test('hBarChart: labels, values, negative bars and truncation', () => {
  const s = String(
    hBarChart({
      ariaLabel: 'Vaikutukset',
      bars: [
        { label: 'Liikenne', value: 0.52 },
        { label: 'Asuminen, vesi, sähkö, kaasu ja muut polttoaineet', value: -0.18 },
      ],
    }),
  );
  assert.match(s, /chart-hbar chart-hbar--pos/);
  assert.match(s, /chart-hbar chart-hbar--neg/);
  assert.match(s, /\+0,52\s%\u2011yks\./); // non-breaking hyphen (format.js PP_UNIT)
  assert.match(s, /−0,18\s%\u2011yks\./);
  assert.match(s, /…<title>Asuminen, vesi, sähkö, kaasu ja muut polttoaineet<\/title>/);
  assert.match(s, /chart-grid--zero/);
});

test('every series class has CSS', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/css/components.css', import.meta.url), 'utf8');
  for (const cls of SERIES_CLASSES) {
    assert.ok(css.includes(`--${cls} `) || css.includes(`--${cls},`) || css.includes(`--${cls}{`), `missing CSS for ${cls}`);
  }
});
