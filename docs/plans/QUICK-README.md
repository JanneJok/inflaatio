# Inflaatio.fi

Lyhyt overview ja pikastart uusille tekij?ille.
Tarkempi dokumentaatio: `docs/plans/README.md`.

---

## Pikastart

### Muokkaat CSS/JS
1. Muokkaa `inflation-site-optimized.css` ja/tai `inflation-site-optimized.js`
2. Aja `npm run release` (build + bump)
3. Commit + push

### Muokkaat data-pipelinea
1. Apps Script el?? Google Sheetsiss? (ei t?ss? repossa)
2. P?ivit? `update-all-data.js` tai `.github/workflows/update-yearly-data.yml`
3. Commit + push

---

## T?rkeimm?t tiedostot
- `index.html` (p??sivu, inline data, lataa minified assetit)
- `inflation-site-optimized.css` / `inflation-site-optimized.js` (l?hteet)
- `inflation-site-optimized.min.css` / `inflation-site-optimized.min.js` (tuotanto)
- `build.js` (minifiointi)
- `update-all-data.js` (data -> index.html)
- `.github/workflows/update-yearly-data.yml` (automaattinen p?ivitt?inen p?ivitys)

---

## Data flow
Eurostat API -> Google Apps Script -> Google Sheets -> GitHub Actions -> index.html -> deploy
