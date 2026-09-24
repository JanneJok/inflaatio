/**
 * /menetelmat/ – methods and definitions: KHI vs YKHI, official annual figures
 * vs the partial-year mean, monthly change vs %-yks., average annual change
 * (CAGR), base years, provisional values and revisions, update schedule and
 * release calendar, data sources (tables, links) and notation.
 *
 * Every example number is computed from ctx.data / ctx.latest at build time
 * and shown with its month and source; examples whose data is missing are
 * simply left out (the method text stays valid).
 *
 * The pure helpers (formatPeriod, releaseTime, upcomingReleases,
 * officialVsMonthlyMean, kkiBaseRows) are unit-tested in test/trust.test.js.
 */
import { legalSection, organizationLd } from './kayttoehdot.js';

/**
 * Period label: '2026-08' → 'elo 2026', '2026' → '2026', '2026-Q2' → '2. neljännes 2026'.
 * @param {any} fmt format.js
 * @param {string|null|undefined} p
 * @returns {string}
 */
export function formatPeriod(fmt, p) {
  if (typeof p !== 'string' || !p) return fmt.DASH;
  const q = p.match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[2]}. neljännes ${q[1]}`;
  if (/^\d{4}-\d{2}$/.test(p)) return fmt.monthShort(p);
  return p;
}

/**
 * Release time in Finnish notation: '08:00' → '8.00', '12:00' → '12.00'.
 * @param {string|null|undefined} time
 * @returns {string|null}
 */
export function releaseTime(time) {
  const m = typeof time === 'string' ? time.match(/^(\d{1,2}):(\d{2})$/) : null;
  return m ? `${Number(m[1])}.${m[2]}` : null;
}

/**
 * Release-calendar entries for periods the data does not have yet (same rule
 * as ctx.latest.nextRelease): KHI after the latest KHI month, the YKHI flash
 * after the latest YKHI month, the final YKHI after it – or for it while the
 * latest YKHI month is still a flash estimate.
 * @param {Array<{date: string, source: string, period: string}>|undefined} calendar
 * @param {{khi?: {month: string}, ykhi?: {month: string, provisional?: boolean}}} latest
 * @returns {Array<object>}
 */
export function upcomingReleases(calendar, latest) {
  if (!Array.isArray(calendar)) return [];
  const khi = latest?.khi?.month;
  const ykhi = latest?.ykhi?.month;
  const prov = Boolean(latest?.ykhi?.provisional);
  return calendar
    .filter((e) => {
      if (!e || typeof e.period !== 'string') return false;
      if (e.source === 'khi') return !khi || e.period > khi;
      if (e.source === 'ykhi-ennakko') return !ykhi || e.period > ykhi;
      if (e.source === 'ykhi') return !ykhi || (prov ? e.period >= ykhi : e.period > ykhi);
      return false;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The latest complete year whose official annual change differs from the
 * mean of its twelve monthly annual rates (both rounded to one decimal).
 * @param {any} stats stats.js
 * @param {{months: string[], yoy: (number|null)[]}} monthly khi.json
 * @param {{years: string[], yoy: (number|null)[]}} annual khi-annual.json
 * @returns {{year: number, official: number, mean: number}|null}
 */
export function officialVsMonthlyMean(stats, monthly, annual) {
  if (!monthly?.months || !monthly?.yoy || !annual?.years || !annual?.yoy) return null;
  const means = stats.annualMeanOfMonthly(monthly.months, monthly.yoy);
  for (let i = annual.years.length - 1; i >= 0; i--) {
    const year = Number(annual.years[i]);
    const official = annual.yoy[i];
    const j = means.years.indexOf(year);
    if (j < 0 || !means.complete[j] || !stats.isNum(official)) continue;
    const mean = stats.round(means.values[j], 1);
    if (mean !== stats.round(official, 1)) return { year, official, mean };
  }
  return null;
}

/**
 * KHI base years with their first month and the value in the latest month,
 * newest base first.
 * @param {{months: string[], index: Record<string, (number|null)[]>}} khi
 * @returns {{base: string, first: string|null, value: number|null}[]}
 */
export function kkiBaseRows(khi) {
  if (!khi?.months || !khi?.index) return [];
  const last = khi.months.length - 1;
  return Object.keys(khi.index)
    .map((base) => {
      const arr = khi.index[base] ?? [];
      const i = arr.findIndex((v) => v != null);
      return { base, first: i >= 0 ? khi.months[i] : null, value: arr[last] ?? null };
    })
    .sort((a, b) => Number.parseInt(b.base, 10) - Number.parseInt(a.base, 10));
}

const TOC = [
  { id: 'khi-ja-ykhi', label: 'KHI ja YKHI' },
  { id: 'vuosiluvut', label: 'Vuosimuutos ja vuoden luku' },
  { id: 'kuukausimuutos', label: 'Kuukausimuutos ja %-yks.' },
  { id: 'keskimaarainen-muutos', label: 'Keskimääräinen vuosimuutos' },
  { id: 'perusvuodet', label: 'Pisteluvut ja perusvuodet' },
  { id: 'ennakkotiedot', label: 'Ennakkotiedot ja korjaukset' },
  { id: 'paivitykset', label: 'Päivitykset' },
  { id: 'lahteet', label: 'Tietolähteet' },
  { id: 'merkinnat', label: 'Merkinnät' },
];

/**
 * @param {any} ctx build context
 */
export default async function menetelmat(ctx) {
  const { html, fmt, stats, c } = ctx;
  const path = '/menetelmat/';
  const L = ctx.latest ?? {};
  const k = L.khi;
  const y = L.ykhi;
  const d = ctx.data;
  const meta = d.meta?.sources ?? {};
  const khiSrc = html`Tilastokeskus, kuluttajahintaindeksi`;

  /* ------------------------------------------------ 1. KHI ja YKHI */
  const ka = d['khi-annual'];
  const ya = d['ykhi-annual'];
  const cmpRows = [];
  if (ka?.years && ya?.years && ya.geo?.FI) {
    for (let i = ka.years.length - 1; i >= 0 && cmpRows.length < 6; i--) {
      const yr = ka.years[i];
      const j = ya.years.indexOf(yr);
      const a = ka.yoy[i];
      const b = j >= 0 ? ya.geo.FI[j] : null;
      if (!stats.isNum(a) || !stats.isNum(b)) continue;
      cmpRows.push({ year: yr, khi: a, ykhi: b, diff: stats.round(a - b, 1) });
    }
  }
  const widest = cmpRows.length ? cmpRows.reduce((m, r) => (Math.abs(r.diff) > Math.abs(m.diff) ? r : m), cmpRows[0]) : null;
  const cmpTable = cmpRows.length
    ? c.dataTable({
        id: 'khi-ykhi-vuodet',
        caption: `KHI ja YKHI vuosina ${cmpRows.at(-1).year}–${cmpRows[0].year}`,
        columns: [{ label: 'Vuosi' }, { label: 'KHI', num: true }, { label: 'YKHI', num: true }, { label: 'Ero, %-yks.', num: true }],
        rows: cmpRows.map((r) => [r.year, fmt.pct(r.khi), fmt.pct(r.ykhi), c.numUnit(fmt.num(r.diff, 1, { sign: true }))]),
        note: 'Virallinen vuosimuutos. Lähteet: Tilastokeskus (KHI, taulukko 122q), Eurostat (YKHI, prc_hicp_ainr). Ero = KHI − YKHI.',
      })
    : '';
  const now = k && y && stats.isNum(k.yoy) && stats.isNum(y.yoy)
    ? html`<p>${fmt.capitalize(fmt.inessive(k.month))} KHI oli ${fmt.pct(k.yoy)} (Tilastokeskus) ja YKHI ${y.month === k.month ? '' : html`${fmt.inessive(y.month)} `}${fmt.pct(y.yoy)} (Eurostat${y.provisional ? ', ennakko' : ''}).</p>`
    : '';
  const khiYkhi = html`
