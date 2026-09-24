/**
 * /kayttoehdot/ – terms of use, privacy policy, cookies and disclaimer as ONE
 * document (no JS tabs) with a sticky table of contents on desktop and the
 * anchors #kayttoehdot #tietosuoja #evasteet #vastuuvapaus (plus sub-anchors
 * such as #kavijatilasto and #yhteydenotot used by the dialogs).
 *
 * Everything that describes what the code does is read from the code:
 * cookie name and lifetime (site.config CONSENT), GA cookie lifetime and data
 * retention (analytics.js), the page-view fields (analytics.js
 * PAGE_VIEW_FIELDS – the build fails if a field has no description here),
 * operator details (site.config OPERATOR + layout.js operatorAddress).
 *
 * TERMS_UPDATED is the date this TEXT was last changed (not the build date);
 * update it and CHANGES whenever the text changes. If the change concerns a
 * consent-based purpose, bump CONSENT_VERSION in src/site.config.js too.
 */
import { operatorAddress, operatorPostal } from '../templates/layout.js';
import { GA_COOKIE_MAX_AGE_DAYS, PAGE_VIEW_FIELDS, RETENTION_MONTHS } from '../js/lib/analytics.js';

/** Date the terms/privacy text was last changed (YYYY-MM-DD). */
export const TERMS_UPDATED = '2026-09-24';

/** Retention of contact form messages after the matter is closed (owner practice). */
export const CONTACT_RETENTION_MONTHS = 12;

/** Change history of this document, newest first. */
const CHANGES = [
  {
    date: '2026-09-24',
    text: 'Käyttöehdot ja tietosuojaseloste uudistettiin ja koottiin yhdelle sivulle. Seloste kuvaa nyt evästeettömän kävijätilaston, Google Analyticsin (vain suostumuksella), yhteydenottolomakkeen ja sivuston tekniset palveluntarjoajat säilytysaikoineen, ja evästeluettelo lisättiin. Lukujen lainaaminen lähdeviitteen kanssa on sallittu.',
  },
];

/** Plain-language description of each page-view column (analytics.js). */
const FIELD_TEXT = {
  event_type: 'tapahtuman tyyppi (aina sivulataus)',
  page: 'avatun sivun osoite ilman hakuparametreja, esimerkiksi /vuokrankorotus/ (tuntemattomat osoitteet tallentuvat muodossa /404.html)',
  referrer: 'mistä tulit: suoraan, sivuston sisältä tai toiselta sivustolta, jolloin tallentuu vain sen verkkotunnus (esimerkiksi google.com, ei koko osoitetta)',
  device: 'laitetyyppi: puhelin, tabletti tai tietokone',
};

const TOC = [
  { id: 'kayttoehdot', label: 'Käyttöehdot' },
  { id: 'tietosuoja', label: 'Tietosuojaseloste' },
  { id: 'evasteet', label: 'Evästeet' },
  { id: 'vastuuvapaus', label: 'Vastuuvapaus' },
];

const LINKS = {
  statfiTerms: 'https://stat.fi/fi/tietoa-meista/tutustu-tilastokeskukseen/lainsaadanto/kayttoehdot',
  ccBy: 'https://creativecommons.org/licenses/by/4.0/deed.fi',
  eurostat: 'https://ec.europa.eu/eurostat/web/main/help/copyright-notice',
  ecb: 'https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html',
  kuluttajariita: 'https://www.kuluttajariita.fi/',
  tietosuoja: 'https://tietosuoja.fi/',
};

/** Days → whole months ("12 kuukautta"). */
export const monthsOf = (days) => Math.round(days / 30.44);

/**
 * schema.org Organization of the operator (shared by the TRUST pages).
 * @param {any} ctx
 */
