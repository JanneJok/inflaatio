# Tietosuoja: käsittelytoimien seloste ja ylläpitäjän muistilista

**Päivitetty 29.9.2026.** Rekisterinpitäjä: Opak Oy (2950233-8), Kivikastintie
24, 65300 Vaasa. Kävijöille näkyvä seloste on sivulla
https://inflaatio.fi/kayttoehdot/#tietosuoja (`src/pages/kayttoehdot.js`).
Tämä tiedosto on rekisterinpitäjän sisäinen kirjanpito (GDPR 30 art.) ja
perustelut. Tarvittaessa se luovutetaan tietosuojavaltuutetulle.

## 1. Käsittelytoimet

| Käsittely | Tiedot | Tarkoitus | Peruste | Säilytys | Käsittelijä |
|---|---|---|---|---|---|
| Evästeetön kävijätilasto | Sivun polku (ei kyselyosaa), viittaavan sivuston verkkotunnus tai `direct`/`internal`, laitetyyppi, aika | Palvelun käytön seuranta ja kehittäminen | Oikeutettu etu (6.1 f) | 14 kk (pg_cron) | Supabase |
| Oma tapahtumatilasto | Tapahtuman nimi (sallittu lista), sivun polku, sivuston oma tarkenne, aika | Toimintojen käytön mittaus (laskurit, lataukset …) | Suostumus (6.1 a) | 14 kk (pg_cron) | Supabase |
| Google Analytics 4 | Sivut ja tapahtumat, laite- ja selaintiedot, karkea sijainti, evästetunniste | Käytön analysointi | Suostumus (6.1 a) | 14 kk (GA-asetus) | Google |
| Yhteydenottolomake | Nimi (vapaaehtoinen), sähköposti, viesti | Yhteydenottoihin vastaaminen | Oikeutettu etu (6.1 f) | 12 kk käsittelyn jälkeen | EmailJS, sähköpostipalvelu |
| Sivuston toimittaminen | IP-osoite, selaintiedot, pyyntö, aika (palveluntarjoajien lokit) | Toimitus ja tietoturva | Oikeutettu etu (6.1 f) | Palveluntarjoajien käytännöt | Fly.io, Cloudflare |
| Tilastonäkymän kirjautuminen | Ylläpitäjän sähköposti ja salasanan tiiviste | Pääsynhallinta | Oikeutettu etu (6.1 f) | Kunnes tunnus poistetaan | Supabase |

Nginx-lokit eivät sisällä IP-osoitteita, käyttäjäagentteja, viittaajia eikä
kyselyosia (`deploy/nginx.conf`, `log_format inflaatio`).

## 2. Arvio: kävijätilasto ilman suostumusta

- **Henkilötiedot (GDPR):** tauluun ei tallennu IP-osoitetta, evästettä,
  tunnistetta, käyttäjäagenttia eikä kyselyosaa. Rivejä ei voi yhdistää
  toisiinsa. Supabase näkee pyynnön IP-osoitteen teknisesti (käsittelijänä),
  mutta sitä ei tallenneta tilastoon.
- **Tasapainotesti (6.1 f):** etu = palvelun kehittäminen ja ylläpito. Tietoja
  on vähän ja ne ovat karkeita, joten vaikutus kävijään on vähäinen.
  Vastustamisoikeus: selaimen Do Not Track tai Global Privacy Control estää
  laskennan kokonaan, ja seloste kertoo tästä.
- **Päätelaitteen tiedot (sähköisen viestinnän palveluista annettu laki 205 §,
  ePrivacy 5.3 art.):** laskuri ei tallenna mitään päätelaitteelle. Se lukee
  kuitenkin selaimen JavaScriptillä karkean laiteluokan (osoitintyyppi ja
  näytön lyhyempi sivu) ja `document.referrer`in. EDPB:n ohjeiden 2/2023
  laajan tulkinnan mukaan tällainenkin lukeminen voi vaatia suostumuksen.
  Traficom ei ole antanut suomalaista poikkeusta analytiikalle. **Riski
  arvioidaan pieneksi**, koska tiedot ovat karkeita, tunnisteettomia ja vain
  omaan käyttöön. Varovaisin vaihtoehto olisi jättää laitetyyppi pois
  (`deviceClass` → `null` analytics.js:ssä) tai siirtää koko laskuri
  suostumuksen taakse. Silloin kävijämäärä näkyisi vain suostumuksen
  antaneilta. Päätös on rekisterinpitäjän.