<p><strong>Kuluttajahintaindeksi (KHI)</strong> on Tilastokeskuksen virallinen inflaatiomittari (englanniksi consumer price index, CPI). Se kuvaa kotitalouksien Suomessa ostamien tavaroiden ja palvelujen hintojen muutosta. Kun uutisissa kerrotaan Suomen inflaatiosta, tarkoitetaan yleensä KHI:n vuosimuutosta. KHI:stä johdetaan myös elinkustannusindeksi, johon monet vuokra- ja muut sopimukset on sidottu.</p>
<p><strong>Yhdenmukaistettu kuluttajahintaindeksi (YKHI)</strong> lasketaan kaikissa EU-maissa samoilla säännöillä (englanniksi harmonised index of consumer prices, HICP). Eurostat julkaisee sen, ja Euroopan keskuspankki seuraa sillä euroalueen 2 prosentin inflaatiotavoitetta. YKHI sopii siksi maiden väliseen vertailuun.</p>
<p><strong>Suurin ero:</strong> KHI sisältää omistusasumisen kuluja, kuten asuntolainojen korot, YKHI ei. Kun korot nousevat, KHI nousee YKHI:tä nopeammin, ja kun korot laskevat, KHI hidastuu YKHI:tä enemmän. Lisäksi painot ja eräät laskentatavat eroavat.${
    widest ? html` Viime vuosina ero oli suurin vuonna ${widest.year}: KHI ${fmt.pct(widest.khi)} ja YKHI ${fmt.pct(widest.ykhi)}.` : ''
  }</p>
