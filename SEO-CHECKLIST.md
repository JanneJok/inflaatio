# SEO-muutosloki ja ohjeistus - Inflaatio.fi

## ✅ Tehdyt tekniset SEO-parannukset (10.10.2025)

### 1. Schema.org -laajennukset
- ✅ **BreadcrumbList** lisätty (index.html riveillä 168-199)
- ✅ **FAQPage** lisätty (index.html riveillä 201-256)
  - 6 kysymystä FAQ-schemaan
  - Kattaa yleisimmät inflaatioon liittyvät kysymykset
- ✅ **Päivitetty WebSite schema**: dateModified → 2025-10-10

### 2. Sisäinen linkitys parannettu
- ✅ **Footer-linkit** laajennettu:
  - Lisätty "Resurssit"-osio (Eurostat, Tilastokeskus, Wikipedia)
  - Kaikki linkit saivat `title`-attribuutit SEO:ta varten
  - Ulkoiset linkit saivat `rel="noopener"` turvallisuussyistä
- ✅ **Breadcrumb-navigaatio** lisätty:
  - HTML-rakenne microdata-markupilla
  - Inline CSS-tyylit critical CSS:ssä
  - Responsiivinen suunnittelu

### 3. Robots.txt -optimointi
- ✅ Poistettu `Disallow: /*.json$` -esto
  - Varmistaa, että JSON-LD structured data ei esty
  - Sallii JSON-tiedostojen indeksoinnin tarvittaessa

### 4. Sitemap.xml päivitetty
- ✅ Kaikki `lastmod`-päivämäärät → 2025-10-10
- ✅ Lisätty terms-of-use.html sitemappiin
- ✅ Kommentoitu FAQ-sisältö #tietoa-osiossa

### 5. Komponentit tuleville blogiartikkeleille
- ✅ **related-articles-component.html** luotu
  - Valmis HTML/CSS-pohja "Lue myös nämä" -osiolle
  - Article Schema.org -markup mukana
  - Responsiivinen 3-palstainen grid
  - Hover-efektit ja kuvien lazy loading

---

## 🚀 SEURAAVAT ASKELEET (Prioriteetti 1 - SISÄLTÖ)

### Kriittisimmät toimenpiteet SEO:n parantamiseksi:

#### 1. Luo 5-10 blogiartikkelia (1500-2500 sanaa/artikkeli)
**Ehdotetut aiheet:**
1. "Mikä on inflaatio ja miten se vaikuttaa säästöihisi?" (perusteet)
2. "Suomen inflaatio 2020-2025: Kattava analyysi" (historiallinen)
3. "Miten inflaatio lasketaan? HICP vs CPI selitettynä" (koulutuksellinen)
4. "10 tapaa suojautua inflaatiolta Suomessa" (käytännöllinen)
5. "Inflaation vaikutus asuntolainoihin - mitä sinun tulee tietää" (niche)
6. "Ruokainflaaatio Suomessa - miksi hinnat nousevat?" (ajankohtainen)
7. "EKP:n korkopäätökset ja Suomen inflaatio" (analyyttinen)
8. "Inflaatio ja osakemarkkinat - historian opetukset" (sijoittaminen)
9. "Kuinka paljon tarvitsen palkankorotusta inflaation vuoksi?" (laskuri)
10. "Suomen inflaatio vs. EU-keskiarvo - vertailuanalyysi" (vertailu)

**Jokainen artikkeli tarvitsee:**
- [ ] Article Schema.org -markup
- [ ] Breadcrumb-navigaatio (Etusivu > Blogi > Artikkeliotsikko)
- [ ] Meta description (max 160 merkkiä)
- [ ] Open Graph & Twitter Card -tagit
- [ ] Alt-tekstit kaikille kuville
- [ ] Sisäiset linkit muihin artikkeleihin/sivuston osioihin
- [ ] "Lue myös nämä" -osio (related-articles-component.html)
- [ ] Canonical URL

#### 2. Luo erillinen FAQ-sivu
**Tiedosto:** `/faq.html`

**Sisältö (15-20 kysymystä):**
- Mikä on inflaatio?
- Mitä eroa on HICP ja CPI välillä?
- Miten inflaatio vaikuttaa ostovoimaan?
- Onko inflaatio aina huono asia?
- Miten voin suojata rahani inflaatiolta?
- Mikä on deflaatio?
- Mitä tarkoittaa hyperinflaatio?
- Mikä on EKP:n inflaatiotavoite?
- Miten korot vaikuttavat inflaatioon?
- Miksi ruoan hinta nousee?
- ...jne.

**FAQ-sivulle tarvitaan:**
- [ ] FAQPage Schema.org (laajempi kuin index.html:ssä)
- [ ] Visuaalinen collapse/expand -toiminnallisuus
- [ ] Sisäinen linkitys relevantteihin blogiartikkeleihin
- [ ] Breadcrumb: Etusivu > FAQ

#### 3. Inflaatiolaskuri-työkalu
**Tiedosto:** `/laskuri.html` tai `/laskuri/`

**Ominaisuudet:**
- Laske rahan ostovoiman muutos ajan myötä
- "Jos ostit tuotteen X€ vuonna 2020, se maksaa nyt Y€"
- Interaktiivinen työkalu → lisää sivustolla vietettyä aikaa
- Jaettava sosiaalisen median kautta
- **SoftwareApplication Schema.org**

