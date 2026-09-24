/**
 * View state in the query string (e.g. ?mittari=ykhi&jakso=5v) without
 * adding history entries (history.replaceState). Values are validated by the
 * caller through `allowed` lists; unknown values are ignored.
 */

/**
 * Read one query parameter.
 * @param {string} name
 * @param {readonly string[]} [allowed] accepted values (others → null)
 * @returns {string|null}
 */
export function getParam(name, allowed) {
  let v;
  try {
    v = new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
  if (v == null) return null;
  return !allowed || allowed.includes(v) ? v : null;
}

/** All query parameters as an object. @returns {Record<string, string>} */
export function getParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/**
 * Set or remove query parameters in place. A value equal to its default (or
 * null/undefined/'') removes the parameter so default URLs stay clean.
 * @param {Record<string, string|number|null|undefined>} values
 * @param {{defaults?: Record<string, string>}} [o]
 */
export function setParams(values, { defaults = {} } = {}) {
  const url = new URL(window.location.href);
  for (const [k, raw] of Object.entries(values)) {
    const v = raw == null ? '' : String(raw);
    if (v === '' || v === defaults[k]) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== now) {
    try {
      window.history.replaceState(window.history.state, '', next);
    } catch {
      /* sandboxed iframe: ignore */
    }
  }
}
