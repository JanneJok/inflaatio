/**
 * /tilastot/ – the owner's statistics dashboard (noindex, not in the sitemap,
 * not linked from the site). A bare document: no site.js, so no consent
 * banner, Google Analytics or page-view counting on this page.
 *
 * The HTML holds no data. After signing in (Supabase Auth, e-mail and
 * password of a user listed in public.inflaatio_stats_admins) the browser
 * script src/js/pages/tilastot.js calls public.inflaatio_stats() and draws
 * everything. Setup and how to read it: docs/TILASTOT.md; SQL:
 * docs/supabase-tilastot.sql.
 */

/** @param {any} ctx */
export default async function tilastot(ctx) {
  const { html } = ctx;
  const path = '/tilastot/';
  const title = 'Inflaatio.fi · tilastot';

  const range = [
    ['7', '7 pv'],
    ['30', '30 pv'],
    ['90', '90 pv'],
    ['365', '12 kk'],
    ['all', 'Kaikki'],
  ];

  const main = html`<div class="dash">
<section id="login" class="dash-login" aria-labelledby="login-title">
  <h1 id="login-title">${title}</h1>
  <p class="dash-muted">Ylläpitäjän tilastonäkymä. Kirjaudu Supabasen käyttäjätunnuksella. Istunto pysyy vain tämän välilehden muistissa ja päättyy, kun suljet välilehden tai kirjaudut ulos.</p>
  <form id="login-form" class="dash-login__form" method="post" action="${path}">
    <label for="email">Sähköposti</label>
    <input id="email" name="email" type="email" autocomplete="username" required spellcheck="false" autocapitalize="off">
    <label for="password">Salasana</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit" class="dash-btn dash-btn--primary" id="login-button">Kirjaudu</button>
    <p id="login-error" class="dash-error" role="alert"></p>
  </form>
  <noscript><p class="dash-error">Tilastonäkymä vaatii JavaScriptin.</p></noscript>
</section>

<div id="app" class="dash-app" hidden>
  <header class="dash-top">
    <div>
      <h1>${title}</h1>
      <p id="meta" class="dash-muted dash-small"></p>
    </div>
    <div class="dash-top__actions">
      <div class="dash-seg" id="range" role="radiogroup" aria-label="Aikaväli">
        ${range.map(([v, label]) => html`<button type="button" role="radio" data-range="${v}" aria-checked="${v === '30' ? 'true' : 'false'}" tabindex="${v === '30' ? '0' : '-1'}">${label}</button>`)}
      </div>
      <button type="button" class="dash-btn" id="refresh">Päivitä</button>
      <button type="button" class="dash-btn" id="csv">Lataa CSV</button>
      <button type="button" class="dash-btn dash-btn--ghost" id="logout">Kirjaudu ulos</button>
    </div>
  </header>
  <p id="status" class="dash-status" role="status" aria-live="polite"></p>

  <section id="alerts" class="dash-alerts" aria-labelledby="alerts-title" hidden>
    <h2 id="alerts-title">Huomioita</h2>
    <p class="dash-note">Automaattiset tarkistukset valitulta aikaväliltä. Selitykset: docs/TILASTOT.md, kohta Hälytykset.</p>
    <ul id="alerts-list" class="dash-alert-list"></ul>
  </section>

  <section class="dash-block" aria-labelledby="kpi-title">
    <h2 id="kpi-title">Eilen</h2>
    <p class="dash-note">Eilinen kokonainen päivä verrattuna sitä edeltävän 7 päivän keskiarvoon. Prosenttia ei näytetä, jos keskiarvo on alle 20. Aikaväli ei vaikuta näihin lukuihin.</p>
    <div id="kpis" class="dash-kpis"></div>
    <p class="dash-note dash-small">* Tapahtumat tulevat vain analytiikkasuostumuksen antaneilta.</p>
  </section>

  <section class="dash-card" aria-labelledby="pv-title">
    <h2 id="pv-title">Sivukatselut osioittain</h2>
    <p class="dash-note" id="pv-note"></p>
    <figure class="dash-chart" id="pv-chart"></figure>
    <ul class="dash-legend" id="pv-legend"></ul>
    <ol class="dash-markers" id="pv-markers"></ol>
    <p class="dash-note dash-note--warn" id="pv-anomalies" hidden></p>
  </section>

  <section class="dash-card" aria-labelledby="pages-title">
    <h2 id="pages-title">Suosituimmat sivut</h2>
    <p class="dash-note">Katselut valitulla aikavälillä. Saapumiset = katselut, joihin ei tultu sivuston toiselta sivulta (laskeutumissivut). Upotetun inflaatiokortin lataukset ovat omalla rivillään.</p>
    <div class="dash-table-wrap"><table class="dash-table" id="pages-table"></table></div>
    <p><button type="button" class="dash-btn dash-btn--small" id="pages-more" hidden>Näytä kaikki sivut</button></p>
  </section>

  <section class="dash-card" aria-labelledby="aud-title">
    <h2 id="aud-title">Mistä kävijät tulevat</h2>
    <p class="dash-note">Saapumiset lähteittäin (sivuston sisäisiä siirtymiä ei lasketa) ja laitteet kaikista sivukatseluista valitulla aikavälillä.</p>
    <div class="dash-two">
      <div>
        <h3>Lähteet</h3>
        <div id="sources" class="dash-hbars"></div>
      </div>
      <div>
        <h3>Laitteet</h3>
        <div id="devices" class="dash-stackbar"></div>
        <h3>Viittaavat sivustot</h3>
        <div class="dash-table-wrap dash-table-wrap--scroll"><table class="dash-table" id="ref-table"></table></div>
      </div>
    </div>
  </section>

  <section class="dash-card" aria-labelledby="time-title">
    <h2 id="time-title">Milloin sivustoa käytetään</h2>
    <p class="dash-note" id="heat-note"></p>
    <figure class="dash-chart" id="heat-chart"></figure>
    <div class="dash-legend" id="heat-scale"></div>
    <h3>Viikonpäivät</h3>
    <p class="dash-note">Sivukatseluja päivässä keskimäärin viikonpäivittäin (tämä päivä ei ole mukana).</p>
    <figure class="dash-chart" id="week-chart"></figure>
  </section>

  <section class="dash-card" aria-labelledby="ev-title">
    <h2 id="ev-title">Tapahtumat (vain suostumuksella)</h2>
    <p class="dash-note">Tapahtumat tulevat vain kävijöiltä, jotka sallivat analytiikan, joten ne ovat otos. Käytä niitä suhdelukuina ja trendeinä, älä kokonaismäärinä. Sama tapahtuma samalla tarkenteella lasketaan kerran sivulatausta kohden.</p>
    <figure class="dash-chart" id="ev-chart"></figure>
    <div class="dash-two">
      <div class="dash-table-wrap"><table class="dash-table" id="events-table"></table></div>
      <div class="dash-table-wrap dash-table-wrap--scroll"><table class="dash-table" id="details-table"></table></div>
    </div>
    <h3>Tapahtumat sivuittain</h3>
    <div class="dash-table-wrap dash-table-wrap--scroll"><table class="dash-table" id="event-pages-table"></table></div>
  </section>

  <section class="dash-card" aria-labelledby="table-title">
    <h2 id="table-title">Päivätaulukko</h2>
    <p class="dash-note">Kaikki laskurit päivittäin, uusin ensin. ”–” = ei mitattu (ennen ensimmäistä tallennettua päivää). Sarakeotsikon selite näkyy, kun viet osoittimen sen päälle. CSV sisältää valitun aikavälin päivät.</p>
    <div class="dash-table-wrap dash-table-wrap--tall"><table class="dash-table dash-table--days" id="day-table"></table></div>
  </section>

  <footer class="dash-foot">
    <p class="dash-muted dash-small">Luvut ovat sivulatauksia ja tapahtumia, eivät kävijöitä: tilasto ei tunnista palaavia kävijöitä, koska se ei tallenna tunnisteita. Päivät ja tunnit ovat Suomen aikaa. Sivukatselut lasketaan ilman evästeitä; niitä ei lasketa, jos selaimessa on Do Not Track tai Global Privacy Control päällä, eikä boteille tai automaattiselaimille (30.9.2026 alkaen; sitä ennen luvut voivat olla paisuneita). Lisää: docs/TILASTOT.md.</p>
  </footer>
</div>
</div>`;

  const doc = ctx.layout({
    title,
    description: 'Inflaatio.fi-sivuston ylläpitäjän tilastonäkymä (vaatii kirjautumisen).',
    path,
    page: 'tilastot',
    noindex: true,
    bare: true,
    scripts: ['pages/tilastot.js'],
    head: html`<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="${ctx.asset('tilastot.css')}">`,
    main,
  });

  return [{ path, html: doc, sitemap: false, noindex: true }];
}