${now}
${cmpTable}
<p><strong>Kumpaa käyttää?</strong> Suomen hintakehitykseen, palkka- ja sopimusasioihin KHI:tä (vuokrasopimuksissa yleensä elinkustannusindeksiä). EU-maiden ja euroalueen vertailuun YKHI:tä. Sivusto näyttää oletuksena KHI:n, ja YKHI:n voi valita rinnalle.</p>`;

  /* ------------------------------------------------ 2. Vuosiluvut */
  const cy = k?.currentYear;
  const diffYear = officialVsMonthlyMean(stats, d.khi, ka);
  const annual = html`
<p><strong>Vuosimuutos</strong> eli inflaatio kertoo, kuinka paljon kuluttajahinnat ovat muuttuneet vuoden takaisesta samasta kuukaudesta.${
    k && stats.isNum(k.yoy) ? html` Esimerkiksi ${fmt.inessive(k.month)} vuosimuutos oli ${fmt.pct(k.yoy)} (${khiSrc}).` : ''
  }</p>
<p><strong>Päättyneiden vuosien luvut</strong> ovat tilastojen tuottajien virallisia vuosimuutoksia: KHI:n osalta Tilastokeskuksen taulukko 122q, joka lasketaan vuoden keskimääräisistä pisteluvuista, ja YKHI:n osalta Eurostatin vuosikeskiarvo (prc_hicp_ainr). Virallinen luku voi poiketa kuukausien vuosimuutosten keskiarvosta.${
    diffYear ? html` Esimerkiksi vuonna ${diffYear.year} KHI:n virallinen vuosimuutos oli ${fmt.pct(diffYear.official)}, kun kuukausien vuosimuutosten keskiarvo oli ${fmt.pct(diffYear.mean)}.` : ''
  }</p>
<p><strong>Kuluvan vuoden luku</strong> on tähän mennessä julkaistujen kuukausien vuosimuutosten keskiarvo. Se merkitään aina kuukausivälillä ja tarkentuu, kunnes vuosi on päättynyt ja virallinen vuosimuutos julkaistu.${
    cy && stats.isNum(cy.value) && !cy.complete ? html` Esimerkiksi kuluvan vuoden luku ${cy.label} on ${fmt.pct(cy.value)} (${cy.months} kuukauden keskiarvo; ${khiSrc}).` : ''
  }</p>
