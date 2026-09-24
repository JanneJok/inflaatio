/**
 * /data/ – open data (module data, owner EXTRAS; PROD-19, UX-32).
 *
 * Outputs
 * - /data/khi.csv                     KHI monthly: annual + monthly change, point figures of every base
 * - /data/khi-vuosi.csv               KHI official annual change + annual average point figures
 * - /data/ykhi.csv                    Eurostat HICP, Finland and the euro area
 * - /data/elinkustannusindeksi.csv    cost-of-living index (1951:10=100 and 1938:8–1939:7=100)
 * - /data/json/<name>.json            compact copies of every data/*.json (+ the release calendar)
 * - /data/latest.json                 the latest figures in one small file (static "API")
 * - /data/                            the page: files, sizes, format, citation examples, licence
 *
 * CSV format (Finnish Excel opens it directly): UTF-8 with BOM, semicolon
 * separator, decimal comma, ASCII hyphen-minus for negatives (spreadsheets do
 * not parse U+2212), CRLF line ends, Finnish header row, empty field = missing.
 * Every number comes straight from data/*.json as published (no rounding
 * beyond the published precision, nothing back-calculated).
 */

/** UTF-8 byte order mark: Excel needs it to read UTF-8 CSV correctly. */
export const CSV_BOM = String.fromCharCode(0xfeff);
const SEP = ';';
const EOL = '\r\n';

const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
const KHI_URL = 'https://stat.fi/tilasto/khi';
const EUROSTAT_HICP_URL = 'https://ec.europa.eu/eurostat/web/hicp';

/**
 * Number for a Finnish CSV cell: decimal comma, ASCII minus, '' for missing.
 * @param {number|null|undefined} v
 * @param {number} [decimals] fixed decimals (published precision); omitted = as is
 * @returns {string}
 */
export function csvNum(v, decimals) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const s = decimals == null ? String(v) : v.toFixed(decimals);
  return (s === '-0' || /^-0[.,]0+$/.test(s) ? s.slice(1) : s).replace('.', ',');
}

/**
 * One CSV cell: quoted only when it contains the separator, a quote or a line break.
 * @param {unknown} v
 */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV document: BOM + header + rows, CRLF line ends (incl. a final one).
 * @param {string[]} header
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(header, rows) {
  const line = (cells) => cells.map(csvCell).join(SEP);
  return CSV_BOM + [line(header), ...rows.map(line)].join(EOL) + EOL;
}

/** Index bases of an index object in a stable order (newest base first). */
const baseKeys = (index) =>
  Object.keys(index ?? {}).sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

/**
 * KHI monthly CSV (data/khi.json): one row per month.
 * @param {any} khi ctx.data.khi
 * @returns {{header: string[], rows: string[][], body: string}}
 */
export function khiCsv(khi) {
  const bases = baseKeys(khi.index);
  const header = [
    'Kuukausi',
    'Vuosimuutos (%)',
    'Kuukausimuutos (%)',
    'Kuukausimuutos: tieto',
    ...bases.map((b) => `Pisteluku ${b}`),
  ];
  const officialFrom = khi.momOfficialFrom ?? khi.months[0];
  const rows = khi.months.map((ym, i) => {
    const mom = khi.mom?.[i];
    const momKind = typeof mom === 'number' ? (ym >= officialFrom ? 'virallinen' : 'laskettu') : '';
    return [ym, csvNum(khi.yoy?.[i], 1), csvNum(mom, 1), momKind, ...bases.map((b) => csvNum(khi.index[b][i], 2))];
  });
  return { header, rows, body: toCsv(header, rows) };
}

/**
 * KHI annual CSV (data/khi-annual.json): official annual change (122q) and
 * annual average point figures (11xt); complete years only.
 * @param {any} ka ctx.data['khi-annual']
 */
export function khiAnnualCsv(ka) {
  const bases = baseKeys(ka.index);
  const header = ['Vuosi', 'Vuosimuutos (%)', ...bases.map((b) => `Pisteluku ${b} (vuosikeskiarvo)`)];
  const rows = ka.years.map((y, i) => [String(y), csvNum(ka.yoy?.[i], 1), ...bases.map((b) => csvNum(ka.index[b][i], 2))]);
  return { header, rows, body: toCsv(header, rows) };
}

