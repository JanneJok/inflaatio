# Inflaatio.fi - Dokumentaatio

## Projektin rakenne

### Datan päivitys - kaksi erillistä järjestelmää

Projektissa on **KAKSI** erillistä järjestelmää datan päivitykseen:

```
┌─────────────────────────────────────────────────────────────┐
│                    GOOGLE SHEETS                            │
│  (Google Apps Script - google-apps-script.js)               │
│                                                             │
│  1. Hakee datan Eurostatista API:n kautta                  │
│  2. Päivittää Google Sheetin                                │
│  3. Lähettää sähköpostin jos data muuttui                   │
│                                                             │
│  Triggeröidään: Päivittäin klo 07:00                        │
│  Sijainti: Google Sheets → Extensions → Apps Script         │
│  Tiedosto: docs/plans/google-apps-script.js (kopio)        │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    (Päivittää Sheetin)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 GITHUB ACTIONS WORKFLOW                     │
│  (.github/workflows/update-yearly-data.yml)                 │
│                                                             │
│  1. Triggeröidään päivittäin klo 07:00 UTC                  │
│  2. Ajaa update-all-data.js -skriptin                       │
│  3. Skripti hakee datan Google Sheetsistä                   │
│  4. Päivittää index.html:n                                  │
│  5. Committaa muutokset GitHubiin                           │
│                                                             │
│  Tiedostot:                                                 │
│  - .github/workflows/update-yearly-data.yml                 │
│  - update-all-data.js                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Google Apps Script (Googlen puolella)

### Sijainti
**TÄRKEÄ:** Tämä koodi EI ole tässä GitHub-repositoriossa vaan **Google Sheetsissä**.

- Avaa Google Sheets: [Inflaatio-data](https://docs.google.com/spreadsheets/d/1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8/)
- Mene: **Extensions → Apps Script**
- Siellä on `tarkistaJaPaivitaInflaatio()` -funktio

### Mitä se tekee

1. **Hakee datan Eurostatista** (HICP-indeksi)
2. **Vertaa** uusinta dataa Google Sheetin viimeiseen riviin:
   - Onko kuukausi muuttunut? TAI
   - Onko inflaatioarvo muuttunut?
3. **Päivittää Google Sheetin** jos muutoksia
4. **Lähettää sähköpostin** osoitteeseen `janne.jokela@live.fi`

### Triggeröinti

Google Sheetsissä on ajastettu trigger:
- **Päivittäin klo 07:00** (Suomen aikaa)
- Asetettu: Apps Script → Triggers

### Koodi

Katso: [google-apps-script.js](google-apps-script.js)

---

## 2. GitHub Actions (GitHubin puolella)

### Sijainti
`.github/workflows/update-yearly-data.yml`

### Mitä se tekee

1. Triggeröidään päivittäin klo 07:00 UTC
2. Ajaa `update-all-data.js` Node.js-skriptin
3. Skripti:
   - Hakee datan **Google Sheetistä** (ei Eurostatista)
   - Päivittää `index.html`:n (vuositaulukko, kaaviot, metriikat)
   - Minifioi JavaScriptin
4. Committaa muutokset GitHubiin

### Koodi

- Workflow: `.github/workflows/update-yearly-data.yml`
- Päivitysskripti: `update-all-data.js`

---

## Tiedonkulku

```
Eurostat API
     ↓
Google Apps Script (Googlen palvelimilla)
     ↓
Google Sheets päivittyy
     ↓  (sähköposti lähetetään)
     ↓
GitHub Actions (GitHubin palvelimilla)
     ↓
Hakee datan Google Sheetsistä
     ↓
Päivittää index.html
     ↓
Committaa GitHubiin
     ↓
Fly.io deployment (automaattinen)
     ↓
Inflaatio.fi sivusto päivittyy
```

---

## Sähköposti-ilmoitukset

### Milloin lähetetään?

Sähköposti lähetetään **vain jos**:
- Uusi kuukausi on saatavilla TAI
- Inflaatioarvo on muuttunut samalle kuukaudelle

### Vastaanottaja
`janne.jokela@live.fi`

### Viestin sisältö
```
Aihe: Inflaatiodata päivitetty (2025-12)

Hei!

Eurostatin inflaatiodata on päivittynyt kuukaudelle 2025-12.
Uusin inflaatioarvo: 1.7 %

Tiedot on nyt päivitetty Google Sheetiin.

Terveisin,
Inflaatio-botti
```

---

## Muokkausohjeet

### Google Apps Script -koodin muokkaus

1. Avaa [Google Sheets](https://docs.google.com/spreadsheets/d/1tj7AbW3BkzmPZUd_pfrXmaHZrgpKgYwNljSoVoAObx8/)
2. Extensions → Apps Script
3. Muokkaa koodia
4. Tallenna (Ctrl+S)
5. Tarvittaessa testaa: Run → tarkistaJaPaivitaInflaatio

**HUOM:** Päivitä myös kopio tähän repositorioon: `docs/plans/google-apps-script.js`

### GitHub Actions -koodin muokkaus

1. Muokkaa `.github/workflows/update-yearly-data.yml` tai `update-all-data.js`
2. Committaa GitHubiin
3. Workflow ajautuu automaattisesti seuraavalla triggerillä

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

## Vianmääritys

### Sähköposti ei tule

1. Tarkista Google Apps Script -loki:
   - Apps Script → Executions
2. Tarkista trigger:
   - Apps Script → Triggers
3. Tarkista Gmail-kansiot (Spam, All Mail)

### GitHub Actions ei päivitä

1. Tarkista GitHub Actions -loki:
   - GitHub → Actions → Latest workflow run
2. Tarkista onko Google Sheets päivittynyt
3. Tarkista API-avain: `update-all-data.js`

### Data ei päivity Googlessa

1. Tarkista Eurostat API:
   - Avaa URL suoraan selaimessa
2. Tarkista Google Apps Script -oikeudet:
   - Apps Script → Services → Advanced Google services
3. Tarkista loki: Apps Script → Executions

---

## Yhteenveto tiedostoista

| Tiedosto | Sijainti | Tarkoitus |
|----------|----------|-----------|
| `google-apps-script.js` | **Google Sheets** (Apps Script) | Hakee datan Eurostatista, päivittää Sheetin, lähettää sähköpostin |
| `docs/plans/google-apps-script.js` | GitHub (kopio) | Dokumentaatio, ei käytössä |
| `update-all-data.js` | GitHub | Hakee datan Google Sheetsistä, päivittää index.html |
| `.github/workflows/update-yearly-data.yml` | GitHub | GitHub Actions workflow |
| `index.html` | GitHub → Fly.io | Sivuston pääsivu |

---

## Jatkokehitys

Katso: [ROADMAP.md](ROADMAP.md)
