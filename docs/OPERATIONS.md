# Ylläpito ja julkaisu

Tämä dokumentti kertoo, miten Inflaatio.fi julkaistaan, miten data päivittyy
ja mitä ylläpitäjän pitää tehdä omilla tunnuksillaan (Fly.io, Cloudflare,
GitHub, Google, Supabase, EmailJS). Muut dokumentit:
[`ARCHITECTURE.md`](ARCHITECTURE.md) (build ja koodi), [`DATA.md`](DATA.md)
(datalähteet ja hakuputki), [`../CONTRIBUTING.md`](../CONTRIBUTING.md) (kehitystyö).

## Sisällys

1. [Yleiskuva](#yleiskuva)
2. [Siirto GitHub Pagesista Fly.io:hon (tee ennen PR:n mergeä)](#siirto-github-pagesista-flyioon)
3. [Ylläpitäjän tilitehtävät (tarkistuslista)](#ylläpitäjän-tilitehtävät)
4. [Päivittäinen ylläpito](#päivittäinen-ylläpito)
5. [Hyödyllisiä komentoja](#hyödyllisiä-komentoja)

## Yleiskuva

```
 Tilastokeskus, Eurostat, EKP
        │  2 × päivässä: .github/workflows/update-data.yml (npm run fetch)
        v
 GitHub: main ── "data: …" -kommitti ──┐          push mainiin (koodi) ──┐
        │                              v                                  v
        │                    update-data.yml: julkaisu          deploy.yml: testit + julkaisu
        │                              └──────── flyctl deploy --remote-only ─┘
        v                                          v
 CI (ci.yml): jokainen PR ja push        Fly.io: sovellus "inflaatio", Tukholma (arn)
                                           Docker: nginx 1.30 palvelee dist/-kansion
                                                   ^
 Kävijä ── https://inflaatio.fi ── Cloudflare (DNS, CDN, TLS) ┘
                                                   ^
 site-check.yml: 6 tunnin välein tarkistus → GitHub-issue, jos jokin on vialla
```

- **Sivusto on staattinen.** Docker-image rakentaa sivut repoon commitoidusta
  datasta (`npm ci` + `npm run build`) ja nginx palvelee vain `dist/`-kansion.
  Imagessa ei haeta dataa verkosta, joten sama commit tuottaa aina saman sivuston.
- **nginx-asetukset**: `deploy/nginx.conf` (välimuisti, MIME-tyypit,
  uudelleenohjaukset, oikea 404, gzip, `/healthz`) ja
  `deploy/security-headers.conf` (tietoturvaotsakkeet ja CSP, ainoa lähde).
  Upotettava kortti `/upotus/` käyttää tiedostoa
  `deploy/security-headers-embed.conf` (saa näkyä iframessa). Paikallinen
  palvelin `scripts/serve.js` toimii samoin, ja `test/ops.test.js` tarkistaa,
  että ne pysyvät samanlaisina.
- **Fly.io**: `fly.toml`. Kone pysähtyy, kun liikennettä ei ole, ja käynnistyy
  ensimmäisestä pyynnöstä (ks. [Kylmäkäynnistys](#kylmäkäynnistys-ja-kustannukset)).
  Terveystarkistus: `GET /healthz`. Julkaisu tehdään blue-green-tapaan: uusi
  kone otetaan käyttöön vasta, kun sen terveystarkistus menee läpi.
  Sovelluksen oma osoite https://inflaatio.fly.dev vastaa samoin kuin
  inflaatio.fi (savutestit käyttävät sitä), mutta nginx lähettää sille
  otsakkeen `X-Robots-Tag: noindex, nofollow`, joten hakukoneet eivät
  indeksoi sitä sivuston kopiona.

### GitHub Actions -työnkulut

| Työnkulku | Milloin | Mitä tekee |
|---|---|---|
| `ci.yml` (CI) | jokainen pull request ja push mainiin | lint, testit, tuotantobuild, linkkien tarkistus, Docker-imagen rakennus ja savutesti (ei julkaise) |
| `update-data.yml` (Päivitä data) | klo 06.17 ja 13.47 UTC (kesäaikaan 9.17 ja 16.47) + käsin | `npm run fetch` → datasopimus, build ja linkit → kommitti `data: …` mainiin → julkaisu Fly.io:hon → savutesti. Epäonnistuu lopuksi, jos jokin lähde epäonnistui (GitHub lähettää sähköpostin). |
| `deploy.yml` (Julkaisu) | push mainiin, joka muuttaa sivustoa (`src/`, `scripts/`, `deploy/`, `data/`, Dockerfile, fly.toml, package*.json) + käsin (vain main; muun haaran käsiajo ohitetaan) | testit, build, linkit → `flyctl deploy --remote-only` → savutesti osoitteeseen `https://inflaatio.fly.dev` |
| `site-check.yml` (Tuotannon tarkistus) | 6 tunnin välein + käsin | tarkistaa https://inflaatio.fi:n (otsakkeet, tiedostot, 404/410, uudelleenohjaukset, `/healthz`, uusin KHI-kuukausi, `/data/latest.json` vs. mainin data ja julkaisukalenteri); virheestä avautuu issue, jolla on tunniste `site-check` |

Datakommitit eivät käynnistä `deploy.yml`:ää (GitHubin `GITHUB_TOKEN`-pushit
eivät käynnistä muita työnkulkuja), siksi `update-data.yml` julkaisee itse.
Molemmat käyttävät samaa `fly-deploy`-jonoa, joten julkaisuja ei tehdä
päällekkäin, ja molemmat julkaisevat mainin sellaisena kuin se on julkaisun
alkaessa (uudempi jonoon tullut julkaisu korvaa odottavan, eikä mikään
kommitti jää julkaisematta). Julkaisevat työt käyttävät GitHubin ympäristöä
`production`, jonka `FLY_API_TOKEN`-secret on vain main-haaran käytössä.

Toimitusketju: kaikki actionit on kiinnitetty commit-SHA:han, ja Dependabot
(`.github/dependabot.yml`) ehdottaa päivityksiä viikoittain. `npm ci` ajetaan
aina valinnalla `--ignore-scripts` (riippuvuuksien asennusskriptit eivät
suoritu), eikä `actions/checkout` jätä tokenia `.git/config`-tiedostoon;
datapäivitys antaa kirjoitusoikeuden tokenin vain push-vaiheelle. flyctl on
kiinnitetty versioon (ks. [Päivitykset](#päivitykset)).

## Siirto GitHub Pagesista Fly.io:hon

Nykytila: inflaatio.fi tarjoillaan GitHub Pagesista (koko repon juuri,
Jekyll) Cloudflaren takaa. `FLY_API_TOKEN`-secret on GitHubissa (vanha
`fly-deploy.yml` onnistui viimeksi 15.6.2026), mutta omalla
fly-tunnuksellasi ei näy sovellusta nimeltä `inflaatio` (`fly apps list`
näyttää vain fly-reversi, stayfinder ja valokammio), ja `inflaatio.fly.dev`
ei resolvoidu. Sovellus on siis joko toisella tunnuksella tai organisaatiolla
tai se on poistettu.

**Tee vaiheet 0–4 ennen kuin PR mergetään.** Silloin tuotanto siirtyy
Fly.io:hon hallitusti, ja paluu GitHub Pagesiin on yhä mahdollinen.

**Komentotulkki (Windows):** aja alla olevat `sh`-lohkot **Git Bashissa**
(tai WSL:ssä). Niissä on POSIX-muotoja (`MUUTTUJA=arvo komento`, `grep`,
`head`), jotka eivät toimi PowerShellissä, ja Windows PowerShell 5.1:ssä
`curl` on eri ohjelma (Invoke-WebRequest). `fly`- ja `gh`-komennot toimivat
myös PowerShellissä. PowerShell-vastineet:

```powershell
# SMOKE_URL=… node --test …  →
$env:SMOKE_URL = "https://inflaatio.fly.dev"; $env:SMOKE_EXPECT_LATEST = "1"
node --test --test-name-pattern="^smoke" test/ops.test.js
Remove-Item Env:SMOKE_URL, Env:SMOKE_EXPECT_LATEST     # lopuksi pois
# curl -sI … | grep -iE '…'  →  curl.exe (Windowsin oma curl) ja Select-String
curl.exe -sI https://inflaatio.fly.dev/ | Select-String -Pattern 'HTTP/|content-security|strict-transport|cache-control'
```

Ennen aloitusta:

- Asenna flyctl (https://fly.io/docs/flyctl/install/) ja kirjaudu:
  `fly auth login`. Tarkista tunnus: `fly auth whoami`.
- Ota talteen Cloudflaren nykyiset DNS-tietueet: Cloudflare → inflaatio.fi →
  DNS → Records → **Import and Export → Export**. Tätä tarvitaan paluussa.
- Katso Cloudflaresta SSL/TLS → Overview, onko tila nyt *Flexible* vai *Full*
  (tarvitaan vaiheessa 3).

### Vaihe 0: Vanhat työnkulut pois käytöstä (ensimmäiseksi)

Mainissa ovat yhä vanhan sivuston työnkulut:

- `fly-deploy.yml` ("Deploy to Fly.io") julkaisee pushista mainiin ja käsin
  vanhan sivun Fly-sovellukseen `inflaatio`. Kun vaihe 1.4 vaihtaa
  `FLY_API_TOKEN`-secretin uuden sovelluksen tokeniin, jokainen push mainiin
  tai käsiajo julkaisisi **vanhan sivun uuteen tuotantosovellukseen**
  (SPA-varasivu, ei CSP:tä, vuoden välimuisti CSS- ja JS-tiedostoille).
- `update-yearly-data.yml` ("Update Yearly Inflation Data") kommitoi joka
  päivä vanhan sivun `index.html`- ja `inflation-site-optimized.min.*`-tiedostoja
  mainiin. Tämä PR poistaa ne tiedostot, joten jokainen tällainen kommitti
  lisää PR:n ristiriitoja (ks. vaihe 5).

Poista molemmat käytöstä ennen mitään muuta:

```sh
gh workflow disable "Deploy to Fly.io" --repo JanneJok/inflaatio
gh workflow disable "Update Yearly Inflation Data" --repo JanneJok/inflaatio
gh workflow list --all --repo JanneJok/inflaatio     # molemmilla tila disabled_manually
```

Mergen jälkeen niitä ei enää ole (tämä PR poistaa tiedostot), eikä GitHub
näytä poistettuja työnkulkuja.

### Vaihe 1: Fly-sovellus – löydä tai luo

1. Etsi vanha sovellus kaikista organisaatioista, joihin tunnuksellasi on pääsy:

   ```sh
   fly orgs list
   fly apps list
   ```

   Jos olet joskus käyttänyt Flytä toisella sähköpostiosoitteella tai
   GitHub-kirjautumisella, kirjaudu sillä (`fly auth logout`, `fly auth login`)
   ja aja `fly apps list` uudelleen. Vihje: vanhan "Deploy to Fly.io"
   -ajon loki (Actions → Deploy to Fly.io → ajo 15.6.2026) kertoo, mihin
   sovellukseen julkaistiin.

2. **Tapaus A – sovellus löytyi** (esim. toiselta tunnukselta):
   - Jos haluat pitää kaiken omalla päätunnuksellasi, poista vanha sovellus
     sillä tunnuksella, jolla se on: `fly apps destroy inflaatio`. Mitätöi
     samalla sen tunnuksen vanhat tokenit: `fly tokens list` ja
     `fly tokens revoke <id>`. Jatka sitten tapauksesta B.
   - Tai käytä löytynyttä sovellusta sellaisenaan (se on sinun hallinnassasi):
     luo sille uusi deploy-token kohdan 4 mukaan.

3. **Tapaus B – sovellusta ei ole** (tai poistit sen): luo uusi sovellus
   omaan organisaatioosi. Fly vaatii organisaatiolle maksukortin
   (Billing), jos sitä ei vielä ole.

   ```sh
   fly apps create inflaatio --org personal
   ```

   Jos Fly vastaa, että nimi on varattu, nimi on jonkun toisen (tai vanhan
   tunnuksen) käytössä. Valitse silloin toinen nimi, esim.
   `fly apps create inflaatio-fi --org personal`, ja vaihda `fly.toml`-tiedostoon
   `app = 'inflaatio-fi'`. Työnkulut lukevat nimen fly.toml:sta; alla olevissa
   komennoissa `inflaatio.fly.dev` on silloin `inflaatio-fi.fly.dev`.

4. Luo sovellukselle deploy-token (oikeudet vain tähän sovellukseen) ja
   tallenna se GitHubin **ympäristöön `production`**, jota vain main-haara saa
   käyttää. Silloin muun haaran työnkulku (esim. `gh workflow run deploy.yml
   --ref jokin-haara`) ei pääse tokeniin eikä voi julkaista tarkistamatonta
   koodia tuotantoon. Tokenia ei kirjoiteta mihinkään muualle.

   ```sh
   fly tokens create deploy -a inflaatio -x 8760h --name github-actions
   # Ympäristö "production": vain main-haara saa käyttää sen secretejä.
   gh api -X PUT repos/JanneJok/inflaatio/environments/production \
     -F "deployment_branch_policy[protected_branches]=false" \
     -F "deployment_branch_policy[custom_branch_policies]=true"
   gh api -X POST repos/JanneJok/inflaatio/environments/production/deployment-branch-policies \
     -f name=main -f type=branch
   gh secret set FLY_API_TOKEN --env production --repo JanneJok/inflaatio   # liitä token kehotteeseen
   gh secret delete FLY_API_TOKEN --repo JanneJok/inflaatio                 # vanha repotason secret pois
   gh secret list --env production --repo JanneJok/inflaatio                # FLY_API_TOKEN
   ```

   Sama selaimessa: Settings → Environments → *New environment* `production`
   → *Deployment branches and tags*: **Selected branches and tags** → *Add
   deployment branch or tag rule* `main` → *Environment secrets*: *Add
   environment secret* `FLY_API_TOKEN`. Poista sitten Settings → Secrets and
   variables → Actions → *Repository secrets* -listalta vanha `FLY_API_TOKEN`.
   Älä lisää ympäristöön *Required reviewers* -sääntöä: se pysäyttäisi
   datapäivitysten automaattiset julkaisut odottamaan hyväksyntää.
   (PowerShellissä rivinjatko `\` on `` ` ``, tai kirjoita komento yhdelle riville.)

   Token on voimassa vuoden (`-x 8760h`): merkitse kalenteriin uusiminen
   (`fly tokens create …` ja `gh secret set FLY_API_TOKEN --env production …`
   uudelleen).

### Vaihe 2: Julkaise PR-haara ja testaa osoitteessa inflaatio.fly.dev

`deploy.yml` voidaan käynnistää käsin vasta, kun se on mainissa. Ensimmäinen
julkaisu tehdään siksi omalta koneelta PR-haarasta. Paikallista Dockeria ei
tarvita: `--remote-only` rakentaa imagen Flyn palvelimella.

```sh
git fetch origin
git switch claude/code-review-improvements-eabb62
fly deploy --remote-only
fly status          # koneet "started", tarkistus "passing"
fly ips list        # jaettu IPv4 ja oma IPv6 (luodaan ensimmäisessä julkaisussa)
```

Jos `fly ips list` on tyhjä: `fly ips allocate-v6` ja `fly ips allocate-v4 --shared`.
Ensimmäinen julkaisu voi luoda kaksi konetta (vikasietoisuus). Automaattisen
pysäytyksen takia ylimääräinen kone ei juuri maksa; yhden koneen saat komennolla
`fly scale count 1`.

Testaa:

```sh
curl -sI https://inflaatio.fly.dev/ | grep -iE 'HTTP/|content-security|strict-transport|cache-control'
SMOKE_URL=https://inflaatio.fly.dev SMOKE_EXPECT_LATEST=1 node --test --test-name-pattern='^smoke' test/ops.test.js
```

Selaa lisäksi sivustoa osoitteessa https://inflaatio.fly.dev (etusivu,
laskurit, tumma teema, puhelimen leveys) ja katso, ettei selaimen konsolissa
ole CSP-virheitä. Yhteydenottolomake ja kävijätilasto toimivat vain
osoitteessa inflaatio.fi, se on tarkoituksellista.

### Vaihe 3: Varmenteet ja Cloudflaren DNS

Cloudflare pysyy DNS:nä ja CDN:nä (oranssi pilvi). Cloudflare ottaa yhteyden
Flyhin HTTPS:llä ja tarkistaa Flyn varmenteen (tila *Full (strict)*).

**3.1 Varmenteet Flyhin (sivusto toimii yhä GitHub Pagesissa):**

```sh
fly certs add inflaatio.fi
fly certs add www.inflaatio.fi
fly certs setup inflaatio.fi
fly certs setup www.inflaatio.fi
```

`fly certs setup <nimi>` näyttää tarvittavat DNS-tietueet. (`fly certs show`
on nykyään sama komento kuin `fly certs check`: se näyttää vain tilan, ei
tietueita.) Koska Cloudflaren välityspalvelin (oranssi pilvi) on Flyn
edessä, Fly ei näe DNS:stä, että domain ohjautuu siihen. Siksi tarvitaan
kaksi tietuetta kummallekin nimelle. Lisää ne Cloudflareen (DNS → Records →
Add record), kaikki **DNS only** (harmaa pilvi):

| Tyyppi | Nimi | Arvo | Tarkoitus |
|---|---|---|---|
| TXT | `_fly-ownership` | `fly certs setup inflaatio.fi` → kohta *Ownership TXT Record* | todistaa, että domain on sinun; Fly vaatii sen, kun liikenne kulkee CDN:n kautta. **Pysyvä**: tarvitaan myös varmenteen uusimisessa. |
| TXT | `_fly-ownership.www` | `fly certs setup www.inflaatio.fi` → *Ownership TXT Record* | sama www-nimelle, pysyvä |
| CNAME | `_acme-challenge` | `fly certs setup inflaatio.fi` → kohta *ACME DNS Challenge* (muotoa `inflaatio.fi.<tunniste>.flydns.net`) | varmenne myönnetään jo ennen DNS-vaihtoa (DNS-01). **Väliaikainen**: poistetaan vaiheessa 3.4. |
| CNAME | `_acme-challenge.www` | `fly certs setup www.inflaatio.fi` → *ACME DNS Challenge* | sama www-nimelle, väliaikainen |

Odota, kunnes `fly certs check inflaatio.fi` ja `fly certs check www.inflaatio.fi`
kertovat varmenteen olevan voimassa (*Certificate is verified and active*;
yleensä muutama minuutti). Tarkista halutessasi ennen DNS-vaihtoa, että Fly
vastaa oikealla varmenteella (IPv4 `fly ips list` -tulosteesta):

```sh
curl -sI --resolve inflaatio.fi:443:<Flyn IPv4> https://inflaatio.fi/ | head -n 1
```

(PowerShell: `curl.exe -sI --resolve inflaatio.fi:443:<Flyn IPv4> https://inflaatio.fi/`
ja katso ensimmäinen rivi.) Jos varmennetta ei synny puolessa tunnissa,
`fly certs check` kertoo syyn; tarkista, että tietueet ovat harmaalla
pilvellä ja arvot on kopioitu kokonaan.

**3.2 SSL/TLS-tila ennen vaihtoa.** Jos tila on nyt *Flexible*, vaihda se
tilaan **Full** (SSL/TLS → Overview) ja varmista, että inflaatio.fi toimii
yhä. *Flexible* + Fly = uudelleenohjaussilmukka, koska Fly ohjaa HTTP:n
HTTPS:ään. *Full* hyväksyy myös GitHub Pagesin varmenteen, joten sivusto
toimii koko vaihdon ajan.

**3.3 DNS-vaihto (DNS → Records).** **Muokkaa** olemassa olevia tietueita
(*Edit*) äläkä poista niitä ensin. Jos juurinimeltä poistetaan kaikki
osoitetietueet ennen uuden lisäämistä, välissä kysyvä resolveri tallentaa
välimuistiinsa vastauksen "ei osoitetta" jopa 30 minuutiksi (SOA:n
negatiivinen TTL), ja osa kävijöistä ei pääse sivulle. Muokattaessa
välivaihetta ei ole. Osoitteet saat komennolla `fly ips list` (*v4 shared* ja *v6*).

1. Muokkaa ensimmäinen inflaatio.fi:n A-tietue (185.199.108.153): arvoksi
   Flyn jaettu IPv4, **Proxied** (oranssi pilvi). Poista sen jälkeen
   GitHubin kolme muuta A-tietuetta (185.199.109.153, 185.199.110.153,
   185.199.111.153). Välissä Cloudflare jakaa pyyntöjä sekä Flyhin että
   GitHub Pagesiin; molemmat toimivat, koska SSL/TLS-tila on *Full* (3.2).
2. AAAA: jos GitHubin AAAA-tietueita on (`2606:50c0:800X::153`), muokkaa
   ensimmäinen Flyn IPv6-osoitteeksi (Proxied) ja poista muut. Jos AAAA-tietuetta
   ei ole, lisää AAAA `@` → Flyn IPv6, Proxied.
3. Muokkaa `www`-tietueen (CNAME `janneJok.github.io`) kohteeksi
   `inflaatio.fly.dev`, **Proxied**. nginx ohjaa www-osoitteen pysyvästi
   osoitteeseen https://inflaatio.fi/. (Vaihtoehto: Cloudflaren Redirect Rule
   `www.inflaatio.fi/*` → `https://inflaatio.fi/${1}`, 301.)

Vaihtoehto A/AAAA-tietueille on juuren CNAME `@` → `inflaatio.fly.dev`
(Proxied; Cloudflare litistää sen). Se vaatii A-tietueiden poiston ensin,
joten siinä on yllä kuvattu katkon riski: käytä A/AAAA-tietueita.

**3.4 Heti vaihdon jälkeen:**

- SSL/TLS → Overview: **Full (strict)**.
- Kun sivu toimii *Full (strict)* -tilassa (`curl -sI https://inflaatio.fi/`
  näyttää `fly-request-id`-otsakkeen): **poista** Cloudflaresta väliaikaiset
  CNAME-tietueet `_acme-challenge` ja `_acme-challenge.www`. Flyn DNS-01-varmenteet
  törmäävät Cloudflaren Universal SSL:n omiin (piilotettuihin)
  `_acme-challenge`-tietueisiin. Ilman niitä Fly uusii varmenteet
  HTTP-01-haasteella Cloudflaren läpi, ja siihen tarvitaan `_fly-ownership`-TXT-tietueet:
  **pidä ne pysyvästi**. Muuten varmenne voi jäädä uusimatta (noin 60 päivän
  päästä), ja Cloudflare näyttää kävijöille virheen 526.
  Tarkista kolmen kuukauden päästä: `fly certs check inflaatio.fi` (voimassa, uusi päivämäärä).
- SSL/TLS → Edge Certificates: *Always Use HTTPS* päälle, *Minimum TLS Version*
  1.2. Jätä Cloudflaren oma HSTS pois päältä (nginx lähettää HSTS-otsakkeen;
  jos otat sen käyttöön, käytä samoja arvoja: 12 kk, includeSubDomains, ei preloadia).
- Caching → Configuration: *Browser Cache TTL* = **Respect Existing Headers**.
  Nykyinen asetus pakottaa CSS/JS-tiedostoille vuoden välimuistin
  (katselmoinnin PSA-9). Poista myös vanhat Cache Rules- ja Page Rules
  -säännöt, jotka ylikirjoittavat välimuistiajan tai välimuistittavat HTML:ää.
  Uusi sivusto kertoo itse oikeat ajat: `/assets/` ja `/fonts/` vuosi
  (tiedostonimessä on sisältötiiviste), HTML `no-cache`, `/data/` tunti,
  jakokuva `/og/` vuorokausi (se tehdään uudelleen joka kuukausi), muut
  kuvat viikko.
- Poista käytöstä ominaisuudet, jotka lisäävät sivulle skriptejä ja rikkovat
  CSP:n: Speed → Optimization → *Rocket Loader* pois; Scrape Shield →
  *Email Address Obfuscation* pois; *Web Analytics* (Real User Monitoring)
  -automaattiasennus pois; *Zaraz* pois.
- Security → Bots: jos *Bot Fight Mode* on päällä, se voi antaa GitHub
  Actionsin tarkistuksille (datakeskusten IP-osoitteet) haasteen tai 403-vastauksen,
  jolloin `site-check.yml` hälyttää turhaan. Pidä se pois päältä tai tarkista
  ensimmäisen tarkistusajon tulos.
- Caching → Configuration → **Purge Everything** (poistaa GitHub Pagesin
  vanhat tiedostot Cloudflaren välimuistista, myös vanhan `service_worker.js`:n).

### Vaihe 4: Tarkista tuotanto

```sh
curl -sI https://inflaatio.fi/ | grep -iE 'HTTP/|server|fly-request-id|content-security|strict-transport|cache-control'
curl -sI https://www.inflaatio.fi/hinnat/ | grep -iE 'HTTP/|location'     # 301 → https://inflaatio.fi/hinnat/
curl -sI http://inflaatio.fi/ | grep -iE 'HTTP/|location'                 # 301 → https://
SMOKE_URL=https://inflaatio.fi SMOKE_EXPECT_LATEST=1 node --test --test-name-pattern='^smoke' test/ops.test.js
```

Vastauksessa pitää näkyä `fly-request-id` (vastaus tulee Flystä) ja
`content-security-policy`. Selaa sivustoa ja tarkista konsoli. Lisää Google
Search Consoleen uusi sivukartta `https://inflaatio.fi/sitemap.xml`, ja
pyydä vanhojen roskasivujen poistoa (Removals: `/docs/plans/`,
`/SEO-CHECKLIST.html`, `/related-articles-component.html` …). Ne vastaavat
nyt `410 Gone`.

### Vaihe 5: Merge

1. Päivitä PR-haara mainista juuri ennen mergeä. Vanha datatyönkulku ehti
   kommitoida mainiin vanhan sivun tiedostoja (`index.html`,
   `inflation-site-optimized.min.js`, `inflation-site-optimized.min.css`)
   haaran erkanemisen jälkeen, ja tämä haara poistaa ne, joten GitHub
   näyttää *modify/delete*-ristiriitoja. Ratkaise ne pitämällä poisto:

   ```sh
   git fetch origin
   git switch claude/code-review-improvements-eabb62
   git merge origin/main
   git status          # "Unmerged paths": deleted by us: index.html …
   git rm index.html inflation-site-optimized.min.js inflation-site-optimized.min.css   # ne, jotka git status listaa
   git status          # ei enää "Unmerged paths"; ratkaise muut ristiriidat tavalliseen tapaan
   git commit --no-edit
   npm run check
   git push
   ```

   (Vaihtoehto: `gh pr update-branch <numero>` toimii vain, jos ristiriitoja
   ei ole.) Vaiheen 0 jälkeen vanha työnkulku ei enää kommitoi, joten
   ristiriidat eivät synny uudelleen.

2. Mergeä PR. Push mainiin käynnistää `deploy.yml`:n, joka julkaisee mainin
   Fly.io:hon, ja `ci.yml`:n. Seuraa: Actions-välilehti.
3. Aja datapäivitys ja tuotannon tarkistus kerran käsin ja katso ajojen
   yhteenvedot:

   ```sh
   gh workflow run update-data.yml --repo JanneJok/inflaatio
   gh workflow run site-check.yml --repo JanneJok/inflaatio
   ```

4. Ilmoitukset: GitHub lähettää ajastetun työnkulun virheestä sähköpostin
   sille käyttäjälle, joka viimeksi muutti työnkulun `cron`-riviä (mergen
   tekijä). Tarkista GitHubin omista asetuksista: Settings → Notifications →
   Actions → *Email* ja *Only notify for failed workflows*.

### Vaihe 6: GitHub Pages pois (heti mergen jälkeen)

Mergen jälkeen mainin juuressa ei ole enää vanhaa sivua, joten Pages
julkaisisi repon lähdekoodia. Poista Pages käytöstä:

1. Settings → Pages → *Custom domain*: **Remove**, sitten **Unpublish site**
   (tai `gh api -X DELETE repos/JanneJok/inflaatio/pages`).
2. Juuren `CNAME`-tiedosto on poistettu jo tässä PR:ssä (Fly ei tarvitse
   sitä), joten sille ei tarvitse tehdä mitään.
3. Suositus: vahvista domain GitHubissa, ettei kukaan muu voi myöhemmin
   ottaa inflaatio.fi:tä käyttöön omassa Pages-sivustossaan: oma profiili →
   Settings → Pages → *Add a domain* → inflaatio.fi → lisää Cloudflareen
   GitHubin antama TXT-tietue `_github-pages-challenge-JanneJok` (DNS only)
   → *Verify*.
4. `gh secret list --repo JanneJok/inflaatio`: poista repotason secretit,
   joita mikään työnkulku ei enää käytä. Käytössä on vain ympäristön
   `production` `FLY_API_TOKEN` (`gh secret list --env production --repo JanneJok/inflaatio`).

### Vaihe 7: Paluusuunnitelma

- **DNS-vaihdon jälkeen, ennen mergeä:** palauta Cloudflareen aloitusvaiheessa tallennetun
  export-tiedoston tietueet (A 185.199.108–111.153, AAAA, `www` → CNAME
  `janneJok.github.io`) ja vaihda SSL/TLS-tila takaisin tilaan *Full*. Sivu
  palaa GitHub Pagesiin muutamassa minuutissa (Pages on yhä päällä ja main
  ennallaan). Poista lopuksi välimuisti (*Purge Everything*). Jos paluu on
  pidempiaikainen, ota vanha datatyönkulku takaisin käyttöön, jotta vanhan
  sivun luvut päivittyvät: `gh workflow enable "Update Yearly Inflation Data" --repo JanneJok/inflaatio`
  ("Deploy to Fly.io" pysyy pois päältä).
- **Mergen jälkeen** paluu tehdään Flyn sisällä:
  - Edellinen toimiva versio: `fly releases -a inflaatio --image` näyttää
    julkaisut ja imaget; `fly deploy --image registry.fly.io/inflaatio:deployment-<tunniste>`
    palauttaa valitun imagen.
    **Huom.:** imagen palautus kumoutuu itsestään. Seuraava datapäivitys, jossa
    data muuttuu (ajo kahdesti päivässä), julkaisee mainin uudelleen ja tuo
    viallisen koodin takaisin. Tee siksi heti palautuksen jälkeen jompikumpi:
    peru viallinen kommitti mainista (`git revert <commit>` → push →
    `deploy.yml` julkaisee korjatun mainin) tai keskeytä datajulkaisut
    korjaukseen asti: `gh workflow disable update-data.yml --repo JanneJok/inflaatio`
    (ja korjauksen jälkeen `gh workflow enable update-data.yml --repo JanneJok/inflaatio`).
  - Koodimuutoksen peruutus: `git revert <commit>` → push mainiin →
    `deploy.yml` julkaisee.
  - Virheellinen data: `git revert` datakommitille (seuraava onnistunut haku
    tuo datan takaisin, jos lähde on kunnossa).
- **Fly ei vastaa:** `fly status`, `fly machine list`, `fly machine start <id>`,
  `fly logs`; Flyn tila: https://status.flyio.net/. Cloudflaren virhe 521/522
  = origin ei vastaa, 525/526 = TLS- tai varmenneongelma (`fly certs check inflaatio.fi`).

## Ylläpitäjän tilitehtävät

Nämä vaativat ylläpitäjän omat tunnukset, joten koodi ei voi tehdä niitä.
Rastita, kun tehty.

**Vuotaneet avaimet ja vanha putki**

- [ ] **Google Cloud:** poista vuotanut Google Sheets -API-avain (alkaa
  `AIzaSyDbeAW`): Google Cloud Console → APIs & Services → Credentials →
  avain → *Delete*. Uutta avainta ei tarvita, koska Sheets-putki on poistettu.
- [ ] **GitHub:** Security → Secret scanning → hälytys **#1** → *Close as* →
  **Revoked**.
- [ ] **Google Apps Script:** script.google.com → HICP/Sheets-projekti →
  Triggers (kellokuvake) → poista kaikki ajastukset. Sheets-putki ei ole
  enää käytössä; arkistoi tai poista projekti ja taulukko, kun et tarvitse niitä.

**Tietosuoja ja analytiikka**

- [ ] **Supabase:** aja `docs/supabase.sql` (projekti ysuhexvvgjoizrcdrxso →
  SQL Editor → New query → liitä → Run) ennen uuden sivuston julkaisua tai
  heti sen jälkeen, ja tee tiedoston alussa kuvatut tarkistukset (anon voi
  vain lisätä rivejä, ei lukea; 14 kuukauden poistoajo on ajastettu).
- [ ] **Google Analytics 4:** Admin → Data collection and modification →
  Data retention → *Event data retention* = **14 months**. Tarkista samalla,
  että tietosuojaselosteen lupaukset pitävät: *Google signals data collection*
  pois päältä ja mainonnan personointi pois (Data collection → Advanced
  settings to allow for ads personalization), eikä Google Ads -linkityksiä ole.
- [ ] **Google Analytics 4, sivuhistorian tapahtumat pois:** Admin → Data
  streams → verkkovirta (inflaatio.fi) → *Enhanced measurement* → *Page views*
  -kohdan rataskuvake → *Show advanced settings* → **Page changes based on
  browser history events** pois päältä → Save. Laskurit kirjoittavat
  syötetyt luvut (palkka, vuokra, kuukausimenot) osoiteriville
  (`history.replaceState`), jotta linkin voi jakaa. Tämä asetus päällä GA4
  lähettäisi jokaisesta muutoksesta sivunäytön koko osoitteineen Googlelle.
  Tietosuojaseloste lupaa GA:lle vain sivut ja ominaisuuksien käytön, ei
  syötettyjä summia. (Koodi lähettää GA:lle osoitteen ilman kyselyosaa;
  tämä asetus estää lisäksi GA4:n omat historiatapahtumat.)
- [ ] **EmailJS:** Account → Security: *Allowed origins* = `https://inflaatio.fi`
  (ja `https://www.inflaatio.fi`) ja rajoitus pyyntötiheydelle (esim. yksi
  lähetys 10 sekunnissa). Tarkista, säilyttääkö EmailJS viestihistoriaa
  (Email History), ja poista tai rajaa se, jotta säilytys vastaa selostetta.
- [ ] **Tietosuojaselosteen kohdat** (`/kayttoehdot/#tietosuoja`, koodi
  `src/pages/kayttoehdot.js`), jotka riippuvat ylläpitäjän käytännöistä:
  yhteydenottoviestit poistetaan sähköpostista viimeistään 12 kuukautta asian
  käsittelyn jälkeen (`CONTACT_RETENTION_MONTHS`); GA4:n ja Supabasen
  säilytysajat 14 kk (yllä); Opak Oy:n yhteystiedot ovat ajan tasalla;
  palveluntarjoajat (Fly.io, Cloudflare, Supabase, EmailJS, Google) vastaavat
  todellisuutta. Hyväksy tarvittaessa palveluntarjoajien
  tietojenkäsittelysopimukset (DPA) niiden hallintapaneeleista tai
  Legal-sivuilta. Jos tekstiä muutetaan, päivitä `TERMS_UPDATED`.

**GitHub**

- [ ] Settings → Code security: **Dependabot alerts** ja **Dependabot
  security updates** päälle; **Secret scanning** ja **Push protection** päälle;
  **Private vulnerability reporting** päälle (CONTRIBUTING.md ohjaa
  ilmoittamaan haavoittuvuudet sitä kautta).
- [ ] Settings → Actions → General → *Workflow permissions*: **Read repository
  contents and packages permissions** (työnkulut pyytävät itse tarvitsemansa
  oikeudet), ja *Allow GitHub Actions to create and approve pull requests* pois.
- [ ] Settings → Rules → Rulesets → *New branch ruleset* "main": Target =
  default branch, Enforcement = Active, säännöt **Restrict deletions** ja
  **Block force pushes**. Älä ota käyttöön sääntöjä *Require a pull request*
  tai *Require status checks*: datapäivitysbotti pushaa suoraan mainiin, ja
  ne estäisivät sen. PR-käytäntö on sovittu CONTRIBUTING.md:ssä, ja CI ajetaan
  jokaisessa PR:ssä.

**Cloudflare (DNS inflaatio.fi)**

- [ ] Sähköpostin väärentämisen esto (domain ei lähetä postia):
  - TXT `@` `v=spf1 -all` (säilytä olemassa oleva `google-site-verification`-tietue)
  - TXT `_dmarc` `v=DMARC1; p=reject; adkim=s; aspf=s`
  - valinnainen: TXT `*._domainkey` `v=DKIM1; p=`
- [ ] CAA (vasta kun Flyn varmenteet on myönnetty): CAA `@` `0 issue "letsencrypt.org"`
  (Flyn varmenteet). Cloudflare lisää omien varmenteidensa CA:t automaattisesti.
- [ ] DNSSEC: DNS → Settings → DNSSEC → *Enable* → vie Cloudflaren näyttämä
  DS-tietue .fi-verkkotunnusvälittäjän hallintapaneeliin. Tarkista vuorokauden
  päästä esim. https://dnsviz.net/.
- [ ] Jos haluat yhteysosoitteen @inflaatio.fi: Email → **Email Routing**
  (esim. yhteys@inflaatio.fi → oma postilaatikko). Cloudflare lisää silloin
  MX- ja SPF-tietueet itse (SPF muuttuu muotoon `v=spf1 include:_spf.mx.cloudflare.net ~all`);
  DMARC `p=reject` sopii edelleen, kun domainista ei lähetetä postia.

**Tarkistettavat tekstit ja sisältö (ennen julkaisua)**

- [ ] **Tietosuojaselosteen käsittelijätiedot** (`src/pages/kayttoehdot.js`):
  varmista Supabase Inc:n tietojenkäsittelysopimus ja projektin alue; Google
  Ireland / Google LLC:n EU–US Data Privacy Framework -sertifiointi; Fly.io:n
  lokien säilytysaika; että liikenne kulkee DNS-siirron jälkeen yhä
  Cloudflaren kautta; EmailJS:n yhtiön nimi ja sijainti; Tilastokeskuksen
  käyttöehtojen osoite.
- [ ] **Juridinen tarkistus:** anna juristin katsoa sovellettavan lain ja
  riidanratkaisun muotoilu (kuluttajariitalautakunta, kuluttajan kotipaikan
  tuomioistuin) sekä oikeutetun edun peruste evästeettömälle kävijälaskurille
  (EDPB:n ohje 2/2023 voi tulkita myös evästeettömän seurannan
  suostumusta vaativaksi).
- [ ] **Avoimen datan lisenssi:** `/data/`, `data/latest.json` ja Dataset
  JSON-LD ilmoittavat koostetut tiedostot lisenssillä CC BY 4.0 (lähde
  Tilastokeskus/Eurostat ja Inflaatio.fi). Vahvista, että haluat tämän.
- [ ] **Oma inflaatio -laskurin esimerkkiprofiilit** (`src/pages/oma-inflaatio.js`,
  esim. autoton kaupunkilainen, maaseudun autoilija): painot ovat
  havainnollistavia, eivät tilastoa (sivulla sanotaan näin). Tarkista, että
  ne ovat järkeviä.
- [ ] **Etusivun UKK "Mihin vuokrankorotukset sidotaan?"**
  (`src/content/faq.json`): yleistä ohjeistusta, ei oikeudellista neuvontaa –
  tarkista sanamuoto.
- [ ] **GA4:n mukautetut määritteet** (valinnainen, raportointia varten):
  Admin → Custom definitions → tapahtuman `calculator_used` parametrit
  `laskuri`, `sarja`, `kieli`, `tapa`. Muut tuotetapahtumat: `result_shared`,
  `share`, `csv_download`, `json_download`, `widget_code_copied`,
  `contact_form_sent`. Kaikki lähetetään vain suostumuksella.

**Säännöllinen sisällön ylläpito**

- [ ] **Ennusteet** (`src/content/ennusteet.json`): päivitä julkaisijan omalta
  sivulta aina uuden ennusteen jälkeen – Suomen Pankki (kesä- ja joulukuu,
  väliennusteet), valtiovarainministeriö (neljästi vuodessa), EKP:n
  asiantuntijat (neljännesvuosittain). Kentät: `org`, `title`, `published`,
  `url`, `measure` (KHI/YKHI), `area` (`FI` tai `EA` – euroalueen ennustetta
  ei saa näyttää Suomen lukuna), `label`, `values`, `verified`. Tyhjä lista
  piilottaa ennustekortin.
- [ ] **Tapahtumat** (`src/content/tapahtumat.json`): lisää merkittävät uudet
  tapahtumat (esim. ALV-muutokset, EKP:n korkokäänteet); otsikko enintään
  24 merkkiä, prosenttimerkin edessä sitova välilyönti.
- [ ] **Kuukausikatsauksen kommentti** (valinnainen,
  `src/content/katsauskommentit.json`): `"YYYY-MM": "teksti"` tai
  `{ "text": ["kappale", …], "author": "…", "date": "YYYY-MM-DD" }` näkyy
  kuukauden katsauksessa otsikolla "Ylläpitäjän kommentti".
- [ ] **Upotettava kortti:** tarjoa `/upotus/ohje/`-sivua esimerkiksi
  isännöitsijöille, vuokranantajayhdistyksille ja talousbloggaajille (PROD-20).

**Myöhemmin**

- [ ] 9/2027: poista `src/static/service_worker.js` (vanhan service workerin
  poistaja, ks. tiedoston kommentti).
- [ ] Flyn deploy-tokenin uusiminen vuoden välein (vaihe 1, kohta 4:
  `gh secret set FLY_API_TOKEN --env production`).

## Päivittäinen ylläpito

### Miten data päivittyy

`update-data.yml` ajetaan kahdesti päivässä (06.17 ja 13.47 UTC; GitHubin
ajastukset voivat viivästyä). Tilastokeskus julkaisee KHI:n klo 8.00 ja
Eurostat YKHI:n klo 12.00 Suomen aikaa, joten uusi luku näkyy yleensä
julkaisupäivänä. Ajo:

1. `npm run fetch` hakee kaikki lähteet. Jos lähde epäonnistuu, sen edellinen
   tiedosto jää ennalleen, ja ajo merkitään lopuksi epäonnistuneeksi (sivusto
   näyttää viimeisimmän hyvän datan).
2. Jos `data/` tai `src/content/julkaisukalenteri.json` muuttui: datasopimuksen
   testi, täysi build ja linkkien tarkistus. Jos jokin näistä epäonnistuu,
   mitään ei kommitoida.
3. Kommitti mainiin, esim. `data: khi 2026-09, hyodykkeet 2026-09`
   (`github-actions[bot]`; `git pull --rebase` ennen pushia).
4. Julkaisu Fly.io:hon ja savutesti osoitteeseen `https://inflaatio.fly.dev`:
   sivun pitää näyttää uusin KHI-kuukausi.

Ajon yhteenveto (Actions → Päivitä data → ajo → Summary) näyttää lähdekohtaisen
taulukon ja lopputuloksen. Päivänä, jolloin mikään ei muutu, ei synny kommittia
eikä julkaisua. Käsin: `gh workflow run update-data.yml` (valinta *deploy*
julkaisee, vaikka data ei muuttuisi).

### Kun datapäivitys epäonnistuu

GitHub lähettää sähköpostin "Run failed: Päivitä data".

1. Avaa ajo ja sen yhteenveto. Hakuvaiheen taulukko kertoo, mikä lähde
   epäonnistui ja miksi (`fetch` = rajapinta ei vastannut, `validate` = data ei
   läpäissyt tarkistuksia, `stale` = uusin kuukausi on liian vanha).
2. Yksittäinen verkkovirhe korjaantuu yleensä seuraavassa ajossa. Voit ajaa
   työnkulun uudelleen käsin.
3. Jos sama lähde epäonnistuu päivästä toiseen, rajapinta on todennäköisesti
   muuttunut (taulukon tunnus, muuttujat). Katso `docs/DATA.md` → *Known
   caveats*, korjaa hakija haarassa ja testaa: `npm run fetch -- --only khi --dry-run`.
4. Jos "Tarkista datasopimus, build ja linkit" epäonnistui, uusi data rikkoo
   jonkin sivun tai sopimuksen. Toista paikallisesti: `npm run fetch` ja
   `npm run check`.
5. Jos julkaisu epäonnistui, data on mainissa mutta ei tuotannossa: aja
   `gh workflow run deploy.yml` tai `fly deploy --remote-only`.

### Kun tuotannon tarkistus epäonnistuu

`site-check.yml` avaa issuen, jolla on tunniste `site-check` (tai kommentoi
jo avointa). Issue suljetaan automaattisesti, kun tarkistus onnistuu taas.

1. Issuessa on testitulosteen loppu: mikä tarkistus epäonnistui.
2. Vastaako palvelu? https://inflaatio.fi/healthz → `ok`. Jos ei: `fly status`,
   `fly logs`, Flyn ja Cloudflaren tilasivut. Cloudflaren 52x-virheet: ks.
   paluusuunnitelma yllä.
3. **Uusin KHI-kuukausi puuttuu sivulta** tai **`/data/latest.json` ei vastaa
   dataa** (esim. YKHI on yhä "ennakko", päivitetty-päivä tai seuraava
   julkaisupäivä on vanha): jokin datapäivitys on mainissa mutta ei
   tuotannossa. Katso viimeisin "Päivitä data" -ajo. Epäonnistuiko julkaisu?
   Aja `gh workflow run deploy.yml`. (Seuraava datapäivitys ei julkaise
   uudelleen, jos data ei sillä välin muutu.)
4. **Otsake puuttuu tai on väärä:** onko joku muuttanut Cloudflaren asetuksia
   (Transform Rules, HSTS, Rocket Loader) tai nginx-asetuksia? Otsakkeiden ainoa
   lähde on `deploy/security-headers.conf`.
5. **Tiedosto (CSS/JS) puuttuu:** välimuistissa voi olla vanha HTML. Tarkista
   Cloudflaren välimuistisäännöt (HTML:ää ei saa välimuistittaa) ja tyhjennä
   välimuisti tarvittaessa.
6. **Kaikki pyynnöt saavat 403-vastauksen**, mutta selaimella sivu toimii:
   Cloudflaren bottisuojaus estää GitHub Actionsin (ks. vaihe 3.4, Bot Fight Mode).

### Julkaisu käsin ja versiot

- Julkaise main: `gh workflow run deploy.yml` (tai paikallisesti
  `fly deploy --remote-only`).
- Julkaisuhistoria: `fly releases -a inflaatio --image`; palautus: ks.
  [paluusuunnitelma](#vaihe-7-paluusuunnitelma).
- Kokeile imagea paikallisesti (Docker Desktop):

  ```sh
  docker build -t inflaatio-local .
  docker run --rm -d -p 8108:8080 --name inflaatio-local inflaatio-local
  SMOKE_URL=http://127.0.0.1:8108 SMOKE_EXPECT_LATEST=1 node --test --test-name-pattern='^smoke' test/ops.test.js
  docker stop inflaatio-local
  ```

  PowerShellissä savutesti: `$env:SMOKE_URL = "http://127.0.0.1:8108"; $env:SMOKE_EXPECT_LATEST = "1"; node --test --test-name-pattern="^smoke" test/ops.test.js`.

### Päivitykset

- **Dependabot** avaa maanantaisin enintään muutaman ryhmitellyn PR:n (npm:n
  minor- ja patch-päivitykset yhdessä, GitHub Actions yhdessä). Mergeä, kun
  CI on vihreä. Pääversiopäivitykset tulevat erikseen: lue muutosloki ennen mergeä.
- **nginx:** image `nginx:1.30-alpine` saa patch- ja tietoturvapäivitykset
  jokaisessa julkaisussa. Uusi vakaa haara ilmestyy huhtikuussa (1.32 vuonna
  2027): vaihda `Dockerfile`n `FROM`-rivi ja anna CI:n tarkistaa.
- **Node.js:** 24 (LTS). Siirto uuteen LTS-versioon: `Dockerfile`,
  työnkulkujen `node-version` ja `package.json`:n `engines`.
- **flyctl:** `setup-flyctl` asentaa kiinnitetyn version (`version: '0.4.104'`
  tiedostoissa `deploy.yml` ja `update-data.yml`). Dependabot päivittää vain
  actionin SHA:n, ei tätä versiota. Nosta se muutaman kuukauden välein tai
  kun Fly sitä pyytää: katso uusin versio (`fly version` tai `fly version upgrade` omalla
  koneella tai https://github.com/superfly/flyctl/releases), kokeile
  `fly deploy --remote-only` sillä ja vaihda sama numero molempiin
  tiedostoihin (`test/ops.test.js` tarkistaa, että ne ovat samat).

### Kylmäkäynnistys ja kustannukset

`fly.toml`: `min_machines_running = 0` ja `auto_stop_machines = 'stop'`. Kone
pysähtyy muutaman minuutin hiljaisuuden jälkeen, ja seuraava kävijä odottaa
sen käynnistymistä (nginxillä yleensä alle 2 sekuntia). Tämä on halvin
vaihtoehto.

- **Ei kylmäkäynnistyksiä:** vaihda `min_machines_running = 1` ja julkaise.
  Yksi kone on silloin aina käynnissä (shared-cpu-1x, 256 Mt; muutama
  dollari kuukaudessa, ks. https://fly.io/docs/about/pricing/).
- **Nopeampi herätys ilman jatkuvaa konetta:** `auto_stop_machines = 'suspend'`
  keskeyttää koneen muistiin, ja se herää yleensä selvästi alle sekunnissa.
- Laskutus: Fly-hallintapaneeli → Billing. Cloudflare välimuistittaa
  tiedostot (`/assets/`, `/fonts/`, kuvat, `/data/`), joten Flyn kautta
  kulkee lähinnä HTML.

## Hyödyllisiä komentoja

| Komento | Tekee |
|---|---|
| `fly status -a inflaatio` | koneet, versio, terveystarkistukset |
| `fly logs -a inflaatio` | nginxin loki (ei IP-osoitteita) ja Flyn tapahtumat |
| `fly releases -a inflaatio --image` | julkaisuhistoria ja imaget |
| `fly deploy --remote-only` | julkaisu nykyisestä hakemistosta |
| `fly certs list` / `fly certs check inflaatio.fi` | varmenteiden tila |
| `fly certs setup inflaatio.fi` | varmenteen DNS-tietueet (`_fly-ownership`, `_acme-challenge`) |
| `fly scale count 1` / `fly scale show` | koneiden määrä ja koko |
| `fly ssh console -a inflaatio` | komentotulkki koneessa (esim. `nginx -T`) |
| `gh workflow run update-data.yml` | datapäivitys käsin |
| `gh workflow run deploy.yml` | julkaisu käsin |
| `gh workflow run site-check.yml` | tuotannon tarkistus käsin |
| `gh run list --workflow update-data.yml` | viimeisimmät ajot |
| `npm run serve` | tuotantobuild paikallisesti samoilla otsakkeilla kuin nginx |