<p>Kuluvaa vuotta ei päätellä kalenterista vaan uusimmasta julkaistusta kuukaudesta.</p>`;

  /* ------------------------------------------------ 3. Kuukausimuutos */
  let monthlyExample = '';
  if (k && stats.isNum(k.mom) && stats.isNum(k.yoy) && stats.isNum(k.prevYoy) && stats.isNum(k.delta) && k.prevMonth) {
    const from = fmt.elative(k.prevMonth, { year: k.prevMonth.slice(0, 4) !== k.month.slice(0, 4) });
    const to = fmt.illative(k.month, { year: false });
    const mom = stats.round(k.mom, 1);
    const priceVerb = mom > 0 ? `nousivat ${from} ${to} ${fmt.pct(mom)}` : mom < 0 ? `laskivat ${from} ${to} ${fmt.pct(-mom)}` : `pysyivät ${from} ${to} ennallaan`;
    const dir = stats.deltaClass(k.delta);
    const rateText =
      dir === 'up'
        ? `kiihtyi ${fmt.num(k.prevYoy, 1)} prosentista ${fmt.num(k.yoy, 1)} prosenttiin`
        : dir === 'down'
          ? `hidastui ${fmt.num(k.prevYoy, 1)} prosentista ${fmt.num(k.yoy, 1)} prosenttiin`
          : `pysyi ${fmt.num(k.yoy, 1)} prosentissa`;
    monthlyExample = html`<p class="legal__example">Esimerkki ${fmt.genitive(k.month)} luvuista (${khiSrc}): kuluttajahinnat ${priceVerb} (hinnat kuukaudessa ${fmt.pct(k.mom, { sign: true })}). Samaan aikaan inflaatio ${rateText} (muutos ${fmt.pp(k.delta)}).</p>`;
  }
  const momFrom = d.khi?.momOfficialFrom;
  const monthly = html`
<p><strong>Hinnat kuukaudessa</strong> on virallinen kuukausimuutos: kuinka paljon hinnat muuttuivat edellisestä kuukaudesta. Yksikkö on prosentti (%).</p>
<p><strong>Muutos edellisestä kuukaudesta</strong> tarkoittaa inflaatiovauhdin muutosta eli kahden peräkkäisen vuosimuutoksen erotusta. Sen yksikkö on prosenttiyksikkö (%-yks.). Punainen ▲ tarkoittaa, että inflaatio kiihtyi, ja sininen ▼, että se hidastui.</p>
<p>Luvut voivat olla eri suuntaan: hinnat voivat laskea kuukaudessa, vaikka inflaatio kiihtyy, jos hinnat laskivat vuotta aiemmin samana kuukautena vielä enemmän.</p>
${monthlyExample}
${momFrom ? html`<p>KHI:n kuukausimuutos on Tilastokeskuksen virallinen luku ${fmt.elative(momFrom)} alkaen. Sitä vanhemmat kuukausimuutokset on laskettu Tilastokeskuksen virallisesta pisteluvusta (1972=100).</p>` : ''}`;

  /* ------------------------------------------------ 4. CAGR */
  let cagrExample = '';
  const idx25 = d.khi?.index?.['2025=100'];
  if (k && idx25) {
    const end = d.khi.months.indexOf(k.month);
    const start = end - 120;
    const i0 = start >= 0 ? idx25[start] : null;
    const i1 = end >= 0 ? idx25[end] : null;
    if (stats.isNum(i0) && stats.isNum(i1)) {
      const total = stats.totalChange(i0, i1);
      const avg = stats.cagr(i0, i1, 120);
      const verb = total >= 0 ? 'nousivat' : 'laskivat';
      cagrExample = html`<p class="legal__example">Esimerkki: kuluttajahintaindeksin pisteluku (2025=100) oli ${fmt.idx(i0)} ${fmt.inessive(d.khi.months[start])} ja ${fmt.idx(i1)} ${fmt.inessive(k.month)}. Hinnat ${verb} kymmenessä vuodessa yhteensä ${fmt.pct(Math.abs(total))} eli keskimäärin ${fmt.pct(avg)} vuodessa (${khiSrc}).</p>`;
    }
  }
  const cagr = html`
