# Hakukoneoptimointi – Inflaatio.fi

Päivitetty 9/2026, kun sivusto oli uudistettu (v2). Kehityssuunnitelma ja
jäljellä olevat sisältöideat: [`ROADMAP.md`](ROADMAP.md). Tekninen toteutus:
[`ARCHITECTURE.md`](ARCHITECTURE.md).

Tämä korvaa vanhan tarkistuslistan (10.10.2025). Sen kohdista on luovuttu
näistä syistä:

- **FAQPage-skeema:** Google lopetti FAQ-rikkaat tulokset, joten skeema on
  poistettu. UKK näkyy etusivulla tavallisena sisältönä.
- **Microdata-murupolku ja inline-CSS:** tilalla on näkyvä murupolku ja
  BreadcrumbList-JSON-LD. Tiukka CSP ei salli inline-tyylejä.
- **`related-articles-component.html`:** poistettu. Sivujen lopussa on
  datasta koottuja linkkikortteja.
- **Sivukartan ja `dateModified`-päivämäärien käsin päivitys:** build tekee
  sen nyt joka päivityksellä.
- **Linkit Wikipediaan "resursseina":** Wikipedia ei ole virallinen lähde.
  Lähteet ovat Tilastokeskus, Eurostat ja EKP.
- **WordPress tai Ghost blogille:** sivut generoidaan datasta omalla
  buildilla. Mahdolliset artikkelit tehdään samaan repoon (ks. ROADMAP).

## Toteutettu v2-uudistuksessa

### Rakenne ja sisältö

- [x] Monisivuinen rakenne. URL-osoitteet ovat suomeksi ja päättyvät
  kauttaviivaan: laskurit, historia, hinnat, vertailu, korot, avoin data ja
  tietoa-sivut. Vanhan listan suunnitelmat (`/blogi/`, `/faq.html`,
  `/laskuri.html`) korvattiin näillä.
- [x] Laskeutumissivut pitkän hännän hakuihin: vuodet 1980 alkaen
  (`/inflaatio/2022/`), kuukaudet 1/2015 alkaen (`/inflaatio/2026/elokuu/`),
  kuukausikatsaukset 1/2024 alkaen (`/katsaus/2026-08/`) sekä noin 60
  hyödykesivua (`/hinnat/<hyödyke>/`).
- [x] Laskurit omina sivuinaan: vuokrankorotus, rahan arvo, oma inflaatio
  ja ostovoima. Englanniksi `/en/` ja kaksi laskuria.
- [x] Sisäinen linkitys: päänavigaatio, alatunnisteen linkkisarakkeet,
  murupolku alasivuilla, edellinen/seuraava-linkit vuosi-, kuukausi- ja
  katsaussivuilla sekä linkkikortit laskureihin ja datasivuille.
- [x] Jokaisella luvulla on kuukausi ja lähde, ja luvut tulevat datasta.
  Otsikoissa ja kuvauksissa ei ole vanhentuneita vuosilukuja, eikä sanaa
  "reaaliaikainen" käytetä.

### Tekninen

- [x] `<title>` enintään 60 ja meta description enintään 155 merkkiä.
  Molemmat muodostetaan datasta, ja build varoittaa liian pitkistä
  (`--strict` tekee varoituksista virheitä).
- [x] Canonical jokaisella indeksoitavalla sivulla. `noindex`-sivuilla
  (`/tyylit/`, `/404.html`, `/upotus/`) sitä ei ole, eivätkä ne ole
  sivukartassa.
- [x] hreflang-parit (fi, en, x-default), kun sivulla on englanninkielinen
  vastine. `<html lang>` on oikein jokaisella sivulla.
- [x] Open Graph ja Twitter Card absoluuttisilla osoitteilla. Jakokuva
  `/og/inflaatio.png` (1200 × 630 PNG, leveys, korkeus ja alt-teksti)
  generoidaan jokaisessa buildissa uusimmasta luvusta.
- [x] JSON-LD: Organization, WebSite ja WebPage; Dataset ja DataCatalog
  datasivuilla (`/data/`, pisteluvut, historia, hinnat); Article
  katsauksissa; CollectionPage ja ItemList listasivuilla; WebApplication
  laskureissa; TechArticle menetelmissä. BreadcrumbList lisätään
  automaattisesti.
- [x] `sitemap.xml` generoidaan buildissa. Mukana ovat vain indeksoitavat
  sivut ilman fragmentteja, ja `lastmod` tulee datasta.
  `scripts/check-links.js` tarkistaa, että jokainen osoite on olemassa.
- [x] `robots.txt`: hakukoneet ja hakuvastauspalvelut on sallittu,
  tekoälyn koulutusaineistoa keräävät botit estetty; `Sitemap`-rivi.
- [x] RSS-syöte `/feed.xml`, ja jokaisen sivun `<head>`issä on
  syötelinkki (autodiscovery).
- [x] Oikeat HTTP-vastaukset (nginx ja `scripts/serve.js`):
  - suomenkielinen 404-sivu statuksella 404
  - `410 Gone` vanhan sivuston vahingossa julkisille tiedostoille
  - 301-uudelleenohjaukset vanhoista osoitteista (`/index.html`,
    `/terms-of-use.html`, `/image/*`)
  - kauttaviivan lisäys hakemisto-osoitteisiin, `www` → `inflaatio.fi`
    ja http → https