export function organizationLd(ctx) {
  const op = ctx.site.operator;
  const postal = operatorPostal(ctx);
  return {
    '@type': 'Organization',
    name: op.name,
    identifier: { '@type': 'PropertyValue', propertyID: 'Y-tunnus', value: op.businessId },
    address: { '@type': 'PostalAddress', streetAddress: postal.street, postalCode: postal.postalCode, addressLocality: postal.city, addressCountry: 'FI' },
  };
}

/**
 * One document section with its h2 (anchor = section id, heading id = `${id}-otsikko`).
 * @param {any} ctx
 * @param {string} id
 * @param {string} title
 * @param {any} body SafeString
 */
export function legalSection(ctx, id, title, body) {
  return ctx.html`<section class="legal__section" id="${id}" aria-labelledby="${id}-otsikko">
  <h2 id="${id}-otsikko">${title}</h2>
  ${body}
</section>`;
}

/**
 * @param {any} ctx build context
 */
export default async function kayttoehdot(ctx) {
  const { html, fmt, c } = ctx;
  const path = '/kayttoehdot/';
  const op = ctx.site.operator;
  const address = operatorAddress(ctx);
  const consentCookie = ctx.site.consent.cookieName;
  const consentMonths = monthsOf(ctx.site.consent.maxAgeDays);
  const gaMonths = monthsOf(GA_COOKIE_MAX_AGE_DAYS);
  const gaCookie = `_ga_${String(ctx.site.gaId).replace(/^G-/, '')}`;
  const missing = PAGE_VIEW_FIELDS.filter((f) => !FIELD_TEXT[f]);
  if (missing.length) throw new Error(`kayttoehdot: describe the page-view field(s) ${missing.join(', ')} in the privacy policy (FIELD_TEXT)`);

  const updated = html`<time datetime="${TERMS_UPDATED}">${fmt.date(TERMS_UPDATED)}</time>`;
  const contactButton = (label = 'Ota yhteyttä') =>
    c.button({ label, variant: 'secondary', size: 'sm', icon: 'mail', className: 'js-only', attrs: { data: { openContact: '' } } });
  const ext = (href, text) => html`<a href="${href}">${text}</a>`;

  const section = (id, title, body) => legalSection(ctx, id, title, body);
  const sub = (id, title) => html`<h3 id="${id}">${title}</h3>`;

  /* ------------------------------------------------------ 1. Käyttöehdot */
  const terms = html`
<p>Nämä ehdot koskevat ${ctx.site.brand}-verkkopalvelun käyttöä. Käyttämällä palvelua hyväksyt ehdot.</p>
${sub('palvelun-kuvaus', 'Palvelun kuvaus')}
<p>${ctx.site.brand} on maksuton verkkopalvelu, joka esittää Suomen virallisia inflaatiolukuja. Luvut perustuvat Tilastokeskuksen kuluttajahintaindeksiin (KHI) ja Eurostatin yhdenmukaistettuun kuluttajahintaindeksiin (YKHI). Lisäksi palvelussa on muita Tilastokeskuksen hinta- ja ansiotilastoja sekä Euroopan keskuspankin korkotietoja.</p>
<p>Luvut päivittyvät kuukausittain tilastojen julkaisun jälkeen. Ne eivät ole hetkittäisiä hintatietoja: jokainen luku koskee tiettyä kuukautta, ja kuukausi ja lähde kerrotaan luvun yhteydessä. Palvelua ylläpitää ${op.name}. Lisätietoa: <a href="/tietoa/">Tietoa palvelusta</a> ja <a href="/menetelmat/">Menetelmät</a>.</p>
${sub('lainaaminen', 'Lukujen lainaaminen ja jakaminen')}
<p>Saat lainata ja jakaa sivuston lukuja, taulukoita ja kuvaajia esimerkiksi uutisissa, opetuksessa, opinnäytteissä ja sosiaalisessa mediassa. Mainitse lähteenä ${ctx.site.brand} ja alkuperäinen tilastolähde, esimerkiksi näin:</p>
<p class="legal__example">Lähde: ${ctx.site.brand}, Tilastokeskus (kuluttajahintaindeksi)</p>
<p>Voit myös upottaa inflaatiokortin omalle sivullesi (<a href="/upotus/ohje/">Upota sivullesi</a>) tai ladata aineistot koneluettavina tiedostoina (<a href="/data/">Avoin data</a>). Avoimen datan tiedostoja saa käyttää vapaasti, kun lähteeksi mainitaan ${ctx.site.brand} ja alkuperäinen tilastolähde; tilastotietoihin sovelletaan alla lueteltuja tuottajien lisenssejä. Sivuston ulkoasun, tekstien ja ohjelmakoodin kopioiminen kokonaisuutena, esimerkiksi koko sivuston jäljentäminen, on kielletty ilman lupaa.</p>
${sub('lisenssit', 'Tilastojen lisenssit')}
<p>Tilastotiedot ovat niiden tuottajien avointa dataa, ja niihin sovelletaan tuottajan käyttöehtoja:</p>
<ul>
  <li><strong>Tilastokeskus:</strong> ${ext(LINKS.ccBy, 'Creative Commons Nimeä 4.0 (CC BY 4.0)')}. Lähteeksi mainitaan Tilastokeskus ja tilaston nimi. ${ext(LINKS.statfiTerms, 'Tilastokeskuksen käyttöehdot')}</li>
  <li><strong>Eurostat:</strong> vapaa uudelleenkäyttö Euroopan komission päätöksen 2011/833/EU mukaisesti, kun lähteeksi mainitaan Eurostat. ${ext(LINKS.eurostat, 'Eurostatin tekijänoikeusilmoitus')}</li>
  <li><strong>Euroopan keskuspankki (EKP):</strong> vapaa uudelleenkäyttö, kun lähteeksi mainitaan EKP. ${ext(LINKS.ecb, 'EKP:n tilastojen käyttöehdot')} (englanniksi)</li>
</ul>
<p>Osa sivuston luvuista on laskettu virallisista luvuista, esimerkiksi kuluvan vuoden keskiarvo ja keskimääräinen vuosimuutos. Ne on merkitty, ja laskentatavat kerrotaan <a href="/menetelmat/">Menetelmät</a>-sivulla. Tilastojen tuottajat eivät vastaa näistä laskelmista.</p>
${sub('sallittu-kaytto', 'Sallittu käyttö')}
<ul>
  <li>Palvelua saa käyttää vain lainmukaisiin tarkoituksiin.</li>
  <li>Palvelun turvatoimia ei saa yrittää ohittaa.</li>
  <li>Palvelua ei saa kuormittaa automaattisilla kyselyillä. Koneluettavat aineistot löytyvät <a href="/data/">Avoin data</a> -sivulta ja tilastojen tuottajien avoimista rajapinnoista.</li>
</ul>
${sub('immateriaalioikeudet', 'Immateriaalioikeudet')}
<p>Sivuston ulkoasu, tekstit ja ohjelmakoodi kuuluvat ${op.name}:lle. Tilastotietoihin sovelletaan edellä kerrottuja tuottajien lisenssejä.</p>
${sub('ei-takuuta', 'Ei takuuta')}
<p>Palvelu tarjotaan sellaisena kuin se on. Pyrimme siihen, että luvut vastaavat tilastojen virallisia julkaisuja ja että palvelu on aina käytettävissä, mutta emme takaa palvelun virheetöntä tai keskeytymätöntä toimintaa. Katso myös <a href="#vastuuvapaus">Vastuuvapaus</a>.</p>
${sub('ehtojen-muutokset', 'Ehtojen muutokset')}
<p>Voimme päivittää näitä ehtoja esimerkiksi palvelun muuttuessa. Päivitetyt ehdot julkaistaan tällä sivulla, ja päivityspäivä näkyy sivun alussa. Muutokset tulevat voimaan julkaisupäivänä.</p>
${sub('sovellettava-laki', 'Sovellettava laki')}
<p>Näihin ehtoihin sovelletaan Suomen lakia. Erimielisyydet pyritään ratkaisemaan ensisijaisesti neuvottelemalla. Kuluttajana voit viedä asian myös ${ext(LINKS.kuluttajariita, 'kuluttajariitalautakunnan')} käsiteltäväksi tai nostaa kanteen kotipaikkasi käräjäoikeudessa.</p>`;

  /* ------------------------------------------------ 2. Tietosuojaseloste */
  const summary = c.dataTable({
    id: 'tietosuoja-yhteenveto',
    caption: 'Henkilötietojen käsittely lyhyesti',
    columns: [{ label: 'Käsittely' }, { label: 'Tiedot' }, { label: 'Peruste' }, { label: 'Säilytys' }],
    rows: [
      [
        html`<a href="#kavijatilasto">Kävijätilasto ilman evästeitä</a>`,
        'Sivun osoite, mistä tulit (suoraan, sivuston sisältä tai toisen sivuston verkkotunnus), laitetyyppi ja aika',
        'Oikeutettu etu',
        `${RETENTION_MONTHS} kuukautta`,
      ],
      [
        html`<a href="#google-analytics">Google Analytics</a>`,
        'Sivujen ja toimintojen käyttö, laite- ja selaintiedot, karkea sijainti ja evästetunniste',
        'Suostumus',
        `${RETENTION_MONTHS} kuukautta`,
      ],
      [
        html`<a href="#yhteydenotot">Yhteydenottolomake</a>`,
        'Nimi (vapaaehtoinen), sähköpostiosoite ja viesti',
        'Oikeutettu etu',
        `Enintään ${CONTACT_RETENTION_MONTHS} kuukautta asian käsittelyn jälkeen`,
      ],
      [
        html`<a href="#palveluntarjoajat">Sivuston toimittaminen</a>`,
        'IP-osoite, selaimen tiedot, pyydetty osoite ja aika',
        'Oikeutettu etu',
        'Palveluntarjoajien lokikäytäntöjen mukaan',
      ],
      [
        html`<a href="#evasteet">Evästevalinta</a>`,
        'Valintasi ja sen päivämäärä (eväste omassa selaimessasi)',
        'Välttämätön eväste (ei vaadi suostumusta)',
        `${consentMonths} kuukautta`,
      ],
    ],
  });

  const privacy = html`
<p>Tässä selosteessa kerrotaan, mitä henkilötietoja ${ctx.site.brand} käsittelee, mihin tarkoitukseen ja millä perusteella sekä mitä oikeuksia sinulla on. Seloste perustuu EU:n yleiseen tietosuoja-asetukseen (GDPR).</p>
${sub('rekisterinpitaja', 'Rekisterinpitäjä ja yhteystiedot')}
<address class="legal__address">${op.name} (Y-tunnus ${op.businessId})<br>${address}</address>
<p>Tietosuojaa koskevat kysymykset ja pyynnöt voit lähettää yhteydenottolomakkeella tai kirjeitse yllä olevaan osoitteeseen.</p>
<p class="js-only">${contactButton('Avaa yhteydenottolomake')}</p>
${sub('yhteenveto', 'Yhteenveto')}
${summary}
${sub('kavijatilasto', 'Kävijätilasto ilman evästeitä')}
<p>Laskemme sivulataukset omalla, evästeettömällä kävijätilastollamme, jotta tiedämme, mitä sivuja luetaan ja mistä kävijät tulevat. Jokaisesta sivulatauksesta tallentuu yksi rivi, jossa on vain</p>
<ul>
  ${PAGE_VIEW_FIELDS.map((f) => html`<li>${FIELD_TEXT[f]}</li>`)}
  <li>tallennusaika, jonka tietokanta lisää.</li>
</ul>
<p>Emme tallenna IP-osoitetta, evästeitä, laite- tai istuntotunnisteita, hakusanoja emmekä klikkauksia, emmekä yhdistä rivejä toisiinsa. Tilasto ei käytä selaimesi tallennustilaa, eikä yksittäistä kävijää voi tunnistaa riveistä.</p>
<p>Myös muille sivustoille upotetun inflaatiokortin (<a href="/upotus/ohje/">Upota sivullesi</a>) jokainen lataus lasketaan samalla tavalla yhdeksi riviksi. Viittaavaksi sivustoksi tallentuu silloin upottavan sivuston verkkotunnus.</p>
<p>Jos selaimesi lähettää Global Privacy Control- tai Do Not Track -signaalin, sivulatauksesta ei lähetetä mitään.</p>
<p><strong>Peruste:</strong> oikeutettu etu (tietosuoja-asetuksen 6 artiklan 1 kohdan f alakohta). Etumme on seurata palvelun käyttöä, jotta voimme kehittää ja ylläpitää sitä. Koska tiedot on minimoitu eikä niistä voi tunnistaa kävijää, käsittely ei arviomme mukaan juurikaan vaikuta yksityisyyteesi. Voit vastustaa käsittelyä, ks. <a href="#oikeutesi">Oikeutesi</a>.</p>
<p><strong>Säilytys:</strong> rivit poistetaan automaattisesti ${RETENTION_MONTHS} kuukauden kuluttua.</p>
<p><strong>Käsittelijä:</strong> tiedot tallennetaan Supabase-tietokantapalveluun (Supabase, Inc.). Palvelu vastaanottaa rivin verkon yli ja käsittelee siksi teknisesti myös pyynnön IP-osoitetta, mutta IP-osoitetta ei tallenneta tilastoon.</p>
${sub('google-analytics', 'Google Analytics (vain suostumuksella)')}
<p>Jos sallit analytiikan evästeasetuksissa, sivusto lataa Google Analytics 4 -palvelun. Ilman suostumustasi sitä ei ladata lainkaan.</p>
<p>Google Analytics kerää tietoa siitä, miten sivustoa käytetään: avatut sivut ja viittaava sivu (osoitteet ilman hakuparametreja, joten esimerkiksi laskureihin syöttämäsi summat eivät välity Googlelle), sivuston toimintojen käyttö (esimerkiksi laskurin käyttö, CSV-tiedoston lataus, linkin jakaminen ja upotuskoodin kopiointi), laite- ja selaintiedot sekä IP-osoitteesta päätelty karkea sijainti. Tunnistaakseen palaavan selaimen se tallentaa selaimeesi evästeet _ga ja ${gaCookie}. Google Analytics 4 ei tallenna IP-osoitteita. Googlen signaalit ja mainonnan personointi ovat poissa käytöstä.</p>
<p><strong>Peruste:</strong> suostumuksesi (6 artiklan 1 kohdan a alakohta). Voit perua suostumuksen milloin tahansa evästeasetuksista. Silloin Google Analytics pysäytetään ja sen evästeet poistetaan selaimestasi.</p>
<p><strong>Säilytys:</strong> Google Analyticsin tapahtumatiedot säilytetään ${RETENTION_MONTHS} kuukautta, minkä jälkeen ne poistuvat automaattisesti.</p>
<p><strong>Käsittelijä ja siirrot:</strong> Google Ireland Limited ja sen emoyhtiö Google LLC. Google voi käsitellä tietoja myös Yhdysvalloissa, ks. <a href="#siirrot">Tietojen siirrot</a>.</p>
${sub('yhteydenotot', 'Yhteydenottolomake')}
<p>Kun lähetät viestin yhteydenottolomakkeella, lomakkeen tiedot – nimi (vapaaehtoinen), sähköpostiosoite ja viesti – välitetään sähköpostiimme EmailJS-palvelun kautta. Käytämme tietoja vain viestiisi vastaamiseen ja asian hoitamiseen. Lomakkeen roskapostisuoja toimii selaimessasi eikä tallenna tietoja.</p>
<p><strong>Peruste:</strong> oikeutettu etu vastata yhteydenottoihin (6 artiklan 1 kohdan f alakohta).</p>
<p><strong>Säilytys:</strong> säilytämme viestit enintään ${CONTACT_RETENTION_MONTHS} kuukautta asian käsittelyn päättymisestä, ellei laki edellytä pidempää säilytystä.</p>
<p><strong>Käsittelijät:</strong> EmailJS (lomakkeen välitys) ja ylläpitäjän sähköpostipalvelu (viestien säilytys).</p>
${sub('palveluntarjoajat', 'Sivuston toimittaminen: palvelin, verkko ja lokit')}
<p>Sivusto toimitetaan Fly.io-pilvipalvelusta (Fly.io, Inc.), ja liikenne kulkee Cloudflaren (Cloudflare, Inc.) verkon kautta. Kun avaat sivun, nämä palveluntarjoajat käsittelevät teknisesti välttämättömiä tietoja, kuten IP-osoitettasi, selaimesi tietoja sekä pyydetyn sivun osoitetta ja ajankohtaa, jotta sivu voidaan toimittaa ja palvelu suojata hyökkäyksiltä ja väärinkäytöksiltä. Tiedot voivat tallentua palveluntarjoajien lokeihin lyhyeksi ajaksi niiden käytäntöjen mukaisesti. Emme käytä lokeja kävijöiden seurantaan emmekä yhdistä niitä muihin tietoihin.</p>
<p><strong>Peruste:</strong> oikeutettu etu (palvelun toimittaminen ja tietoturva).</p>
<p>Sivusto ei lataa fontteja, skriptejä tai muita tiedostoja kolmansien osapuolten palvelimilta. Ainoat poikkeukset ovat edellä kuvatut: kävijätilaston tallennus Supabaseen, Google Analytics suostumuksellasi ja yhteydenottolomakkeen lähetys EmailJS:lle.</p>
${sub('siirrot', 'Tietojen siirrot EU:n ja ETA:n ulkopuolelle')}
<p>Osa palveluntarjoajistamme on yhdysvaltalaisia yrityksiä tai niiden tytäryhtiöitä, ja ne voivat käsitellä tietoja myös EU:n ja ETA:n ulkopuolella. Tällöin siirrot perustuvat tietosuoja-asetuksen mukaisiin suojatoimiin, kuten Euroopan komission tietosuojan riittävyyttä koskevaan päätökseen (EU:n ja Yhdysvaltojen välinen tietosuojakehys) tai komission hyväksymiin vakiosopimuslausekkeisiin. Emme myy tai luovuta henkilötietoja muille.</p>
${sub('oikeutesi', 'Oikeutesi')}
<p>Sinulla on tietosuoja-asetuksen mukaan</p>
<ul>
  <li>oikeus saada tietää, käsittelemmekö tietojasi, ja saada pääsy niihin (15 artikla)</li>
  <li>oikeus pyytää virheellisten tietojen oikaisua (16 artikla)</li>
  <li>oikeus pyytää tietojen poistamista (17 artikla)</li>
  <li>oikeus pyytää käsittelyn rajoittamista (18 artikla)</li>
  <li>oikeus siirtää antamasi tiedot järjestelmästä toiseen, kun käsittely perustuu suostumukseen (20 artikla)</li>
  <li>oikeus vastustaa oikeutettuun etuun perustuvaa käsittelyä (21 artikla)</li>
  <li>oikeus perua suostumuksesi milloin tahansa; peruminen ei vaikuta sitä ennen tehdyn käsittelyn lainmukaisuuteen (7 artikla).</li>
</ul>
<p>Voit käyttää oikeuksiasi ottamalla yhteyttä yhteydenottolomakkeella tai kirjeitse (${op.name}, ${address}). Vastaamme viimeistään kuukauden kuluessa. Kävijätilaston rivejä emme pysty yhdistämään sinuun, joten niistä emme yleensä voi löytää sinua koskevia tietoja (11 artikla). Google Analyticsin tiedonkeruun voit lopettaa perumalla suostumuksen.</p>
<p>Emme tee henkilötietojesi perusteella automaattisia päätöksiä.</p>
${sub('valitusoikeus', 'Oikeus valittaa valvontaviranomaiselle')}
<p>Jos katsot, että henkilötietojesi käsittely rikkoo tietosuojalainsäädäntöä, voit tehdä valituksen valvontaviranomaiselle: Tietosuojavaltuutetun toimisto, ${ext(LINKS.tietosuoja, 'tietosuoja.fi')}.</p>
${sub('muutokset', 'Selosteen muutokset')}
<p>Päivitämme selostetta, kun henkilötietojen käsittely muuttuu. Jos muutos koskee suostumukseen perustuvaa käsittelyä, kysymme suostumuksesi uudelleen.</p>
<ul class="legal__changes">
  ${CHANGES.map((ch) => html`<li><time datetime="${ch.date}">${fmt.date(ch.date)}</time>: ${ch.text}</li>`)}
</ul>`;

  /* ---------------------------------------------------------- 3. Evästeet */
  const cookieTable = c.dataTable({
    id: 'evastetaulukko',
    caption: 'Sivuston evästeet',
    columns: [{ label: 'Nimi' }, { label: 'Tarkoitus' }, { label: 'Tyyppi' }, { label: 'Voimassa' }],
    rows: [
      [html`<code>${consentCookie}</code>`, 'Muistaa evästevalintasi (valinta, sen päivämäärä ja käytäntöjen versio).', 'Välttämätön', `${consentMonths} kuukautta`],
      [html`<code>_ga</code>`, 'Google Analytics: erottaa selaimet toisistaan.', 'Analytiikka, vain suostumuksella', `${gaMonths} kuukautta viimeisestä käynnistä`],
      [html`<code>${gaCookie}</code>`, 'Google Analytics: tallentaa käynnin tilan.', 'Analytiikka, vain suostumuksella', `${gaMonths} kuukautta viimeisestä käynnistä`],
    ],
  });

  const cookies = html`
<p>Eväste on pieni tekstitiedosto, jonka sivusto tallentaa selaimeesi. ${ctx.site.brand} käyttää evästeitä vain evästevalintasi muistamiseen ja – jos sallit sen – Google Analyticsiin. Kävijätilastomme ei käytä evästeitä.</p>
${cookieTable}
${sub('selaimen-tallennustila', 'Selaimen tallennustila')}
<p>Lisäksi sivusto muistaa kaksi näkymävalintaasi selaimesi omassa tallennustilassa (localStorage): teemavalinnan (avain theme), jos valitset vaalean tai tumman teeman, ja etusivulla valitun mittarin (avain inflaatio.mittari), jos valitset YKHI:n. Nämä tiedot eivät lähde selaimestasi mihinkään, ja voit poistaa ne selaimen asetuksista.</p>
${sub('evastevalinta', 'Evästevalinnan muuttaminen')}
<p>Voit muuttaa tai perua valintasi milloin tahansa sivun alareunan Evästeasetukset-painikkeesta tai alla olevasta painikkeesta. Kun perut analytiikan, Google Analytics pysäytetään ja sen evästeet poistetaan. Valintaa kysytään uudelleen ${consentMonths} kuukauden kuluttua tai jos evästeiden käyttötarkoitukset muuttuvat. Kunnes valitset uudelleen, Google Analytics ei ole käytössä, ja sen evästeet poistetaan.</p>
<p class="js-only">${c.button({ label: 'Avaa evästeasetukset', variant: 'secondary', attrs: { data: { openConsent: '' } } })}</p>
<p class="no-js-only">JavaScript on poissa käytöstä, joten sivusto ei aseta evästeitä eikä lataa Google Analyticsia.</p>
<p>Voit myös poistaa evästeet ja estää niiden tallentamisen selaimesi asetuksista.</p>`;

  /* ------------------------------------------------------ 4. Vastuuvapaus */
  const disclaimer = html`
<p>Sivuston tiedot ovat yleistä tietoa. Ne eivät ole sijoitus-, talous- tai oikeudellista neuvontaa eivätkä korvaa asiantuntijan arviota.</p>
<p><strong>Tietojen oikeellisuus.</strong> Luvut haetaan automaattisesti Tilastokeskuksen, Eurostatin ja Euroopan keskuspankin avoimista rajapinnoista ja tarkistetaan automaattisesti ennen julkaisua. Virallinen lähde on aina tilaston tuottajan oma julkaisu. Jos huomaat eron, kerro siitä meille.</p>
<p><strong>Ennakkotiedot.</strong> Sanalla ennakko merkityt luvut (Eurostatin YKHI-pikaennakko ja Tilastokeskuksen ansiotasoindeksin uusimmat neljännekset) voivat muuttua lopullisessa julkaisussa.</p>
<p><strong>Laskurit.</strong> Laskurien tulokset ovat suuntaa antavia. Esimerkiksi vuokrankorotus määräytyy vuokrasopimuksen ehtojen mukaan, joten tarkista oma sopimuksesi.</p>
<p><strong>Vastuunrajoitus.</strong> ${op.name} ei vastaa välittömistä tai välillisistä vahingoista, jotka aiheutuvat palvelun tietojen käytöstä tai palvelun käyttökatkoista, ellei pakottavasta lainsäädännöstä muuta johdu.</p>
<p><strong>Ulkoiset linkit.</strong> Emme vastaa linkitettyjen ulkopuolisten sivustojen sisällöstä tai tietosuojakäytännöistä.</p>`;

  const main = html`${c.pageHeader({
    eyebrow: ctx.site.brand,
    title: 'Käyttöehdot ja tietosuoja',
    lede: 'Palvelun käyttöehdot, tietosuojaseloste, evästeet ja vastuuvapauslauseke yhdellä sivulla.',
    meta: html`Päivitetty ${updated} · Ylläpito: ${op.name}`,
  })}
<div class="container legal">
  <aside class="legal__aside">${c.toc(TOC, { title: 'Sisällys' })}</aside>
  <div class="legal__body">
    ${section('kayttoehdot', 'Käyttöehdot', terms)}
    ${section('tietosuoja', 'Tietosuojaseloste', privacy)}
    ${section('evasteet', 'Evästeet', cookies)}
    ${section('vastuuvapaus', 'Vastuuvapaus', disclaimer)}
  </div>
</div>`;

  const url = `${ctx.baseUrl}${path}`;
  const organization = organizationLd(ctx);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Käyttöehdot ja tietosuoja',
      url,
      inLanguage: 'fi',
      dateModified: TERMS_UPDATED,
      isPartOf: { '@type': 'WebSite', name: ctx.site.brand, url: `${ctx.baseUrl}/` },
      publisher: organization,
    },
  ];

  return [
    {
      path,
      lastmod: TERMS_UPDATED,
      html: ctx.layout({
        title: 'Käyttöehdot ja tietosuoja',
        description: `${ctx.site.brand}:n käyttöehdot, tietosuojaseloste, evästeet ja vastuuvapaus: mitä tietoja käsittelemme, miksi ja miten voit muuttaa evästevalintasi.`,
        path,
        page: 'kayttoehdot',
        breadcrumbs: ctx.crumbs(path, 'Käyttöehdot ja tietosuoja'),
        jsonLd,
        main,
      }),
    },
  ];
}
