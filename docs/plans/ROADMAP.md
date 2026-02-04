# Inflaatio.fi - Roadmap & Kehityssuunnitelma

## Tavoite
Kasvattaa sivuston uniikkien kävijöiden määrä 50 000:een kuukaudessa mainosverkostoihin liittymiseksi.


## Vaihe 2: Blogi-osio
**Prioriteetti:** Kriittinen (suurin kasvuvaikutus)
**Status:** Ei aloitettu

### Tekniset tiedostot
- [ ] `blog.html` - Blogin etusivu (artikkelilista)
- [ ] `blog/[artikkeli].html` - Yksittäiset artikkelit
- [ ] Navigaation päivitys
- [ ] Sitemap.xml päivitys
- [ ] Blog JSON-LD schema

### 10 Blogiartikkelin aihetta

| # | Aihe | Hakupotentiaali |
|---|------|-----------------|
| 1 | Miten inflaatio vaikuttaa asuntolainaan? | Korkea |
| 2 | Inflaatio vs deflaatio - mitä eroa ja kumpi on pahempi? | Keskikorkea |
| 3 | Miten suojautua inflaatiolta? 5 konkreettista keinoa | Korkea |
| 4 | Vuokran korotus inflaation mukaan - mitä laki sanoo? | Korkea |
| 5 | Palkankorotus vs inflaatio - pysyykö ostovoimasi? | Keskikorkea |
| 6 | Miksi ruoan hinta nousee? Inflaation anatomia | Keskikorkea |
| 7 | EKP:n korot ja inflaatio - miten ne liittyvät toisiinsa? | Keskikorkea |
| 8 | Säästöjen arvo inflaatiossa - näin lasket todellisen tuoton | Korkea |
| 9 | Suomen inflaatiohistoria: Pahimmat kriisit 1990-2025 | Keskikorkea |
| 10 | HICP vs CPI - miksi eri lähteet näyttävät eri lukuja? | Matala (niche) |

---

## Vaihe 3: Inflaatiolaskuri
**Prioriteetti:** Korkea (käyttäjäsitouttavuus)
**Status:** Ei aloitettu

### Toiminnallisuus
- Käyttäjä syöttää summan (esim. 1000€)
- Valitsee alkuvuoden (esim. 2000)
- Valitsee loppuvuoden (esim. 2024)
- Valitsee datalähteen (HICP / CPI)
- Laskuri näyttää inflaatiokorjatun arvon

### Esimerkki
> "1000€ vuonna 2000 vastaa noin 1450€ vuonna 2024 (HICP)"

### Toteutus
- [ ] UI-komponentti (lisäys index.html:ään tai erillinen `laskuri.html`)
- [ ] JavaScript-funktio käyttäen STATIC_INFLATION_DATA + STATIC_CPI_DATA
- [ ] Responsive design

---

## PxWeb API -esimerkki

**POST-pyyntö vuosimuutokselle:**
```json
{
  "query": [
    {
      "code": "Kuukausi",
      "selection": {
        "filter": "all",
        "values": ["*"]
      }
    }
  ],
  "response": {
    "format": "json-stat2"
  }
}
```

**Endpoint:** `https://pxdata.stat.fi/PxWeb/api/v1/fi/StatFin/khi/statfin_khi_pxt_122p.px`

---

## Kriittiset tiedostot

| Tiedosto | Kuvaus |
|----------|--------|
| `update-all-data.js` | Nykyinen datapäivitysskripti |
| `index.html` | Pääsivu |
| `inflation-site-optimized.js` | Kaavioiden JavaScript |

---

## Mainosverkostojen vaatimukset

| Verkosto | Vaatimus | Status |
|----------|----------|--------|
| Google AdSense | Ei tiukkaa minimiä | Voi hakea nyt |
| Ezoic | 10 000 sivulatausta/kk | Välitavoite |
| Mediavine | 50 000 istuntoa/kk | Päätavoite |
| AdThrive | 100 000 sivulatausta/kk | Pitkän ajan tavoite |

---

## Dokumentaatio

Katso: [README.md](README.md) - Täydellinen dokumentaatio projektin rakenteesta, Google Apps Scriptistä ja GitHub Actionsista.

---

## Lähteet

- [Tilastokeskus PxWeb](https://pxdata.stat.fi/PXWeb/pxweb/fi/StatFin/StatFin__khi/?tablelist=true)
- [Kuluttajahintaindeksin vuosimuutos](https://pxdata.stat.fi/PxWeb/pxweb/fi/StatFin/StatFin__khi/statfin_khi_pxt_122p.px/)