<p>Pitkän aikavälin hintakehitys kerrotaan <strong>keskimääräisenä vuosimuutoksena</strong>. Se lasketaan pisteluvuista geometrisena keskiarvona, jolloin vuosien muutokset korkoa korolle -periaatteella tuottavat saman kokonaismuutoksen:</p>
<p class="legal__formula"><span>keskimääräinen vuosimuutos = ((loppuarvo ÷ alkuarvo)<span class="sr-only"> potenssiin (12 jaettuna n:llä)</span><sup aria-hidden="true">12${fmt.NBSP}÷${fmt.NBSP}n</sup> − 1) × 100${fmt.NBSP}%</span></p>
<p>Kaavassa n on kuukausien määrä alku- ja loppukuukauden välillä: esimerkiksi tammikuusta 2016 tammikuuhun 2026 on 120 kuukautta.</p>
${cagrExample}
<p>Kaavioiden jaksot lasketaan kuukausipisteinä: jakso ”1 v” sisältää 13 kuukautta (saman kuukauden vuotta aiemmin ja uusimman kuukauden), ”5 v” 61 kuukautta. Alle 12 kuukauden jaksoista näytetään kokonaismuutos, ei vuositasolle muunnettua lukua.</p>`;

  /* ------------------------------------------------ 5. Perusvuodet */
  const bases = kkiBaseRows(d.khi);
  const baseTable = bases.length && k
    ? c.dataTable({
        id: 'perusvuodet-taulukko',
        caption: `Kuluttajahintaindeksin perusvuodet ja pisteluvut ${fmt.inessive(k.month)}`,
        columns: [{ label: 'Perusvuosi' }, { label: 'Sarja alkaa' }, { label: `Pisteluku ${fmt.monthShort(k.month)}`, num: true }],
        rows: bases.map((b) => [b.base, b.first ? fmt.monthShort(b.first) : fmt.DASH, fmt.idx(b.value)]),
        visibleRows: 6,
        toggleLabels: { more: `Näytä kaikki perusvuodet (${bases.length})`, less: 'Näytä vain uusimmat perusvuodet' },
        note: 'Lähde: Tilastokeskus, kuluttajahintaindeksi (taulukot 11xs ja 15b5).',
      })
    : '';
  const eki = L.elinkustannusindeksi;
  const ekiData = d.elinkustannusindeksi;
  const ykhiBases = Object.keys(d.ykhi?.geo?.FI?.index ?? {});
  const baseYears = html`
