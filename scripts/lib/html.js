/**
 * Tagged-template HTML with automatic escaping (build time only).
 *
 *   html`<p class="${cls}">${text}</p>`   → SafeString
 *
 * Interpolation rules:
 * - strings and numbers are HTML-escaped (& < > " ');
 * - SafeString values (from html``, raw(), attrs(), jsonLd()…) are inserted as is;
 * - arrays are rendered item by item and joined without separator;
 * - null, undefined, false and true render as '' (so `${cond && html`…`}` works).
 *
 * Only `raw()` bypasses escaping: use it for trusted, build-generated markup
 * (e.g. SVG from scripts/lib/svg.js), never for data or content strings.
 */

/** Markup that is already safe to insert into HTML. */
export class SafeString {
  /** @param {string} value */
  constructor(value) {
    this.value = String(value);
  }

  toString() {
    return this.value;
  }

  toJSON() {
    return this.value;
  }

  get length() {
    return this.value.length;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_RE = /[&<>"']/g;

/**
 * Escape text for HTML element content and quoted attribute values.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(ESCAPE_RE, (ch) => ESCAPES[ch]);
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * Escape text for XML element content and attributes (sitemap, RSS);
 * null/undefined → ''.
 * @param {unknown} value
 * @returns {string}
 */
export function xmlEscape(value) {
  return String(value ?? '').replace(ESCAPE_RE, (ch) => XML_ESCAPES[ch]);
}

/**
 * Render one interpolated value to an HTML string.
 * @param {unknown} value
 * @returns {string}
 */
function render(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeString) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return escapeHtml(value);
}

/**
 * Tagged template that escapes every interpolation.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeString}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeString(out);
}

/**
 * Mark trusted markup as safe (no escaping). Accepts strings or SafeStrings.
 * @param {unknown} markup
 * @returns {SafeString}
 */
export function raw(markup) {
  if (markup instanceof SafeString) return markup;
  return new SafeString(markup == null ? '' : String(markup));
}

/**
 * Render any value (string, SafeString, array…) to an HTML string with the
 * same rules as interpolations.
 * @param {unknown} value
 * @returns {string}
 */
export function toHtml(value) {
  return render(value);
}

/**
 * Join values with a separator; each value is rendered with the usual rules.
 * @param {unknown[]} list
 * @param {string|SafeString} [separator='']
 * @returns {SafeString}
 */
export function join(list, separator = '') {
  const sep = separator instanceof SafeString ? separator.value : escapeHtml(separator);
  return new SafeString((list ?? []).map(render).filter((s) => s !== '').join(sep));
}

/**
 * Space-separated class list from strings, arrays and { name: condition } maps.
 *   classes('btn', cond && 'btn--on', { 'is-open': open }) → 'btn is-open'
 * @param {...unknown} parts
 * @returns {string}
 */
export function classes(...parts) {
  const out = [];
  const add = (p) => {
    if (!p) return;
    if (Array.isArray(p)) p.forEach(add);
    else if (typeof p === 'object') {
      for (const [k, v] of Object.entries(p)) if (v) out.push(k);
    } else out.push(String(p).trim());
  };
  parts.forEach(add);
  return out.filter(Boolean).join(' ');
}

const ATTR_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/;

/**
 * Attributes from an object, each with a leading space:
 *   html`<a${attrs({ href, class: ['link', active && 'is-active'], hidden: !show })}>`
 * - true → boolean attribute (` hidden`);
 * - null, undefined, false → omitted;
 * - arrays → space-joined (class lists), empty result omitted;
 * - objects under the key `data` → data-* attributes ({ data: { copyTarget: '#x' } }
 *   → ` data-copy-target="#x"`);
 * - `style` and on* event handler attributes are rejected (CSP, SPEC §10).
 * @param {Record<string, unknown>} obj
 * @returns {SafeString}
 */
export function attrs(obj) {
  let out = '';
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (key === 'data' && value && typeof value === 'object' && !Array.isArray(value)) {
      const data = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]),
      );
      out += attrs(data).value;
      continue;
    }
    if (!ATTR_NAME_RE.test(key)) throw new Error(`Invalid attribute name ${JSON.stringify(key)}`);
    const lower = key.toLowerCase();
    if (lower === 'style' || lower.startsWith('on')) {
      throw new Error(`Attribute "${key}" is not allowed (CSP: no inline styles or event handlers)`);
    }
    if (value == null || value === false) continue;
    if (value === true) {
      out += ` ${key}`;
      continue;
    }
    let v = value;
    if (Array.isArray(v)) {
      v = classes(v);
      if (!v) continue;
    }
    if (v instanceof SafeString) v = v.value;
    else if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out += ` ${key}="${escapeHtml(String(v))}"`;
  }
  return new SafeString(out);
}

/**
 * Serialise data for embedding inside a <script> element (JSON-LD or a JSON
 * data island). Escapes <, >, & and the JS line separators so the content can
 * never close the script element or be parsed as markup.
 * @param {unknown} data
 * @returns {string}
 */
export function safeJson(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * JSON-LD block. Not executable, so it is allowed by the CSP.
 * @param {object|object[]} data a schema.org object (or @graph array)
 * @returns {SafeString}
 */
export function jsonLd(data) {
  return new SafeString(`<script type="application/ld+json">${safeJson(data)}</script>`);
}

/**
 * JSON data island for browser code: <script type="application/json" id="…">.
 * Read it in the browser with JSON.parse(document.getElementById(id).textContent).
 * @param {string} id element id
 * @param {unknown} data
 * @returns {SafeString}
 */
export function jsonScript(id, data) {
  return new SafeString(`<script type="application/json" id="${escapeHtml(id)}">${safeJson(data)}</script>`);
}
