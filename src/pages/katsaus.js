/**
 * Monthly reviews (owner ARCHIVE):
 *   /katsaus/            list of every review, newest first
 *   /katsaus/<yyyy-mm>/  "Inflaatiokatsaus: elokuu 2026" for 2024-01 → latest month
 *
 * The text is generated from the data at build time (level, change in
 * %-points, monthly price change, main-group contributions, YKHI and the
 * euro area, next release). The owner may add a short comment per month in
 * src/content/katsauskommentit.json:
 *   { "2026-08": "Yksi kappale." }  or
 *   { "2026-08": { "text": ["Kappale 1.", "Kappale 2."], "author": "Nimi", "date": "2026-09-15" } }
 */
import * as fmt from '../js/lib/format.js';
import * as stats from '../js/lib/stats.js';
import {
  archive,
  KATSAUS_FROM,
  katsausPath,
  monthPath,
  yearPath,
  levelSentence,
  deltaSentence,
  deltaVerb,
  rateWord,
  lowerFirst,
  fitDescription,
  contextFigure,
  contributionsFigure,
  eventList,
  sourceMeta,
} from './inflaatio.js';

/** Months that have a review (ascending). @param {ReturnType<typeof archive>} A */
export function katsausMonths(A) {
  return A.monthPages.filter((ym) => ym >= KATSAUS_FROM);
}

/** ' klo 8.00' from '08:00' ('' when missing). @param {string} [t] */
function clock(t) {
  const mm = typeof t === 'string' ? t.match(/^(\d{1,2}):(\d{2})$/) : null;
  return mm ? ` klo ${Number(mm[1])}.${mm[2]}` : '';
}