<p><strong>Pisteluku</strong> kertoo hintatason suhteessa perusvuoteen, jonka keskimääräinen hintataso on 100. Pisteluku 125 tarkoittaa, että hinnat ovat ${fmt.pct(25, { decimals: 0 })} korkeammat kuin perusvuonna.</p>
<p>Tilastokeskus otti tammikuun 2026 luvuista alkaen käyttöön perusvuoden 2025=100 ja uuden COICOP 2018 -hyödykeluokituksen. Eurostat siirsi YKHI:n samaan aikaan perusvuoteen 2025=100 ja ECOICOP 2 -luokitukseen. Sivusto näyttää oletuksena perusvuoden 2025=100 pisteluvut. Vanhemmat perusvuodet julkaistaan edelleen, koska monet sopimukset viittaavat niihin.</p>
${baseTable}
<p>Perusvuodet kuvaavat samaa hintakehitystä, mutta pisteluvut ovat eri suuruisia. Käytä aina samaa perusvuotta kuin sopimuksessasi. Emme laske uudempaa perusvuotta taaksepäin itse: vanhoille kuukausille käytetään perusvuotta, jolla Tilastokeskus on luvun julkaissut. Perusvuoden 2025=100 sarja alkaa vuodesta 1995, koska Tilastokeskus julkaisee sen ketjutettuna taaksepäin.</p>
${eki && stats.isNum(eki.value) ? html`<p><strong>Elinkustannusindeksi</strong> (${eki.base}) on vuokrasopimuksissa yleisimmin käytetty hintaindeksi, ja sitä julkaistaan edelleen kuukausittain. Se oli ${fmt.num(eki.value)} ${fmt.inessive(eki.month)} (Tilastokeskus). Vielä vanhemmat sarjat ovat ${ekiData?.monthly1939 ? html`${ekiData.monthly1939.base} (kuukausittain ${fmt.elative(ekiData.monthly1939.months[0])} alkaen)` : ''}${ekiData?.monthly1939 && ekiData?.annual1914 ? ' ja ' : ''}${ekiData?.annual1914 ? html`${ekiData.annual1914.base} (vuosittain vuodesta ${ekiData.annual1914.years[0]})` : ''}.</p>` : ''}
${ykhiBases.length ? html`<p>YKHI:n pisteluvut ovat saatavilla perusvuosilla ${ykhiBases.join(' ja ')} (Eurostat).</p>` : ''}`;

  /* ------------------------------------------------ 6. Ennakkotiedot */
  const loki = Array.isArray(d.muutosloki) ? d.muutosloki : [];
  const revision = loki.find((e) => e.source === 'ykhi' && e.kind === 'lopullinen' && /\(ennakko /.test(e.text ?? ''));
  const prelim = d.ansiot?.preliminary ?? [];
  const provisional = html`
<p><strong>YKHI-ennakko.</strong> Eurostat julkaisee euroalueen ja jäsenmaiden inflaation ennakkoarvion (pikaennakon) kuukauden vaihteessa ja lopulliset luvut noin kaksi viikkoa myöhemmin. Ennakkoarvio voi muuttua, joten se merkitään sivustolla sanalla ${c.chip({ text: 'ennakko', tone: 'provisional' })}.${
    y ? (y.provisional ? html` Tällä hetkellä YKHI:n ${fmt.genitive(y.month)} luku on ennakkotieto.` : html` Tällä hetkellä Suomen YKHI-luvut ovat lopullisia (uusin ${fmt.monthName(y.month)}).`) : ''
  }</p>
${revision ? html`<p>Esimerkki muutoslokista (<time datetime="${revision.date}">${fmt.date(revision.date)}</time>): ”${revision.text}”</p>` : ''}
<p><strong>KHI.</strong> Tilastokeskus ei tarkista kuluttajahintaindeksin julkaistuja lukuja jälkikäteen. Sivusto näyttää luvut sellaisina kuin ne on julkaistu.</p>
${prelim.length ? html`<p><strong>Ansiotasoindeksi.</strong> Tilastokeskus merkitsee uusimmat neljännekset ennakkotiedoiksi, ja ne tarkentuvat myöhemmin (tällä hetkellä ${formatPeriod(fmt, prelim[0])}${prelim.length > 1 ? ` – ${formatPeriod(fmt, prelim.at(-1))}` : ''}).</p>` : ''}`;

  /* ------------------------------------------------ 7. Päivitykset */
  const upcoming = upcomingReleases(ctx.content.julkaisukalenteri, L).slice(0, 9);
  const calTable = upcoming.length
    ? c.dataTable({
        id: 'julkaisukalenteri',
        caption: 'Tulevat julkaisut',
        columns: [{ label: 'Julkaisu' }, { label: 'Päivä' }, { label: 'Julkaisija' }],
        rows: upcoming.map((e) => [
          e.label,
          html`<time datetime="${e.date}">${fmt.date(e.date)}</time>${releaseTime(e.time) ? ` klo ${releaseTime(e.time)}` : ''}`,
          e.url ? html`<a href="${e.url}">${e.publisher}</a>` : e.publisher,
        ]),
        note: 'Julkaisupäivät Tilastokeskuksen ja Eurostatin virallisista julkaisukalentereista. Kellonajat Suomen aikaa.',
      })
    : '';
  const updates = html`
