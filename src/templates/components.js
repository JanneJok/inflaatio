/**
 * Reusable server-side components (build time). Every function returns a
 * SafeString; CSS lives in src/css/components.css. Pass plain strings for text
 * (they are escaped) and SafeStrings (html`…`) for rich content.
 *
 * Available in page modules as `ctx.c`, e.g.
 *   ctx.c.kpiCard({ label: '12 kk keskiarvo', value: ctx.fmt.pct(1.0), note: 'syys 2025 – elo 2026' })
 *
 * CSP: no inline styles or scripts. Interactive behaviour (segmented control,
 * copy, share, table toggle, dialogs) is wired by src/js/site.js through
 * data-* attributes, so the markup below is complete without page JS.
 */
import { html, attrs, classes, SafeString } from '../../scripts/lib/html.js';
import * as fmt from '../js/lib/format.js';
import { levelBand, deltaClass, LEVEL_BANDS } from '../js/lib/stats.js';

/* ------------------------------------------------------------------ icons */

const ICONS = {
  sun: html`<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>`,
  moon: html`<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>`,
  auto: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor"/>`,
  menu: html`<path d="M4 7h16M4 12h16M4 17h16"/>`,
  close: html`<path d="M6 6l12 12M18 6 6 18"/>`,
  check: html`<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  copy: html`<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>`,
  link: html`<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>`,
  share: html`<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>`,
  download: html`<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>`,
  external: html`<path d="M14 4.5h5.5V10M19.5 4.5 11 13M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>`,
  info: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>`,
  alert: html`<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.3"/>`,
  arrowRight: html`<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>`,
  arrowLeft: html`<path d="M19 12H5M10.5 6.5 5 12l5.5 5.5"/>`,
  chevronDown: html`<path d="m6.5 9.5 5.5 5.5 5.5-5.5"/>`,
  rss: html`<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.3" fill="currentColor"/>`,
  mail: html`<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>`,
};

/** Names of the available icons. */
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

/**
 * Inline stroke icon (24×24, currentColor). Decorative unless `label` is given.
 * @param {keyof typeof ICONS} name one of ICON_NAMES
 * @param {object} [o]
 * @param {string} [o.className] extra classes (e.g. 'icon--sm')
 * @param {string} [o.label] accessible name → role="img" instead of aria-hidden
 * @returns {SafeString}
 */
export function icon(name, { className, label } = {}) {
  const body = ICONS[name];
  if (!body) throw new Error(`icon: unknown icon "${name}"`);
  const a = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  return html`<svg${attrs({ class: classes('icon', `icon--${name}`, className), viewBox: '0 0 24 24', focusable: 'false', ...a })}>${body}</svg>`;
}

/** Heading element of the given level (2–6). */
function heading(level, content, a = {}) {
  const l = Math.min(6, Math.max(1, Number(level) || 2));
  return html`<h${l}${attrs(a)}>${content}</h${l}>`;
}

/** Slug usable in ids from any text. @param {string} s */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* --------------------------------------------------------------- sections */

/**
 * Section heading row: eyebrow, heading, one-line intro and controls on the right.
 * @param {object} p
 * @param {string|SafeString} p.title heading text
 * @param {string} [p.id] id of the heading (for aria-labelledby)
 * @param {string} [p.eyebrow] small caps line above the heading
 * @param {string|SafeString} [p.intro] one sentence below the heading
 * @param {SafeString} [p.controls] e.g. a segmented() control
 * @param {number} [p.level=2] heading level
 * @returns {SafeString}
 */
export function sectionHead({ title, id, eyebrow, intro, controls, level = 2 }) {
  return html`<div class="section-head">
  <div class="section-head__text">
    ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
    ${heading(level, title, { id })}
    ${intro ? html`<p class="section-head__intro">${intro}</p>` : ''}
  </div>
  ${controls ? html`<div class="section-head__controls">${controls}</div>` : ''}
</div>`;
}

/**
 * Full-width page section with a container and a section head.
 * @param {object} p
 * @param {string} p.id section id (anchor); the heading gets `${id}-otsikko`
 * @param {string|SafeString} [p.title] section heading (omit for a headless section)
 * @param {string} [p.eyebrow]
 * @param {string|SafeString} [p.intro]
 * @param {SafeString} [p.controls]
 * @param {SafeString|SafeString[]} p.body section content
 * @param {string} [p.className] e.g. 'section--tight'
 * @param {number} [p.level=2]
 * @returns {SafeString}
 */
export function section({ id, title, eyebrow, intro, controls, body, className, level = 2 }) {
  const headingId = title ? `${id}-otsikko` : null;
  return html`<section${attrs({ class: classes('section', className), id, 'aria-labelledby': headingId })}>
  <div class="container">
    ${title ? sectionHead({ title, id: headingId, eyebrow, intro, controls, level }) : ''}
    ${body}
  </div>
</section>`;
}