/** 'p' → 'ennakko'; other Eurostat flags as published; none → ''. */
const flagText = (f) => (f === 'p' ? 'ennakko' : f ? String(f) : '');

/**
 * HICP CSV (data/ykhi.json): Finland and the euro area side by side.
 * @param {any} y ctx.data.ykhi
 */
export function ykhiCsv(y) {
  const geos = [
    ['FI', 'Suomi'],
    ['EA', 'Euroalue'],
  ].filter(([code]) => y.geo?.[code]);
  const header = ['Kuukausi'];
  for (const [code, label] of geos) {
    const g = y.geo[code];
    header.push(`${label} vuosimuutos (%)`, `${label} kuukausimuutos (%)`, `${label} pohjainflaatio (%)`);
    for (const b of baseKeys(g.index)) header.push(`${label} pisteluku ${b}`);
    header.push(`${label} tila`);
  }
  const rows = y.months.map((ym, i) => {
    const row = [ym];
    for (const [code] of geos) {
      const g = y.geo[code];
      row.push(csvNum(g.yoy?.[i], 1), csvNum(g.mom?.[i], 1), csvNum(g.coreYoy?.[i], 1));
      for (const b of baseKeys(g.index)) row.push(csvNum(g.index[b][i], 2));
      row.push(flagText(y.flags?.[code]?.[ym]));
    }
    return row;
  });
  return { header, rows, body: toCsv(header, rows) };
}

/**
 * Cost-of-living index CSV (data/elinkustannusindeksi.json): the monthly
 * 1951:10=100 series and the monthly 1938:8–1939:7=100 series on one month axis.
 * @param {any} eki ctx.data.elinkustannusindeksi
 * @param {any} fmt ctx.fmt (month arithmetic)
 */
export function ekiCsv(eki, fmt) {
  const series = [eki.monthly, eki.monthly1939].filter((s) => s?.months?.length);
  const first = series.map((s) => s.months[0]).sort()[0];
  const last = series.map((s) => s.months.at(-1)).sort().at(-1);
  const n = fmt.ymDiff(first, last) + 1;
  const months = Array.from({ length: n }, (_, i) => fmt.ymAdd(first, i));
  const lookup = series.map((s) => new Map(s.months.map((m, i) => [m, s.values[i]])));
  const header = ['Kuukausi', ...series.map((s) => `Elinkustannusindeksi ${s.base}`)];
  const rows = months.map((ym) => [ym, ...lookup.map((m) => csvNum(m.get(ym)))]);
  return { header, rows, months, body: toCsv(header, rows) };
}

/**
 * The latest figures as one small JSON object (/data/latest.json).
 * @param {any} ctx
 */
export function latestSummary(ctx) {
  const { fmt } = ctx;
  const L = ctx.latest;
  const out = { kuukausi: L.khi?.month ?? null };
  if (L.khi) {
    out.khi = {
      kuukausi: L.khi.month,
      vuosimuutos: L.khi.yoy,
      kuukausimuutos: L.khi.mom,
      muutos_edellisesta_kuukaudesta_prosenttiyksikkoa: L.khi.delta,
      pisteluku_2025_100: L.khi.index2025,
      pisteluku_2015_100: L.khi.index2015,
      julkaistu: fmt.isoDate(L.khi.updated),
      lahde: 'Tilastokeskus, kuluttajahintaindeksi',
    };
  }
  if (L.ykhi) {
    out.ykhi = {
      kuukausi: L.ykhi.month,
      suomi: L.ykhi.yoy,
      euroalue: L.ea?.month === L.ykhi.month ? L.ea.yoy : null,
      tila: L.ykhi.provisional ? 'ennakko' : 'lopullinen',
      julkaistu: fmt.isoDate(L.ykhi.updated),
      lahde: 'Eurostat, yhdenmukaistettu kuluttajahintaindeksi (YKHI)',
    };
  }
  if (L.elinkustannusindeksi) {
    out.elinkustannusindeksi = {
      kuukausi: L.elinkustannusindeksi.month,
      pisteluku: L.elinkustannusindeksi.value,
      perusajankohta: L.elinkustannusindeksi.base,
      lahde: 'Tilastokeskus, elinkustannusindeksi',
    };
  }
  const next = L.nextRelease?.khi;
  if (next) out.seuraava_khi_julkaisu = { paiva: next.date, kuukausi: next.period };
  out.paivitetty = L.dataUpdated ?? null;
  out.lisenssi = 'CC BY 4.0 (lähde mainittava: Tilastokeskus / Eurostat ja Inflaatio.fi)';
  out.url = `${ctx.baseUrl}/data/`;
  return out;
}