/** "a, b sekä c" (group names contain "ja" themselves). @param {string[]} items */
function listSeka(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} sekä ${items.at(-1)}`;
}

/**
 * Headline: "Inflaatio kiihtyi 2,2 prosenttiin" / "Inflaatio pysyi 2,1 prosentissa".
 * @param {{yoy: number, delta: number|null}} m
 */
export function katsausHeadline(m) {
  const verb = deltaVerb(m.delta);
  if (verb === 'kiihtyi' || verb === 'hidastui') return `Inflaatio ${verb} ${rateWord(m.yoy, 'illative')}`;
  if (verb === 'pysyi ennallaan') return `Inflaatio pysyi ${rateWord(m.yoy, 'inessive')}`;
  return `Inflaatio ${fmt.pct(m.yoy)}`;
}

/** Normalised owner comment for a month, or null. */
export function ownerComment(ctx, ym) {
  const raw = ctx.content.katsauskommentit?.[ym];
  if (!raw) return null;
  if (typeof raw === 'string') return { paragraphs: [raw], author: null, date: null };
  const t = raw.text ?? raw.teksti;
  const paragraphs = (Array.isArray(t) ? t : [t]).filter((p) => typeof p === 'string' && p.trim());
  if (!paragraphs.length) return null;
  return { paragraphs, author: typeof raw.author === 'string' ? raw.author : null, date: typeof raw.date === 'string' ? raw.date : null };
}

/**
 * Generated review of one month: headline and 3–5 paragraphs (plain strings;
 * `next` is kept apart because it may contain a link).
 * @param {any} ctx
 * @param {string} ym
 */
export function katsausModel(ctx, ym) {
  const A = archive(ctx);
  const m = A.month(ym);
  if (!fmt.isNum(m.yoy)) throw new Error(`katsaus: no KHI value for ${ym}`);
  const paragraphs = [];
  const monthOnly = fmt.monthNameOnly(ym);

  // 1. Level and change in %-points.
  const p1 = [levelSentence(ym, m.yoy)];
  const ds = deltaSentence(m.prevYm, m.prevYoy, m.delta);
  if (ds) p1.push(ds);
  if (m.released) p1.push(`Tilastokeskus julkaisi ${fmt.genitive(ym, { year: false })} luvut ${fmt.date(m.released)}.`);
  paragraphs.push(p1.join(' '));

  // 2. Monthly price change, a year ago, year to date.
  const p2 = [];
  if (fmt.isNum(m.mom)) {
    const r = fmt.round(m.mom, 1);
    const from = fmt.elative(m.prevYm, { year: false });
    p2.push(r === 0 ? `Hintataso pysyi ${from} ${fmt.illative(ym, { year: false })} ennallaan.` : `Hintataso ${r > 0 ? 'nousi' : 'laski'} ${from} ${fmt.illative(ym, { year: false })} ${fmt.pct(Math.abs(r))}.`);
  }
  if (fmt.isNum(m.yearAgoYoy)) p2.push(`Vuotta aiemmin, ${fmt.inessive(fmt.ymAdd(ym, -12))}, inflaatio oli ${fmt.pct(m.yearAgoYoy)}.`);
  const year = fmt.yearOf(ym);
  const ytdMonths = A.monthsOfYear(year).filter((x) => x <= ym);
  const ytd = stats.mean(ytdMonths.map((x) => A.month(x).yoy));
  if (ytdMonths.length > 1 && fmt.isNum(ytd)) {
    const span = fmt.monthsSpan(ytdMonths[0], ytdMonths.at(-1));
    p2.push(ytdMonths.length === 12 ? `Vuoden ${year} kuukausien keskiarvo oli ${fmt.pct(ytd)}.` : `Vuoden ${year} ${span}kuun keskiarvo on ${fmt.pct(ytd)}.`);
  }
  if (p2.length) paragraphs.push(p2.join(' '));

  // 3. Contributions of the main groups.
  let up = [];
  let down = [];
  if (m.groups?.mode === 'yoy') {
    const rows = m.groups.rows;
    up = rows.filter((g) => fmt.round(g.yoy, 1) > 0).slice(0, 3);
    down = rows.filter((g) => fmt.round(g.yoy, 1) < 0).reverse().slice(0, 3);
    const item = (g) => `${lowerFirst(g.name)} (${fmt.pct(g.yoy, { sign: true })})`;
    const p3 = [];
    if (up.length) p3.push(`Kuluttajahintaindeksin pääryhmistä eniten kallistuivat vuodessa ${listSeka(up.map(item))}.`);
    if (down.length) p3.push(`Eniten halpenivat ${listSeka(down.map(item))}.`);
    else p3.push('Minkään pääryhmän hinnat eivät laskeneet vuodessa.');
    paragraphs.push(p3.join(' '));
  } else if (m.groups) {
    const rows = m.groups.rows;
    up = rows.filter((g) => fmt.round(g.contribution, 2) > 0).slice(0, 3);
    down = rows.filter((g) => fmt.round(g.contribution, 2) < 0).reverse().slice(0, 3);
    const item = (g) => `${lowerFirst(g.name)} (${fmt.pp(g.contribution, { decimals: 2 })})`;
    const p3 = [];
    if (up.length) p3.push(`Eniten vuosi-inflaatiota nostivat ${listSeka(up.map(item))}.`);
    if (down.length) p3.push(`Eniten sitä laskivat ${listSeka(down.map(item))}.`);
    else p3.push('Yksikään pääryhmä ei laskenut vuosi-inflaatiota.');
    const top = rows[0];
    if (top && fmt.isNum(top.yoy) && top.contribution > 0) {
      const group = top.name.includes(' ') ? `${top.name} -ryhmän` : `${top.name}-ryhmän`;
      p3.push(`${group} hinnat ${top.yoy >= 0 ? 'nousivat' : 'laskivat'} vuodessa ${fmt.pct(Math.abs(top.yoy))}.`);
    }
    paragraphs.push(p3.join(' '));
  }

  // 4. YKHI and the euro area.
  if (fmt.isNum(m.ykhi.yoy)) {
    const p4 = [
      `EU:n yhdenmukaistetulla kuluttajahintaindeksillä (YKHI) mitattuna Suomen inflaatio oli ${fmt.pct(m.ykhi.yoy)}${fmt.isNum(m.ea.yoy) ? ` ja euroalueen ${fmt.pct(m.ea.yoy)}` : ''} (Eurostat${m.ykhi.provisional || m.ea.provisional ? ', ennakkotieto' : ''}).`,
    ];
    const gap = stats.ppChange(m.ykhi.yoy, m.ea.yoy);
    if (fmt.isNum(gap)) {
      if (gap < 0) p4.push(`Suomen luku oli siis ${fmt.pp(Math.abs(gap), { sign: false })} euroalueen lukua matalampi.`);
      else if (gap > 0) p4.push(`Suomen luku oli siis ${fmt.pp(gap, { sign: false })} euroalueen lukua korkeampi.`);
      else p4.push('Suomen luku oli sama kuin euroalueen.');
    }
    const diff = stats.ppChange(m.yoy, m.ykhi.yoy);
    if (fmt.isNum(diff) && Math.abs(diff) >= 0.3) {
      p4.push('KHI:n ja YKHI:n ero johtuu pääosin siitä, että KHI sisältää omistusasumisen kuluja, kuten asuntolainojen korot, ja YKHI ei.');
    }
    paragraphs.push(p4.join(' '));
  }

  // 5. What next (only for the latest month; older reviews link to the next one).
  let next = null;
  if (ym === A.latestMonth) {
    const nr = ctx.latest.nextRelease ?? {};
    const nextYm = fmt.ymAdd(ym, 1);
    const parts = [];
    if (nr.khi?.period === nextYm) parts.push(`Tilastokeskus julkaisee ${fmt.genitive(nextYm)} kuluttajahintaindeksin ${fmt.date(nr.khi.date)}${clock(nr.khi.time)}.`);
    if (nr['ykhi-ennakko']?.period === nextYm) parts.push(`Eurostatin ennakkotieto ${fmt.genitive(nextYm, { year: false })} YKHI:stä julkaistaan ${fmt.date(nr['ykhi-ennakko'].date)}.`);
    next = parts.length ? parts.join(' ') : `${fmt.capitalize(fmt.genitive(nextYm))} luvut julkaistaan Tilastokeskuksen julkaisukalenterin mukaisesti.`;
    paragraphs.push(next);
  }

  const headline = katsausHeadline(m);
  return {
    ym,
    m,
    A,
    title: `Inflaatiokatsaus: ${fmt.monthName(ym)}`,
    headline,
    paragraphs,
    next,
    up,
    down,
    monthOnly,
    comment: ownerComment(ctx, ym),
    published: m.released,
    modified: [m.released, m.ykhiFinalReleased].filter(Boolean).sort().at(-1) ?? null,
  };
}

/* ============================================================ page module */

/** @param {any} ctx */
export default async function katsaus(ctx) {
  const A = archive(ctx);
  const list = katsausMonths(A);
  const out = [indexPage(ctx, A, list)];
  list.forEach((ym, i) => out.push(reviewPage(ctx, A, ym, list[i - 1] ?? null, list[i + 1] ?? null)));
  return out;
}

function indexPage(ctx, A, list) {
  const { html, c } = ctx;
  const path = '/katsaus/';
  const latest = list.at(-1);
  const k = katsausModel(ctx, latest);
  const desc = [...list].reverse();
  const table = c.dataTable({
    id: 'katsaukset-taulukko',
    caption: `Inflaatiokatsaukset ${fmt.monthRange(list[0], latest)}`,
    columns: [{ label: 'Katsaus' }, { label: 'KHI', num: true }, { label: 'Muutos, %-yks.', num: true }, { label: 'YKHI', num: true }, { label: 'Euroalue', num: true }],
    rows: desc.map((ym) => {
      const m = A.month(ym);
      return [
        html`<a href="${katsausPath(ym)}">${fmt.capitalize(fmt.monthName(ym))}</a>`,
        c.numUnit(fmt.pct(m.yoy)),
        fmt.isNum(m.delta) ? c.deltaChip({ value: m.delta, plain: true, showUnit: false }) : fmt.DASH,
        html`${c.numUnit(fmt.pct(m.ykhi.yoy))}${m.ykhi.provisional ? html` ${c.chip({ text: 'ennakko', tone: 'provisional' })}` : ''}`,
        c.numUnit(fmt.pct(m.ea.yoy)),
      ];
    }),
    visibleRows: 12,
    toggleLabels: { more: `Näytä kaikki katsaukset (${list.length})`, less: 'Näytä vain 12 viimeisintä' },
    note: 'KHI = kuluttajahintaindeksin vuosimuutos (Tilastokeskus), muutos edellisestä kuukaudesta prosenttiyksikköinä. YKHI ja euroalue: Eurostat.',
  });

  const main = html`${c.pageHeader({
    eyebrow: `Kuukausikatsaukset · ${fmt.monthRange(list[0], latest)}`,
    title: 'Inflaatiokatsaukset',
    lede: 'Jokaisesta kuukaudesta oma katsaus: inflaation taso ja suunta, hintatason muutos kuukaudessa, hintoja nostaneet ja laskeneet hyödykeryhmät sekä vertailu euroalueeseen. Tekstit syntyvät Tilastokeskuksen ja Eurostatin luvuista.',
    meta: sourceMeta(ctx, [A.sources.khi, A.sources.ykhi], ctx.latest.dataUpdated),
  })}
