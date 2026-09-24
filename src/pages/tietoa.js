/**
 * /tietoa/ – about the service: what it is and why, who maintains it
 * (Opak Oy), where the numbers come from, how often they update, how they are
 * checked, how to report an error (contact dialog), the latest changelog
 * entries (data/muutosloki.json) and links to /menetelmat/ and /data/.
 * All numbers are read from ctx.latest / ctx.data at build time.
 */
import { operatorAddress } from '../templates/layout.js';
import { legalSection, organizationLd } from './kayttoehdot.js';
import { releaseTime } from './menetelmat.js';

/** How many changelog entries to list. */
const CHANGELOG_ROWS = 8;

const TOC = [
  { id: 'palvelu', label: 'Mikä Inflaatio.fi on?' },
  { id: 'yllapito', label: 'Kuka ylläpitää?' },
  { id: 'lahteet', label: 'Mistä luvut tulevat?' },
  { id: 'paivitykset', label: 'Päivitykset' },
  { id: 'tarkistukset', label: 'Miten luvut tarkistetaan?' },
  { id: 'virheet', label: 'Ilmoita virheestä' },
  { id: 'muutosloki', label: 'Muutosloki' },
  { id: 'lisaa', label: 'Lue lisää' },
];

/** Display order of the publishers (others follow). */
const PUBLISHER_ORDER = ['Tilastokeskus', 'Eurostat'];

/**
 * @param {any} ctx build context
 */
