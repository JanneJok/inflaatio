# Tilastot ja tilastonäkymä

Sivusto kerää omaan Supabase-tauluunsa (`public.inflaatio_analytics`) kaksi
asiaa:

1. **Sivukatselut** – evästeetön kävijätilasto, ei vaadi suostumusta
   (oikeutettu etu). Yksi rivi per sivulataus: sivu, lähteen verkkotunnus tai
   luokka, laitetyyppi ja aika. Ei lähetetä, jos selaimessa on Do Not Track
   tai Global Privacy Control. Koodi: `src/js/lib/analytics.js`.
2. **Tapahtumat** – vain analytiikkasuostumuksella. Yksi rivi per tapahtuma:
   nimi, sivu ja sivuston oma tarkenne (esim. laskurin nimi). Lista:
   `src/js/lib/tilastot-events.js`.

Ylläpitäjä näkee koosteet osoitteessa **https://inflaatio.fi/tilastot/**
kirjautumalla. Sivu ei ole hakukoneissa eikä linkitettynä sivustolla, eikä
sen HTML sisällä dataa: luvut haetaan vasta kirjautumisen jälkeen
tietokantafunktiolla, joka vastaa vain ylläpitäjiksi merkityille käyttäjille.

## 1. Käyttöönotto (kerran, noin 5 minuuttia)

Tee nämä Supabasen hallintapaneelissa (projekti `ysuhexvvgjoizrcdrxso`):

1. **Luo käyttäjä:** Authentication → Users → *Add user* → *Create new user*.
   Anna sähköpostiosoitteesi ja vahva salasana (esim. salasanamanagerin
   generoima), ja pidä *Auto Confirm User* päällä.
2. **Estä muut rekisteröitymiset:** Authentication → Sign In / Providers →
   Email → poista *Allow new users to sign up* käytöstä. (Vaikka joku
   rekisteröityisi, hän ei näe tilastoja, mutta turhat tunnukset on hyvä
   estää.)
3. **Aja SQL:** SQL Editor → New query → liitä `docs/supabase-tilastot.sql`
   → vaihda tiedoston lopussa `OMA@SAHKOPOSTI.FI` omaksi osoitteeksesi → Run.
   Skripti lisää tapahtumasarakkeen, sallitut tapahtumat, ylläpitäjätaulun ja
   tilastofunktion. Sen voi ajaa uudelleen turvallisesti.
4. **Kirjaudu:** https://inflaatio.fi/tilastot/ → sähköposti ja salasana.
   Selain tarjoutuu tallentamaan tunnukset salasanamanageriin.

Tarkistuskomennot (anon ei saa lukea mitään, tapahtuma kirjautuu) ovat
SQL-tiedoston alussa.

Ennen vaihetta 3 sivusto toimii normaalisti: sivukatselut kirjautuvat kuten
ennenkin, ja tapahtumat hylätään tietokannassa hiljaa (sivulle ei näy mitään).

**Vapaaehtoinen lisäsuojaus:** Supabase Authentication → Multi-Factor voi
ottaa käyttöön, ja salasanan voi vaihtaa kohdasta Users → käyttäjä → *Send
password recovery* tai *Reset password*.

**Toisen henkilön lisääminen:** luo hänelle käyttäjä (vaihe 1) ja aja
SQL-tiedoston kohta 4 hänen osoitteellaan. **Pääsyn poisto:** tiedoston
lopun `delete`-lause tai käyttäjän poisto Authentication → Users.

## 2. Kirjautuminen ja istunto

- Kirjautuminen käyttää Supabase Authia (`/auth/v1/token`). Supabase rajoittaa
  kirjautumisyrityksiä (liian moni yritys → "Liian monta
  kirjautumisyritystä").
- Istunto (lyhytikäinen access token ja refresh token) säilyy vain tämän
  välilehden `sessionStorage`ssa. Välilehden sulkeminen tai *Kirjaudu ulos*
  unohtaa sen; uloskirjautuminen mitätöi myös refresh tokenin palvelimella.
- Virheilmoitukset: "Sähköposti tai salasana on väärin", "Tunnuksellasi ei
  ole oikeutta tilastoihin" (käyttäjää ei ole lisätty tauluun
  `inflaatio_stats_admins`), "Tilastofunktiota ei löydy" (SQL ajamatta).

## 3. Näkymän osat

Yläpalkin **aikaväli** (7 pv, 30 pv, 90 pv, 12 kk, kaikki) rajaa kaaviot ja
taulukot. "Eilen"-laatat eivät riipu aikavälistä. *Päivitä* hakee tuoreet
luvut, *Lataa CSV* tallentaa valitun aikavälin päivät (pilkkuerotin; Excelissä
Tiedot → Tekstistä/CSV:stä).

