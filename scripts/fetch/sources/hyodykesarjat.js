/**
 * data/hyodykesarjat.json — monthly series (Tilastokeskus 15b5, 2025=100) for
 * the ~60 recognisable commodities listed in scripts/fetch/hyodykesivut.json
 * (one page each under /hinnat/<slug>/).
 *
 *   { latest, base, items: { <slug>: { code, coicop, name, officialName, category,
 *     months, yoy, index } } }
 * Each item's months run from its first published value to the latest month.
 */
import { query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { monthsBetween, align, r1, r2, dataSpan } from '../util.js';
import { parseLabel } from '../coicop.js';
import { detailTable, loadPages } from './hyodykkeet.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function fetchSarjat({ log }) {
  const [{ t, time, item, cont, c }, pages] = await Promise.all([detailTable(), loadPages()]);
  const known = new Set(item.values);
  const missing = pages.filter((p) => !known.has(p.code));
  if (missing.length) {
    // A code vanished (classification change): report loudly but keep the rest.
    log?.(`warning: hyodykesivut.json codes not in ${t.id}: ${missing.map((p) => `${p.slug}=${p.code}`).join(', ')}`);
  }
  const wanted = pages.filter((p) => known.has(p.code));
  const ds = await query(t.url, { [time.code]: time.values, [item.code]: wanted.map((p) => p.code), [cont.code]: [c.ip, c.vm] }, { timeVar: time.code, label: 'PxWeb 15b5 items' });
  const labelOf = new Map(item.values.map((code, i) => [code, item.valueTexts[i]]));

  const items = {};
  let latest = null;
  for (const p of wanted) {
    const ipS = seriesOf(ds, time.code, { [item.code]: p.code, [cont.code]: c.ip }, pxTime);
    const vmS = seriesOf(ds, time.code, { [item.code]: p.code, [cont.code]: c.vm }, pxTime);
    const span = dataSpan(ipS.times, [ipS.values, vmS.values]);
    if (!span) {
      log?.(`warning: no data for ${p.slug} (${p.code})`);
      continue;
    }
    const months = monthsBetween(span.start, span.end);
    const { coicop, name: officialName } = parseLabel(labelOf.get(p.code));
    items[p.slug] = {
      code: p.code,
      coicop,
      name: p.name,
      officialName,
      category: p.category,
      months,
      yoy: align(months, vmS.times, vmS.values, r1),
      index: align(months, ipS.times, ipS.values, r2),
    };
    if (!latest || span.end > latest) latest = span.end;
  }
  return {
    data: { latest, base: '2025=100', items },
    meta: { table: `${t.id.replace('.px', '')} (hyödykkeet)`, url: tableWebUrl('khi', t.id), updated: ds.updated ?? null, latest },
  };
}

function validateSarjat(data, prev) {
  return check('hyodykesarjat', (c) => {
    const entries = Object.entries(data.items ?? {});
    if (entries.length < 40) c.fail(`hyodykesarjat: only ${entries.length} items`);
    for (const [slug, it] of entries) {
      if (!SLUG_RE.test(slug)) c.fail(`hyodykesarjat: slug ${slug} is not ascii-kebab`);
      if (!it.name || !it.category || !it.code) c.fail(`hyodykesarjat.${slug}: name/category/code missing`);
      c.periods(`hyodykesarjat.${slug}.months`, it.months, 'M');
      c.values(`hyodykesarjat.${slug}.yoy`, it.yoy, it.months?.length ?? 0, { min: -90, max: 500, required: false });
      c.values(`hyodykesarjat.${slug}.index`, it.index, it.months?.length ?? 0, { positive: true, max: 10_000 });
    }
    c.notOlder('hyodykesarjat', data.latest, prev?.latest);
  });
}

export default {
  key: 'hyodykesarjat',
  file: 'hyodykesarjat.json',
  name: 'Kuluttajahintaindeksi, valitut hyödykkeet',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchSarjat,
  validate: validateSarjat,
  latest: (d) => d.latest,
};