<p>Sivusto hakee luvut automaattisesti tilastojen tuottajien avoimista rajapinnoista kahdesti päivässä: aamulla Tilastokeskuksen klo 8.00 julkaisujen jälkeen ja iltapäivällä Eurostatin ja EKP:n julkaisujen jälkeen. Uusi kuukausi näkyy siksi yleensä jo julkaisupäivänä. Jokainen haku tarkistetaan automaattisesti ennen julkaisua: aikasarjojen on oltava yhtenäisiä, arvojen järkevissä rajoissa ja vuosimuutosten täsmättävä pistelukuihin. Jos lähde ei läpäise tarkistuksia, sivusto näyttää edelliset tarkistetut luvut.</p>
<p>Tilastokeskus julkaisee kuluttajahintaindeksin kerran kuukaudessa, yleensä seuraavan kuukauden puolivälissä. Eurostat julkaisee YKHI-ennakon kuukauden vaihteessa ja lopulliset luvut noin kaksi viikkoa myöhemmin.${
    L.dataUpdated ? html` Viimeksi tiedot päivittyivät <time datetime="${L.dataUpdated}">${fmt.date(L.dataUpdated)}</time>.` : ''
  }</p>
${calTable}
<p>Uusimmat julkaisut näkyvät <a href="/tietoa/#muutosloki">muutoslokissa</a> ja <a href="/feed.xml">RSS-syötteessä</a>.</p>`;

  /* ------------------------------------------------ 8. Lähteet */
  const srcRows = Object.values(meta)
    .filter((s) => s?.name)
    .map((s) => [
      s.url ? html`<a href="${s.url}">${s.name}</a>` : s.name,
      s.publisher ?? fmt.DASH,
      s.table ?? s.dataset ?? fmt.DASH,
      formatPeriod(fmt, s.latest),
      s.updated ? html`<time datetime="${String(s.updated).slice(0, 10)}">${fmt.date(s.updated)}</time>` : fmt.DASH,
    ]);
  const sources = html`
<p>Sivuston luvut perustuvat tilastojen tuottajien julkaisemiin virallisiin lukuihin; itse lasketut luvut on merkitty (ks. yllä). Tilastoluvut haetaan Tilastokeskuksen PxWeb-rajapinnasta, Eurostatin tilastorajapinnasta ja Euroopan keskuspankin (EKP) tietorajapinnasta.</p>
${srcRows.length ? c.dataTable({
    id: 'lahteet-taulukko',
    caption: 'Sivuston tietolähteet',
    columns: [{ label: 'Tieto' }, { label: 'Julkaisija' }, { label: 'Taulukko tai aineisto' }, { label: 'Uusin jakso' }, { label: 'Päivitetty' }],
    rows: srcRows,
    compact: true,
  }) : ''}
<p>Tilastojen lisenssit: Tilastokeskus CC BY 4.0, Eurostat ja EKP vapaa uudelleenkäyttö lähde mainiten (ks. <a href="/kayttoehdot/#lisenssit">Käyttöehdot</a>). Samat aineistot voit ladata koneluettavina tiedostoina <a href="/data/">Avoin data</a> -sivulta.</p>`;

  /* ------------------------------------------------ 9. Merkinnät */
  const notation = html`