/**
 * Header of a sub page: eyebrow, h1, lede and meta line.
 * @param {object} p
 * @param {string|SafeString} p.title the page h1
 * @param {string} [p.eyebrow]
 * @param {string|SafeString} [p.lede] one or two sentences
 * @param {string|SafeString} [p.meta] e.g. "Päivitetty 14.9.2026 · Lähde: Tilastokeskus"
 *   (inline text, or block markup such as sourceLine(); rendered in a <div>)
 * @param {SafeString} [p.aside] extra content under the meta line
 * @returns {SafeString}
 */
export function pageHeader({ title, eyebrow, lede, meta, aside }) {
  return html`<header class="page-header container">
  ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
  <h1>${title}</h1>
  ${lede ? html`<p class="page-header__lede">${lede}</p>` : ''}
  ${meta ? html`<div class="page-header__meta">${meta}</div>` : ''}
  ${aside ?? ''}
</header>`;
}

/* ------------------------------------------------------------------- KPIs */

const UNIT_RE = /^(.*?)\u00A0(%-yks\.|%|€|p)$/;
const DELTA_WORDS = {
  pp: { up: 'kiihtyi', down: 'hidastui', flat: 'ennallaan' },
  pct: { up: 'nousi', down: 'laski', flat: 'ennallaan' },
};
const ARROWS = { up: '▲', down: '▼', flat: '' };

/**
 * Formatted value with its unit in <span class="unit"> ('+0,1 %-yks.' →
 * '+0,1&nbsp;<span class="unit">%-yks.</span>'). Use it inside tabular-number
 * contexts (tables, KPIs, chips): Inter's tabular figures would otherwise give
 * the hyphen of "%-yks." a digit-wide advance.
 * @param {string} text output of fmt.pct / fmt.pp / fmt.eur
 * @returns {SafeString}
 */
export function numUnit(text) {
  const s = String(text ?? fmt.DASH);
  const i = s.lastIndexOf(fmt.NBSP);
  if (i < 0) return html`${s}`;
  return html`${s.slice(0, i + 1)}<span class="unit">${s.slice(i + 1)}</span>`;
}

/**
 * KPI card: label (caps, 12 px), value (32 px, tabular) and a note.
 * Colour + arrow ONLY for change KPIs (`delta`); levels stay neutral.
 * @param {object} p
 * @param {string} p.label e.g. 'Muutos edellisestä kuukaudesta'
 * @param {string|number|null} p.value formatted value; a trailing NBSP unit
 *   ('2,2 %', '+0,1 %-yks.') is split into the unit automatically
 * @param {string} [p.unit] unit shown smaller after the value
 * @param {string|SafeString} [p.note] context line, e.g. 'Heinäkuussa 2,1 %'
 * @param {'up'|'down'|'flat'|null} [p.delta] change direction (colour + arrow)
 * @param {'pp'|'pct'} [p.deltaWords='pp'] screen reader words: kiihtyi/hidastui or nousi/laski
 * @param {string|SafeString} [p.foot] small print at the bottom (source, month)
 * @param {string} [p.id]
 * @param {string} [p.field] data-kpi hook for page JS updates
 * @param {number} [p.headingLevel=3] 0 renders the label as <p>
 * @returns {SafeString}
 */
export function kpiCard({ label, value, unit, note, delta = null, deltaWords = 'pp', foot, id, field, headingLevel = 3 }) {
  let v = value == null ? fmt.DASH : String(value);
  let u = unit;
  if (!u) {
    const m = v.match(UNIT_RE);
    if (m) [, v, u] = m;
  }
  const labelId = id ? `${id}-label` : null;
  const labelEl = headingLevel
    ? heading(headingLevel, label, { class: 'kpi__label', id: labelId })
    : html`<p${attrs({ class: 'kpi__label', id: labelId })}>${label}</p>`;
  const arrow = delta && ARROWS[delta] ? html`<span class="kpi__arrow" aria-hidden="true">${ARROWS[delta]}</span>` : '';
  const sr = delta ? html`<span class="sr-only"> (${DELTA_WORDS[deltaWords]?.[delta] ?? ''})</span>` : '';
  return html`<article${attrs({ class: 'kpi', id, 'aria-labelledby': labelId, data: { kpi: field } })}>
  ${labelEl}
  <p${attrs({ class: ['kpi__value', delta && `kpi__value--${delta}`] })}>${arrow}<span class="kpi__number">${v}</span>${u ? html`<span class="kpi__unit">${u}</span>` : ''}${sr}</p>
  ${note ? html`<p class="kpi__note">${note}</p>` : ''}
  ${foot ? html`<p class="kpi__foot">${foot}</p>` : ''}
</article>`;
}