${c.section({
  id: 'uusin',
  eyebrow: 'Uusin katsaus',
  title: html`<a href="${katsausPath(latest)}">${k.title}</a>`,
  body: html`<div class="prose katsaus-teaser">
  <p class="katsaus-teaser__headline">${k.headline}.</p>
  <p>${k.paragraphs[0]}</p>
  <p><a href="${katsausPath(latest)}">Lue koko katsaus</a></p>
</div>`,
})}
${c.section({ id: 'kaikki', eyebrow: 'Arkisto', title: 'Kaikki katsaukset', body: table })}
${c.section({
  id: 'tilaa',
  title: 'Tilaa uudet luvut',
  className: 'section--tight',
  body: html`<p class="measure">Uudet katsaukset ja julkaisut näkyvät RSS-syötteessä heti, kun sivusto päivittyy.</p><p>${c.button({ label: 'RSS-syöte', icon: 'rss', href: '/feed.xml', size: 'sm' })}</p>`,
})}`;

  return {
    path,
    priority: 0.7,
    changefreq: 'monthly',
    html: ctx.layout({
      title: 'Inflaatiokatsaukset kuukausittain',
      description: fitDescription([
        `Inflaatiokatsaukset kuukausittain ${fmt.monthRange(list[0], latest)}: inflaatio, hintoja nostaneet hyödykeryhmät ja vertailu euroalueeseen.`,
        `Uusin: ${fmt.monthName(latest)}.`,
      ]),
      path,
      page: 'katsaus',
      breadcrumbs: ctx.crumbs(path, ctx.site.pageName(path) ?? 'Kuukausikatsaukset'),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Inflaatiokatsaukset',
          url: ctx.baseUrl + path,
          inLanguage: 'fi',
          hasPart: desc.slice(0, 12).map((ym) => ({ '@type': 'Article', headline: `Inflaatiokatsaus: ${fmt.monthName(ym)}`, url: ctx.baseUrl + katsausPath(ym) })),
        },
      ],
      main,
    }),
  };
}

function reviewPage(ctx, A, ym, prevYm, nextYm) {
  const { html, c } = ctx;
  const k = katsausModel(ctx, ym);
  const m = k.m;
  const path = katsausPath(ym);
  const name = fmt.monthName(ym);
  const year = fmt.yearOf(ym);

  const kpis = c.kpiGrid([
    c.kpiCard({ label: 'Inflaatio (KHI)', value: fmt.pct(m.yoy), note: `${fmt.capitalize(name)} · Tilastokeskus` }),
    c.kpiCard({
      label: 'Muutos edellisestä kuukaudesta',
      value: fmt.pp(m.delta),
      delta: stats.deltaClass(m.delta),
      note: `${fmt.capitalize(fmt.inessive(m.prevYm, { year: fmt.yearOf(m.prevYm) !== year }))} ${fmt.pct(m.prevYoy)}`,
    }),
    c.kpiCard({ label: 'Hinnat kuukaudessa', value: fmt.pct(m.mom, { sign: true }), note: `Hintataso ${fmt.elative(m.prevYm, { year: false })} ${fmt.illative(ym, { year: false })}` }),
    c.kpiCard({ label: 'YKHI (Eurostat)', value: fmt.pct(m.ykhi.yoy), note: `Euroalue ${fmt.pct(m.ea.yoy)}${m.ykhi.provisional || m.ea.provisional ? ' · ennakko' : ''}` }),
  ]);

  const nextLink = !k.next && nextYm ? html`<p>Seuraavan kuukauden katsaus: <a href="${katsausPath(nextYm)}">${fmt.monthName(nextYm)}</a>.</p>` : '';
  const article = html`<div class="prose katsaus-text">
  ${k.paragraphs.map((p) => html`<p>${p}</p>`)}
  ${nextLink}
