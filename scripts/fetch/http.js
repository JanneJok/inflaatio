/**
 * Minimal HTTP helpers for the data fetchers (Node 24 native fetch, no deps).
 *
 * - every request has a timeout (AbortSignal.timeout, default 30 s);
 * - HTTP 429, 5xx and network/timeout errors are retried with exponential
 *   backoff (default 3 retries → at most 4 attempts); `Retry-After` is honoured;
 * - 4xx errors (other than 408/429) fail immediately with the status, the URL
 *   and the beginning of the response body in the message (PxWeb and Eurostat
 *   explain bad variable/dimension codes in the body).
 *
 * All functions accept `opts.fetchImpl` and `opts.sleep` so tests can run
 * without network.
 */

export const USER_AGENT = 'inflaatio.fi-data-fetch/2 (+https://inflaatio.fi/tietoa/)';

const DEFAULTS = Object.freeze({
  timeoutMs: 30_000,
  retries: 3,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
});

/** Error thrown for non-2xx responses. */
export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {{status: number, url: string, body?: string}} info
   */
  constructor(message, { status, url, body = '' }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** True when a failed attempt is worth retrying. */
export function isRetryable(err) {
  if (err instanceof HttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
  // AbortSignal.timeout → TimeoutError; undici network failures → TypeError('fetch failed')
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return true;
  if (err instanceof TypeError) return true;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_)/.test(code);
}

/** Backoff for attempt n (1-based): base·2^(n−1) with ±20 % jitter, capped. */
export function backoffDelay(attempt, { baseDelayMs = DEFAULTS.baseDelayMs, maxDelayMs = DEFAULTS.maxDelayMs } = {}, rnd = Math.random) {
  const raw = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(raw * (0.8 + 0.4 * rnd()));
}

/** Parse a Retry-After header (seconds or HTTP date) into ms, or null. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const s = Number(value);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Shorten a response body for error messages (strip HTML tags, collapse space). */
export function snippet(text, max = 300) {
  const s = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Perform one HTTP request with timeout + retries and return the Response
 * together with its body text.
 * @param {string} url
 * @param {RequestInit & {timeoutMs?: number, retries?: number, baseDelayMs?: number,
 *   maxDelayMs?: number, fetchImpl?: typeof fetch, sleep?: (ms:number)=>Promise<void>,
 *   label?: string, onRetry?: (info:{attempt:number, delay:number, error:Error})=>void}} [opts]
 * @returns {Promise<{response: Response, text: string}>}
 */
export async function request(url, opts = {}) {
  const {
    timeoutMs = DEFAULTS.timeoutMs,
    retries = DEFAULTS.retries,
    baseDelayMs = DEFAULTS.baseDelayMs,
    maxDelayMs = DEFAULTS.maxDelayMs,
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    label = '',
    onRetry,
    headers = {},
    ...init
  } = opts;
  const what = label ? `${label}: ` : '';
  for (let attempt = 1; ; attempt++) {
    let retryAfter = null;
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { 'user-agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) {
        retryAfter = retryAfterMs(response.headers?.get?.('retry-after'));
        throw new HttpError(
          `${what}HTTP ${response.status} ${response.statusText ?? ''} for ${init.method ?? 'GET'} ${url}${text ? ` — ${snippet(text)}` : ''}`.trim(),
          { status: response.status, url, body: text },
        );
      }
      return { response, text };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt > retries || !isRetryable(error)) {
        if (!(error instanceof HttpError)) {
          const reason = error.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : error.cause?.code ?? error.message;
          throw new Error(`${what}request failed for ${init.method ?? 'GET'} ${url} after ${attempt} attempt(s): ${reason}`, { cause: err });
        }
        if (attempt > 1) error.message += ` (after ${attempt} attempts)`;
        throw error;
      }
      const delay = Math.min(maxDelayMs, retryAfter ?? backoffDelay(attempt, { baseDelayMs, maxDelayMs }));
      onRetry?.({ attempt, delay, error });
      await sleep(delay);
    }
  }
}

/** Parse JSON with a clear error message. */
function parseJson(text, url, label) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${label ? `${label}: ` : ''}invalid JSON from ${url}: ${e.message} — ${snippet(text, 120)}`, { cause: e });
  }
}

/**
 * GET a JSON document.
 * @param {string} url
 * @param {Parameters<typeof request>[1]} [opts]
 * @returns {Promise<{json: any, headers: Headers}>}
 */
export async function getJsonWithHeaders(url, opts = {}) {
  const { response, text } = await request(url, { ...opts, method: 'GET', headers: { accept: 'application/json', ...opts.headers } });
  return { json: parseJson(text, url, opts.label), headers: response.headers };
}

/** GET a JSON document and return the parsed body. */
export async function getJson(url, opts = {}) {
  return (await getJsonWithHeaders(url, opts)).json;
}

/** POST a JSON body and return the parsed JSON response. */
export async function postJson(url, body, opts = {}) {
  const { text } = await request(url, {
    ...opts,
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...opts.headers },
    body: JSON.stringify(body),
  });
  return parseJson(text, url, opts.label);
}

/** GET a text document (CSV, HTML). Returns the text and the response headers. */
export async function getText(url, opts = {}) {
  const { response, text } = await request(url, { ...opts, method: 'GET' });
  return { text, headers: response.headers };
}