/**
 * Grid of KPI cards (4 columns desktop, 2×2 on phones; 3 or 5 supported).
 * @param {SafeString[]} cards output of kpiCard()
 * @param {object} [o]
 * @param {boolean} [o.live=false] aria-live="polite" when JS updates the values
 * @param {string} [o.id]
 * @param {string} [o.className]
 * @returns {SafeString}
 */
export function kpiGrid(cards, { live = false, id, className } = {}) {
  return html`<div${attrs({ class: classes('kpi-grid', className), id, 'aria-live': live ? 'polite' : null, data: { count: cards.length } })}>${cards}</div>`;
}

/* ------------------------------------------------------ chips, dots, delta */

/**
 * Small neutral label. `tone`: 'neutral' | 'brand' | 'provisional' (dashed,
 * for "ennakko"). With `series` a coloured line swatch is shown.
 * @param {object} p
 * @param {string|SafeString} p.text
 * @param {'neutral'|'brand'|'provisional'} [p.tone='neutral']
 * @param {string} [p.series] series class suffix (khi, ykhi, ea…) for a swatch
 * @param {string} [p.href] renders a link chip
 * @param {string} [p.title]
 * @returns {SafeString}
 */
export function chip({ text, tone = 'neutral', series, href, title }) {
  const cls = classes('chip', tone !== 'neutral' && `chip--${tone}`);
  const sw = series ? html`<span class="chip__swatch series--${series}" aria-hidden="true"></span>` : '';
  return href
    ? html`<a${attrs({ class: cls, href, title })}>${sw}${text}</a>`
    : html`<span${attrs({ class: cls, title })}>${sw}${text}</span>`;
}

/** Finnish label of a level band ('0–2 %' …). */
const BAND_LABEL = Object.fromEntries(LEVEL_BANDS.map((b) => [b.key, b.label]));

/**
 * Level dot for an inflation rate (neutral level, coloured by band:
 * <0 deflation, 0–2 low, 2–4 elevated, >4 high).
 * @param {number|string|null} valueOrBand an inflation rate or a band key
 * @param {object} [o]
 * @param {boolean} [o.srLabel=false] add a visually hidden "taso: 0–2 %" text
 * @returns {SafeString}
 */
export function levelDot(valueOrBand, { srLabel = false } = {}) {
  const band = typeof valueOrBand === 'string' ? valueOrBand : levelBand(valueOrBand);
  if (!band) return html``;
  return html`<span class="level-dot level-dot--${band}" aria-hidden="true"></span>${srLabel ? html`<span class="sr-only">taso ${BAND_LABEL[band]}</span>` : ''}`;
}

/**
 * Legend of the four level bands.
 * @returns {SafeString}
 */
export function levelLegend() {
  return html`<ul class="level-legend" aria-label="Inflaation tasoluokat">${LEVEL_BANDS.map(
    (b) => html`<li><span class="level-dot level-dot--${b.key}" aria-hidden="true"></span>${b.label}</li>`,
  )}</ul>`;
}

/**
 * Delta chip for a CHANGE: ▲ red = kiihtyi/nousi, ▼ blue = hidastui/laski,
 * grey = ennallaan. Direction is judged on the rounded value.
 * @param {object} p
 * @param {number|null} p.value the change (e.g. 0.1)
 * @param {'pp'|'pct'} [p.unit='pp'] '%-yks.' (difference of rates) or '%' (price change)
 * @param {number} [p.decimals=1]
 * @param {string|SafeString} [p.context] text after the value, e.g. 'heinäkuusta'
 * @param {boolean} [p.plain=false] no background (inline in tables)
 * @param {boolean} [p.showUnit=true] false = number only (the column header names the unit)
 * @returns {SafeString}
 */
export function deltaChip({ value, unit = 'pp', decimals = 1, context, plain = false, showUnit = true }) {
  const dir = deltaClass(value) ?? 'flat';
  const text = unit === 'pp' ? fmt.pp(value, { decimals }) : fmt.pct(value, { decimals, sign: true });
  const words = DELTA_WORDS[unit] ?? DELTA_WORDS.pp;
  const shown = showUnit ? numUnit(text) : fmt.num(value, decimals, { sign: true });
  return html`<span${attrs({ class: ['delta', `delta--${dir}`, plain && 'delta--plain'] })}>${
    ARROWS[dir] ? html`<span class="delta__arrow" aria-hidden="true">${ARROWS[dir]}</span>` : ''
  }<span class="delta__value">${shown}</span><span class="sr-only">${showUnit ? '' : ` ${unit === 'pp' ? 'prosenttiyksikköä' : 'prosenttia'}`} (${words[dir]})</span>${
    context ? html` <span class="delta__context">${context}</span>` : ''
  }</span>`;
}

/* ------------------------------------------------------ segmented control */