- [x] Suorituskyky: luvut ja SVG-kaaviot ovat valmiina HTML:ssä, fontti on
  itse isännöity, CSS on yksi tiedosto, tiedostonimissä on sisältötiiviste
  (pitkä välimuisti), Chart.js ladataan vasta tarvittaessa ja pakkauksena
  on gzip.
- [x] Saavutettavuus (WCAG 2.2 AA) tukee myös hakua: semanttiset taulukot,
  kaavioiden tekstivastineet, maamerkit ja ohituslinkki.
- [x] Faviconit, `site.webmanifest` ja apple-touch-icon.
- [x] Avoin data (`/data/`): CSV- ja JSON-tiedostot ja lainausohje
  toimittajille ja opiskelijoille.

### Automaattiset tarkistukset

- `npm run check` (CI jokaisessa PR:ssä): sisäiset linkit, ankkurit ja
  sivukartta; CSP; päällekkäiset polut. `test/build.test.js` tarkistaa
  headin ja maamerkit.
- `site-check.yml` (6 tunnin välein) tarkistaa tuotannosta otsakkeet,
  `robots.txt`:n, `sitemap.xml`:n, 404:n, uudelleenohjaukset ja sen, että
  uusin KHI-kuukausi näkyy sivulla.
- Datapäivitys (kahdesti päivässä) rakentaa sivut uudelleen. Otsikot,
  kuvaukset, JSON-LD, sivukartan `lastmod` ja jakokuva päivittyvät
  itsestään.

## Ylläpitäjän kertaluonteiset tehtävät

Nämä vaativat ylläpitäjän omat tunnukset (ks. myös `OPERATIONS.md`, vaihe 4).

- [ ] **Google Search Console:** lisää sivukartta
  `https://inflaatio.fi/sitemap.xml`. Pyydä vanhojen roskasivujen poistoa
  (Removals: `/docs/plans/`, `/SEO-CHECKLIST.html`,
  `/related-articles-component.html` …). Ne vastaavat nyt `410 Gone`.
- [ ] **Search Console, siirron jälkeen:** tarkista Page indexing -raportista
  uudelleenohjaukset ja 404-virheet ja Core Web Vitals -raportista mobiili.
- [ ] **Bing Webmaster Tools:** lisää sivusto ja sivukartta (asetukset voi
  tuoda Search Consolesta).
- [ ] **Rich Results Test** ja **Schema Markup Validator** muutamalle
  sivulle: etusivu, `/data/`, yksi katsaus ja yksi laskuri.

## Jatkuva ylläpito

### Kuukausittain

- [ ] Search Console: indeksointivirheet, Core Web Vitals ja
  suosituimmat hakusanat. Hakusanoista saa aiheita artikkeleille ja
  hyödykesivuille.
- [ ] Valinnainen ylläpitäjän kommentti uuteen kuukausikatsaukseen
  (`src/content/katsauskommentit.json`).

### Jokainen uusi sivu

- [ ] Reitti on `src/site.config.js`:n `PAGES`-rekisterissä (murupolku) ja
  tarvittaessa navigaatiossa tai alatunnisteessa.
- [ ] Otsikko ja kuvaus ovat yksilöllisiä ja mahtuvat rajoihin. Jos niissä
  on lukuja, mukana ovat kuukausi ja lähde.
- [ ] Canonical tulee automaattisesti. Sivu, jota ei indeksoida:
  `noindex` ja `sitemap: false`.
- [ ] Sopiva JSON-LD (WebPage, Article tai Dataset), ei FAQPage-skeemaa.
- [ ] Sisäiset linkit: vähintään yhdeltä koontisivulta sivulle ja sivulta
  aiheeseen liittyvään laskuriin tai datasivulle.
- [ ] Kaavioilla on tekstivastine (tiivistelmä ja taulukko) ja kuvilla alt-teksti.
- [ ] `npm run check` menee läpi (linkit, ankkurit, sivukartta).

### Neljännesvuosittain

- [ ] PageSpeed Insights tai Lighthouse mobiililla: etusivu, yksi laskuri
  ja yksi vuosisivu.
- [ ] Hakusijoitukset Search Consolessa, esim. "inflaatio", "inflaatio
  2026", "vuokrankorotus laskuri", "elinkustannusindeksi", "rahan arvo
  laskuri".
- [ ] Saapuvat linkit (Search Console → Links).

## Näkyvyys ja saapuvat linkit

- **Upotettava inflaatiokortti** (`/upotus/ohje/`): tarjoa sitä
  isännöitsijöille, vuokranantaja- ja vuokralaisyhdistyksille ja
  talousbloggaajille. Jokainen upotus linkittää sivustolle.
- **Avoin data ja lainausohje** (`/data/`): toimittajat, opiskelijat ja
  opettajat.
- **Media:** kuukausikatsaus ilmestyy julkaisupäivänä, ja siihen voi
  viitata. Talousjournalisteille voi kertoa laskureista (vuokrankorotus,
  rahan arvo).
- **Yhteistyö:** kuluttaja- ja asumisjärjestöt ja taloustieteen opetus.
- **Keskustelut:** vastaa asiallisesti ja linkitä vain, kun sivu vastaa
  kysymykseen. Ei roskapostia.

## Jäljellä olevat hakukoneideat

- Työkaluja tukevat yleisartikkelit (lista: [`ROADMAP.md`](ROADMAP.md)).
- Oma jakokuva kuukausikatsauksille ja vuosisivuille.
- IndexNow-ilmoitus Bingille datapäivityksen jälkeen (valinnainen).
- Laajempi englanninkielinen osio (vuosisivut, hinnat).
