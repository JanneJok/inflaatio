/**
 * Helpers for Tilastokeskus commodity (hyödyke) codes of table 15b5
 * (COICOP 2018 / ECOICOP ver.2, from January 2026).
 *
 * PxWeb codes are the COICOP code without dots ('01113' = 01.1.1.3); the
 * total is 'SSS'. Labels look like '01.1.1.3 Leipä ja leipomotuotteet (LI)',
 * where the trailing marker tells the nature of the item:
 *   LI = lyhytikäinen (non-durable), PKS = puolikestävä (semi-durable),
 *   KS = kestävä (durable), P = palvelu (service).
 */
import { sentenceCase } from './util.js';

export const TOTAL = 'SSS';

/** Everyday Finnish names for the 13 main groups (SPEC: "arkikieliset ryhmänimet"). */
export const MAIN_GROUP_SHORT = Object.freeze({
  '01': 'Ruoka ja alkoholittomat juomat',
  '02': 'Alkoholi ja tupakka',
  '03': 'Vaatteet ja kengät',
  '04': 'Asuminen ja energia',
  '05': 'Kodin kalusteet ja kodinhoito',
  '06': 'Terveys',
  '07': 'Liikenne',
  '08': 'Viestintä',
  '09': 'Kulttuuri ja vapaa-aika',
  '10': 'Koulutus',
  '11': 'Ravintolat ja majoitus',
  '12': 'Vakuutukset ja rahoituspalvelut',
  '13': 'Hygienia, sosiaalipalvelut ja muut',
});

/** Hierarchy level: total 0, '01' 1, '011' 2, '0111' 3 … */
export function levelOf(code) {
  return code === TOTAL ? 0 : Math.max(1, String(code).length - 1);
}

/**
 * Split a PxWeb label into its dotted COICOP code, display name and nature
 * marker: '01.1.1.3 Leipä ja leipomotuotteet (LI)' →
 * { coicop: '01.1.1.3', name: 'Leipä ja leipomotuotteet', nature: 'LI' }.
 * Upper-case main-group labels are turned into sentence case.
 */
export function parseLabel(label) {
  const s = String(label).trim();
  const m = s.match(/^(\d{1,2}(?:\.\d+)*)\s+(.*)$/);
  let coicop = m ? m[1] : null;
  let rest = m ? m[2] : s;
  if (coicop === '0') coicop = null; // '0 Yhteensä'
  let nature = null;
  const n = rest.match(/\s*\((LI|PKS|KS|P)\)\s*$/);
  if (n) {
    nature = n[1];
    rest = rest.slice(0, n.index);
  }
  return { coicop, name: sentenceCase(rest.trim()), nature };
}

/**
 * Parent code = longest proper prefix present in `codes`; main groups → total.
 * @param {string} code
 * @param {Set<string>} codes
 */
export function parentOf(code, codes) {
  if (code === TOTAL) return null;
  for (let len = code.length - 1; len >= 2; len--) {
    const p = code.slice(0, len);
    if (codes.has(p)) return p;
  }
  return codes.has(TOTAL) ? TOTAL : null;
}
