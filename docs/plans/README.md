# Inflaatio.fi - Dokumentaatio

---

## Quick Start (AI / new contributor)

Goal: ymmarra projektin data-flow, kriittiset tiedostot ja yleisimmat rutiinit ilman turhaa selailua.

### Mika tama projekti on
Staattinen sivusto (`index.html`), jossa data on upotettuna (inline) ja CSS/JS on minifioitu tuotantoa varten.
Data paivittyy kahdessa vaiheessa:
1. Google Apps Script paivittaa Google Sheetsin.
2. GitHub Actions hakee datan Sheetsista ja paivittaa `index.html`.

### Kriittiset tiedostot (aloita naista)
- `index.html`
  Paasivu. Sisaltaa inline data-aiset (HICP + CPI) ja lataa minified CSS/JS.
- `inflation-site-optimized.css`
  CSS-lahde. Muokkaa tata, ja buildaa minified CSS.
- `inflation-site-optimized.js`
  JS-lahde. Muokkaa tata, ja buildaa minified JS.
- `inflation-site-optimized.min.css` / `inflation-site-optimized.min.js`
  Tuotantoon ladattavat assetit. Paivittyvat buildilla.
- `build.js`
  Minifioi CSS + JS.
- `update-all-data.js`
  Hakee datan Google Sheetsista ja kirjoittaa `index.html` (taulukot + inline data).
- `.github/workflows/update-yearly-data.yml`
  Ajoittaa data-paivitykset ja committaa muutokset.
- `docs/plans/google-apps-script.js`
  Kopio Apps Scriptista (oikea scripti on Google Sheetsissa).

### Data flow (yhdella rivilla)
Eurostat API -> Google Apps Script -> Google Sheets -> GitHub Actions -> index.html -> deploy

### Tuotannon cache (tarkea)
Tuotanto lataa minified assetit `?v=...` -versionumerolla.
Jos `v=` ei muutu, selain/CDN voi kayttaa vanhaa cachea.

### Yleisimmat tehtavat
CSS/JS-muutos:
1. Muokkaa `inflation-site-optimized.css` ja/tai `inflation-site-optimized.js`
2. Aja `node build.js`
3. Bumpaa versiot `index.html`:ssa (tai `node scripts/bump-version.js`)
4. Commit + push

Data pipeline -muutos:
1. Paivita Apps Script Google Sheetsissa (ei tassa repossa)
2. Paivita `update-all-data.js` ja/tai workflow
3. Commit + push

Vanhat versiot tuotannossa:
- Tarkista etta minified tiedostot on commitattu
- Tarkista `v=` arvot `index.html`:ssa
- Cache voi pitaa vanhaa jos versionumero ei muutu

---

## Projektin rakenne

### Datan paivitys - kaksi erillista jarjestelmaa

Projektissa on KAKSI erillista jarjestelmaa datan paivitykseen:

GOOGLE SHEETS
- Google Apps Script (google-apps-script.js)
- Hakee datan Eurostatista API:n kautta
- Paivittaa Google Sheetin
- Lahettaa sahkopostin jos data muuttui
- Triggeroidaan: paivittain klo 07:00
- Sijainti: Google Sheets -> Extensions -> Apps Script
- Tiedosto: docs/plans/google-apps-script.js (kopio)

GITHUB ACTIONS WORKFLOW
- .github/workflows/update-yearly-data.yml
- Triggeroidaan paivittain klo 07:00 UTC
- Ajaa update-all-data.js
- Hakee datan Google Sheetsista
- Paivittaa index.html
- Ajaa build.js (minify CSS + JS)
- Committaa muutokset GitHubiin

---

## 1. Google Apps Script (Googlen puolella)

### Sijainti
TARKEA: Tama koodi EI ole tassa GitHub-repositoriossa vaan Google Sheetsissa.

- Avaa Google Sheets: Inflaatio-data
- Mene: Extensions -> Apps Script
- Siella on `tarkistaJaPaivitaInflaatio()` -funktio

### Mita se tekee

1. Hakee datan Eurostatista (HICP-indeksi)
2. Vertaa uusinta dataa Google Sheetin viimeiseen riviin:
   - Onko kuukausi muuttunut? TAI
   - Onko inflaatioarvo muuttunut?
3. Paivittaa Google Sheetin jos muutoksia
4. Lahettaa sahkopostin osoitteeseen `janne.jokela@live.fi`

### Triggerointi

Google Sheetsissa on ajastettu trigger:
- Paivittain klo 07:00 (Suomen aikaa)
- Asetettu: Apps Script -> Triggers

### Koodi

Katso: `docs/plans/google-apps-script.js`

---

## 2. GitHub Actions (GitHubin puolella)

### Sijainti
`.github/workflows/update-yearly-data.yml`

### Mita se tekee

1. Triggeroidaan paivittain klo 07:00 UTC
2. Ajaa `update-all-data.js`
3. Skripti:
   - Hakee datan Google Sheetsista (ei Eurostatista)
   - Paivittaa `index.html`:n (vuositaulukko, kaaviot, metriikat)
