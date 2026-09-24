# Kehitysohjeet

Näillä ohjeilla muutos kulkee turvallisesti tuotantoon: haara → pull request →
CI → merge → automaattinen julkaisu Fly.io:hon. Tarkemmat tekniset ohjeet:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): build, sivumoduulit, `ctx`-rajapinta, komponentit, CSS ja selaimen JavaScript
- [`docs/DATA.md`](docs/DATA.md): datalähteet, tiedostomuodot ja hakuputki
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md): julkaisu, ajastetut työnkulut ja ylläpitäjän tehtävät

## Aloitus

Vaatimukset: Node.js 24 ja npm (Docker Desktop vain, jos haluat kokeilla
tuotannon imagea).

```sh
npm ci          # täsmälleen package-lock.json:n versiot
npm run dev     # build ilman minifiointia + palvelin http://127.0.0.1:8080/, rakentaa muutoksista uudelleen
```

## Työnkulku

1. **Tee muutokset omassa haarassa**, älä suoraan mainiin: `git switch -c fix/kuukausimuutoksen-yksikko`.
   Haaran nimi: `tyyppi/lyhyt-kuvaus` (tyypit alla).
2. **Tarkista ennen pull requestia:**

   ```sh
   npm run check   # lint + testit + tuotantobuild + sisäisten linkkien tarkistus (sama kuin CI)
   ```

   Katso muuttuneet sivut selaimessa (`npm run dev`): vaalea ja tumma teema,
   puhelimen leveys (390 px) ja työpöytä (1280 px), JavaScript pois päältä,
   eikä selaimen konsolissa saa olla virheitä.
3. **Avaa pull request** (`gh pr create`). Kerro kuvauksessa, mitä muuttui ja
   miksi, ja liitä kuvakaappaus käyttöliittymämuutoksista.
4. **CI** (`.github/workflows/ci.yml`) ajaa lintin, testit, buildin,
   linkkien tarkistuksen sekä rakentaa ja testaa Docker-imagen. Mergeä vasta,
   kun CI on vihreä (mieluiten *Squash and merge*).
5. **Julkaisu** tapahtuu itsestään: push mainiin käynnistää `deploy.yml`:n,
   joka testaa ja julkaisee Fly.io:hon ja tarkistaa julkaistun sovelluksen.

Mainiin pushaa suoraan vain datapäivitysbotti (`github-actions[bot]`,
`data: …` -kommitit, ks. `docs/OPERATIONS.md`).

## Commit-viestit

Muoto `tyyppi: mitä muuttui`, suomeksi ja käskymuodossa. Ensimmäinen rivi
enintään noin 72 merkkiä; tarvittaessa tyhjä rivi ja perustelut.

| Tyyppi | Käyttö | Esimerkki |
|---|---|---|
| `feat` | uusi ominaisuus tai sivu | `feat: lisää ostovoimalaskuri` |
| `fix` | virheen korjaus | `fix: korjaa kuukausimuutoksen yksikkö (%-yks.)` |
| `teksti` | sisältö- ja tekstimuutos | `teksti: selkeytä KHI:n ja YKHI:n eroa` |
| `style` | ulkoasu, CSS | `style: nosta taulukon kontrastia` |
| `refactor` | rakennemuutos ilman toiminnallista muutosta | `refactor: yhdistä kaavioiden apufunktiot` |
| `test` | testit | `test: lisää vuokrankorotuksen rajatapaukset` |
| `docs` | dokumentaatio | `docs: päivitä julkaisuohje` |
| `ci` | työnkulut, Dependabot | `ci: päivitä actions/checkout` |
| `deps` | riippuvuudet | `deps: päivitä esbuild` |
| `data` | datapäivitys (yleensä botti) | `data: khi 2026-09, ykhi 2026-09` |
| `chore` | muu ylläpito | `chore: poista vanhat varmuuskopiot` |

Ei viestejä kuten "ok" tai "Update index.html": historiasta pitää löytyä,
mikä muutos rikkoi tai korjasi minkäkin asian.

## Säännöt, joita CI ja build valvovat

- **CSP** (`deploy/security-headers.conf`): ei inline-skriptejä (JSON-LD ja
  JSON-datasaaret sallittu), ei `<style>`-elementtejä, `style=""`- tai
  `on*=""`-attribuutteja eikä `javascript:`-osoitteita. Build epäonnistuu,
  jos generoitu HTML rikkoo tätä. Dynaamiset arvot asetetaan JavaScriptistä
  `el.style.setProperty()`-kutsulla.
