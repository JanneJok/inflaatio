import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkLinks, resolveRef } from '../scripts/check-links.js';

test('resolveRef: internal, external, fragments, same-origin absolute URLs', () => {
  const base = 'https://inflaatio.fi';
  assert.deepEqual(resolveRef('/hinnat/#kahvi', '/', base), { path: '/hinnat/', hash: 'kahvi' });
  assert.deepEqual(resolveRef('https://inflaatio.fi/og/x.png', '/a/', base), { path: '/og/x.png', hash: '' });
  assert.deepEqual(resolveRef('../b/', '/a/c/', base), { path: '/a/b/', hash: '' });
  assert.equal(resolveRef('https://stat.fi/', '/', base), null);
  assert.equal(resolveRef('mailto:x@y.fi', '/', base), null);
  assert.ok(resolveRef(['java', 'script:void(0)'].join(''), '/', base).error);
});

test('checkLinks finds missing targets, fragments and aria references', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inflaatio-links-'));
  try {
    const w = async (rel, body) => {
      const f = path.join(dir, ...rel.split('/'));
      await fs.mkdir(path.dirname(f), { recursive: true });
      await fs.writeFile(f, body);
    };
    await w(
      'index.html',
      `<a href="/a/">ok</a><a href="/puuttuu/">x</a><a href="/a/#osio">ok</a><a href="/a/#eiole">x</a>
       <a href="#paikallinen">ok</a><button aria-controls="valikko">x</button><a href="/a">redir</a>
       <img src="/kuva.png" alt=""><a href="https://example.com/">ext</a><span id="paikallinen"></span>
       <script type="application/ld+json">{"u":"<a href=\\"/json/\\">"}</script>`,
    );
    await w('a/index.html', '<h2 id="osio">x</h2>');
    await w('kuva.png', 'png');
    await w('sitemap.xml', '<urlset><url><loc>https://inflaatio.fi/a/</loc></url><url><loc>https://inflaatio.fi/vanha/</loc></url></urlset>');
    const { errors, warnings, pages } = await checkLinks({ dir });
    assert.equal(pages, 2);
    assert.equal(errors.length, 4, errors.join('\n'));
    assert.ok(errors.some((e) => e.includes('/puuttuu/')));
    assert.ok(errors.some((e) => e.includes('#eiole not found')));
    assert.ok(errors.some((e) => e.includes('aria-controls') && e.includes('#valikko')));
    assert.ok(errors.some((e) => e.startsWith('sitemap.xml') && e.includes('/vanha/')));
    assert.ok(warnings.some((w2) => w2.includes('redirect')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