<ul>
  <li>Vuosi- ja kuukausimuutokset näytetään yhden desimaalin ja pisteluvut kahden desimaalin tarkkuudella, kuten tilaston tuottaja ne julkaisee. Laskureissa ja vaikutuksissa käytetään kahta desimaalia; elinkustannusindeksi julkaistaan kokonaislukuina.</li>
  <li>Desimaalierotin on pilkku, ja miinusmerkkinä käytetään merkkiä − (esimerkiksi ${fmt.pct(-0.2)}).</li>
  <li>%-yks. eli prosenttiyksikkö on kahden prosenttiluvun erotus. Kun inflaatio nousee 2,1 prosentista 2,2 prosenttiin, muutos on ${fmt.pp(0.1)}</li>
  <li>Inflaatiovauhdin muutoksen suunta näytetään nuolella ja värillä: ${c.deltaChip({ value: 0.1 })}, ${c.deltaChip({ value: -0.1 })} ja ${c.deltaChip({ value: 0 })}. Punainen ▲ tarkoittaa, että inflaatio kiihtyi, sininen ▼, että se hidastui, ja harmaa, että se pysyi ennallaan. Inflaation tasoa ei värjätä.</li>
  <li>${fmt.DASH} tarkoittaa, että lukua ei ole (esimerkiksi sarja ei ole vielä alkanut).</li>
  <li>${c.chip({ text: 'ennakko', tone: 'provisional' })} tarkoittaa ennakkotietoa, joka voi muuttua.</li>
</ul>`;

  const section = (id, title, body) => legalSection(ctx, id, title, body);
  const main = html`${c.pageHeader({
    eyebrow: 'Menetelmät',
    title: 'Menetelmät ja määritelmät',
    lede: 'Miten sivuston luvut syntyvät: mitä mittarit sisältävät, miten vuosi- ja kuukausiluvut lasketaan ja mistä tiedot haetaan.',
    meta: L.dataUpdated ? html`Tiedot päivitetty <time datetime="${L.dataUpdated}">${fmt.date(L.dataUpdated)}</time> · Lähteet: Tilastokeskus, Eurostat, EKP` : 'Lähteet: Tilastokeskus, Eurostat, EKP',
  })}
<div class="container legal">
  <aside class="legal__aside">${c.toc(TOC, { title: 'Sisällys' })}</aside>
  <div class="legal__body">
    ${section('khi-ja-ykhi', 'KHI ja YKHI', khiYkhi)}
    ${section('vuosiluvut', 'Vuosimuutos, vuoden luku ja kuluvan vuoden keskiarvo', annual)}
    ${section('kuukausimuutos', 'Kuukausimuutos ja muutos prosenttiyksikköinä', monthly)}
    ${section('keskimaarainen-muutos', 'Keskimääräinen vuosimuutos', cagr)}
    ${section('perusvuodet', 'Pisteluvut ja perusvuodet', baseYears)}
    ${section('ennakkotiedot', 'Ennakkotiedot ja korjaukset', provisional)}
    ${section('paivitykset', 'Päivitykset ja julkaisukalenteri', updates)}
    ${section('lahteet', 'Tietolähteet', sources)}
    ${section('merkinnat', 'Pyöristys ja merkinnät', notation)}
  </div>
</div>`;

  const url = `${ctx.baseUrl}${path}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Menetelmät ja määritelmät',
      url,
      inLanguage: 'fi',
      ...(L.dataUpdated ? { dateModified: L.dataUpdated } : {}),
      about: ['Kuluttajahintaindeksi', 'Yhdenmukaistettu kuluttajahintaindeksi', 'Inflaatio'],
      isBasedOn: Object.values(meta).map((s) => s?.url).filter(Boolean),
      publisher: organizationLd(ctx),
      isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
    },
  ];

  return [
    {
      path,
      html: ctx.layout({
        title: 'Menetelmät: näin luvut lasketaan',
        description: 'KHI ja YKHI, virallinen vuosimuutos ja kuluvan vuoden keskiarvo, kuukausimuutos ja %-yks., keskimääräinen vuosimuutos, perusvuodet ja tietolähteet.',
        path,
        page: 'menetelmat',
        breadcrumbs: ctx.crumbs(path, 'Menetelmät'),
        jsonLd,
        main,
      }),
    },
  ];
}