4. Ajaa `build.js` (minifioi CSS + JS)
5. Committaa muutokset GitHubiin

---

## Tiedonkulku

Eurostat API
 -> Google Apps Script (Googlen palvelimilla)
 -> Google Sheets paivittyy
 -> (sahkoposti lahetetaan)
 -> GitHub Actions (GitHubin palvelimilla)
 -> Hakee datan Google Sheetsista
 -> Paivittaa index.html
 -> Ajaa build.js
 -> Committaa GitHubiin
 -> Fly.io deployment (automaattinen)
 -> Inflaatio.fi sivusto paivittyy

---

## Sahkoposti-ilmoitukset

### Milloin lahetetaan?

Sahkoposti lahetetaan vain jos:
- Uusi kuukausi on saatavilla TAI
- Inflaatioarvo on muuttunut samalle kuukaudelle

### Vastaanottaja
`janne.jokela@live.fi`

### Viestin sisalto (esimerkki)
```
Aihe: Inflaatiodata paivitetty (2025-12)

Hei!

Eurostatin inflaatiodata on paivitetty kuukaudelle 2025-12.
Uusin inflaatioarvo: 1.7 %

Tiedot on nyt paivitetty Google Sheetiin.

Terveisin,
Inflaatio-botti
```

---

## Muokkausohjeet

### Google Apps Script -koodin muokkaus

1. Avaa Google Sheets
2. Extensions -> Apps Script
3. Muokkaa koodia
4. Tallenna (Ctrl+S)
5. Tarvittaessa testaa: Run -> `tarkistaJaPaivitaInflaatio`

HUOM: Paivita myos kopio tahan repositorioon: `docs/plans/google-apps-script.js`

### GitHub Actions -koodin muokkaus

1. Muokkaa `.github/workflows/update-yearly-data.yml` tai `update-all-data.js`
2. Committaa GitHubiin
3. Workflow ajautuu automaattisesti seuraavalla triggerilla

---

## Frontend-muutokset (CSS/JS) - paivittainen rutiini

Kun muutat `inflation-site-optimized.css` tai `inflation-site-optimized.js`, tee nain:

1. Aja build (minifioi CSS + JS):
   - `node build.js`
2. Bumpaa versiot `index.html`:ssa yhdella komennolla:
   - `node scripts/bump-version.js`
   - Vaihtoehto: `npm run release` (build + bump yhdella)
3. Commitoi kaikki muuttuneet tiedostot ja pushaa:
   - `inflation-site-optimized.min.css`
   - `inflation-site-optimized.min.js`
   - `index.html`

Miksi tama? Version bump pakottaa selaimen/CDN:n hakemaan uudet tiedostot eika kayttamaan vanhaa cachea.

---

## API-avaimet ja konfiguraatio

### Google Sheets API (GitHub Actions)

```javascript
// update-all-data.js
const SHEET_ID = '1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8';
const API_KEY = 'AIzaSyDbeAW-uO-vEHuPdSJPVQwR_l1Axc7Cq7g';
```

### Eurostat API (Google Apps Script)

```javascript
// Google Apps Script
const url = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=FI&coicop=CP00&unit=RCH_A';
```

Ei API-avainta tarvita - avoin API.

---

## Troubleshooting / FAQ

### 1) Tuotanto nayttaa vanhaa versiota
- Varmista etta `inflation-site-optimized.min.css` ja `inflation-site-optimized.min.js` on commitattu
- Varmista etta `index.html` `v=` on bumpattu
- Cache pysyy jos versionumero ei muutu

### 2) Mobiilissa hamburger-menu puuttuu
- Tarkista etta minified CSS on paivitetty
- Varmista etta media queryt ovat minified-versiossa

### 3) CPI/HICP nayttaa "?" info-bannerissa
- Tarkista etta JS minified on paivitetty
- Varmista etta `index.html` sisaltaa `STATIC_*` data -arrayt

### 4) GitHub Actions ei paivita dataa
- Katso Actions-logit
- Tarkista etta Sheets on paivittynyt
- Tarkista API-avaimet

---

## Yhteenveto tiedostoista

| Tiedosto | Sijainti | Tarkoitus |
|----------|----------|-----------|
| `google-apps-script.js` | Google Sheets (Apps Script) | Hakee datan Eurostatista, paivittaa Sheetin, lahettaa sahkopostin |
| `docs/plans/google-apps-script.js` | GitHub (kopio) | Dokumentaatio, ei kaytossa |
| `update-all-data.js` | GitHub | Hakee datan Google Sheetsista, paivittaa index.html |
| `build.js` | GitHub | Minifioi CSS + JS |
| `.github/workflows/update-yearly-data.yml` | GitHub | GitHub Actions workflow |
| `index.html` | GitHub -> Fly.io | Sivuston paasivu |

---

## Jatkokehitys

Katso: `docs/plans/ROADMAP.md`
