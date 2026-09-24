/**
 * /oma-inflaatio/ – personal inflation calculator (owner CALC).
 *
 * Personal inflation = weighted mean of the official annual changes of the
 * 13 COICOP main groups (Tilastokeskus 15b5) with the user's weights,
 * normalised (src/js/lib/calc.js personalInflation). Default weights are the
 * official KHI weights of the main groups (15bc). The weighted mean with
 * the official weights is shown next to the official KHI because the index
 * is chain-linked and the two can differ slightly.
 *
 * Server-rendered: default result, the group table (weights, changes,
 * contributions) and the method. src/js/pages/oma-inflaatio.js makes the
 * sliders / €-inputs, profiles and URL state work.
 */
import { html } from '../../scripts/lib/html.js';
import { personalInflation } from '../js/lib/calc.js';
import { out, calcJsonLd, noJsNote, calculatorCards, calcCrumbs, messageData, ablative } from './laskurit.js';

export const PATH = '/oma-inflaatio/';

/**
 * Illustrative example profiles: multipliers on the official weights
 * (assumptions for the example, not statistics; labelled on the page).
 */
const PROFILES = [
  { id: 'keskiarvo', label: 'Keskimääräinen kotitalous', multipliers: {} },
  { id: 'autoton', label: 'Autoton kaupunkilainen', multipliers: { '07': 0.3, '04': 1.15, '11': 1.3, '09': 1.1 } },
  { id: 'autoilija', label: 'Autoilija maaseudulla', multipliers: { '07': 1.6, '04': 1.05, '11': 0.7 } },
  { id: 'elakelainen', label: 'Eläkeläinen', multipliers: { '06': 2, '01': 1.2, '04': 1.15, '03': 0.8, '07': 0.8, '10': 0, '11': 0.8 } },
  { id: 'lapsiperhe', label: 'Lapsiperhe', multipliers: { '01': 1.15, '03': 1.3, '09': 1.1, '10': 2, '11': 0.9 } },
];

const MESSAGES = {
  share: 'Anna osuus prosentteina väliltä 0–100.',
  euro: 'Anna menot euroina, esimerkiksi 250 tai 0.',
  empty: 'Anna ainakin yhdelle ryhmälle osuus tai menot.',
  sumShares: 'Osuudet yhteensä {summa}. Laskuri suhteuttaa ne 100 %:iin.',
  sumEuros: 'Menot yhteensä {summa} kuukaudessa.',
  driver: '{ryhma}: {vaikutus} (osuutesi {oma}, keskimäärin {virallinen}; hinnat {muutos})',
  bigger: 'korkeampi',
  smaller: 'matalampi',
  same: 'Arviosi on sama kuin keskimääräisellä kulutuksella laskettu.',
  diff: 'Arviosi on {ero} {suunta} kuin keskimääräisellä kulutuksella laskettu ({oletus}).',
  largest: 'Suurin tekijä omassa inflaatiossasi: {ryhma} ({vaikutus}).',
};

/**
 * Main groups with official weight (‰), annual change and contribution.
 * @param {any} h data.hyodykkeet
 */
export function mainGroups(h) {
  const byCode = new Map((h?.items ?? []).map((it) => [it.code, it]));
  const codes = (h?.groups?.codes ?? []).filter((c) => c !== 'SSS');
  return codes
    .map((code) => byCode.get(code))
    .filter((it) => it && it.level === 1)
    .map((it) => ({ code: it.code, name: it.shortName ?? it.name, officialName: it.name, weight: it.weight, yoy: it.yoy, contribution: it.contribution }));
}

