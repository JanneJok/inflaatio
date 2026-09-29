#!/usr/bin/env node
/**
 * Freshness check of the inflation forecasts (src/content/ennusteet.json).
 *
 *   node scripts/check-content.js [--today YYYY-MM-DD] [--report file.md]
 *
 * The home page shows the newest forecast of each publisher × measure × area
 * for FORECAST_MAX_AGE_DAYS after its publication (currentForecasts() in
 * src/js/charts/home-model.js). New forecasts arrive as pull requests from the
 * monthly content routine (docs/SISALTOAGENTTI.md); this check is the safety
 * net for when they stop coming. It fails (exit 1) when
 * - even the newest forecast is older than FORECAST_REMIND_DAYS, or
 * - a forecast has dropped off the home page because it is too old.
 * An empty file is a choice (the section is simply hidden) and passes.
 *
 * Prints a Markdown report in Finnish (and writes it to --report); the weekly
 * workflow .github/workflows/content-check.yml puts it into a GitHub issue.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fmt from '../src/js/lib/format.js';
import { currentForecasts, daysBetween, FORECAST_MAX_AGE_DAYS, FORECAST_REMIND_DAYS } from '../src/js/charts/home-model.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'src', 'content', 'ennusteet.json');

/**
 * @param {unknown} forecasts contents of ennusteet.json
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{ok: boolean, problems: string[], report: string}}
 */
export function checkForecasts(forecasts, today) {
  const { shown, stale } = currentForecasts(forecasts, { today });
  const current = [...shown, ...stale].sort((a, b) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0));
  const age = (f) => daysBetween(f.published, today);
  const problems = [];
  const newest = current[0];
  if (newest && age(newest) > FORECAST_REMIND_DAYS) {
    problems.push(
      `Uusin ennuste (${newest.org}) on julkaistu ${fmt.date(newest.published)} eli ${age(newest)} päivää sitten. Uusia ennusteita ei ole tullut ${FORECAST_REMIND_DAYS} päivään.`,
    );
  }
  for (const f of stale) {
    problems.push(
      `${f.org} (${f.measure}, ${f.area}) ei enää näy etusivulla: ennuste on julkaistu ${fmt.date(f.published)} eli ${age(f)} päivää sitten (raja ${FORECAST_MAX_AGE_DAYS} päivää).`,
    );
  }

  const lines = [`## Ennusteiden tuoreus ${fmt.date(today)}`, ''];
  if (!current.length) lines.push('Tiedostossa `src/content/ennusteet.json` ei ole ennusteita, joten etusivun ennusteosio on piilossa.');
  else {
    lines.push(problems.length ? problems.map((p) => `- ${p}`).join('\n') : 'Kaikki ennusteet ovat ajan tasalla.', '');
    lines.push('| Ennustaja | Mittari | Alue | Julkaistu | Ikä, pv | Etusivulla |', '|---|---|---|---|--:|---|');
    for (const f of current) {
      lines.push(`| ${f.org} | ${f.measure ?? ''} | ${f.area ?? ''} | ${fmt.date(f.published)} | ${age(f)} | ${stale.includes(f) ? 'ei (liian vanha)' : 'kyllä'} |`);
    }
  }
  if (problems.length) {
    lines.push(
      '',
      'Mitä tehdä: tarkista kuukausittaisen sisältöagentin ajot (https://claude.ai/code/routines) tai päivitä ennusteet käsin julkaisijoiden omilta sivuilta. Ohje: `docs/SISALTOAGENTTI.md`.',
    );
  }
  return { ok: problems.length === 0, problems, report: `${lines.join('\n')}\n` };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const get = (name, def) => {
    const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
    if (i < 0) return def;
    return args[i].includes('=') ? args[i].split('=').slice(1).join('=') : args[i + 1];
  };
  const today = get('--today', fmt.isoDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today ?? '')) {
    console.error(`--today: expected YYYY-MM-DD, got ${today}`);
    process.exit(2);
  }
  let forecasts = [];
  try {
    forecasts = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const { ok, report } = checkForecasts(forecasts, today);
  process.stdout.write(report);
  const out = get('--report');
  if (out) await fs.writeFile(out, report);
  process.exit(ok ? 0 : 1);
}
