/**
 * data/ansiot.json — Tilastokeskus ansiotasoindeksi and reaaliansioindeksi,
 * table 14um (whole economy, all pay types, both sexes), quarterly.
 *   { periods: ['1995-Q1', …], freq: 'Q', nominalYoy, realYoy,
 *     indexBase: '2015=100', nominalIndex, realIndex, preliminary: [periods] }
 * `preliminary` lists the quarters Tilastokeskus marks with '*' (ennakkotieto).
 */
import { resolveTable, getMetadata, findVariable, findValue, query, pxTime, tableWebUrl } from '../pxweb.js';
import { seriesOf } from '../jsonstat.js';
import { check } from '../validate.js';
import { quartersBetween, align, r1, r2, dataSpan, latestPeriod, isNum } from '../util.js';
import { pct } from '../../../src/js/lib/format.js';

const DB = 'ati';
export const TABLE = { id: '14um', title: /reaaliansioindeksi sektorin mukaan, neljännesvuositiedot/i };

async function fetchAnsiot() {
  const t = await resolveTable(DB, TABLE);
  const meta = await getMetadata(t.url);
  const time = findVariable(meta, { time: true });
  const sector = findVariable(meta, { text: /sektori/i });
  const payType = findVariable(meta, { text: /palkkausmuoto/i });
  const sex = findVariable(meta, { text: /sukupuoli/i });
  const cont = findVariable(meta, { code: /content|tiedot/i });
  const sel = {
    sector: findValue(sector, { text: /^koko kansantalous$/i }).code,
    pay: findValue(payType, { text: /^kaikki$/i }).code,
    sex: findValue(sex, { text: /^yhteensä$/i }).code,
  };
  const cc = {
    nomYoy: findValue(cont, { text: /^ansiotasoindeksi, vuosimuutos/i }).code,
    realYoy: findValue(cont, { text: /^reaaliansioindeksi, vuosimuutos/i }).code,
    nomIdx: findValue(cont, { text: /^ansiotasoindeksi 2015\s*=\s*100$/i }).code,
    realIdx: findValue(cont, { text: /^reaaliansioindeksi 2015\s*=\s*100$/i }).code,
  };
  const ds = await query(t.url, {
    [sector.code]: [sel.sector],
    [payType.code]: [sel.pay],
    [sex.code]: [sel.sex],
    [time.code]: time.values,
    [cont.code]: Object.values(cc),
  }, { timeVar: time.code, label: 'PxWeb 14um' });

  const where = { [sector.code]: sel.sector, [payType.code]: sel.pay, [sex.code]: sel.sex };
  const s = (content) => seriesOf(ds, time.code, { ...where, [cont.code]: content }, pxTime);
  const nom = s(cc.nomYoy);
  const real = s(cc.realYoy);
  const ni = s(cc.nomIdx);
  const ri = s(cc.realIdx);
  const span = dataSpan(nom.times, [nom.values, real.values, ni.values]);
  const periods = quartersBetween(span.start, span.end);
  const preliminary = time.values
    .map((code, i) => ({ p: pxTime(code), label: time.valueTexts?.[i] ?? code }))
    .filter((x) => /\*\s*$/.test(x.label) && periods.includes(x.p))
    .map((x) => x.p);
  const nominalYoy = align(periods, nom.times, nom.values, r1);
  return {
    data: {
      periods,
      freq: 'Q',
      nominalYoy,
      realYoy: align(periods, real.times, real.values, r1),
      indexBase: '2015=100',
      nominalIndex: align(periods, ni.times, ni.values, r2),
      realIndex: align(periods, ri.times, ri.values, r2),
      preliminary,
    },
    meta: { table: t.id.replace('.px', ''), url: tableWebUrl(DB, t.id), updated: ds.updated ?? null, latest: latestPeriod(periods, nominalYoy) },
  };
}

function validateAnsiot(data, prev) {
  return check('ansiot', (c) => {
    const n = data.periods?.length ?? 0;
    c.periods('ansiot.periods', data.periods, 'Q');
    if (data.freq !== 'Q') c.fail(`ansiot.freq is ${data.freq}`);
    c.values('ansiot.nominalYoy', data.nominalYoy, n, { min: -10, max: 25 });
    c.values('ansiot.realYoy', data.realYoy, n, { min: -15, max: 25 });
    c.values('ansiot.nominalIndex', data.nominalIndex, n, { positive: true });
    c.values('ansiot.realIndex', data.realIndex, n, { positive: true });
    if (prev?.periods) c.notOlder('ansiot', latestPeriod(data.periods, data.nominalYoy), latestPeriod(prev.periods, prev.nominalYoy ?? []));
  });
}

/** "Tilastokeskus julkaisi ansiotasoindeksin 2. neljännekseltä 2026: ansiot +3,4 %, reaaliansiot +1,6 % vuodessa." */
function eventsAnsiot(data, prev) {
  const latest = latestPeriod(data.periods, data.nominalYoy);
  const prevLatest = prev?.periods ? latestPeriod(prev.periods, prev.nominalYoy ?? []) : null;
  if (!latest || latest === prevLatest) return [];
  const i = data.periods.indexOf(latest);
  const [y, q] = latest.split('-Q');
  const real = data.realYoy[i];
  const realPart = isNum(real) ? `, reaaliansiot ${pct(real, { sign: true })}` : '';
  return [{
    source: 'ansiot',
    period: latest,
    text: `Tilastokeskus julkaisi ansiotasoindeksin ${q}. neljännekseltä ${y}: ansiot ${pct(data.nominalYoy[i], { sign: true })}${realPart} vuodessa.`,
  }];
}

export default {
  key: 'ansiot',
  file: 'ansiot.json',
  name: 'Ansiotasoindeksi ja reaaliansiot',
  publisher: 'Tilastokeskus',
  license: 'CC BY 4.0',
  fetch: fetchAnsiot,
  validate: validateAnsiot,
  latest: (d) => latestPeriod(d.periods, d.nominalYoy),
  events: eventsAnsiot,
};