- **Ei HTML-merkkijonoja DOMiin eikä koodin suorittamista merkkijonosta.**
  Merkintä tehdään buildissa `html`-templaatilla (escapoi arvot); selaimessa
  käytetään `textContent`-ominaisuutta, `document.createElement`-kutsua,
  `<template>`-elementtiä tai `hidden`-attribuuttia. ESLint ja paikallinen
  tallennustarkistus hylkäävät kielletyt rajapinnat (lista:
  `docs/ARCHITECTURE.md` → *Security rules*).
- **Ei ajonaikaisia CDN:iä.** Kirjastot asennetaan npm:stä
  (`npm install --save-dev <paketti>`) ja bundlataan. Uusi kolmannen
  osapuolen osoite vaatii CSP-muutoksen `deploy/security-headers.conf`-tiedostoon
  (ja testien päivityksen).
- **Numerot tulevat datasta.** Sivut lukevat `ctx.data`- ja `ctx.latest`-arvoja
  buildin aikana; tekstiin ei kirjoiteta lukuja käsin. Muotoilu aina
  `format.js`-kirjastolla: desimaalipilkku, sitova välilyönti ennen %-merkkiä,
  miinusmerkki U+2212, muutokset prosenttiyksikköinä (`%-yks.`). Jokaisella
  luvulla on kuukausi ja lähde.
- **Tekstit:** selkeää suomea; viralliset nimet kuluttajahintaindeksi (KHI) ja
  yhdenmukaistettu kuluttajahintaindeksi (YKHI); brändi "Inflaatio.fi"; ei
  sanaa "reaaliaikainen". Otsikko enintään 60 ja kuvaus enintään 155 merkkiä.
- **Saavutettavuus** (WCAG 2.2 AA): näkyvä fokus, kontrasti vähintään 4,5:1,
  kosketusalueet vähintään 40 px, jokaisella kaaviolla tekstivastine
  (tiivistelmä ja taulukko), sivut toimivat ilman JavaScriptiä.
- **Kaaviot** vain `src/js/charts/setup.js`-moduulin kautta (Chart.js ladataan
  laiskasti ja teema tulee tokeneista).
- **Testit:** jokaiselle laskennalle tai generaattorille testi
  `test/<alue>.test.js` (`node --test`).

## Yleiset tehtävät

- **Uusi sivu:** `docs/ARCHITECTURE.md` → *Adding a page: complete minimal
  example* (reitti `src/site.config.js`:n `PAGES`-rekisteriin, moduuli
  `src/pages/<nimi>.js`, tyylit `src/css/pages/<nimi>.css`, valinnainen skripti
  `src/js/pages/<nimi>.js`). Rakenna ja katso yksin:

  ```sh
  node scripts/build.js --out .tmp/oma --only <nimi>
  node scripts/serve.js --dir .tmp/oma --port 8093
  ```

- **Uusi datalähde:** `docs/DATA.md` → *How to add a source*. `data/*.json`
  kirjoitetaan vain `npm run fetch` -komennolla, ei käsin.
- **Julkaisukalenteri** (`src/content/julkaisukalenteri.json`) päivittyy
  hakuputkessa; käsin saa lisätä vain virallisesti julkistettuja päivämääriä.
- **nginx- tai otsakemuutos:** muuta `deploy/`-tiedostoja ja pidä
  `scripts/serve.js` samanlaisena; `test/ops.test.js` ja `test/serve.test.js`
  tarkistavat vastaavuuden. Kokeile imagea paikallisesti:

  ```sh
  docker build -t inflaatio-local .
  docker run --rm -d -p 8108:8080 --name inflaatio-local inflaatio-local
  SMOKE_URL=http://127.0.0.1:8108 node --test --test-name-pattern='^smoke' test/ops.test.js
  docker stop inflaatio-local
  ```

  Komennot ovat POSIX-muotoa (Git Bash tai WSL Windowsissa). PowerShellissä
  savutestin rivi on
  `$env:SMOKE_URL = "http://127.0.0.1:8108"; node --test --test-name-pattern="^smoke" test/ops.test.js`.

## Tietoturva

Älä koskaan commitoi salaisuuksia (API-avaimia, tokeneita, salasanoja).
Supabasen anon-avain ja EmailJS:n julkiset tunnisteet `src/site.config.js`:ssä
ovat julkisia tarkoituksella. Ilmoita haavoittuvuudesta yksityisesti GitHubin
kautta (Security → *Report a vulnerability*), ei julkisella issuella.