/** @param {any} ctx */
export default async function omaInflaatio(ctx) {
  const { html: h, fmt: f, c } = ctx;
  const hy = ctx.data.hyodykkeet;
  const k = ctx.latest.khi;
  if (!hy || !k) throw new Error('oma-inflaatio: data/hyodykkeet.json or data/khi.json is missing (run npm run fetch)');
  const month = hy.latest;
  const groups = mainGroups(hy);
  if (groups.length < 5) throw new Error('oma-inflaatio: main groups missing from data/hyodykkeet.json');
  const total = hy.items.find((it) => it.code === 'SSS');
  const official = month === k.month ? k.yoy : total?.yoy;
  const weights = Object.fromEntries(groups.map((g) => [g.code, g.weight]));
  const rates = Object.fromEntries(groups.map((g) => [g.code, g.yoy]));
  const base = personalInflation({ weights, rates });
  if (!base) throw new Error('oma-inflaatio: weights missing');
  const sumW = groups.reduce((s, g) => s + (f.isNum(g.weight) ? g.weight : 0), 0);
  const top = [...base.parts].sort((a, b) => b.contribution - a.contribution)[0];
  const topName = groups.find((g) => g.code === top.key)?.name ?? '';
  const updated = ctx.latest.updated?.hyodykkeet ?? k.updated;
  const pp = (v) => f.pp(v, { decimals: 2 });
  const shareOf = (w) => (w / sumW) * 100;

  const rows = groups.map((g) => {
    const share = f.isNum(g.weight) ? shareOf(g.weight) : null;
    return html`<div class="oi-row" data-code="${g.code}">
  <div class="oi-row__head">
    <label class="oi-row__label" for="oi-${g.code}">${g.name}</label>
    <p class="oi-row__meta" id="oi-${g.code}-tieto">Hinnat ${f.pct(g.yoy, { sign: true })} · keskimäärin ${f.pct(share)} kulutuksesta</p>
  </div>
  <div class="oi-row__control" data-mode="osuus">
    <input type="range" id="oi-${g.code}" name="oi-${g.code}" min="0" max="60" step="0.1" value="${f.round(share, 1)}" aria-valuetext="${f.pct(share)}" aria-describedby="oi-${g.code}-tieto">
    <output class="oi-row__value" for="oi-${g.code}" data-value-for="oi-${g.code}">${f.pct(share)}</output>
  </div>
  <div class="oi-row__control" data-mode="eur" hidden>
    <label class="sr-only" for="oi-${g.code}-eur">${g.name}, euroa kuukaudessa</label>
    <div class="input-affix"><input class="input" type="text" id="oi-${g.code}-eur" name="oi-${g.code}-eur" inputmode="decimal" autocomplete="off" placeholder="0" aria-describedby="oi-${g.code}-tieto oi-${g.code}-eur-virhe"><span class="input-affix__suffix" aria-hidden="true">€/kk</span></div>
    <p class="field__error" id="oi-${g.code}-eur-virhe"></p>
  </div>
</div>`;
  });

  const form = h`<form class="calc__form form js-only oi-form" id="oi-lomake" novalidate${ctx.attrs({ data: messageData(MESSAGES) })}>
  <div class="oi-mode">
    ${c.segmented({
      name: 'oi-tapa',
      label: 'Syötä kulutus',
      value: 'osuus',
      full: true,
      controls: 'oi-ryhmat',
      options: [
        { value: 'osuus', label: 'Osuuksina', sub: 'prosenttia' },
        { value: 'eur', label: 'Euroina', sub: 'kuukaudessa' },
      ],
    })}
  </div>
  <div class="oi-profiles" role="group" aria-labelledby="oi-profiilit-otsikko">
    <p class="oi-profiles__title" id="oi-profiilit-otsikko">Esimerkkiprofiilit</p>
    <div class="oi-profiles__list">${PROFILES.map((p) => c.button({ label: p.label, size: 'sm', variant: 'ghost', attrs: { data: { profile: p.id }, 'aria-pressed': p.id === 'keskiarvo' ? 'true' : 'false' } }))}</div>
    <p class="field__hint">Keskimääräinen kotitalous = Tilastokeskuksen viralliset painot. Muut profiilit ovat suuntaa antavia esimerkkejä, eivät tilastoja.</p>
  </div>
  <fieldset class="oi-groups" id="oi-ryhmat">
    <legend class="field__label">Kulutuksen jakauma hyödykeryhmittäin</legend>
    ${rows}
  </fieldset>
  ${out('sum', MESSAGES.sumShares.replace('{summa}', f.pct(100)), 'p', { class: 'oi-sum', id: 'oi-summa' })}
  <p class="field__error" id="oi-virhe"></p>
  <div class="calc__actions">
    ${c.button({ label: 'Palauta keskimääräiset painot', size: 'sm', variant: 'secondary', attrs: { data: { reset: '' } } })}
    ${c.shareButton({ label: 'Kopioi linkki', size: 'sm', track: 'result_shared' })}
  </div>
</form>`;

  const diffText = MESSAGES.same;
  const largest = MESSAGES.largest.replace('{ryhma}', topName.toLowerCase()).replace('{vaikutus}', pp(top.contribution));
  const result = h`<div class="calc__result" id="oi-tulos" role="region" aria-labelledby="oi-tulos-otsikko">
  <h3 class="calc__result-title" id="oi-tulos-otsikko">Oma inflaatiosi</h3>
  <div data-result-ok>
    <div class="calc__live" aria-live="polite" aria-atomic="true">
      <p class="calc__big">${out('rate', f.pct(base.rate))}</p>
      <p class="calc__lead">Arvio kuluttajahintojen vuosimuutoksesta ${f.inessive(month)} sinun kulutuksellasi. Virallinen kuluttajahintaindeksi: <strong>${f.pct(official)}</strong> (Tilastokeskus).</p>
    </div>
    ${out('diff', diffText, 'p', { class: 'calc__rule' })}
    ${out('largest', largest, 'p', { class: 'calc__lead' })}
    <div class="oi-drivers" data-drivers hidden>
      <p class="oi-drivers__title">Eniten eroa selittävät</p>
      <ol class="oi-drivers__list" data-drivers-list></ol>
    </div>
    <dl class="calc__facts">
      <div><dt>Oma arvio</dt><dd>${out('rateFact', f.pct(base.rate, { decimals: 2 }))}</dd></div>
      <div><dt>Keskimääräisellä kulutuksella</dt><dd>${f.pct(base.rate, { decimals: 2 })}</dd></div>
      <div><dt>Virallinen KHI</dt><dd>${f.pct(official)}</dd></div>
    </dl>
  </div>
  <p class="calc__error" data-result-error hidden role="alert">Tulosta ei voi laskea. Anna ainakin yhdelle ryhmälle osuus tai menot.</p>
  <p class="calc__disclaimer">Arvio on likiarvo: se käyttää pääryhmien virallisia hintamuutoksia ja painoja (${hy.weightYear}), ei omia ostoksiasi.</p>
</div>`;

  const table = c.dataTable({
    id: 'oi-painot',
    caption: `Hyödykeryhmät ${f.monthName(month)}: paino, vuosimuutos ja vaikutus inflaatioon`,
    columns: [
      { label: 'Ryhmä' },
      { label: `Paino ${hy.weightYear}`, num: true },
      { label: 'Vuosimuutos', num: true },
      { label: 'Vaikutus, %-yks.', num: true },
    ],
    rows: [
      ...groups.map((g) => [g.name, f.isNum(g.weight) ? f.pct(shareOf(g.weight)) : f.DASH, f.pct(g.yoy, { sign: true }), c.numUnit(f.num(g.contribution, 2, { sign: true }))]),
      { cells: [html`<strong>Kaikki yhteensä</strong>`, f.pct(100), f.pct(total?.yoy ?? official), c.numUnit(f.num(total?.contribution ?? official, 2, { sign: true }))], className: 'oi-total' },
    ],
    note: `Lähde: Tilastokeskus, kuluttajahintaindeksi (taulukot 15b5 ja 15bc), ${f.monthName(month)}, perusvuosi ${hy.base}. Vaikutus = ryhmän osuus kokonaisinflaatiosta prosenttiyksikköinä.`,
    compact: true,
  });

  const island = ctx.jsonScript('oma-data', {
    month,
    official,
    groups: groups.map((g) => ({ code: g.code, name: g.name, weight: g.weight, yoy: g.yoy })),
    profiles: PROFILES.map((p) => ({ id: p.id, multipliers: p.multipliers })),
  });

  const method = h`<div class="prose">
  <p>Arvio lasketaan painotettuna keskiarvona: <code>oma inflaatio = Σ (osuus × ryhmän hintamuutos) / Σ osuudet</code>. Hintamuutokset ovat Tilastokeskuksen julkaisemia 13 pääryhmän vuosimuutoksia ${ablative(month)} ja oletusosuudet kuluttajahintaindeksin virallisia painoja vuodelle ${hy.weightYear}.</p>
  <p>Keskimääräisillä painoilla laskettu arvio (${f.pct(base.rate, { decimals: 2 })}) poikkeaa hieman virallisesta luvusta (${f.pct(official)}), koska virallinen indeksi on ketjutettu: painot päivitetään vuosittain, ja vuosimuutos vertaa kahta eri vuoden painorakennetta. Siksi omaa arviota kannattaa verrata ennen kaikkea keskimääräisillä painoilla laskettuun lukuun.</p>
  <p>Pääryhmän sisällä hinnat muuttuvat eri tahtiin. Esimerkiksi asumisen ryhmään kuuluvat vuokrat, sähkö ja asuntolainojen korot, joten oma inflaatiosi riippuu myös siitä, mitä ryhmän sisällä ostat. Tarkemmat hyödykkeet löydät <a href="/hinnat/">Hinnat</a>-sivulta.</p>
</div>`;

  const main = h`${c.pageHeader({
    eyebrow: `Laskuri · Hyödykeryhmät ${f.monthName(month)}`,
    title: 'Oma inflaatio',
    lede: `Kuluttajahintaindeksi kuvaa keskimääräisen kotitalouden kulutusta. Arvioi, paljonko hinnat nousivat sinun kulutuksellasi: muuta ryhmien osuuksia tai syötä kuukausimenosi euroina. ${f.capitalize(f.inessive(month))} ${topName.toLowerCase()} vaikutti inflaatioon eniten.`,
    meta: h`Päivitetty <time datetime="${String(updated).slice(0, 10)}">${f.date(updated)}</time> · Lähde: Tilastokeskus`,
  })}
${c.section({ id: 'laskuri', title: 'Laske oma inflaatiosi', className: 'section--flush-top', body: h`${noJsNote(c, 'Alla on keskimääräisen kotitalouden tulos ja taulukko ryhmien painoista ja hintamuutoksista. Voit laskea oman arviosi itse: kerro kunkin ryhmän osuus sen hintamuutoksella ja laske tulot yhteen.')}<div class="calc">${form}${result}</div>${island}` })}
${c.section({ id: 'ryhmat', title: 'Hyödykeryhmien painot ja hinnat', intro: `Viralliset luvut ${ablative(month)}.`, body: table })}
${c.section({ id: 'menetelma', title: 'Näin arvio lasketaan', body: method })}
${c.section({ id: 'muut-laskurit', title: 'Muut laskurit', body: c.cardGrid(calculatorCards(ctx, { exclude: PATH })) })}`;

  const description = `Laske oma inflaatiosi kulutuksesi mukaan. ${f.capitalize(f.inessive(month))} virallinen KHI ${f.pct(official)}; ${topName.toLowerCase()} kallistui ${f.pct(groups.find((g) => g.code === top.key)?.yoy)}.`;
  return [
    {
      path: PATH,
      html: ctx.layout({
        title: 'Oma inflaatio -laskuri kulutuksesi mukaan',
        description,
        path: PATH,
        page: 'oma-inflaatio',
        scripts: ['pages/oma-inflaatio.js'],
        breadcrumbs: calcCrumbs(ctx, PATH, 'Oma inflaatio'),
        jsonLd: [calcJsonLd(ctx, { name: 'Oma inflaatio -laskuri', path: PATH, description })],
        main,
      }),
      changefreq: 'monthly',
    },
  ];
}