/**
 * Segmented control (radiogroup of buttons with aria-checked). site.js adds
 * roving tabindex + arrow keys and dispatches a bubbling `segmentedchange`
 * CustomEvent ({ name, value }) on selection. Render the default state on the
 * server so the page is meaningful without JS.
 * @param {object} p
 * @param {string} p.name logical name (data-segmented), e.g. 'mittari' or 'jakso'
 * @param {string} p.label accessible name of the group, e.g. 'Mittari'
 * @param {{value: string, label: string, sub?: string, series?: string}[]} p.options
 *   `sub` = small second line ('Tilastokeskus'); `series` = colour swatch
 * @param {string} p.value selected value
 * @param {string} [p.id]
 * @param {boolean} [p.full=false] full width on phones
 * @param {string} [p.controls] id(s) of the region(s) the control updates (aria-controls)
 * @returns {SafeString}
 */
export function segmented({ name, label, options, value, id, full = false, controls }) {
  return html`<div${attrs({ class: ['segmented', full && 'segmented--full'], role: 'radiogroup', 'aria-label': label, id, data: { segmented: name } })}>${options.map(
    (o) => {
      const on = o.value === value;
      return html`<button${attrs({
        type: 'button',
        class: 'segmented__option',
        role: 'radio',
        'aria-checked': on ? 'true' : 'false',
        tabindex: on ? '0' : '-1',
        'aria-controls': controls,
        data: { value: o.value },
      })}><span class="segmented__main">${o.series ? html`<span class="chip__swatch series--${o.series}" aria-hidden="true"></span>` : ''}${o.label}</span>${
        o.sub ? html`<span class="segmented__sub">${o.sub}</span>` : ''
      }</button>`;
    },
  )}</div>`;
}

/* ------------------------------------------------------ details/accordion */

/**
 * Disclosure (<details>). Works without JS; print expands it.
 * @param {object} p
 * @param {string|SafeString} p.summary
 * @param {SafeString|string} p.body
 * @param {boolean} [p.open=false]
 * @param {string} [p.id]
 * @param {string} [p.className] e.g. 'disclosure--plain'
 * @param {number} [p.headingLevel] wrap the summary text in a heading (FAQ)
 * @returns {SafeString}
 */
export function details({ summary, body, open = false, id, className, headingLevel }) {
  const s = headingLevel ? heading(headingLevel, summary, { class: 'disclosure__heading' }) : summary;
  const b = typeof body === 'string' ? html`<p>${body}</p>` : body;
  return html`<details${attrs({ class: classes('disclosure', className), id, open })}><summary>${s}</summary><div class="disclosure__body">${b}</div></details>`;
}

/**
 * Accordion: a list of details. FAQ style: `faq: true` (bigger questions).
 * @param {{id?: string, summary: string|SafeString, body: SafeString|string, open?: boolean}[]} items
 * @param {object} [o]
 * @param {boolean} [o.faq=false]
 * @param {number} [o.headingLevel] heading level inside each summary
 * @param {string} [o.id]
 * @returns {SafeString}
 */
export function accordion(items, { faq = false, headingLevel, id } = {}) {
  return html`<div${attrs({ class: ['accordion', faq && 'accordion--faq'], id })}>${items.map((it) => details({ ...it, headingLevel }))}</div>`;
}

/* ------------------------------------------------------------- data table */

/**
 * Semantic data table with caption, th scope and right-aligned numbers,
 * wrapped in a keyboard-scrollable region. Optional "show all" toggle:
 * rows after `visibleRows` are hidden with JS only (all rows without JS / print).
 * @param {object} p
 * @param {string} p.id table id (required for the toggle and the caption id)
 * @param {string|SafeString} p.caption table caption (always present for AT)
 * @param {boolean} [p.captionHidden=false] visually hide the caption
 * @param {{label: string|SafeString, num?: boolean, rowHeader?: boolean, className?: string, abbr?: string}[]} p.columns
 *   `num` = numeric (right aligned); the first column is the row header by default
 * @param {Array<Array<unknown>|{cells: unknown[], className?: string, partial?: boolean}>} p.rows
 *   cell values: strings/numbers are escaped, SafeStrings inserted as is
 * @param {number} [p.visibleRows] rows shown before "show all"
 * @param {{more: string, less: string}} [p.toggleLabels] e.g. { more: 'Näytä kaikki vuodet (1980–2026)', less: 'Näytä vain 10 viimeisintä vuotta' }
 * @param {string|SafeString} [p.note] footnote under the table
 * @param {boolean} [p.compact=false]
 * @returns {SafeString}
 */
