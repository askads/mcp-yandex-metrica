import type { YandexMetrikaConfig } from "./types.js";
import { YandexMetrikaError } from "./types.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

/** A query string value; undefined and empty-string values are dropped. */
export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

/** Largest page size the Stat API ("stat/v1/data") accepts. */
export const STAT_MAX_LIMIT = 100_000;
/** Page size used when paginating the Stat API automatically. */
export const STAT_PAGE_LIMIT = 10_000;
/** Hard row cap for autoPaginate so a runaway report can't exhaust memory/context. */
export const STAT_MAX_ROWS = 100_000;
/** Hard byte cap (serialized rows) for autoPaginate — ~1 MB. */
export const STAT_MAX_BYTES = 1_000_000;
/** Default page-follow cap for autoPaginate. */
export const STAT_MAX_PAGES = 100;

/** Optional caps for {@link YandexMetrikaClient.getAllStat}. */
export interface AutoPaginateCaps {
  maxRows?: number;
  maxBytes?: number;
}

/** A Stat API response: a page of `data` rows plus grand totals and sampling flags. */
export interface StatPage {
  data: unknown[];
  totals?: unknown;
  total_rows?: number;
  sampled?: boolean;
  sample_share?: number;
  query?: unknown;
  _truncated?: boolean;
  _truncatedNote?: string;
  [key: string]: unknown;
}

export class YandexMetrikaClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(private readonly config: YandexMetrikaConfig) {
    // Normalize to a trailing slash so relative paths ("stat/v1/data") resolve.
    this.base = config.apiBase.endsWith("/") ? config.apiBase : config.apiBase + "/";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  /** Default counter id from config (env), used when a tool omits counterId. */
  get defaultCounterId(): number | undefined {
    return this.config.counterId;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `OAuth ${this.config.token}`,
      "Accept-Language": this.config.lang,
      ...extra,
    };
  }

  /** Backoff before a retry: honors Retry-After when present, else exponential (capped at 30s). */
  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = res ? Number(res.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30_000);
  }

  /**
   * fetch with an AbortController timeout so a hung connection can't hang the tool
   * forever. The response body is read INSIDE the guarded zone so the timeout also
   * covers a slow (drip-feed) body, not just the headers — hence the return type
   * carries both the response and its already-read text.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request to "${label}" timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path.replace(/^\//, ""), this.base);
    // SSRF guard: an absolute path ("https://evil/x", "http://evil/x") or a
    // protocol-relative one ("\\evil/x") overrides the base, so the request —
    // carrying the OAuth token — would go to a foreign host. Reject anything
    // that does not resolve back onto the configured API origin.
    if (url.origin !== new URL(this.base).origin) {
      throw new Error(
        `raw_request path must be a relative API path (resolved to foreign origin ${url.origin})`,
      );
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === "") continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Issues a request to a Metrica API path (e.g. "management/v1/counters" or
   * "stat/v1/data") and returns the parsed JSON body. Retries 429 and 5xx with
   * backoff; any other non-2xx status throws a {@link YandexMetrikaError}.
   */
  async request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const hasBody = opts.body !== undefined && method !== "GET";
    // Only GET is safe to retry blindly: replaying a POST/DELETE that already
    // committed on the backend (but returned 5xx / dropped the connection) would
    // duplicate the write.
    const idempotent = method === "GET";

    for (let attempt = 0; ; attempt++) {
      const url = this.buildUrl(path, opts.query);

      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(
          url,
          {
            method,
            headers: this.headers(hasBody ? { "Content-Type": "application/json" } : undefined),
            body: hasBody ? JSON.stringify(opts.body) : undefined,
          },
          path,
        ));
      } catch (err) {
        // Network errors / timeouts (ECONNRESET, DNS, AbortError): retry only for
        // idempotent GET; on the last attempt rethrow the original error.
        if (idempotent && attempt < this.maxRetries) {
          await delay(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      // 429 (request not processed) is safe to retry for any method; 5xx is only
      // retried for idempotent GET, since a POST/DELETE may have committed before
      // the gateway returned 5xx (retry → duplicate write).
      const transient = res.status === 429 || (idempotent && res.status >= 500 && res.status < 600);
      if (transient && attempt < this.maxRetries) {
        await delay(this.backoffMs(attempt, res));
        continue;
      }

      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) throw new YandexMetrikaError(res.status, data);
      return data as T;
    }
  }

  async get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  /**
   * Reads the Stat API ("stat/v1/data"), following limit/offset to fetch every
   * row and merging the `data` arrays, so large reports are not silently
   * truncated. Carries `totals`/`total_rows`/`sampled` from the first page
   * (the grand totals are the same on every page); flags `_truncated` if a cap
   * (maxPages, STAT_MAX_ROWS or STAT_MAX_BYTES) stops it with rows remaining.
   * The per-tool `limit` is intentionally ignored here — pagination always uses
   * the API-max page size so capacity is deterministic. Metrica's offset is 1-based.
   */
  async getAllStat(
    query: Record<string, QueryValue> = {},
    maxPages = STAT_MAX_PAGES,
    caps: AutoPaginateCaps = {},
  ): Promise<StatPage> {
    const limit = STAT_PAGE_LIMIT;
    const maxRows = caps.maxRows ?? STAT_MAX_ROWS;
    const maxBytes = caps.maxBytes ?? STAT_MAX_BYTES;
    let offset = Number(query.offset ?? 1) || 1;
    let first: StatPage | undefined;
    const data: unknown[] = [];
    let totalRows = 0;
    let bytes = 0;
    let truncated = false;
    let cappedNote: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const res = await this.get<StatPage>("stat/v1/data", { ...query, limit, offset });
      if (!first) first = res;
      const batch = Array.isArray(res.data) ? res.data : [];
      data.push(...batch);
      bytes += batch.length ? JSON.stringify(batch).length : 0;
      totalRows = typeof res.total_rows === "number" ? res.total_rows : data.length;
      offset += batch.length;

      // Stop cleanly when the API has no more rows. Checked BEFORE the caps so a
      // dataset that completes exactly on a cap boundary is not falsely flagged
      // as truncated (nothing left to fetch → no "narrow the range" advice).
      if (batch.length === 0 || batch.length < limit || offset > totalRows) break;

      // Hard caps: more rows remain, but stop before a runaway report exhausts
      // memory or the downstream context.
      if (data.length >= maxRows || bytes >= maxBytes) {
        truncated = true;
        cappedNote =
          `Stopped at the autoPaginate cap (${data.length} rows / ${bytes} bytes); ` +
          `returned ${data.length} of ${totalRows} rows. ` +
          "Narrow the date range, dimensions or filters to get the rest.";
        break;
      }

      if (page === maxPages - 1) truncated = true;
    }

    const result: StatPage = { ...(first ?? { data: [] }), data, total_rows: totalRows };
    if (truncated) {
      result._truncated = true;
      result._truncatedNote =
        cappedNote ??
        `Stopped at the ${maxPages}-page cap; returned ${data.length} of ${totalRows} rows. ` +
          "Narrow the date range, dimensions or filters to get the rest.";
    }
    return result;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