export default async function tietoa(ctx) {
  const { html, fmt, stats, c } = ctx;
  const path = '/tietoa/';
  const brand = ctx.site.brand;
  const op = ctx.site.operator;
  const L = ctx.latest ?? {};
  const k = L.khi;
  const y = L.ykhi;
  const meta = ctx.data.meta?.sources ?? {};
  const section = (id, title, body) => legalSection(ctx, id, title, body);
  const contactButton = (label) => c.button({ label, variant: 'secondary', icon: 'mail', attrs: { data: { openContact: '' } } });

  /* -------------------------------------------------- 1. Palvelu */
  const level = (v) => (v > 0 ? 'korkeammat' : v < 0 ? 'matalammat' : 'samalla tasolla');
  const headline =
    k && stats.isNum(k.yoy)
      ? html`<p>Uusin luku koskee ${fmt.genitive(k.month)} hintoja: kuluttajahinnat olivat ${
          k.yoy === 0 ? 'samalla tasolla kuin' : html`${fmt.pct(Math.abs(k.yoy))} ${level(k.yoy)} kuin`
        } vuotta aiemmin (Tilastokeskus, kuluttajahintaindeksi).${
          y && stats.isNum(y.yoy)
            ? html` EU:n yhdenmukaistetulla kuluttajahintaindeksillä (YKHI) inflaatio oli ${fmt.pct(y.yoy)}${y.month === k.month ? '' : ` ${fmt.inessive(y.month)}`} (Eurostat${y.provisional ? ', ennakko' : ''}).`
            : ''
        } <a href="/">Katso uusimmat luvut</a>.</p>`
      : '';
  const khiMonths = ctx.data.khi?.months ?? [];
  const firstYoy = ctx.data.khi?.yoy ? khiMonths[stats.firstIndex(ctx.data.khi.yoy)] : null;
  const next = L.nextRelease?.khi;
  const facts = c.statsList([
    ...(k ? [{ label: 'Uusin kuukausi', value: fmt.capitalize(fmt.monthName(k.month)), note: 'KHI, Tilastokeskus' }] : []),
    ...(firstYoy ? [{ label: 'Kuukausiluvut alkaen', value: fmt.monthShort(firstYoy), note: 'inflaatio (vuosimuutos)' }] : []),
    ...(L.dataUpdated ? [{ label: 'Tiedot päivitetty', value: html`<time datetime="${L.dataUpdated}">${fmt.date(L.dataUpdated)}</time>`, note: 'uusin lähteen julkaisu' }] : []),
    ...(next
      ? [{ label: 'Seuraava julkaisu', value: html`<time datetime="${next.date}">${fmt.date(next.date)}</time>`, note: `KHI, ${fmt.monthName(next.period)}` }]
      : []),
  ]);
  const service = html`
<p>${brand} kokoaa Suomen viralliset inflaatioluvut yhteen paikkaan selkeinä kuvaajina ja taulukkoina. Sivustolta näet uusimman inflaatioluvun ja sen kehityksen, inflaation vuosittain ja kuukausittain, mitkä hyödykkeet ovat kallistuneet, Suomen vertailun muihin EU-maihin sekä laskurit esimerkiksi vuokrankorotukselle ja rahan arvolle.</p>
${headline}
${facts}
<p><strong>Miksi?</strong> Inflaatioluku kiinnostaa monia: vuokranantajia ja vuokralaisia, palkansaajia, säästäjiä, opiskelijoita ja toimittajia. Viralliset luvut ovat avoimia, mutta ne ovat hajallaan eri tilastotaulukoissa. ${brand} näyttää uusimman luvun heti, kertoo, mitä kuukautta se koskee ja mistä se on peräisin, ja auttaa soveltamaan lukuja omiin laskelmiin.</p>
<p>Palvelu on maksuton. Luvut saa lainata ja jakaa lähde mainiten (<a href="/kayttoehdot/#lainaaminen">käyttöehdot</a>).</p>`;

  /* -------------------------------------------------- 2. Ylläpito */
  const maintainer = html`
<p>Palvelua ylläpitää ${op.name} (Y-tunnus ${op.businessId}), ${operatorAddress(ctx)}.</p>
<p>${brand} on itsenäinen palvelu. Se ei ole Tilastokeskuksen, Eurostatin tai Euroopan keskuspankin palvelu eikä edusta niitä. Luvut ovat näiden tilastojen tuottajien julkaisemia, ja sivusto kertoo jokaisen luvun lähteen.</p>`;

  /* -------------------------------------------------- 3. Lähteet */
  const byPublisher = new Map();
  for (const s of Object.values(meta)) {
    if (!s?.publisher || !s?.name) continue;
    if (!byPublisher.has(s.publisher)) byPublisher.set(s.publisher, []);
    byPublisher.get(s.publisher).push(s);
  }
  const publishers = [...byPublisher.keys()].sort((a, b) => {
    const ia = PUBLISHER_ORDER.indexOf(a);
    const ib = PUBLISHER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const sourceList = publishers.length
    ? html`<ul>${publishers.map(
        (p) => html`<li><strong>${p}</strong><ul>${byPublisher
          .get(p)
          .map((s) => html`<li>${s.url ? html`<a href="${s.url}">${s.name}</a>` : s.name}</li>`)}</ul></li>`,
      )}</ul>`
    : '';
  const sources = html`
<p>Kaikki luvut haetaan suoraan tilastojen tuottajien avoimista rajapinnoista:</p>
${sourceList}
<p>Taulukoiden tunnukset, uusimmat jaksot ja lisenssit on koottu <a href="/menetelmat/#lahteet">Menetelmät-sivulle</a>. Aineistot voit ladata myös itse <a href="/data/">Avoin data</a> -sivulta.</p>`;

  /* -------------------------------------------------- 4. Päivitykset */
  const nextLines = [
    ['khi', 'Kuluttajahintaindeksi'],
    ['ykhi-ennakko', 'YKHI-ennakko'],
    ['ykhi', 'YKHI, lopulliset luvut'],
  ]
    .map(([key, name]) => [name, L.nextRelease?.[key]])
    .filter(([, e]) => e?.date);
  const updates = html`
<p>Sivusto tarkistaa lähteet automaattisesti joka päivä, joten uusi kuukausi näkyy yleensä jo julkaisupäivänä. Tilastokeskus julkaisee kuluttajahintaindeksin kerran kuukaudessa, yleensä kuun puolivälissä. Eurostat julkaisee YKHI-ennakon kuun vaihteessa ja lopulliset luvut noin kuukauden puolivälissä.</p>
${nextLines.length
    ? html`<ul>${nextLines.map(
        ([name, e]) => html`<li>${name}, ${fmt.monthName(e.period)}: <time datetime="${e.date}">${fmt.date(e.date)}</time>${releaseTime(e.time) ? ` klo ${releaseTime(e.time)}` : ''} (${e.publisher})</li>`,
      )}</ul>`
    : ''}
<p>Koko julkaisukalenteri on <a href="/menetelmat/#paivitykset">Menetelmät-sivulla</a>.</p>`;

  /* -------------------------------------------------- 5. Tarkistukset */
  const checks = html`
<ul>
  <li>Luvut haetaan suoraan tilastojen tuottajilta, ei välikäsien kautta eikä käsin kopioiden.</li>
  <li>Jokainen haku tarkistetaan automaattisesti ennen julkaisua: aikasarjojen on oltava yhtenäisiä, arvojen järkevissä rajoissa ja vuosimuutosten täsmättävä pistelukuihin. Lisäksi tarkistetaan, ettei uusin kuukausi ole vanhentunut.</li>
  <li>Jos lähde ei läpäise tarkistuksia, sivusto näyttää edelliset tarkistetut luvut, ja ylläpito saa tiedon epäonnistuneesta päivityksestä.</li>
  <li>Luvut näytetään sellaisina kuin tuottaja ne julkaisee. Itse laskemme vain selvästi merkityt johdetut luvut, kuten kuluvan vuoden keskiarvon ja keskimääräisen vuosimuutoksen (<a href="/menetelmat/">Menetelmät</a>).</li>
  <li>Ennakkotiedot merkitään sanalla ennakko, ja ne korvataan lopullisilla luvuilla, kun ne julkaistaan.</li>
</ul>`;

  /* -------------------------------------------------- 6. Virheet */
  const errors = html`
<p>Jos luku näyttää väärältä tai poikkeaa virallisesta julkaisusta, kerro siitä meille. Mainitse sivun osoite, luku ja kuukausi, niin korjaamme virheen mahdollisimman pian. Samalla lomakkeella voit lähettää palautetta ja kehitysideoita.</p>
<p class="js-only">${contactButton('Ilmoita virheestä')}</p>
<p class="no-js-only">Yhteydenottolomake toimii, kun JavaScript on käytössä. Voit myös lähettää viestin postitse: ${op.name}, ${operatorAddress(ctx)}.</p>`;

  /* -------------------------------------------------- 7. Muutosloki */
  const loki = (Array.isArray(ctx.data.muutosloki) ? ctx.data.muutosloki : []).slice(0, CHANGELOG_ROWS);
  const changelog = html`
<p>Sivusto kirjaa muutoslokiin jokaisen uuden tilastojulkaisun, jonka se on päivittänyt.</p>
${loki.length
    ? html`<ul class="changelog">${loki.map(
        (e) => html`<li><time datetime="${e.date}">${fmt.date(e.date)}</time> <span>${e.text}</span></li>`,
      )}</ul>`
    : html`<p>Muutoslokissa ei ole vielä merkintöjä.</p>`}
<p>Saat uudet luvut myös syötteenä: <a href="/feed.xml">RSS-syöte</a>.</p>`;

  /* -------------------------------------------------- 8. Lisää */
  const more = c.cardGrid(
    [
      { href: '/menetelmat/', eyebrow: 'Menetelmät', title: 'Näin luvut lasketaan', text: 'KHI ja YKHI, vuosiluvut, kuukausimuutos, perusvuodet ja tietolähteet.' },
      { href: '/data/', eyebrow: 'Avoin data', title: 'Lataa aineistot', text: 'Sivuston luvut CSV- ja JSON-tiedostoina.' },
      { href: '/kayttoehdot/', eyebrow: 'Käyttöehdot', title: 'Käyttöehdot ja tietosuoja', text: 'Lukujen lainaaminen, tietosuojaseloste ja evästeet.' },
      { href: '/upotus/ohje/', eyebrow: 'Upotus', title: 'Upota sivullesi', text: 'Uusin inflaatioluku omalle verkkosivullesi.' },
    ],
    { headingLevel: 3 },
  );

  const main = html`${c.pageHeader({
    eyebrow: 'Tietoa palvelusta',
    title: `Tietoa ${brand}-palvelusta`,
    lede: `${brand} kokoaa Suomen viralliset inflaatioluvut yhteen paikkaan. Luvut tulevat Tilastokeskukselta, Eurostatilta ja Euroopan keskuspankilta, ja ne päivittyvät kuukausittain.`,
    meta: L.dataUpdated ? html`Tiedot päivitetty <time datetime="${L.dataUpdated}">${fmt.date(L.dataUpdated)}</time> · Ylläpito: ${op.name}` : html`Ylläpito: ${op.name}`,
  })}
<div class="container legal">
  <aside class="legal__aside">${c.toc(TOC, { title: 'Sisällys' })}</aside>
  <div class="legal__body">
    ${section('palvelu', `Mikä ${brand} on?`, service)}
    ${section('yllapito', 'Kuka palvelua ylläpitää?', maintainer)}
    ${section('lahteet', 'Mistä luvut tulevat?', sources)}
    ${section('paivitykset', 'Kuinka usein luvut päivittyvät?', updates)}
    ${section('tarkistukset', 'Miten luvut tarkistetaan?', checks)}
    ${section('virheet', 'Löysitkö virheen?', errors)}
    ${section('muutosloki', 'Muutosloki', changelog)}
    ${section('lisaa', 'Lue lisää', more)}
  </div>
</div>`;

  const url = `${ctx.baseUrl}${path}`;
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'AboutPage',
      name: 'Tietoa palvelusta',
      url,
      inLanguage: 'fi',
      ...(L.dataUpdated ? { dateModified: L.dataUpdated } : {}),
      isPartOf: { '@type': 'WebSite', name: brand, url: `${ctx.baseUrl}/` },
      publisher: organizationLd(ctx),
      about: { '@type': 'WebSite', name: brand, url: `${ctx.baseUrl}/` },
    },
  ];

  return [
    {
      path,
      html: ctx.layout({
        title: 'Tietoa palvelusta',
        description: `Mikä ${brand} on, kuka sitä ylläpitää, mistä luvut tulevat, kuinka usein ne päivittyvät ja miten ne tarkistetaan. Ilmoita virheestä.`,
        path,
        page: 'tietoa',
        breadcrumbs: ctx.crumbs(path, 'Tietoa palvelusta'),
        jsonLd,
        main,
      }),
    },
  ];
}