- **Uudet tapahtumat** lähetetään vain analytiikkasuostumuksella (sama valinta
  kuin Google Analytics). Siksi suostumuksen versio nostettiin kolmoseen
  29.9.2026, ja kaikilta kysytään uudelleen.

## 3. Tilastonäkymän tietoturva

- Näkymä https://inflaatio.fi/tilastot/ on staattinen sivu ilman dataa.
  Luvut haetaan vasta kirjautumisen jälkeen.
- Kirjautuminen: Supabase Auth (salasanan tiiviste Supabasessa,
  kirjautumisyritysten rajoitus). Julkiset rekisteröitymiset pitää estää
  (`docs/TILASTOT.md`, kohta 1). Vaikka joku rekisteröityisi, tilastofunktio
  vastaa vain käyttäjille, jotka on lisätty tauluun
  `inflaatio_stats_admins`. Taulua ei voi lukea eikä muuttaa API:n kautta.
- Tilastofunktio palauttaa vain koosteita. Taulua ei voi lukea anonyymisti
  eikä kirjautuneena (RLS ja oikeudet, testattu: `docs/supabase-tilastot.sql`).
- Istunto säilyy välilehden `sessionStorage`ssa, ei evästeessä.
  Uloskirjautuminen mitätöi refresh tokenin.
- Näkymä ei lataa site.js:ää, joten se ei laske omia katselujaan eikä lataa
  Google Analyticsia.

## 4. Ylläpitäjän tehtävät

- [ ] Supabasen DPA: https://supabase.com/legal/dpa (hyväksy ja arkistoi PDF).
  Tarkista projektin alue (Project Settings → General). EU-alue on
  suositeltava. Jos alue on Yhdysvalloissa, siirtoperuste on Supabasen
  vakiosopimuslausekkeet (SCC) DPA:ssa. Päivitä tarvittaessa selosteen kohta
  *Tietojen siirrot*.
- [ ] Supabasen tilin kaksivaiheinen tunnistautuminen (Account → Security).
- [ ] Tilastonäkymän käyttäjän vahva salasana salasanamanagerissa.
  Rekisteröitymiset pois käytöstä.
- [ ] Google Analyticsin asetukset ja DPA: `docs/OPERATIONS.md`, kohta
  *Tietosuoja ja analytiikka*.
- [ ] Kerran vuodessa: tarkista tämä tiedosto, selosteen käsittelijät ja
  säilytysajat sekä että pg_cron-poistoajo toimii (`docs/supabase.sql`, kohta 3).

## 5. Rekisteröidyn pyynnöt

Kävijä- ja tapahtumatilaston rivejä ei voi yhdistää henkilöön (11 art.), joten
pääsy- tai poistopyyntöön vastataan, ettei tunnistettavia tietoja ole.
Poikkeus on, jos henkilö itse antaa lisätietoja, joilla rivit voisi yksilöidä.
Käytännössä sellaisia ei ole. Yhteydenottoviestit löytyvät sähköpostista.
Vastaus kuukauden kuluessa.

## 6. Tietoturvaloukkaus

1. Rajaa: vaihda vuotanut salasana tai avain (Supabase: Project Settings → API
   → *Reset* service role key, JWT secret; tilastonäkymän salasana:
   Authentication → Users). Poista tarvittaessa käyttäjän pääsy
   (`inflaatio_stats_admins`).
2. Arvioi: mitä tietoja, kuinka monta henkilöä ja millainen riski. Tilastot
   eivät sisällä henkilötietoja. Yhteydenottoviestit sisältävät.
3. Ilmoita tietosuojavaltuutetulle 72 tunnin kuluessa, jos loukkauksesta
   todennäköisesti aiheutuu riskiä (33 art.): https://tietosuoja.fi/ilmoita-tietoturvaloukkauksesta.
   Ilmoita myös henkilöille, jos riski on korkea (34 art.).
4. Kirjaa tapahtuma (mitä, milloin, toimet) tämän tiedoston loppuun tai
   erilliseen lokiin, vaikka ilmoitusta ei tarvittaisi.