</div>`;
  const comment = k.comment
    ? c.callout({
        tone: 'note',
        title: 'Ylläpitäjän kommentti',
        body: html`${k.comment.paragraphs.map((p) => html`<p>${p}</p>`)}${k.comment.author || k.comment.date ? html`<p class="katsaus-comment__by">${[k.comment.author, k.comment.date ? fmt.date(k.comment.date) : null].filter(Boolean).join(' · ')}</p>` : ''}`,
      })
    : '';

  const meta = html`${k.published ? html`Julkaistu <time datetime="${k.published}">${fmt.date(k.published)}</time> · ` : ''}${k.modified && k.modified !== k.published ? html`Päivitetty <time datetime="${k.modified}">${fmt.date(k.modified)}</time> · ` : ''}Lähteet: <a href="${A.sources.khi.href}">Tilastokeskus</a>, <a href="${A.sources.ykhi.href}">Eurostat</a>`;

  const related = c.cardGrid([
    { href: monthPath(ym), eyebrow: 'Kuukausi', title: `Inflaatio ${fmt.inessive(ym)}`, text: 'Pisteluvut, kaikki perusvuodet ja vertailu euroalueeseen.', meta: 'Katso' },
    { href: yearPath(year), eyebrow: 'Vuosi', title: `Inflaatio ${year}`, text: `Vuoden ${year} kuukaudet ja vuosiluku.`, meta: 'Katso' },
    { href: '/hinnat/', eyebrow: 'Hinnat', title: 'Mikä kallistui?', text: 'Yksittäisten hyödykkeiden hintojen muutokset.', meta: 'Katso' },
  ]);

  const main = html`${c.pageHeader({
    eyebrow: `Inflaatiokatsaus · ${name}`,
    title: k.title,
    lede: `${k.headline}.`,
    meta,
  })}
