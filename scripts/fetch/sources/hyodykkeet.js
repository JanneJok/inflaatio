/**
 * data/hyodykkeet.json — KHI by commodity group for the latest month
 * (Tilastokeskus 15b5, 2025=100) with 2026 weights (15bc), plus 60-month
 * series of the total and the 13 main groups.
 *
 *   items[]  { code, coicop, name, shortName?, nature, level, parent, weight (‰),
 *              index, yoy (%), mom (%), contribution (vaikutus vuodessa, %-yks.),
 *              contributionMom (vaikutus kuukaudessa, %-yks.), slug? }
 *   groups   { months (last 60), codes (display order), series: { SSS|01…13: { yoy, contribution } } }
 *   leaf     true when the item has no sub-items in the table
 * All figures are official values from the tables (nothing computed).
 */
import { readFile } from 'node:fs/promises';
import { resolveTable, getMetadata, findVariable, findValue, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { r1, r2, r3, isNum, monthsBetween, align } from '../util.js';
import { TOTAL, MAIN_GROUP_SHORT, levelOf, parseLabel, parentOf } from '../coicop.js';

const DB = 'khi';
export const TABLES = {
  detail: { id: '15b5', title: /Kuluttajahintaindeksi \(2025=100\), kuukausitiedot/i },
  weights: { id: '15bc', title: /painot hyödykeryhmittäin/i },
};
const GROUP_MONTHS = 60;

/** Slug map from scripts/fetch/hyodykesivut.json. */
export async function loadPages() {
  const text = await readFile(new URL('../hyodykesivut.json', import.meta.url), 'utf8');
  return JSON.parse(text);
}

/** Resolve 15b5 variables (shared with hyodykesarjat). */
export async function detailTable() {
  const t = await resolveTable(DB, TABLES.detail);
  const meta = await getMetadata(t.url);
  const time = findVariable(meta, { time: true });
  const item = findVariable(meta, { text: /hyödyke/i });
  const cont = findVariable(meta, { code: /content|tiedot/i });
  const c = {
    ip: findValue(cont, { text: /^indeksipisteluku.*KHI/i }).code,
    vm: findValue(cont, { text: /^vuosimuutos.*KHI/i }).code,
    km: findValue(cont, { text: /^kuukausimuutos.*KHI/i }).code,
    vv: findValue(cont, { text: /^vaikutus vuodessa.*KHI/i }).code,
    kv: findValue(cont, { text: /^vaikutus kuukaudessa.*KHI/i }).code,
  };
  return { t, meta, time, item, cont, c };
}

async function fetchHyodykkeet() {
  const [{ t, time, item, cont, c }, pages] = await Promise.all([detailTable(), loadPages()]);
  const tw = await resolveTable(DB, TABLES.weights);
  const mw = await getMetadata(tw.url);
  const wTime = findVariable(mw, { time: true });
  const wItem = findVariable(mw, { text: /hyödyke/i });
  const wCont = findVariable(mw, { code: /content|tiedot/i });
  const wKhi = findValue(wCont, { text: /painopromille,?\s*KHI$/i });
  const weightYear = wTime.values.at(-1);

  const latestCode = [...time.values].sort().at(-1);
  const latest = pxTime(latestCode);
  const mainCodes = item.values.filter((code) => code === TOTAL || /^\d{2}$/.test(code));

  const [dsLatest, dsW, dsG] = await Promise.all([
    query(t.url, { [time.code]: [latestCode], [item.code]: item.values, [cont.code]: [c.ip, c.vm, c.km, c.vv, c.kv] }, { timeVar: time.code, label: 'PxWeb 15b5 latest' }),
    query(tw.url, { [wTime.code]: [weightYear], [wItem.code]: wItem.values, [wCont.code]: [wKhi.code] }, { timeVar: wTime.code, label: 'PxWeb 15bc' }),
    query(t.url, { [time.code]: { filter: 'top', values: [String(GROUP_MONTHS)] }, [item.code]: mainCodes, [cont.code]: [c.vm, c.vv] }, { timeVar: time.code, label: 'PxWeb 15b5 groups' }),
  ]);

  const slugByCode = new Map(pages.map((p) => [p.code, p.slug]));
  const codes = new Set(item.values);
  const at = (code, content) => dsLatest.get({ [time.code]: latestCode, [item.code]: code, [cont.code]: content });
  const items = item.values.map((code, i) => {
    const { coicop, name, nature } = parseLabel(item.valueTexts[i]);
    const level = levelOf(code);
    const w = dsW.dims[wItem.code].position[code] !== undefined ? dsW.get({ [wTime.code]: weightYear, [wItem.code]: code, [wCont.code]: wKhi.code }) : null;
    const out = {
      code,
      coicop,
      name,
      ...(level === 1 && MAIN_GROUP_SHORT[code] ? { shortName: MAIN_GROUP_SHORT[code] } : {}),
      nature,
      level,
      parent: parentOf(code, codes),
      weight: r2(w),
      index: r2(at(code, c.ip)),
      yoy: r1(at(code, c.vm)),
      mom: r1(at(code, c.km)),
      contribution: r3(at(code, c.vv)),
      contributionMom: r3(at(code, c.kv)),
    };
    const slug = slugByCode.get(code);
    if (slug) out.slug = slug;
    return out;
  });
  // leaf = no sub-items in the table (use leaves for top/bottom lists to avoid
  // listing a group and its single identical sub-item twice).
  const parents = new Set(items.map((x) => x.parent));
  for (const it of items) it.leaf = !parents.has(it.code);

  const gTimes = dsG.dims[time.code].codes.map(pxTime);
  const months = monthsBetween(gTimes[0], gTimes.at(-1));
  const series = {};
  for (const code of mainCodes) {
    const yoyS = seriesOf(dsG, time.code, { [item.code]: code, [cont.code]: c.vm }, pxTime);
    const vvS = seriesOf(dsG, time.code, { [item.code]: code, [cont.code]: c.vv }, pxTime);
    series[code] = { yoy: align(months, yoyS.times, yoyS.values, r1), contribution: align(months, vvS.times, vvS.values, r3) };
  }

  return {
    data: { latest, base: '2025=100', weightYear, items, groups: { months, codes: mainCodes, series } },
    meta: {
      table: `${t.id.replace('.px', '')} (hyödykeryhmät), ${tw.id.replace('.px', '')} (painot ${weightYear})`,
      url: tableWebUrl(DB, t.id),
      updated: [dsLatest.updated, dsG.updated].filter(Boolean).sort().at(-1) ?? null,
      latest,
    },
  };
}

function validateHyodykkeet(data, prev) {
  return check('hyodykkeet', (c) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(data.latest ?? '')) c.fail(`hyodykkeet.latest invalid: ${data.latest}`);
    const items = data.items ?? [];
    if (items.length < 100) c.fail(`hyodykkeet.items: only ${items.length} items`);
    const seen = new Set();
    for (const it of items) {
      if (seen.has(it.code)) c.fail(`hyodykkeet: duplicate code ${it.code}`);
      seen.add(it.code);
      if (!it.name) c.fail(`hyodykkeet: item ${it.code} has no name`);
      for (const [k, rule] of [['yoy', { min: -90, max: 500 }], ['mom', { min: -80, max: 300 }], ['contribution', { min: -5, max: 10 }], ['weight', { min: 0, max: 1000 }], ['index', { positive: true, max: 10_000 }]]) {
        c.values(`hyodykkeet.${it.code}.${k}`, [it[k]], 1, { ...rule, required: false });
      }
    }
    const total = items.find((i) => i.code === TOTAL);
    const mains = items.filter((i) => i.level === 1);
    if (!total || !isNum(total.yoy)) c.fail('hyodykkeet: total (SSS) missing');
    if (mains.length < 12) c.fail(`hyodykkeet: only ${mains.length} main groups`);
    const wSum = mains.reduce((s, i) => s + (i.weight ?? 0), 0);
    if (mains.some((i) => isNum(i.weight)) && Math.abs(wSum - 1000) > 2) c.fail(`hyodykkeet: main group weights sum to ${wSum.toFixed(2)} ‰, expected 1000`);
    const cSum = mains.reduce((s, i) => s + (i.contribution ?? 0), 0);
    if (total && isNum(total.yoy) && Math.abs(cSum - total.yoy) > 0.3) c.fail(`hyodykkeet: contributions sum to ${cSum.toFixed(3)} but total is ${total.yoy}`);
    const g = data.groups ?? {};
    c.periods('hyodykkeet.groups.months', g.months, 'M');
    for (const [code, s] of Object.entries(g.series ?? {})) {
      c.values(`hyodykkeet.groups.${code}.yoy`, s.yoy, g.months?.length ?? 0, { min: -50, max: 100 });
      c.values(`hyodykkeet.groups.${code}.contribution`, s.contribution, g.months?.length ?? 0, { min: -5, max: 10 });
    }
    if (g.months?.at(-1) !== data.latest) c.fail(`hyodykkeet: groups end ${g.months?.at(-1)} ≠ latest ${data.latest}`);
    c.notOlder('hyodykkeet', data.latest, prev?.latest);
  });
}

export default {
  key: 'hyodykkeet',
  file: 'hyodykkeet.json',
  name: 'Kuluttajahintaindeksi hyödykeryhmittäin ja painot',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchHyodykkeet,
  validate: validateHyodykkeet,
  latest: (d) => d.latest,
};