1. **Huomioita** (keltainen laatikko) – automaattiset hälytykset, ks. kohta 5.
2. **Eilen** – sivukatselut, saapumiset, hakukoneista tulleet,
   laskurisivujen katselut, laskurin käytöt (tapahtuma) ja upotettujen
   korttien lataukset. Verrataan edeltävän 7 päivän keskiarvoon;
   prosenttia ei näytetä, jos keskiarvo on alle 20.
3. **Sivukatselut osioittain** – pinotut pylväät: Etusivu, Laskurit, Historia
   ja katsaukset, Hinnat, Vertailu ja korot, Muut. Yli 60 päivää → viikkosummat.
   Numeroidut pystyviivat ovat muutosmerkintöjä (kohta 6), "!" poikkeuspäivä.
4. **Suosituimmat sivut** – katselut, saapumiset (laskeutumissivut) ja osuus.
5. **Mistä kävijät tulevat** – lähteet (hakukoneet, tekoälypalvelut kuten
   ChatGPT ja Perplexity, some, muut sivustot, suora), laitteet ja
   viittaavat sivustot verkkotunnuksittain.
6. **Milloin sivustoa käytetään** – lämpökartta viikonpäivän ja tunnin mukaan
   sekä keskimääräiset katselut viikonpäivittäin.
7. **Tapahtumat** – päivittäinen määrä, tapahtumat per 1 000 katselua,
   tarkenteet (mikä laskuri, mikä tiedosto, mikä linkki) ja sivut, joilla
   tapahtumat syntyivät.
8. **Päivätaulukko** – kaikki laskurit päivittäin.

### Laskurit

| Laskuri | Merkitys |
|---|---|
| Sivukatselut | Kaikki sivulataukset paitsi upotetun inflaatiokortin lataukset muilla sivustoilla (`pv − sec.upotus`) |
| Saapumiset | Sivukatselut, joihin ei tultu sivuston toiselta sivulta (`sivukatselut − src.internal`) |
| `pv` | Kaikki sivulataukset, myös upotetut kortit |
| `sec.<osio>` | Katselut osioittain: `etusivu`, `laskurit`, `historia` (/inflaatio/, /katsaus/, /pisteluvut/), `hinnat` (+ polttoaineet), `vertailu` (+ korot), `en`, `upotus` (upotettu kortti), `notfound` (404), `muut` |
| `src.<lähde>` | `search`, `ai`, `social`, `other`, `direct` ja `internal` (sivuston sisäinen siirtymä). Luokittelu: SQL-funktio `inflaatio_source_class` |
| `dev.<laite>` | `mobile`, `tablet`, `desktop`; `unknown` = vanhan sivuston rivit |
| `ev.<tapahtuma>` | Tapahtumat alla. Muut `ev.*`-nimet (esim. `session_end`) ovat vanhan sivuston rivejä ja poistuvat säilytysajan myötä |

### Tapahtumat (vain suostumuksella)

| Tapahtuma | Milloin | Tarkenne |
|---|---|---|
| `page_read` | Alatunniste tuli näkyviin ja sivulla oli oltu ≥ 10 s | – |
| `calculator_used` | Laskuria käytettiin (kerran sivulatausta kohden) | laskuri |
| `result_shared` | Laskelman linkki jaettiin/kopioitiin | – |
| `csv_download`, `json_download` | Datatiedosto ladattiin | tiedosto |
| `widget_code_copied` | Upotuskoodi kopioitiin | – |
| `text_copied` | Muu Kopioi-painike | kopioitu kohde |
| `contact_form_sent` | Yhteydenotto lähetettiin | – |
| `chart_changed` | Kaavion valinta (aikaväli, mittari …) | valinta, esim. `mittari-ykhi` |
| `table_opened` | Kaavion taulukko tai kaikki rivit avattiin | osion id |
| `faq_opened` | Kysymys tai lisätietolaatikko avattiin | kysymys |
| `outbound_click` | Linkki toiselle sivustolle | verkkotunnus, esim. `stat.fi` |
| `page_printed` | Sivu tulostettiin / PDF | – |
| `js_error` | Sivuston oman skriptin virhe (vain määrä) | – |

Sama tapahtuma samalla tarkenteella lasketaan kerran sivulatausta kohden, ja
yhdestä sivulatauksesta lähtee enintään 40 tapahtumaa. Hyödyllisiä
suhdelukuja: `calculator_used / laskurisivun katselut` (kuinka moni laskee),
`page_read / katselut` sivuittain (luetaanko sivu loppuun),
`outbound_click` (kuinka moni tarkistaa lähteen).

