/**
 * /feed.xml – RSS 2.0 feed in Finnish (owner ARCHIVE): one item per changelog
 * entry (data/muutosloki.json: new KHI, YKHI flash/final, ansiot, ECB rate)
 * and one per monthly review (/katsaus/<yyyy-mm>/) whose KHI release date is
 * known from the changelog. Everything comes from the data; the feed changes
 * only when the data does (no build timestamps).
 */
import * as fmt from '../js/lib/format.js';
import { archive, katsausPath, logHref, logId, logSourceLabel, lowerFirst } from './inflaatio.js';
import { katsausModel, katsausMonths } from './katsaus.js';

/** Maximum number of items in the feed. */
export const FEED_MAX_ITEMS = 60;

/** Publication times (Finnish time) of the sources, used for pubDate. */
const RELEASE_TIME = { khi: '08:00', ykhi: '12:00', ansiot: '08:00', korot: '00:00' };

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
/** Escape text for XML element content and attributes. @param {unknown} s */
export function xmlEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC offset of Europe/Helsinki at an instant, in minutes (+120 / +180). */
function helsinkiOffset(ms) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Helsinki', timeZoneName: 'longOffset' })
    .formatToParts(new Date(ms))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = name?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/**
 * RFC 822 date for a Finnish calendar date and local time:
 * rfc822('2026-09-14', '08:00') → 'Mon, 14 Sep 2026 08:00:00 +0300'.
 * @param {string} date 'YYYY-MM-DD'
 * @param {string} [time='00:00'] 'HH:MM' Helsinki time
 */
export function rfc822(date, time = '00:00') {
  const d = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) throw new RangeError(`rfc822: invalid date/time ${date} ${time}`);
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  const localAsUtc = Date.UTC(y, mo - 1, da, h, mi);
  const offset = helsinkiOffset(localAsUtc - helsinkiOffset(localAsUtc) * 60000);
  const weekday = DAYS[new Date(Date.UTC(y, mo - 1, da)).getUTCDay()];
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
  const pad = (n) => String(n).padStart(2, '0');
  return `${weekday}, ${pad(da)} ${MONTHS_EN[mo - 1]} ${y} ${pad(h)}:${pad(mi)}:00 ${off}`;
}

/** Sortable key 'YYYY-MM-DD HH:MM'. */
const sortKey = (it) => `${it.date} ${it.time}`;

/**
 * Title of a changelog entry.
 * @param {ReturnType<typeof archive>} A
 * @param {{source: string, period: string, kind?: string}} e
 */
export function logTitle(A, e) {
  const isMonth = /^\d{4}-\d{2}$/.test(e.period ?? '');
  if (e.source === 'khi' && isMonth) {
    const yoy = A.khiAt(A.ctx.data.khi.yoy, e.period);
    return fmt.isNum(yoy) ? `Inflaatio ${fmt.inessive(e.period)}: ${fmt.pct(yoy)}` : `Kuluttajahintaindeksi, ${fmt.monthName(e.period)}`;
  }
  if (e.source === 'ykhi' && isMonth) {
    return e.kind === 'ennakko' ? `YKHI-ennakko, ${fmt.monthName(e.period)}` : `YKHI, lopulliset luvut, ${fmt.monthName(e.period)}`;
  }
  const q = String(e.period ?? '').match(/^(\d{4})-Q([1-4])$/);
  if (e.source === 'ansiot' && q) return `Ansiotasoindeksi, ${q[2]}. neljännes ${q[1]}`;
  if (e.source === 'korot') return 'EKP:n talletuskorko muuttui';
  return `${logSourceLabel(e)}: ${e.period ?? ''}`.trim();
}

/**
 * Feed items (newest first, at most FEED_MAX_ITEMS).
 * @param {any} ctx
 * @returns {{title: string, link: string, guid: string, permalink: boolean, date: string, time: string, description: string, category: string}[]}
 */
export function feedItems(ctx) {
  const A = archive(ctx);
  const base = ctx.baseUrl;
  const items = [];
  for (const e of A.log) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? '') || !e.text) continue;
    const href = logHref(A, e) ?? '/inflaatio/#muutosloki';
    items.push({
      title: logTitle(A, e),
      link: base + href,
      guid: `${base}/inflaatio/#${logId(e)}`,
      permalink: false,
      date: e.date,
      time: RELEASE_TIME[e.source] ?? '00:00',
      description: e.text,
      category: logSourceLabel(e),
    });
  }
  for (const ym of katsausMonths(A)) {
    const m = A.month(ym);
    if (!m.released) continue;
    const k = katsausModel(ctx, ym);
    items.push({
      title: `${k.title} – ${lowerFirst(k.headline)}`,
      link: base + katsausPath(ym),
      guid: base + katsausPath(ym),
      permalink: true,
      date: m.released,
      // A minute after the release so the review sorts above its KHI entry.
      time: '08:01',
      description: k.paragraphs[0],
      category: 'Katsaus',
    });
  }
  items.sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0));
  return items.slice(0, FEED_MAX_ITEMS);
}

/**
 * The RSS 2.0 document.
 * @param {any} ctx
 */
export function renderFeed(ctx) {
  const items = feedItems(ctx);
  const base = ctx.baseUrl;
  const newest = items[0];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${xmlEscape(`${ctx.site.brand} – uudet inflaatioluvut`)}</title>`,
    `<link>${xmlEscape(`${base}/`)}</link>`,
    `<atom:link href="${xmlEscape(`${base}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `<description>${xmlEscape('Tilastokeskuksen kuluttajahintaindeksin ja Eurostatin YKHI:n uudet luvut sekä kuukausittaiset inflaatiokatsaukset.')}</description>`,
    '<language>fi</language>',
    `<copyright>${xmlEscape(`Luvut: Tilastokeskus ja Eurostat (CC BY 4.0). Tekstit: ${ctx.site.brand}.`)}</copyright>`,
    newest ? `<lastBuildDate>${rfc822(newest.date, newest.time)}</lastBuildDate>` : null,
    newest ? `<pubDate>${rfc822(newest.date, newest.time)}</pubDate>` : null,
    '<docs>https://www.rssboard.org/rss-specification</docs>',
    ...items.map((it) =>
      [
        '<item>',
        `<title>${xmlEscape(it.title)}</title>`,
        `<link>${xmlEscape(it.link)}</link>`,
        `<guid isPermaLink="${it.permalink ? 'true' : 'false'}">${xmlEscape(it.guid)}</guid>`,
        `<pubDate>${rfc822(it.date, it.time)}</pubDate>`,
        `<category>${xmlEscape(it.category)}</category>`,
        `<description>${xmlEscape(it.description)}</description>`,
        '</item>',
      ].join(''),
    ),
    '</channel>',
    '</rss>',
    '',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/** @param {any} ctx */
export default async function feed(ctx) {
  return [{ path: '/feed.xml', body: renderFeed(ctx), sitemap: false }];
}