/**
 * File size in Finnish kilobytes: '0,4 kt', '41 kt', '1,2 Mt'.
 * @param {number} bytes
 * @param {any} fmt
 */
export function fileSize(bytes, fmt) {
  const kb = bytes / 1024;
  if (kb >= 1024) return `${fmt.num(kb / 1024, 1)}${fmt.NBSP}Mt`;
  return `${fmt.num(kb, kb < 10 ? 1 : 0)}${fmt.NBSP}kt`;
}

/** Descriptions of the JSON copies (data/*.json basename → Finnish text, meta key). */
const JSON_FILES = [
  ['khi', 'Kuluttajahintaindeksi kuukausittain: vuosi- ja kuukausimuutos, pisteluvut kaikilla perusvuosilla', 'khi'],
  ['khi-annual', 'Kuluttajahintaindeksin viralliset vuosimuutokset ja vuosikeskiarvot', 'khiAnnual'],
  ['ykhi', 'Yhdenmukaistettu kuluttajahintaindeksi (YKHI): Suomi, euroalue, Pohjoismaat ja EU-maat', 'ykhi'],
  ['ykhi-annual', 'YKHI:n viralliset vuosimuutokset', 'ykhiAnnual'],
  ['elinkustannusindeksi', 'Elinkustannusindeksi kuukausittain ja vuosittain (1951:10=100 ja vanhemmat perusajankohdat)', 'elinkustannusindeksi'],
  ['hyodykkeet', 'Hyödykeryhmien vuosimuutokset, painot ja vaikutukset inflaatioon', 'hyodykkeet'],
  ['hyodykesarjat', 'Valittujen hyödykkeiden hintaindeksit kuukausittain', 'hyodykesarjat'],
  ['polttoaineet', 'Polttonesteiden keskihinnat (€/l)', 'polttoaineet'],
  ['ansiot', 'Ansiotasoindeksi ja reaaliansiot neljännesvuosittain', 'ansiot'],
  ['korot', 'EKP:n talletuskorko ja 12 kuukauden euribor', 'korot'],
  ['muutosloki', 'Muutosloki: milloin uudet luvut julkaistiin', null],
  ['meta', 'Lähteiden tiedot: taulukot, lisenssit ja päivitysajat', null],
];