**Uusi tapahtuma:** lisää nimi `src/js/lib/tilastot-events.js`-tiedostoon ja
SQL-tiedoston `event_type in (…)` -listaan (testi vertaa niitä), aja SQL
uudelleen Supabasessa, lisää kuvaus tähän taulukkoon ja kutsu
`track('nimi', { detail })` tai `ownEvent('nimi', detail)`. Tietosuojaseloste
(/kayttoehdot/#tapahtumatilasto) listaa tapahtumat automaattisesti. Jos uusi
tapahtuma muuttaa käsittelyn tarkoitusta, nosta `CONSENT_VERSION`.

## 4. Datan laatu

- **Latauksia, ei kävijöitä.** Palaavia kävijöitä ei tunnisteta, koska
  mitään tunnistetta ei tallenneta.
- **Tapahtumat ovat otos** analytiikan sallineista. Käytä suhdelukuina.
- **Sivukatseluista puuttuvat** Do Not Track / GPC -selaimet, JavaScriptittömät
  selaimet ja mainosestimet, jotka estävät Supabasen.
- **Botit:** osa boteista suorittaa JavaScriptiä ja näkyy katseluina.
  Poikkeuspäivät merkitään "!".
- **Paisutus:** Supabasen julkinen avain on julkinen, joten kuka tahansa voi
  lisätä rivejä, jotka läpäisevät tarkistukset. Trendit ja suhdeluvut ovat
  luotettavampia kuin yksittäinen päivä.
- **Päivät ja tunnit** ovat Suomen aikaa.

## 5. Hälytykset (Huomioita)

Säännöt: `src/js/lib/tilastot-model.js` (`computeAlerts`). Mediaani lasketaan
kunkin päivän edeltäviltä 28 päivältä (vähintään 7 mitattua).

| Hälytys | Milloin | Mitä tehdä |
|---|---|---|
| Kävijätilasto ei ehkä toimi | Kokonainen päivä ilman katseluja, vaikka mediaani ≥ 20 | Avaa sivusto, katso konsoli; tarkista, ettei Supabase-projekti ole keskeytetty |
| Epätavallisen paljon sivukatseluja | Päivä > 5 × mediaani | Katso lähteet ja viittaavat sivustot: julkisuus vai botti |
| Selainvirheitä tavallista enemmän | `js_error` > 3 × mediaani ja ≥ 5 | Avaa sivusto, katso konsoli, varsinkin julkaisun jälkeen |
| Tapahtumat eivät ehkä tallennu | Kokonainen päivä ilman tapahtumia, vaikka mediaani ≥ 10 | Tarkista, että SQL:n tapahtumalista vastaa koodia; kokeile suostumusta |
| Paljon 404-sivuja | Yli 5 % aikavälin katseluista (≥ 200 katselua) | `npm run check-links`, Search Consolen 404-raportti |

## 6. Aikajanan merkinnät

`FIXED_MARKERS` tiedostossa `src/js/lib/tilastot-model.js`:

| Päivä | Muutos |
|---|---|
| 24.9.2026 | Uusi sivusto: laitetyyppi kävijätilastoon, hakusanoja ei enää tallenneta |
| 29.9.2026 | Oma tapahtumatilasto (vain suostumuksella) ja uusi evästekysely (`CONSENT_VERSION` 3) |

Lisää uusi merkintä, kun laskentatapa muuttuu.

## 7. Tekninen kuvaus

- Sivu: `src/pages/tilastot.js` (merkintä), `src/js/pages/tilastot.js`
  (kirjautuminen, haku, piirto), `src/css/tilastot.css` (oma tyylitiedosto,
  ei kävijöiden main.css:ssä), `src/js/lib/tilastot-model.js` (puhtaat
  funktiot, testit `test/tilastot.test.js`).
- Tietokanta: `docs/supabase.sql` (taulu, sivukatselut, säilytys 14 kk) ja
  `docs/supabase-tilastot.sql` (tapahtumat, ylläpitäjät, funktio
  `inflaatio_stats(p_from, p_to)`). Funktio on `security definer`,
  tarkistaa ensin `auth.uid()`:n ylläpitäjätaulusta ja palauttaa vain
  koosteita (päiväsummat, top-listat), ei rivejä. Anon ei voi kutsua sitä,
  eikä kukaan voi lukea taulua API:n kautta.
- CSP: kaikki kutsut menevät jo sallittuun Supabase-osoitteeseen; uusia
  ulkoisia osoitteita ei tarvittu.
- Tietosuoja: `docs/TIETOSUOJA.md`.