export function dataTable({ id, caption, captionHidden = false, columns, rows, visibleRows, toggleLabels, note, compact = false }) {
  if (!id) throw new Error('dataTable: id is required');
  const capId = `${id}-caption`;
  const collapsible = Number.isInteger(visibleRows) && rows.length > visibleRows;
  const head = html`<thead><tr>${columns.map(
    (c) => html`<th${attrs({ scope: 'col', class: classes(c.num && 'num', c.className), abbr: c.abbr })}>${c.label}</th>`,
  )}</tr></thead>`;
  const body = html`<tbody>${rows.map((row, r) => {
    const cells = Array.isArray(row) ? row : row.cells;
    const rowCls = Array.isArray(row) ? null : classes(row.className, row.partial && 'is-partial');
    return html`<tr${attrs({ class: rowCls || null, 'data-extra': collapsible && r >= visibleRows })}>${cells.map((cell, i) => {
      const col = columns[i] ?? {};
      const isHeader = col.rowHeader ?? i === 0;
      const cls = classes(col.num && 'num', col.className);
      return isHeader
        ? html`<th${attrs({ scope: 'row', class: cls || null })}>${cell}</th>`
        : html`<td${attrs({ class: cls || null })}>${cell}</td>`;
    })}</tr>`;
  })}</tbody>`;
  const labels = toggleLabels ?? { more: `Näytä kaikki (${rows.length})`, less: 'Näytä vähemmän' };
  const toggle = collapsible
    ? html`<button${attrs({
        type: 'button',
        class: 'button button--secondary table-toggle js-only',
        'aria-expanded': 'false',
        'aria-controls': id,
        data: { tableToggle: '', labelMore: labels.more, labelLess: labels.less },
      })}>${labels.more}</button>`
    : '';
  return html`<div class="table-wrap" role="region" aria-labelledby="${capId}" tabindex="0">
<table${attrs({ class: ['data-table', compact && 'data-table--compact'], id, 'data-collapsed': collapsible ? 'true' : null })}>
<caption${attrs({ id: capId, class: captionHidden ? 'sr-only' : null })}>${caption}</caption>
${head}${body}
</table>
</div>${note ? html`<p class="table-note">${note}</p>` : ''}${toggle}`;
}

/* ------------------------------------------------------------- stats <dl> */

/**
 * Statistics row as a description list (e.g. under a chart): label, value,
 * and a note with the period ("Korkein 9,1 % · marras 2022").
 * @param {{label: string, value: string|SafeString, note?: string|SafeString, id?: string}[]} items
 * @param {object} [o]
 * @param {boolean} [o.live=false] aria-live="polite" when JS updates it
 * @param {string} [o.id]
 * @param {string} [o.className]
 * @returns {SafeString}
 */
export function statsList(items, { live = false, id, className } = {}) {
  return html`<dl${attrs({ class: classes('stats', className), id, 'aria-live': live ? 'polite' : null })}>${items.map(
    (it) => html`<div${attrs({ id: it.id })}><dt>${it.label}</dt><dd>${it.value}${it.note ? html`<span class="stats__note">${it.note}</span>` : ''}</dd></div>`,
  )}</dl>`;
}

/* ---------------------------------------------------------------- callout */

/**
 * Highlighted note. `tone`: info (brand) | warning | note (neutral).
 * @param {object} p
 * @param {string|SafeString} [p.title]
 * @param {string|SafeString} p.body
 * @param {'info'|'warning'|'note'} [p.tone='info']
 * @param {string} [p.id]
 * @returns {SafeString}
 */
export function callout({ title, body, tone = 'info', id }) {
  const ic = tone === 'warning' ? 'alert' : 'info';
  return html`<div${attrs({ class: ['callout', `callout--${tone}`], id, role: 'note' })}>${icon(ic)}<div>${
    title ? html`<p class="callout__title">${title}</p>` : ''
  }<div class="callout__body">${typeof body === 'string' ? html`<p>${body}</p>` : body}</div></div></div>`;
}

/* -------------------------------------------------------------- card grid */

/**
 * Grid of link cards (whole card clickable via a stretched link; the link
 * name is the card title).
 * @param {{href: string, title: string, text?: string|SafeString, meta?: string, eyebrow?: string, lang?: string}[]} cards
 * @param {object} [o]
 * @param {number} [o.headingLevel=3]
 * @param {string} [o.className]
 * @returns {SafeString}
 */
export function cardGrid(cards, { headingLevel = 3, className } = {}) {
  return html`<ul${attrs({ class: classes('card-grid', className), role: 'list' })}>${cards.map(
    (c) => html`<li class="card">
  ${c.eyebrow ? html`<p class="card__eyebrow">${c.eyebrow}</p>` : ''}
  ${heading(headingLevel, html`<a${attrs({ class: 'card__link', href: c.href, lang: c.lang, hreflang: c.lang })}>${c.title}</a>`, { class: 'card__title' })}
  ${c.text ? html`<p class="card__text">${c.text}</p>` : ''}
  ${c.meta ? html`<p class="card__meta" aria-hidden="true">${c.meta} ${icon('arrowRight', { className: 'icon--sm' })}</p>` : ''}
</li>`,
  )}</ul>`;
}

/* ------------------------------------------------------------ breadcrumbs */