/** @param {any} ctx */
export default async function data(ctx) {
  const { html, fmt, c } = ctx;
  const path = '/data/';
  const base = ctx.baseUrl;
  const d = ctx.data;
  const L = ctx.latest;
  const meta = d.meta?.sources ?? {};
  if (!d.khi?.months?.length || !L.khi) throw new Error('data: data/khi.json is missing (run npm run fetch)');

  const outputs = [];
  const bytes = (body) => Buffer.byteLength(body, 'utf8');

  // ------------------------------------------------------------- CSV files
  /** @type {{id: string, file: string, title: string, desc: string|any, csv: {header: string[], rows: unknown[][], body: string}, period: string, rowsLabel: string, sources: {name: string, href: string, detail: string}[], updated: string|null, json: string, creator: {name: string, url: string}, temporal: string, keywords: string[]}[]} */
  const csvFiles = [];
  const khi = khiCsv(d.khi);
  const firstYoy = d.khi.yoy.findIndex((v) => v != null);
  csvFiles.push({
    id: 'khi',
    file: 'khi.csv',
    title: 'Kuluttajahintaindeksi kuukausittain',
    desc: html`Vuosimuutos (inflaatio), kuukausimuutos ja pisteluvut kaikilla Tilastokeskuksen perusvuosilla (${baseKeys(d.khi.index).join(', ')}). Jokainen pistelukusarja alkaa perusvuodestaan. Kuukausimuutos on virallinen ${fmt.monthShort(d.khi.momOfficialFrom)} alkaen; sitä ennen se on laskettu virallisesta 1972=100-pisteluvusta (sarake <em>Kuukausimuutos: tieto</em>).`,
    csv: khi,
    period: `${fmt.monthRange(d.khi.months[0], d.khi.months.at(-1))} (vuosimuutos ${fmt.monthShort(d.khi.months[firstYoy])} alkaen)`,
    rowsLabel: `${fmt.num(khi.rows.length)} kuukautta`,
    sources: [{ name: 'Tilastokeskus', href: KHI_URL, detail: `taulukot ${meta.khi?.table ?? '122p, 11xs, 15b5'}` }],
    updated: meta.khi?.updated ?? null,
    json: 'khi',
    creator: { name: 'Tilastokeskus', url: 'https://stat.fi/' },
    temporal: `${d.khi.months[0]}/${d.khi.months.at(-1)}`,
    keywords: ['inflaatio', 'kuluttajahintaindeksi', 'KHI', 'CPI', 'Suomi'],
  });

  const ka = d['khi-annual'];
  if (ka?.years?.length) {
    const csv = khiAnnualCsv(ka);
    const firstAnnual = ka.years[ka.yoy.findIndex((v) => v != null)];
    csvFiles.push({
      id: 'khi-vuosi',
      file: 'khi-vuosi.csv',
      title: 'Kuluttajahintaindeksi vuosittain',
      desc: html`Tilastokeskuksen virallinen vuosimuutos (${firstAnnual} alkaen) ja pistelukujen vuosikeskiarvot. Vain päättyneet vuodet; kuluvan vuoden keskiarvo näkyy etusivulla kuukausien mukaan merkittynä (esim. ${L.khi.currentYear?.label ?? fmt.yearOf(L.khi.month)}).`,
      csv,
      period: `${ka.years[0]}–${ka.years.at(-1)}`,
      rowsLabel: `${fmt.num(csv.rows.length)} vuotta`,
      sources: [{ name: 'Tilastokeskus', href: KHI_URL, detail: `taulukot ${meta.khiAnnual?.table ?? '122q, 11xt'}` }],
      updated: meta.khiAnnual?.updated ?? null,
      json: 'khi-annual',
      creator: { name: 'Tilastokeskus', url: 'https://stat.fi/' },
      temporal: `${ka.years[0]}/${ka.years.at(-1)}`,
      keywords: ['inflaatio vuosittain', 'kuluttajahintaindeksi', 'vuosimuutos', 'Suomi'],
    });
  }

  const y = d.ykhi;
  if (y?.months?.length && y.geo?.FI) {
    const csv = ykhiCsv(y);
    const firstFi = y.months[y.geo.FI.yoy.findIndex((v) => v != null)];
    csvFiles.push({
      id: 'ykhi',
      file: 'ykhi.csv',
      title: 'Yhdenmukaistettu kuluttajahintaindeksi (YKHI), Suomi ja euroalue',
      desc: html`Eurostatin YKHI (HICP) Suomelle ja euroalueelle: vuosimuutos (${fmt.monthShort(firstFi)} alkaen), kuukausimuutos, pohjainflaatio (ilman energiaa, ruokaa, alkoholia ja tupakkaa) sekä pisteluvut. Sarake <em>tila</em> kertoo, jos kuukauden luku on vielä ennakkotieto.`,
      csv,
      period: fmt.monthRange(y.months[0], y.months.at(-1)),
      rowsLabel: `${fmt.num(csv.rows.length)} kuukautta`,
      sources: [{ name: 'Eurostat', href: meta.ykhi?.url ?? EUROSTAT_HICP_URL, detail: `tietokanta ${meta.ykhi?.dataset ?? 'prc_hicp_minr'}` }],
      updated: meta.ykhi?.updated ?? null,
      json: 'ykhi',
      creator: { name: 'Eurostat', url: 'https://ec.europa.eu/eurostat' },
      temporal: `${y.months[0]}/${y.months.at(-1)}`,
      keywords: ['YKHI', 'HICP', 'yhdenmukaistettu kuluttajahintaindeksi', 'euroalue', 'inflaatio'],
    });
  }

  const eki = d.elinkustannusindeksi;
  if (eki?.monthly?.months?.length) {
    const csv = ekiCsv(eki, fmt);
    csvFiles.push({
      id: 'elinkustannusindeksi',
      file: 'elinkustannusindeksi.csv',
      title: 'Elinkustannusindeksi kuukausittain',
      desc: html`Vuokrasopimusten indeksiehdoissa yleisimmin käytetty elinkustannusindeksi (${eki.monthly.base}) sekä pitkä sarja ${eki.monthly1939?.base ?? ''}. Tuorein pisteluku ${fmt.num(L.elinkustannusindeksi?.value)} (${fmt.monthName(L.elinkustannusindeksi?.month)}).`,
      csv,
      period: fmt.monthRange(csv.months[0], csv.months.at(-1)),
      rowsLabel: `${fmt.num(csv.rows.length)} kuukautta`,
      sources: [{ name: 'Tilastokeskus', href: KHI_URL, detail: `taulukot ${meta.elinkustannusindeksi?.table ?? '11xl, 11xn'}` }],
      updated: meta.elinkustannusindeksi?.updated ?? null,
      json: 'elinkustannusindeksi',
      creator: { name: 'Tilastokeskus', url: 'https://stat.fi/' },
      temporal: `${csv.months[0]}/${csv.months.at(-1)}`,
      keywords: ['elinkustannusindeksi', 'vuokrankorotus', 'indeksiehto', '1951:10=100'],
    });
  }
  for (const f of csvFiles) outputs.push({ path: `/data/${f.file}`, body: f.csv.body });

  // ------------------------------------------------------------ JSON files
  const jsonFiles = JSON_FILES.filter(([name]) => d[name] != null).map(([name, desc, metaKey]) => {
    const body = JSON.stringify(d[name]);
    outputs.push({ path: `/data/json/${name}.json`, body });
    const updated = metaKey ? meta[metaKey]?.updated : name === 'meta' ? d.meta?.generatedAt : L.dataUpdated;
    return { name, desc, size: bytes(body), updated: updated ?? null };
  });
  if (Array.isArray(ctx.content.julkaisukalenteri)) {
    const body = JSON.stringify(ctx.content.julkaisukalenteri);
    outputs.push({ path: '/data/json/julkaisukalenteri.json', body });
    jsonFiles.push({ name: 'julkaisukalenteri', desc: 'Tulevat julkaisupäivät (Tilastokeskus ja Eurostat)', size: bytes(body), updated: null });
  }
  const latestBody = `${JSON.stringify(latestSummary(ctx), null, 2)}\n`;
  outputs.push({ path: '/data/latest.json', body: latestBody });

  // ------------------------------------------------------------------ page
  const k = L.khi;
  const khiMonth = fmt.monthName(k.month);
  const ykhiMonth = L.ykhi ? fmt.monthName(L.ykhi.month) : null;
  const trackCsv = 'csv_download';

  const fileCards = html`<ul class="data-files" role="list">${csvFiles.map(
    (f) => html`<li class="data-file" id="${f.id}">
  <h3 class="data-file__title" id="${f.id}-otsikko">${f.title}</h3>
  <p class="data-file__desc">${f.desc}</p>
  <dl class="data-file__meta">
    <div><dt>Ajanjakso</dt><dd>${f.period}</dd></div>
    <div><dt>Rivejä</dt><dd>${f.rowsLabel}</dd></div>
    <div><dt>Lähde</dt><dd>${f.sources.map((s) => html`<a href="${s.href}">${s.name}</a>, ${s.detail}`)}</dd></div>
    <div><dt>Päivitetty</dt><dd>${f.updated ? html`<time datetime="${fmt.isoDate(f.updated)}">${fmt.date(f.updated)}</time>` : fmt.DASH}</dd></div>
  </dl>
  ${c.details({
    summary: `Sarakkeet (${f.csv.header.length})`,
    className: 'disclosure--plain data-file__columns',
    body: html`<ol class="data-file__column-list">${f.csv.header.map((h) => html`<li><code>${h}</code></li>`)}</ol>`,
  })}
  <ul class="download-list data-file__downloads" role="list">
    <li>${c.downloadLink({ href: `/data/${f.file}`, label: f.file, format: 'CSV', size: fileSize(bytes(f.csv.body), fmt), track: trackCsv })}</li>
    <li>${c.downloadLink({ href: `/data/json/${f.json}.json`, label: `${f.json}.json`, format: 'JSON', size: fileSize(jsonFiles.find((j) => j.name === f.json)?.size ?? 0, fmt), track: 'json_download' })}</li>
  </ul>
</li>`,
  )}</ul>`;

  const jsonItems = [
    { href: '/data/latest.json', name: 'latest.json', desc: 'Tuoreimmat luvut yhdessä pienessä tiedostossa: KHI, YKHI, euroalue, elinkustannusindeksi ja seuraava julkaisupäivä', size: bytes(latestBody), updated: L.dataUpdated },
    ...jsonFiles.map((j) => ({ href: `/data/json/${j.name}.json`, name: `${j.name}.json`, desc: j.desc, size: j.size, updated: j.updated })),
  ];
  const jsonList = html`<ul class="json-files" role="list">${jsonItems.map(
    (j) => html`<li class="json-file">
  ${c.downloadLink({ href: j.href, label: j.name, format: 'JSON', size: fileSize(j.size, fmt), track: 'json_download' })}
  <p class="json-file__desc">${j.desc}${j.updated ? html`<span class="json-file__updated"> · Päivitetty <time datetime="${fmt.isoDate(j.updated)}">${fmt.date(j.updated)}</time></span>` : ''}</p>
</li>`,
  )}</ul>`;

  const formatList = html`<dl class="data-format">
  <div><dt>Erotin</dt><dd>puolipiste (<code>;</code>)</dd></div>
  <div><dt>Desimaalit</dt><dd>desimaalipilkku (<code>2,2</code>), negatiiviset luvut tavuviivalla (<code>-0,2</code>)</dd></div>
  <div><dt>Merkistö</dt><dd>UTF-8 ja BOM-merkki, jotta ä ja ö näkyvät oikein Excelissä</dd></div>
  <div><dt>Kuukausi</dt><dd>muodossa <code>VVVV-KK</code>, esimerkiksi <code>${k.month}</code></dd></div>
  <div><dt>Puuttuva arvo</dt><dd>tyhjä kenttä (ei koskaan nolla)</dd></div>
  <div><dt>Tarkkuus</dt><dd>kuten lähde julkaisee: muutokset 1 desimaalilla, pisteluvut 2 desimaalilla</dd></div>
</dl>`;

  const notes = c.accordion([
    {
      summary: 'Miksi vanhoja pistelukuja on usealla perusvuodella?',
      body: html`<p>Tilastokeskus julkaisee pisteluvut jokaisella perusvuodella erikseen, ja jokainen sarja alkaa perusvuodestaan. Käytä vanhoille kuukausille vanhempaa perusvuotta äläkä ketjuta uudempaa sarjaa itse taaksepäin. Oletuksena sivustolla näytetään uusin perusvuosi 2025=100.</p>`,
    },
    {
      summary: 'Mitä tarkoittaa YKHI:n tila ”ennakko”?',
      body: html`<p>Eurostat julkaisee kuukauden lopussa pikaennakon, joka voi tarkentua lopullisessa julkaisussa noin kahden viikon kuluttua. Ennakkoluvut on merkitty tiedostoon sanalla <em>ennakko</em>, ja ne korvautuvat automaattisesti lopullisilla.</p>`,
    },
    {
      summary: 'Miksi kuluvaa vuotta ei ole vuositiedostossa?',
      body: html`<p>Vuositiedostossa ovat vain Tilastokeskuksen viralliset vuosimuutokset päättyneiltä vuosilta. Kuluvan vuoden luvun voi laskea kuukausitiedostosta vuosimuutosten keskiarvona, mutta se on väliaikainen ja kattaa vain julkaistut kuukaudet (nyt ${L.khi.currentYear?.span ?? fmt.monthNameOnly(k.month)}).</p>`,
    },
    {
      summary: 'Miten JSON-tiedostot on rakennettu?',
      body: html`<p>Kuukaudet ovat taulukossa <code>months</code> nousevassa järjestyksessä, ja jokainen arvotaulukko on samassa järjestyksessä. Puuttuva arvo on <code>null</code>. Kentät vastaavat sivuston omaa tietomallia; tiedosto <code>meta.json</code> kertoo jokaisen lähteen taulukon, lisenssin ja päivitysajan.</p>`,
    },
  ]);

  const year = fmt.yearOf(k.month);
  const citations = [
    {
      id: 'viittaus-khi',
      label: 'Lyhyt lähdemerkintä (KHI)',
      text: `Lähde: Tilastokeskus, kuluttajahintaindeksi, ${khiMonth}. Koonnut Inflaatio.fi.`,
    },
    L.ykhi && {
      id: 'viittaus-ykhi',
      label: 'Lyhyt lähdemerkintä (YKHI)',
      text: `Lähde: Eurostat, yhdenmukaistettu kuluttajahintaindeksi (YKHI), ${ykhiMonth}. Koonnut Inflaatio.fi.`,
    },
    {
      id: 'viittaus-luettelo',
      label: 'Lähdeluetteloon',
      text: `Tilastokeskus (${year}). Kuluttajahintaindeksi [verkkojulkaisu]. Helsinki: Tilastokeskus. Aineisto koottu: Inflaatio.fi, ${base}/data/. Viitattu [päivämäärä].`,
    },
  ].filter(Boolean);
  const citationBlocks = html`<div class="citations">${citations.map(
    (ci) => html`<figure class="citation">
  <figcaption class="citation__label">${ci.label}</figcaption>
  <blockquote class="citation__text" id="${ci.id}"><p>${ci.text}</p></blockquote>
  ${c.copyButton({ target: `#${ci.id}`, label: 'Kopioi', size: 'sm' })}
</figure>`,
  )}</div>`;

  const licence = html`<div class="prose">
  <p>Tiedostojen luvut ovat Tilastokeskuksen ja Eurostatin julkaisemia virallisia tilastoja. Saat käyttää, muokata ja jakaa niitä vapaasti, myös kaupallisesti, kun mainitset alkuperäisen lähteen:</p>
  <ul>
    <li><strong>Tilastokeskus</strong> (kuluttajahintaindeksi, elinkustannusindeksi, hyödykkeet, polttonesteet, ansiot): <a href="https://creativecommons.org/licenses/by/4.0/deed.fi">CC BY 4.0</a> -lisenssi, lähdemerkintä ”Lähde: Tilastokeskus”.</li>
    <li><strong>Eurostat</strong> (YKHI): uudelleenkäyttö sallittu lähde mainiten (<a href="https://ec.europa.eu/eurostat/web/main/help/copyright-notice">Eurostatin tekijänoikeusilmoitus</a>).</li>
    <li><strong>EKP</strong> (korot): <a href="https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html">EKP:n tilastojen käyttöehdot</a>, lähdemerkintä ”Lähde: EKP”.</li>
  </ul>
  <p>Inflaatio.fi kokoaa luvut yhteen muuttamatta niitä. Mainitse myös Inflaatio.fi, jos käytät näitä tiedostoja. Tarkista tärkeät luvut alkuperäisestä lähteestä: tiedostot tarjotaan sellaisinaan, eikä Inflaatio.fi vastaa niiden käytöstä. Sivuston tekstit ja ulkoasu eivät kuulu avoimen datan piiriin, ks. <a href="/kayttoehdot/">käyttöehdot</a>.</p>
</div>`;

  const next = L.nextRelease?.khi;
  const updates = html`<div class="prose">
  <p>Tiedostot päivittyvät automaattisesti samana päivänä, kun Tilastokeskus tai Eurostat julkaisee uudet luvut. Kuluttajahintaindeksin tuorein kuukausi on ${khiMonth}${L.ykhi ? html` ja YKHI:n ${ykhiMonth}${L.ykhi.provisional ? ' (ennakko)' : ''}` : ''}.${
    next ? html` Seuraava kuluttajahintaindeksi julkaistaan <time datetime="${next.date}">${fmt.date(next.date)}</time> (${fmt.monthName(next.period)}).` : ''
  }</p>
  <p>Uudet julkaisut näet myös <a href="/feed.xml">RSS-syötteestä</a>.</p>
</div>
${c.sourceLine({
  sources: [
    { name: 'Tilastokeskus', href: KHI_URL, detail: 'kuluttajahintaindeksi' },
    { name: 'Eurostat', href: EUROSTAT_HICP_URL, detail: 'YKHI' },
  ],
  updated: L.dataUpdated,
})}`;

  const main = html`${c.pageHeader({
    eyebrow: `Avoin data · ${khiMonth}`,
    title: 'Avoin data',
    lede: 'Lataa Suomen inflaatioluvut CSV- tai JSON-tiedostoina. Tiedostot päivittyvät automaattisesti, kun Tilastokeskus tai Eurostat julkaisee uudet luvut.',
    meta: html`Päivitetty <time datetime="${L.dataUpdated ?? ''}">${fmt.date(L.dataUpdated)}</time> · Lähteet: Tilastokeskus, Eurostat · Lisenssi CC BY 4.0`,
  })}
${c.section({
  id: 'csv',
  title: 'CSV-tiedostot',
  intro: 'Avautuvat suoraan suomenkieliseen Exceliin ja muihin taulukkolaskentaohjelmiin.',
  body: fileCards,
})}
${c.section({
  id: 'json',
  title: 'JSON-tiedostot',
  intro: 'Kaikki sivuston käyttämä data koneluettavassa muodossa, samat luvut kuin kaavioissa.',
  body: jsonList,
})}
${c.section({
  id: 'muoto',
  title: 'Tiedostojen muoto',
  intro: 'CSV-tiedostojen rakenne ja huomioita lukujen käytöstä.',
  body: html`${formatList}${notes}`,
})}
${c.section({
  id: 'viittaus',
  title: 'Näin viittaat',
  intro: 'Mainitse aina alkuperäinen lähde. Kopioi valmis lähdemerkintä:',
  body: citationBlocks,
})}
${c.section({ id: 'lisenssi', title: 'Käyttöoikeus ja lähteet', body: licence })}
${c.section({ id: 'paivitykset', title: 'Päivitykset', body: updates })}`;

  const includedIn = { '@type': 'DataCatalog', name: 'Inflaatio.fi – avoin data', url: `${base}${path}` };
  const datasets = csvFiles.map((f) => ({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${f.title} (${f.period.split(' (')[0]})`,
    description: `${f.title}: ${f.csv.header.slice(1).join(', ')}. Lähde: ${f.creator.name}. CSV (puolipiste, desimaalipilkku, UTF-8) ja JSON.`,
    url: `${base}${path}#${f.id}`,
    identifier: `${base}/data/${f.file}`,
    inLanguage: 'fi',
    isAccessibleForFree: true,
    license: LICENSE_URL,
    creator: { '@type': 'Organization', name: f.creator.name, url: f.creator.url },
    publisher: { '@type': 'Organization', name: ctx.site.brand, url: `${base}/` },
    isBasedOn: f.sources[0].href,
    temporalCoverage: f.temporal,
    spatialCoverage: { '@type': 'Place', name: f.id === 'ykhi' ? 'Suomi ja euroalue' : 'Suomi' },
    dateModified: f.updated ? fmt.isoDate(f.updated) : L.dataUpdated,
    keywords: f.keywords,
    variableMeasured: f.csv.header.slice(1),
    includedInDataCatalog: includedIn,
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${base}/data/${f.file}`, name: f.file },
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${base}/data/json/${f.json}.json`, name: `${f.json}.json` },
    ],
  }));

  outputs.push({
    path,
    changefreq: 'daily',
    html: ctx.layout({
      title: 'Avoin data: inflaatio CSV- ja JSON-muodossa',
      description: 'Lataa Suomen inflaatioluvut (KHI, YKHI, elinkustannusindeksi) CSV- ja JSON-tiedostoina. Päivittyy automaattisesti. Lähteet: Tilastokeskus, Eurostat.',
      path,
      page: 'data',
      breadcrumbs: ctx.crumbs(path, 'Avoin data'),
      jsonLd: datasets,
      main,
    }),
  });
  return outputs;
}
