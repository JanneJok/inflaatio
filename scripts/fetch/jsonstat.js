/**
 * JSON-stat 2.0 dataset reader shared by the PxWeb (Tilastokeskus) and
 * Eurostat clients. Pure functions, no I/O.
 *
 * Handles both dense (`value: []`) and sparse (`value: {"12": 1.2}`) value
 * containers, `status` as string / array / object, and category `index`
 * given as an array or as an object.
 */

/**
 * @typedef {{ id: string, label: string, codes: string[], labels: Record<string,string>,
 *   position: Record<string, number>, unit?: Record<string, any> }} Dim
 * @typedef {{ label: string, updated: string|null, source: string|null, ids: string[],
 *   sizes: number[], dims: Record<string, Dim>, extension: any,
 *   get: (coords: Record<string,string>) => number|null,
 *   statusAt: (coords: Record<string,string>) => string|null }} Dataset
 */

/**
 * Parse a JSON-stat 2.0 dataset.
 * @param {any} ds
 * @returns {Dataset}
 */
export function parseJsonStat(ds) {
  if (!ds || typeof ds !== 'object') throw new TypeError('JSON-stat: expected an object');
  if (!Array.isArray(ds.id) || !Array.isArray(ds.size) || !ds.dimension) {
    throw new TypeError(`JSON-stat: missing id/size/dimension (class=${ds.class ?? '?'})`);
  }
  const ids = ds.id.map(String);
  const sizes = ds.size.map(Number);
  if (ids.length !== sizes.length) throw new TypeError('JSON-stat: id and size lengths differ');

  /** @type {Record<string, Dim>} */
  const dims = {};
  ids.forEach((id, k) => {
    const d = ds.dimension[id];
    if (!d?.category) throw new TypeError(`JSON-stat: dimension ${id} has no category`);
    const cat = d.category;
    let codes;
    if (Array.isArray(cat.index)) codes = cat.index.map(String);
    else if (cat.index && typeof cat.index === 'object') {
      codes = Object.keys(cat.index).sort((a, b) => cat.index[a] - cat.index[b]);
    } else codes = Object.keys(cat.label ?? {});
    if (codes.length !== sizes[k]) {
      throw new TypeError(`JSON-stat: dimension ${id} has ${codes.length} categories but size ${sizes[k]}`);
    }
    const position = Object.fromEntries(codes.map((c, i) => [c, i]));
    const labels = Object.fromEntries(codes.map((c) => [c, String(cat.label?.[c] ?? c)]));
    dims[id] = { id, label: String(d.label ?? id), codes, labels, position, unit: cat.unit };
  });

  // Row-major strides: the last dimension varies fastest.
  const strides = new Array(ids.length);
  let stride = 1;
  for (let k = ids.length - 1; k >= 0; k--) {
    strides[k] = stride;
    stride *= sizes[k];
  }
  const total = stride;

  const valueAt = (i) => {
    const v = Array.isArray(ds.value) ? ds.value[i] : ds.value?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const statusRaw = ds.status;
  const statusAtIndex = (i) => {
    if (statusRaw == null) return null;
    if (typeof statusRaw === 'string') return statusRaw || null;
    const s = Array.isArray(statusRaw) ? statusRaw[i] : statusRaw[i];
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  };

  const flatIndex = (coords) => {
    let i = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      let code = coords[id];
      if (code === undefined) {
        if (sizes[k] === 1) code = dims[id].codes[0];
        else throw new RangeError(`JSON-stat: coordinate for dimension ${id} missing (${sizes[k]} categories)`);
      }
      const p = dims[id].position[code];
      if (p === undefined) return -1;
      i += p * strides[k];
    }
    return i < total ? i : -1;
  };

  return {
    label: String(ds.label ?? ''),
    updated: ds.updated ? String(ds.updated) : null,
    source: ds.source ? String(ds.source) : null,
    ids,
    sizes,
    dims,
    extension: ds.extension ?? null,
    get(coords) {
      const i = flatIndex(coords);
      return i < 0 ? null : valueAt(i);
    },
    statusAt(coords) {
      const i = flatIndex(coords);
      return i < 0 ? null : statusAtIndex(i);
    },
  };
}

/**
 * Extract one time series. `where` fixes every non-time dimension that has
 * more than one category.
 * @param {Dataset} ds
 * @param {string} timeDim
 * @param {Record<string,string>} [where]
 * @param {(code: string) => string} [mapTime] converts the time code (e.g. '2026M08' → '2026-08')
 * @returns {{ times: string[], values: (number|null)[], status: (string|null)[] }}
 */
export function seriesOf(ds, timeDim, where = {}, mapTime = (c) => c) {
  const dim = ds.dims[timeDim];
  if (!dim) throw new RangeError(`JSON-stat: no time dimension ${timeDim} (have ${ds.ids.join(', ')})`);
  const times = [];
  const values = [];
  const status = [];
  for (const code of dim.codes) {
    const coords = { ...where, [timeDim]: code };
    times.push(mapTime(code));
    values.push(ds.get(coords));
    status.push(ds.statusAt(coords));
  }
  return { times, values, status };
}

/** '2026M08' → '2026-08'; '2026Q2' → '2026-Q2'; '2026' → '2026'; '2026-08' unchanged. */
export function normaliseTime(code) {
  const s = String(code);
  let m = s.match(/^(\d{4})M(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = s.match(/^(\d{4})-?Q([1-4])$/);
  if (m) return `${m[1]}-Q${m[2]}`;
  return s;
}