${c.section({ id: 'tunnusluvut', title: 'Tunnusluvut', className: 'section--tight', body: kpis })}
${c.section({ id: 'katsaus', eyebrow: 'Katsaus', title: `${fmt.capitalize(name)} lyhyesti`, body: html`${article}${comment}` })}
${c.section({ id: 'kehitys', eyebrow: 'Kehitys', title: 'Kaksi vuotta taaksepäin', body: contextFigure(ctx, A, m, { id: 'katsaus-kehitys' }) })}
${m.groups ? c.section({ id: 'nostajat', eyebrow: 'Hyödykeryhmät', title: m.groups?.mode === 'contribution' ? 'Mikä nosti ja mikä laski inflaatiota?' : 'Mikä kallistui ja mikä halpeni?', body: contributionsFigure(ctx, A, m, { id: 'katsaus-vaikutukset' }) }) : ''}
${m.events.length ? c.section({ id: 'tapahtumat', eyebrow: 'Taustaa', title: `Tapahtumia ${fmt.inessive(ym)}`, body: eventList(ctx, m.events) }) : ''}
${c.section({
  id: 'lisaa',
  title: 'Lisää',
  className: 'section--tight',
  body: html`${related}${c.pager({
    label: 'Katsaukset',
    prev: prevYm ? { href: katsausPath(prevYm), label: fmt.capitalize(fmt.monthName(prevYm)) } : null,
    next: nextYm ? { href: katsausPath(nextYm), label: fmt.capitalize(fmt.monthName(nextYm)) } : null,
  })}<p class="archive-back"><a href="/katsaus/">Kaikki katsaukset</a></p>`,
})}`;

  const description = fitDescription([
    `Inflaatiokatsaus ${name}: KHI ${fmt.pct(m.yoy)} (${fmt.inessive(m.prevYm, { year: false })} ${fmt.pct(m.prevYoy)})${fmt.isNum(m.ykhi.yoy) ? `, YKHI ${fmt.pct(m.ykhi.yoy)}, euroalue ${fmt.pct(m.ea.yoy)}` : ''}.`,
    m.groups ? 'Mikä nosti ja mikä laski hintoja.' : '',
    'Tilastokeskuksen ja Eurostatin luvuista.',
  ]);
  const image = ctx.site.ogImage?.path ? `${ctx.baseUrl}${ctx.site.ogImage.path}` : undefined;
  return {
    path,
    priority: ym === A.latestMonth ? 0.8 : 0.5,
    changefreq: ym === A.latestMonth ? 'weekly' : 'yearly',
    html: ctx.layout({
      title: k.title,
      description,
      path,
      page: 'katsaus',
      ogType: 'article',
      breadcrumbs: ctx.crumbs(path, fmt.capitalize(name)),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: `${k.title} – ${lowerFirst(k.headline)}`.slice(0, 110),
          description,
          inLanguage: 'fi',
          url: ctx.baseUrl + path,
          mainEntityOfPage: ctx.baseUrl + path,
          image,
          datePublished: k.published ?? undefined,
          dateModified: k.modified ?? undefined,
          author: { '@type': 'Organization', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
          publisher: { '@type': 'Organization', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
          about: { '@type': 'Thing', name: `Inflaatio Suomessa ${fmt.inessive(ym)}` },
        },
      ],
      main,
    }),
  };
}
