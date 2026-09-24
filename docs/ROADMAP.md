# Inflaatio.fi – kehityssuunnitelma

Päivitetty 9/2026, kun sivusto oli uudistettu (v2). Tekniset ohjeet ovat
tiedostoissa [`ARCHITECTURE.md`](ARCHITECTURE.md), [`DATA.md`](DATA.md) ja
[`OPERATIONS.md`](OPERATIONS.md). Hakukoneoptimoinnin tila ja jatkuva
tarkistuslista: [`SEO-CHECKLIST.md`](SEO-CHECKLIST.md).

## Tavoite

Inflaatio.fi on selkein ja luotettavin paikka Suomen virallisille
inflaatioluvuille: jokaisella luvulla on kuukausi ja lähde, ja luvut
päivittyvät itsestään virallisista rajapinnoista. Kävijämäärä kasvaa
hakukoneista laskureiden, vuosi- ja kuukausisivujen, kuukausikatsausten ja
datasivujen kautta.

Vanhan suunnitelman tavoite oli "50 000 uniikkia kävijää kuukaudessa
mainosverkostoihin liittymiseksi". Mainonnasta ei ole päätetty. Sen
edellytykset on koottu kohtaan [Ansaintamalli](#ansaintamalli-mainonta).

**Mittarit.** Uniikkeja kävijöitä ei voi mitata. Oma kävijälaskuri on
evästeetön eikä tunnista kävijää, ja Google Analytics latautuu vain
suostumuksen antaneille. Seuraa siksi näitä:

- sivulataukset (Supabase, yksi `page_view` sivunlatausta kohti)
- Google Search Consolen klikkaukset, näyttökerrat ja hakusanat
- tuotetapahtumat (laskurin käyttö, CSV-lataus, jako, upotuskoodin kopiointi):
  GA4, vain suostumuksen antaneilta

## Toteutettu v2-uudistuksessa (9/2026)

Vanhan suunnitelman vaiheet:

- **Vaihe 2, blogi:** korvattu kuukausikatsauksilla. Ne generoidaan datasta,
  joten jokaisesta julkaisukuukaudesta syntyy tuore sivu ilman käsityötä.
  Yleisartikkelit ovat yhä tekemättä (ks. [Jäljellä](#jäljellä-olevat-ideat)).
- **Vaihe 3, inflaatiolaskuri:** toteutettu laajempana: rahan arvo
  kuukausitarkkuudella virallisilla pisteluvuilla, ja lisäksi neljä muuta
  laskuria.

| Alue | Mitä tehtiin | Reitit |
|---|---|---|
| Laskurit | vuokrankorotus (elinkustannusindeksi ja KHI:n eri perusvuodet), rahan arvo ja säästöjen reaalituotto, oma inflaatio kulutusrakenteen mukaan, ostovoima (reaaliansiot ja palkankorotuslaskuri) | `/laskurit/`, `/vuokrankorotus/`, `/rahanarvo/`, `/oma-inflaatio/`, `/ostovoima/` |
| Kuukausikatsaukset (blogin tilalla) | datasta generoitu katsaus jokaisesta kuukaudesta 1/2024 alkaen: pääluku ja sen muutos, hintojen kuukausimuutos, YKHI ja euroalue, hyödykeryhmien vaikutus, kahden vuoden kehitys ja kuukauden tapahtumat; valinnainen ylläpitäjän kommentti (`src/content/katsauskommentit.json`) | `/katsaus/`, `/katsaus/<vvvv-kk>/` |
| Vuosi- ja kuukausisivut | oma sivu jokaiselle vuodelle 1980 alkaen ja jokaiselle kuukaudelle 1/2015 alkaen (pitkän hännän haut, esim. "inflaatio 2022") | `/inflaatio/`, `/inflaatio/<vuosi>/`, `/inflaatio/<vuosi>/<kuukausi>/` |
| Datasivut | pisteluvut kaikilla perusvuosilla, hyödykeryhmät ja noin 60 hyödykesivua, polttoaineiden keskihinnat, vertailu euroalueeseen, Pohjoismaihin ja EU-maihin, EKP:n korot, euribor ja reaalikorko | `/pisteluvut/`, `/hinnat/`, `/hinnat/<hyödyke>/`, `/polttoaineet/`, `/vertailu/`, `/korot/` |
| Etusivu | inflaatio nyt, tunnusluvut (KHI tai YKHI), mikä nostaa hintoja, kehityskaavio (euroalue, pohjainflaatio, tapahtumat), hintataso, vuosittain, KHI vai YKHI, ennusteet, UKK, julkaisukalenteri ja muutosloki | `/` |
| Avoin data ja jakaminen | CSV- ja JSON-lataukset ja lainausohje, RSS-syöte, syvälinkit (`?mittari=`, `?jakso=`), kaavio kuvana, datasta generoitu jakokuva, upotettava inflaatiokortti | `/data/`, `/feed.xml`, `/og/inflaatio.png`, `/upotus/`, `/upotus/ohje/` |
| Englanti | suppea englanninkielinen versio ja kaksi laskuria | `/en/`, `/en/rent-increase-calculator/`, `/en/value-of-money/` |
| Luottamus | tietoa palvelusta, menetelmät, käyttöehdot, tietosuoja, evästeet ja vastuuvapaus yhtenä dokumenttina | `/tietoa/`, `/menetelmat/`, `/kayttoehdot/` |
| Hakukoneoptimointi | ks. [`SEO-CHECKLIST.md`](SEO-CHECKLIST.md) | |
| Tekniikka | oma build, joka kirjoittaa luvut valmiiksi HTML:ään; data suoraan Tilastokeskukselta, Eurostatista ja EKP:ltä kahdesti päivässä; Fly.io + nginx; tiukka CSP; WCAG 2.2 AA; vaalea, tumma ja automaattinen teema | |
| Analytiikka ja evästeet | evästeetön, minimoitu kävijälaskuri ilman suostumusta (oikeutettu etu); Google Analytics vain suostumuksella | |

## Jäljellä olevat ideat

Karkeassa tärkeysjärjestyksessä:

1. **Sähköposti-ilmoitus uusista luvuista.** RSS-syöte on jo olemassa.
   Seuraava askel on RSS-to-email-lista, jossa tilaus vahvistetaan
   kaksivaiheisesti. Tämä vaatii postipalvelun, tietosuojaselosteen
   päivityksen ja CSP-muutoksen, jos lomake lähettää tiedot kolmannelle
   osapuolelle.
2. **Yleisartikkelit, jotka tukevat työkaluja.** Vanhan suunnitelman
   blogiaiheista ne, jotka ohjaavat laskuriin tai datasivulle:
   - "Vuokran indeksikorotus – näin se lasketaan" → `/vuokrankorotus/`
   - "Rahan arvo ennen ja nyt" → `/rahanarvo/`
   - "Pysyykö palkkasi inflaation perässä?" → `/ostovoima/`
   - "Miten suojautua inflaatiolta?" (säästöjen reaalituotto) → `/rahanarvo/`
   - "KHI vai YKHI – miksi luvut eroavat?" → `/menetelmat/`
   - "EKP:n korot ja inflaatio" → `/korot/`
   - "Suomen inflaatiohistoria" → `/inflaatio/`
   - "Miksi ruoan hinta nousee?" → `/hinnat/`

   Toteutus on sivumoduuli ja sisältötiedostot (esim. `src/content/artikkelit/`),
   Article-JSON-LD, murupolku ja linkit työkaluun. Kaikki luvut tulevat
   datasta, eikä niitä kirjoiteta tekstiin käsin.
3. **Ylläpitäjän kommentit kuukausikatsauksiin** säännöllisesti
   (`src/content/katsauskommentit.json`). Ne erottavat katsaukset
   pelkästä datasta.
4. **Oma jakokuva** kuukausikatsauksille ja vuosisivuille. Nyt kaikki sivut
   käyttävät samaa `/og/inflaatio.png`-kuvaa.
5. **Lisää hyödykesivuja** hakukysynnän mukaan (`scripts/fetch/hyodykesivut.json`).
6. **Laajempi englanninkielinen osio,** esimerkiksi vuosisivut ja hinnat.
7. **Ennusteet ja tapahtumat ajan tasalla**
   (`src/content/ennusteet.json`, `src/content/tapahtumat.json`; ohje
   `OPERATIONS.md`:ssä).

Ei suunnitelmissa: push-ilmoitukset. Service worker on nykyään vain vanhan
sivun service workerin poistaja, ja se poistetaan 9/2027.

## Ansaintamalli (mainonta)

Mainonnasta ei ole päätetty. Ennen päätöstä tarvitaan nämä:

1. **TCF-yhteensopiva evästeiden hallinta (CMP).** Google on vaatinut
   ETA-alueella 16.1.2024 alkaen mainoksille Googlen sertifioiman,
   IAB TCF v2.2 -yhteensopivan CMP:n. Sivuston oma suostumusbanneri
   (`src/js/lib/consent.js`) tuntee vain analytiikkakategorian eikä tuota
   TCF-merkkijonoa, joten ilman CMP:tä AdSense näyttäisi Suomessa korkeintaan
   rajoitettuja mainoksia. Jos CMP otetaan käyttöön, myös Google Analyticsin
   suostumus siirretään sen hallintaan (yksi banneri, ei kahta).
   Evästeetön kävijälaskuri voi jatkaa oikeutetun edun perusteella, mutta
   se kuvataan selosteessa kuten nyt.
2. **`ads.txt`** tiedostoon `src/static/ads.txt` (julkaisijatunnus).
3. **Tietosuojaseloste:** Mainonta-osio ja evästeluettelo
   (`/kayttoehdot/#tietosuoja`, `#evasteet`, `src/pages/kayttoehdot.js`,
   `TERMS_UPDATED`).
4. **CSP:** mainosverkon skripti-, kehys-, kuva- ja yhteysosoitteet
   tiedostoon `deploy/security-headers.conf` ja testeihin
   (`test/serve.test.js`, `test/ops.test.js`). Mainokset tuovat sivulle
   kolmannen osapuolen skriptejä, joten niiden haitat suorituskyvylle ja
   tietoturvalle on punnittava.
5. **Mainospaikat** varaavat tilansa etukäteen, jotta asettelu ei hypi (CLS).
6. **Tuottolaskelma ennen päätöstä,** esimerkiksi 50 000 sivulatausta
   kuukaudessa × RPM 2 € = noin 100 € kuukaudessa.

**Hosting ei ole enää este.** GitHub Pagesin ilmaista hostingia ei ollut
tarkoitettu verkkoliiketoimintaan, joten yrityksen (Opak Oy)
mainosrahoitteinen sivu oli harmaalla alueella. Sivusto palvellaan nyt
Fly.io:sta maksullisena palveluna, joten tämä rajoitus ei enää koske sitä,
eikä siirtoa Cloudflare Pagesiin tarvita.

Mainosverkostot (vaatimukset tarkistettu 9/2026, tarkista uudelleen ennen hakemista):

| Verkosto | Vaatimus | Sopiiko Inflaatio.fi:lle? |
|---|---|---|
| Google AdSense | ei liikennerajaa; ETA:ssa pakollinen sertifioitu TCF-CMP ja ads.txt | kyllä, kun CMP, ads.txt ja tietosuojaseloste ovat kunnossa |
| Ezoic | tarkista nykyiset vaatimukset ennen hakemista | selvitettävä |
| Mediavine | 1/2026 alkaen tuottoperusteinen (vähintään 5 000 $ mainostuloa vuodessa); Journey-ohjelma vaatii liikennettä Tier 1 -maista (US, UK, CA, AU) | ei (suomenkielinen liikenne) |
| Raptive (ent. AdThrive) | 25 000 sivunäyttöä kuukaudessa ja vähintään 50 % liikenteestä maista US, UK, CA, NZ, AU | ei |

## Lähteet

- Datalähteet, taulukot ja rajapinnat: [`DATA.md`](DATA.md)
  (Tilastokeskus PxWeb, Eurostat, EKP:n Data API)
- Tilastokeskuksen kuluttajahintaindeksi:
  https://pxdata.stat.fi/PxWeb/pxweb/fi/StatFin/StatFin__khi/