#### 4. Rakenna monisivuinen rakenne

**Ehdotettu sivustorakenne:**
```
inflaatio.fi/
├── index.html (etusivu)
├── blogi/ (blogiartikkelit)
│   ├── index.html (blogin etusivu)
│   ├── mika-on-inflaatio/
│   ├── hicp-vs-cpi/
│   ├── suojautuminen-inflaatiolta/
│   └── ...
├── faq.html
├── laskuri.html
├── vertailu/ (tulevaisuudessa: EU-maiden vertailu)
├── tilastot/ (tulevaisuudessa: syväluotaava data-analyysi)
└── terms-of-use.html
```

---

## 📋 TEKNINEN SEO CHECKLIST (jatkuva ylläpito)

### Kuukausittain:
- [ ] Päivitä sitemap.xml `lastmod`-päivämäärät
- [ ] Päivitä index.html:n dateModified
- [ ] Tarkista rikkinäiset linkit
- [ ] Tarkista Google Search Console -virheet
- [ ] Päivitä inflaatioluvut (jos muuttuvat)

### Jokainen uusi sivu/artikkeli:
- [ ] Lisää sitemap.xml:ään
- [ ] Varmista canonical URL
- [ ] Lisää breadcrumb-navigaatio
- [ ] Schema.org -markup (Article/WebPage)
- [ ] Meta description + title
- [ ] Internal linking (vähintään 3-5 sisäistä linkkiä)
- [ ] Alt-tekstit kuville
- [ ] Responsiivinen suunnittelu testattu

### Kvartaaleittain:
- [ ] Google PageSpeed Insights -testaus
- [ ] Core Web Vitals -tarkistus
- [ ] Backlink-analyysi (Ahrefs/SEMrush)
- [ ] Kilpailija-analyysi
- [ ] Keyword ranking -seuranta

---

## 🔗 BACKLINK-STRATEGIA

### Tavoite: 20+ laadukasta backlinkkiä 6 kuukaudessa

**Toimenpiteet:**
1. **PR ja media:**
   - Ota yhteyttä talousjournalisteihin (Helsingin Sanomat, Kauppalehti, Talouselämä)
   - Tarjoa inflaatioanalyysejä median käyttöön
   - Kommentoi ajankohtaisia talousuutisia

2. **Yhteistyökumppanit:**
   - Suomen Pankki (linkki resursseihin)
   - Yliopistot (taloustieteen laitokset)
   - Kuluttajaliitto
   - Talousblogi-yhteistyöt

3. **Sisältömarkkinointi:**
   - Kirjoita vierasartikkeleita talousaiheisille blogeille
   - Luo jaettavia infograafeja (Pinterest, LinkedIn)
   - Osallistu Reddit/Suomi24 -keskusteluihin (ei-spämminä)

4. **Listautumiset:**
   - Talousaiheisten sivustojen hakemistot
   - Suomi24 Linkit -osio
   - Wikipedia-lähteet (jos mahdollista)

---

## 🛠 TYÖKALUT JA RESURSSIT

### SEO-työkalut:
- **Google Search Console** (pakollinen!)
- **Google Analytics 4** (jo käytössä)
- **Bing Webmaster Tools**
- **Ahrefs/SEMrush** (backlink-analyysi)
- **Screaming Frog** (tekninen audit)

### Schema.org -validointi:
- [Google Rich Results Test](https://search.google.com/test/rich-results)
- [Schema.org Validator](https://validator.schema.org/)

### Sisällöntuotanto:
- **Keyword research:** Google Keyword Planner, Ubersuggest
- **Kilpailija-analyysi:** Ahrefs, SEMrush
- **Sisällön pituus:** Surfer SEO, Clearscope

---

## 📊 ODOTETUT TULOKSET

### 3 kuukauden päästä (jos sisältöä julkaistaan säännöllisesti):
- 10-15 blogiartikkelia julkaistu
- Google aloittaa indeksoinnin laajemmalle
- Orgaaninen liikenne +50-100%
- Pitkähäntäiset avainsanat alkavat rankkaantua

### 6 kuukauden päästä:
- 20+ blogiartikkelia
- 10-20 laadukasta backlinkkiä
- Orgaaninen liikenne +200-300%
- Kilpailukykyiset avainsanat (esim. "inflaatio suomessa") sijoittuvat top 20:een

### 12 kuukauden päästä:
- Domain Authority (DA) 20-30
- Orgaaninen liikenne 1000-2000 käyntijää/kk
- Useat avainsanat top 5:ssä
- Vakiintunut asema Suomen inflaatio-aiheisten sivustojen joukossa

---

## ❓ KYSYMYKSIÄ / MUISTIINPANOJA

- Harkitse WordPress/Ghost CMS:n käyttöä blogisisällölle (helpottaa julkaisua)
- Voisiko automatisoida sitemap.xml:n päivityksen?
- Kannattaako investoida maksulliseen SEO-työkaluun?
- Milloin aloitetaan sosiaalisen median markkinointi (LinkedIn, Twitter)?

---

**Viimeksi päivitetty:** 10.10.2025
**Seuraava päivitys:** Kun ensimmäiset blogiartikkelit julkaistaan