/**
 * Visible breadcrumb trail (the layout renders it and the matching
 * BreadcrumbList JSON-LD from layout({ breadcrumbs })).
 * @param {{name: string, href?: string}[]} items last item = current page
 * @param {{label?: string}} [o] accessible name of the trail ('Breadcrumb' on English pages)
 * @returns {SafeString}
 */
export function breadcrumb(items, { label = 'Murupolku' } = {}) {
  if (!items?.length) return html``;
  return html`<nav class="breadcrumbs" aria-label="${label}"><ol>${items.map((it, i) =>
    i === items.length - 1
      ? html`<li><span aria-current="page">${it.name}</span></li>`
      : html`<li><a href="${it.href}">${it.name}</a></li>`,
  )}</ol></nav>`;
}

/* ------------------------------------------------------------ source line */

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Source attribution line: "Lähde: Tilastokeskus, kuluttajahintaindeksi · Päivitetty 14.9.2026".
 * @param {object} p
 * @param {{name: string, href?: string, detail?: string}[]} p.sources
 * @param {string} [p.updated] ISO date/time of the source update (formatted D.M.YYYY)
 * @param {string|SafeString} [p.note] extra text at the end
 * @param {'fi'|'en'} [p.lang='fi'] 'en': "Source(s): … · Updated 14 September 2026"
 * @returns {SafeString}
 */
