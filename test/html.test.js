import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, attrs, classes, join, escapeHtml, safeJson, jsonLd, jsonScript, SafeString, toHtml } from '../scripts/lib/html.js';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

test('html escapes interpolated strings', () => {
  const evil = '<script>alert("x")</script> & \'q\'';
  const out = html`<p title="${evil}">${evil}</p>`;
  assert.ok(out instanceof SafeString);
  assert.equal(
    String(out),
    '<p title="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>',
  );
});

test('html renders numbers, arrays and skips null/undefined/false/true', () => {
  const items = ['a', '<b>', 3];
  assert.equal(String(html`<i>${items}</i>`), '<i>a&lt;b&gt;3</i>');
  assert.equal(String(html`${null}${undefined}${false}${true}|${0}`), '|0');
  assert.equal(String(html`${Number.NaN}${Infinity}`), '');
  const cond = false;
  assert.equal(String(html`<p>${cond && html`<b>x</b>`}</p>`), '<p></p>');
});

test('nested SafeStrings are not escaped again', () => {
  const inner = html`<b>${'<i>'}</b>`;
  const outer = html`<p>${inner}${[inner, html`<br>`]}</p>`;
  assert.equal(String(outer), '<p><b>&lt;i&gt;</b><b>&lt;i&gt;</b><br></p>');
});

test('raw() bypasses escaping and is idempotent', () => {
  const r = raw('<svg></svg>');
  assert.equal(String(html`${r}`), '<svg></svg>');
  assert.equal(raw(r), r);
  assert.equal(String(raw(null)), '');
});

test('escapeHtml and toHtml', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(toHtml(['<', html`<b>`]), '&lt;<b>');
});

test('attrs: booleans, skipping, class arrays, data-*', () => {
  const out = String(
    attrs({
      class: ['btn', Boolean(process.env.NO_SUCH_VAR) && 'x', 'btn--primary'],
      hidden: true,
      disabled: false,
      title: null,
      href: '/a?b=1&c="2"',
      'aria-label': 'Sulje',
      data: { copyTarget: '#upotus', empty: '', skip: undefined },
      tabindex: 0,
    }),
  );
  assert.equal(
    out,
    ' class="btn btn--primary" hidden href="/a?b=1&amp;c=&quot;2&quot;" aria-label="Sulje" data-copy-target="#upotus" data-empty="" tabindex="0"',
  );
  assert.equal(String(attrs({ class: [] })), '');
});

test('attrs rejects inline styles, event handlers and bad names', () => {
  assert.throws(() => attrs({ style: 'color:red' }), /not allowed/);
  assert.throws(() => attrs({ onclick: 'x()' }), /not allowed/);
  assert.throws(() => attrs({ 'a b': 1 }), /Invalid attribute name/);
});

test('classes and join', () => {
  assert.equal(classes('a', null, ['b', false, ['c']], { d: true, e: false }), 'a b c d');
  assert.equal(String(join(['a', '<b>', null, html`<i>`], html` · `)), 'a · &lt;b&gt; · <i>');
  assert.equal(String(join(['a', 'b'], '<')), 'a&lt;b');
});

test('safeJson cannot break out of a script element', () => {
  const s = safeJson({ t: `</script><!-- & ${LS}${PS} >` });
  assert.ok(!s.includes('<') && !s.includes('>') && !s.includes('&'));
  assert.ok(!s.includes(LS) && !s.includes(PS));
  assert.ok(s.includes('\\u003c/script\\u003e'));
  assert.deepEqual(JSON.parse(s), { t: `</script><!-- & ${LS}${PS} >` });
});

test('jsonLd and jsonScript blocks', () => {
  const ld = String(jsonLd({ '@type': 'WebPage', name: 'A</script>' }));
  assert.match(ld, /^<script type="application\/ld\+json">\{.*\}<\/script>$/);
  assert.equal(ld.match(/<\/script>/g).length, 1);
  const js = String(jsonScript('kaavio-data', [1, 2]));
  assert.equal(js, '<script type="application/json" id="kaavio-data">[1,2]</script>');
});
