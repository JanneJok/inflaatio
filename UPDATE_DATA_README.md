# Vuosittaisen inflaatiodatan päivitysscripti

Tämä scripti hakee automaattisesti datan Google Sheetsistä ja päivittää `index.html` tiedoston staattisen vuosittaisen inflaatiotaulukon.

## Miten toimii

1. **Hakee datan** Google Sheets API:sta (sama Sheet jota käytät nyt)
2. **Laskee vuosikeskiarvot** jokaiselle vuodelle (2000-2025)
3. **Vertaa** nykyistä HTML:ää uuteen dataan
4. **Päivittää HTML:n** VAIN jos data on muuttunut
5. **Säilyttää layoutin** täysin samana (staattinen SEO-ystävällinen)

## Asennus

### 1. Google Sheets API Key

Tarvitset Google Sheets API avaimen. Jos sinulla ei ole vielä:

1. Mene osoitteeseen: https://console.cloud.google.com/
2. Luo uusi projekti (tai käytä olemassa olevaa)
3. Aktivoi "Google Sheets API"
4. Luo API Key (Credentials → Create Credentials → API Key)
5. Kopioi API key

### 2. Päivitä scripti

Avaa `update-yearly-data.js` ja korvaa:

```javascript
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=AIzaSyD_your_api_key_here`;
```

Korvauksella (käytä omaa API keyä):

```javascript
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=YOUR_ACTUAL_API_KEY`;
```

**TÄRKEÄ:** Älä commitoi API keyä GitHubiin! Lisää se `.gitignore`:en tai käytä environment variablea.

### 3. Vaihtoehto: Environment Variable (Suositus)

Turvallisempi tapa on käyttää environment variablea:

**Windowsilla:**
```bash
set GOOGLE_SHEETS_API_KEY=your_api_key_here
node update-yearly-data.js
```

**Linux/Mac:**
```bash
export GOOGLE_SHEETS_API_KEY=your_api_key_here
node update-yearly-data.js
```

Ja muuta scriptissä:
```javascript
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'your_fallback_key';
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
```

## Käyttö

### Manuaalinen ajo

Aja scripti projektin juurihakemistossa:

```bash
node update-yearly-data.js
```

Scripti:
- ✓ Hakee datan Sheetsistä
- ✓ Laskee vuosikeskiarvot
- ✓ Tarkistaa onko muutoksia
- ✓ Päivittää HTML:n jos tarpeen
- ✓ Kertoo jos muutoksia tehty

### Automaattinen ajo (GitHub Actions)

Voit automatisoida scriptin ajamisen GitHub Actionsilla. Luo tiedosto `.github/workflows/update-data.yml`:

```yaml
name: Update Inflation Data

on:
  schedule:
    # Aja joka kuukauden 1. päivä klo 06:00 UTC
    - cron: '0 6 1 * *'
  workflow_dispatch: # Mahdollistaa manuaalisen ajon

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Update data from Google Sheets
        env:
          GOOGLE_SHEETS_API_KEY: ${{ secrets.GOOGLE_SHEETS_API_KEY }}
        run: node update-yearly-data.js

      - name: Commit changes
        run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add index.html
          git diff --quiet && git diff --staged --quiet || git commit -m "Update yearly inflation data from Google Sheets"
          git push
```

**Lisää API Key GitHub Secretsiin:**
1. GitHub repo → Settings → Secrets and variables → Actions
2. New repository secret
3. Name: `GOOGLE_SHEETS_API_KEY`
4. Value: Sinun API keysi

Nyt scripti ajautuu automaattisesti joka kuukauden alussa!

## Mitä scripti päivittää

Scripti päivittää seuraavat asiat `index.html` tiedostossa:

- Vuosittaiset inflaatioprosentit (2000-2025)
- Nuolet (↑/↓) perustuen arvon positiivisuuteen
- "Kuluva vuosi" badge kuluvalle vuodelle
- Jaon näkyviin ja piilotettuihin vuosiin

**Scripti EI koske:**
- CSS-tyyleihin
- JavaScriptiin
- Muuhun HTML-sisältöön

## Testaus

Testaa scripti ensin lokaalisti:

```bash
node update-yearly-data.js
```

Tarkista `index.html` että muutokset näyttävät oikeilta:

```bash
python -m http.server 8000
# Avaa http://localhost:8000
```

## Vianmääritys

### "Could not find compact-table-grid"
- HTML:n rakenne on muuttunut
- Tarkista että `<div class="compact-table-grid">` löytyy HTML:stä

### API virhe
- Tarkista että API key on oikein
- Tarkista että Google Sheets API on aktivoitu

### Ei muutoksia vaikka Sheet päivittyi
- Tarkista että Sheet ID on oikein
- Tarkista että dataparseri tunnistaa päivämäärät oikein (format M/YYYY)

## Huomioita

- Scripti säilyttää HTML:n rakenteen täysin samana
- SEO säilyy täydellisesti (staattinen HTML)
- Suorita scripti aina kun Sheettiin tulee uutta dataa
- Commitoi ja pushaa muutokset GitHubiin päivityksen jälkeen