export function sourceLine({ sources, updated, note, lang = 'fi' }) {
  const en = lang === 'en';
  const label = en ? (sources.length > 1 ? 'Sources' : 'Source') : sources.length > 1 ? 'Lähteet' : 'Lähde';
  const updatedLabel = en ? 'Updated' : 'Päivitetty';
  const updatedText = (v) => {
    if (!en) return fmt.date(v);
    const iso = fmt.isoDate(v);
    if (!iso) return fmt.DASH;
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${EN_MONTHS[m - 1]} ${y}`;
  };
  const list = sources.map(
    (s, i) => html`${i ? ', ' : ''}${s.href ? html`<a href="${s.href}">${s.name}</a>` : s.name}${s.detail ? html` (${s.detail})` : ''}`,
  );
  return html`<p class="source-line">${label}: ${list}${updated ? html` · ${updatedLabel} <time datetime="${String(updated).slice(0, 10)}">${updatedText(updated)}</time>` : ''}${
    note ? html` · ${note}` : ''
  }</p>`;
}

/* ---------------------------------------------------------------- buttons */

/**
 * Button or link styled as a button.
 * @param {object} p
 * @param {string|SafeString} p.label
 * @param {'primary'|'secondary'|'ghost'} [p.variant='secondary']
 * @param {'sm'} [p.size]
 * @param {string} [p.href] renders <a>
 * @param {string} [p.icon] icon name before the label
 * @param {'button'|'submit'} [p.type='button']
 * @param {Record<string, unknown>} [p.attrs] extra attributes (data, aria-*)
 * @param {string} [p.className]
 * @returns {SafeString}
 */
export function button({ label, variant = 'secondary', size, href, icon: ic, type = 'button', attrs: extra = {}, className }) {
  const cls = classes('button', `button--${variant}`, size && `button--${size}`, className);
  const inner = html`${ic ? icon(ic) : ''}<span class="button__label">${label}</span>`;
  return href
    ? html`<a${attrs({ class: cls, href, ...extra })}>${inner}</a>`
    : html`<button${attrs({ type, class: cls, ...extra })}>${inner}</button>`;
}

/**
 * Copy-to-clipboard button (JS only; hidden without JS). Copies the text of
 * the element matching `target` (selector, e.g. '#upotuskoodi') or `text`.
 * @param {object} p
 * @param {string} [p.target] CSS selector of the element whose value/text is copied
 * @param {string} [p.text] literal text to copy
 * @param {string} [p.label='Kopioi']
 * @param {string} [p.copiedLabel='Kopioitu']
 * @param {string} [p.track] GA event name sent after consent (e.g. 'widget_code_copied')
 * @param {'primary'|'secondary'|'ghost'} [p.variant='secondary']
 * @param {'sm'} [p.size]
 * @returns {SafeString}
 */
export function copyButton({ target, text, label = 'Kopioi', copiedLabel = 'Kopioitu', track, variant = 'secondary', size }) {
  if (!target && text == null) throw new Error('copyButton: target or text is required');
  return button({
    label,
    variant,
    size,
    icon: 'copy',
    className: 'js-only',
    attrs: { data: { copyTarget: target, copyText: text, copiedLabel, track } },
  });
}

/**
 * Share button: native share sheet when available (`mode: 'native'`),
 * otherwise copies the current URL (incl. query state) to the clipboard.
 * @param {object} [p]
 * @param {string} [p.label='Kopioi linkki']
 * @param {'copy'|'native'} [p.mode='copy']
 * @param {string} [p.track='share']
 * @param {'primary'|'secondary'|'ghost'} [p.variant='secondary']
 * @param {'sm'} [p.size]
 * @returns {SafeString}
 */
export function shareButton({ label = 'Kopioi linkki', mode = 'copy', track = 'share', variant = 'secondary', size } = {}) {
  return button({ label, variant, size, icon: mode === 'native' ? 'share' : 'link', className: 'js-only', attrs: { data: { share: mode, track } } });
}

/**
 * Download link with format and size.
 * @param {object} p
 * @param {string} p.href
 * @param {string} p.label
 * @param {string} [p.format] e.g. 'CSV'
 * @param {string} [p.size] e.g. '12 kt'
 * @param {string} [p.track] GA event name (e.g. 'csv_download')
 * @returns {SafeString}
 */
export function downloadLink({ href, label, format, size, track }) {
  const meta = [format, size].filter(Boolean).join(' · ');
  return html`<a${attrs({ class: 'download-link', href, download: true, data: { track } })}>${icon('download')}<span class="download-link__label">${label}</span>${
    meta ? html`<span class="download-link__meta">${meta}</span>` : ''
  }</a>`;
}

/**
 * Code block with a copy button (e.g. embed code).
 * @param {object} p
 * @param {string} p.id id of the <code> element
 * @param {string} p.code
 * @param {string} [p.label='Kopioi koodi']
 * @param {string} [p.track]
 * @returns {SafeString}
 */
export function codeBlock({ id, code, label = 'Kopioi koodi', track }) {
  return html`<div class="code-block"><pre><code id="${id}">${code}</code></pre>${copyButton({ target: `#${id}`, label, track, size: 'sm' })}</div>`;
}

/* ----------------------------------------------------------------- charts */

/**
 * Chart legend. `cls` = series class (khi, ykhi, ea, core, s3…s6, target).
 * `hidden` renders the item hidden (page JS shows it when the series is
 * toggled on); `key` adds data-series="<key>" as a hook for page JS.
 * @param {{cls: string, label: string, dashed?: boolean, box?: boolean, hidden?: boolean, key?: string}[]} items
 * @returns {SafeString}
 */
export function legend(items) {
  return html`<ul class="legend">${items.map(
    (it) => html`<li${attrs({ class: 'legend__item', hidden: Boolean(it.hidden), data: { series: it.key } })}><span${attrs({
      class: ['legend__swatch', `series--${it.cls}`, it.dashed && 'legend__swatch--dashed', it.box && 'legend__swatch--box'],
      'aria-hidden': 'true',
    })}></span><span class="legend__label">${it.label}</span></li>`,
  )}</ul>`;
}

/**
 * Chart with its text alternatives: title + legend (figcaption), the chart
 * (server SVG or a Chart.js canvas container), a one-sentence summary, the
 * data table inside <details>, source line and actions.
 * @param {object} p
 * @param {string} p.id figure id
 * @param {string|SafeString} p.title
 * @param {string|SafeString} [p.subtitle] e.g. 'Vuosimuutos, %'
 * @param {number} [p.headingLevel=3]
 * @param {SafeString} [p.legend] output of legend()
 * @param {SafeString} p.chart the chart markup (svg.lineChart(), or a .chart-canvas div)
 * @param {string|SafeString} p.summary text alternative, e.g. "KHI oli elokuussa 2,2 % …"
 * @param {SafeString} [p.table] a dataTable() with the chart's numbers
 * @param {string} [p.tableLabel='Näytä luvut taulukkona']
 * @param {SafeString} [p.source] output of sourceLine()
 * @param {SafeString} [p.actions] buttons (download image, copy link…)
 * @param {boolean} [p.live=false] aria-live on the summary (JS updates)
 * @param {string} [p.className]
 * @returns {SafeString}
 */
export function chartFigure({ id, title, subtitle, headingLevel = 3, legend: lg, chart, summary, table, tableLabel = 'Näytä luvut taulukkona', source, actions, live = false, className }) {
  const titleId = `${id}-otsikko`;
  return html`<figure${attrs({ class: classes('chart-figure', className), id, 'aria-labelledby': titleId })}>
  <figcaption class="chart-figure__head">
    <div>${heading(headingLevel, title, { class: 'chart-figure__title', id: titleId })}${subtitle ? html`<p class="chart-figure__subtitle">${subtitle}</p>` : ''}</div>
    ${lg ?? ''}
  </figcaption>
  <div class="chart-figure__body">${chart}</div>
  ${summary ? html`<p${attrs({ class: 'chart-figure__summary', 'aria-live': live ? 'polite' : null })}>${summary}</p>` : ''}
  ${table ? details({ summary: tableLabel, body: table, className: 'disclosure--plain' }) : ''}
  ${source ?? ''}
  ${actions ? html`<div class="chart-figure__actions">${actions}</div>` : ''}
</figure>`;
}

/* ------------------------------------------------------------------ forms */

/**
 * Form field with label, hint and error (aria-describedby wired).
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.label
 * @param {'input'|'textarea'|'select'} [p.as='input']
 * @param {string} [p.type='text'] input type
 * @param {string} [p.name] defaults to id
 * @param {string|number} [p.value]
 * @param {string|SafeString} [p.hint]
 * @param {string} [p.error] initial error text (usually empty)
 * @param {boolean} [p.optional=false] adds "(valinnainen)" / "(optional)" to the label
 * @param {'fi'|'en'} [p.lang='fi'] language of the "(valinnainen)" marker
 * @param {boolean} [p.required=false]
 * @param {string} [p.suffix] unit shown inside the input ('€', '%')
 * @param {{value: string, label: string, selected?: boolean}[]} [p.options] for selects
 * @param {Record<string, unknown>} [p.attrs] min, max, step, inputmode, autocomplete, maxlength…
 * @param {string} [p.className]
 * @returns {SafeString}
 */
export function field({ id, label, as = 'input', type = 'text', name, value, hint, error, optional = false, required = false, suffix, options = [], attrs: extra = {}, className, lang = 'fi' }) {
  const hintId = hint ? `${id}-ohje` : null;
  const errId = `${id}-virhe`;
  const describedby = [hintId, errId].filter(Boolean).join(' ');
  const common = { id, name: name ?? id, required, 'aria-describedby': describedby, 'aria-invalid': error ? 'true' : null, ...extra };
  let control;
  if (as === 'textarea') control = html`<textarea${attrs(common)}>${value ?? ''}</textarea>`;
  else if (as === 'select') {
    control = html`<select${attrs(common)}>${options.map(
      (o) => html`<option${attrs({ value: o.value, selected: o.selected ?? String(o.value) === String(value) })}>${o.label}</option>`,
    )}</select>`;
  } else control = html`<input${attrs({ type, value, ...common })}>`;
  if (suffix) control = html`<div class="input-affix">${control}<span class="input-affix__suffix" aria-hidden="true">${suffix}</span></div>`;
  return html`<div${attrs({ class: classes('field', className) })}>
  <label class="field__label" for="${id}">${label}${optional ? html` <span class="field__optional">${lang === 'en' ? '(optional)' : '(valinnainen)'}</span>` : ''}</label>
  ${hint ? html`<p class="field__hint" id="${hintId}">${hint}</p>` : ''}
  ${control}
  <p class="field__error" id="${errId}">${error ?? ''}</p>
</div>`;
}

/**
 * Checkbox with a label and an optional description.
 * @param {object} p
 * @param {string} p.id
 * @param {string|SafeString} p.label
 * @param {string|SafeString} [p.desc]
 * @param {string} [p.name]
 * @param {boolean} [p.checked=false]
 * @param {boolean} [p.disabled=false]
 * @returns {SafeString}
 */
export function checkbox({ id, label, desc, name, checked = false, disabled = false }) {
  const descId = desc ? `${id}-kuvaus` : null;
  return html`<div class="check"><input${attrs({ type: 'checkbox', id, name: name ?? id, checked, disabled, 'aria-describedby': descId })}><div><label class="check__label" for="${id}">${label}</label>${
    desc ? html`<p class="check__desc" id="${descId}">${desc}</p>` : ''
  }</div></div>`;
}

/* ------------------------------------------------------------ navigation */

/**
 * In-page table of contents. With `scrollspy` the current section link gets
 * aria-current (site.js, IntersectionObserver).
 * @param {{id: string, label: string}[]} items
 * @param {object} [o]
 * @param {string} [o.title='Sisällys']
 * @param {boolean} [o.sticky=true]
 * @param {boolean} [o.scrollspy=true]
 * @returns {SafeString}
 */
export function toc(items, { title = 'Sisällys', sticky = true, scrollspy = true } = {}) {
  return html`<nav${attrs({ class: ['toc', sticky && 'toc--sticky'], 'aria-label': title, 'data-scrollspy': scrollspy })}><p class="toc__title" aria-hidden="true">${title}</p><ol>${items.map(
    (it) => html`<li><a href="#${it.id}">${it.label}</a></li>`,
  )}</ol></nav>`;
}

/**
 * Previous / next navigation (archive pages).
 * @param {object} p
 * @param {{href: string, label: string}} [p.prev]
 * @param {{href: string, label: string}} [p.next]
 * @param {string} [p.label='Selaa']
 * @returns {SafeString}
 */
export function pager({ prev, next, label = 'Selaa' }) {
  if (!prev && !next) return html``;
  return html`<nav class="pager" aria-label="${label}">${
    prev ? html`<a class="pager__link" href="${prev.href}" rel="prev"><span class="pager__dir">Edellinen</span><span class="pager__label">${prev.label}</span></a>` : ''
  }${next ? html`<a class="pager__link pager__link--next" href="${next.href}" rel="next"><span class="pager__dir">Seuraava</span><span class="pager__label">${next.label}</span></a>` : ''}</nav>`;
}

export { SafeString };
