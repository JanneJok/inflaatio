# Inflaatio.fi

Suomen viralliset inflaatioluvut yhdessä paikassa: Tilastokeskuksen
kuluttajahintaindeksi (KHI) ja Eurostatin yhdenmukaistettu
kuluttajahintaindeksi (YKHI), kuvaajina, taulukkoina ja laskureina.
Sivusto on staattinen: luvut haetaan virallisista rajapinnoista, ja oma
build-skripti kirjoittaa ne valmiiksi HTML:ään. Tuotannossa sivut palvelee
nginx Fly.io:ssa.

## Vaatimukset

- Node.js 24 tai uudempi, npm

## Käyttö

```sh
npm ci            # asenna riippuvuudet (package-lock.json)
npm run fetch     # hae data/*.json Tilastokeskukselta, Eurostatista ja EKP:ltä
npm run dev       # rakenna (ei minifiointia) ja palvele http://127.0.0.1:8080/, rakentaa muutoksista uudelleen
npm run check     # lint + testit + tuotantobuild + linkkien tarkistus
```

Muut komennot:

| Komento | Tekee |
|---|---|
| `npm run build` | tuotantobuild hakemistoon `dist/` |
| `npm run serve` | palvelee `dist/`:n kuten nginx (samat tietoturvaotsakkeet, välimuisti ja uudelleenohjaukset) |
| `npm test` | `node --test` (test/**/*.test.js) |
| `npm run lint` | ESLint |
| `npm run check-links` | tarkistaa `dist/`:n sisäiset linkit ja ankkurit |
| `node scripts/build.js --out .tmp/x --only tyylit` | rakentaa vain valitut sivumoduulit omaan hakemistoonsa |
| `node scripts/serve.js --dir .tmp/x --port 8091` | palvelee valittua hakemistoa |

Sisäinen tyyliopas (kaikki komponentit vaaleana ja tummana) on osoitteessa
`/tyylit/` (ei hakukoneissa).

## Rakenne

- `src/pages/*.js` – sivumoduulit (yksi moduuli omistaa omat reittinsä)
- `src/templates/` – sivupohja (`layout.js`) ja komponentit (`components.js`)
- `src/css/` – design-tokenit, perustyylit, komponentit ja sivukohtaiset tyylit
- `src/js/` – selaimen JavaScript (`site.js` kaikille sivuille, `pages/*.js` sivukohtaiset)
- `src/static/` – kopioidaan sellaisenaan (faviconit, manifest, robots.txt, vanhan service workerin poistaja)
- `scripts/` – build, paikallinen palvelin, linkkitarkistus ja datan haku
- `deploy/` – nginx-asetukset ja tietoturvaotsakkeet (CSP:n ainoa lähde)
- `data/` – haettu data (vain `npm run fetch` kirjoittaa)
- `Dockerfile`, `.dockerignore`, `fly.toml` – tuotannon image ja Fly.io-asetukset
- `.github/workflows/` – CI, datapäivitys, julkaisu ja tuotannon tarkistus; `.github/dependabot.yml`

## Julkaisu ja ylläpito

Tuotanto: **Fly.io** (sovellus `inflaatio`, Tukholma) → nginx Docker-imagessa
palvelee buildin `dist/`-kansion; edessä **Cloudflare** (DNS, CDN, TLS).
Kaikki tapahtuu GitHub Actionsissa:

| Työnkulku | Milloin | Mitä tekee |
|---|---|---|
| `ci.yml` | jokainen PR ja push mainiin | lint, testit, build, linkit, Docker-image ja sen savutesti |
| `update-data.yml` | kahdesti päivässä + käsin | hakee datan, tarkistaa sen, commitoi `data: …` mainiin ja julkaisee Fly.io:hon; epäonnistuu (ja ilmoittaa), jos jokin lähde epäonnistui |
| `deploy.yml` | push mainiin (sivustoon vaikuttavat tiedostot) + käsin | testit ja build → `flyctl deploy --remote-only` → savutesti |
| `site-check.yml` | 6 tunnin välein + käsin | tarkistaa https://inflaatio.fi:n ja avaa `site-check`-issuen, jos jokin on vialla |

Docker-image rakennetaan repoon commitoidusta datasta (ei verkkohakuja), ja
nginx ajetaan ilman root-oikeuksia. Kokeile paikallisesti (Docker Desktop):

```sh
docker build -t inflaatio-local .
docker run --rm -d -p 8108:8080 --name inflaatio-local inflaatio-local   # http://localhost:8108/
SMOKE_URL=http://127.0.0.1:8108 node --test --test-name-pattern='^smoke' test/ops.test.js
docker stop inflaatio-local
```

Käsin: `gh workflow run update-data.yml`, `gh workflow run deploy.yml` tai
`fly deploy --remote-only`. Siirto GitHub Pagesista Fly.io:hon, paluusuunnitelma,
ylläpitäjän tilitehtävät (avainten kierrätys, Cloudflare, GA4, Supabase,
EmailJS, GitHubin asetukset) ja vianetsintä: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Dokumentaatio

- `docs/ARCHITECTURE.md` – arkkitehtuuri, build-sopimus ja komponentit
- `docs/DATA.md` – datalähteet, tiedostomuodot ja laskentasäännöt
- `docs/OPERATIONS.md` – julkaisu, ajastetut ajot ja ylläpitäjän tehtävät
- `CONTRIBUTING.md` – kehitysohjeet ja säännöt (CSP, saavutettavuus, tekstit)
