export interface YandexMetrikaConfig {
  token: string;
  /** Default counter id used when a tool call omits counterId. Optional. */
  counterId?: number;
  /** Accept-Language header sent with every request. */
  lang: string;
  /** API root host. Defaults to https://api-metrika.yandex.net. */
  apiBase: string;
  /** Per-request timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Max retries for transient errors (429 rate limit, 5xx). Defaults to 3. */
  maxRetries?: number;
  /** Base backoff in milliseconds, doubled each retry. Defaults to 500. */
  retryBaseMs?: number;
}

/**
 * Yandex Metrica reports failures as a non-2xx HTTP status with a JSON body of
 * the shape { code, message, errors: [{ error_type, message }] }. The parsed
 * body is kept alongside the status and a short readable message is derived.
 */
export class YandexMetrikaError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, body: unknown) {
    super(`HTTP ${status}: ${formatErrorBody(body)}`);
    this.name = "YandexMetrikaError";
    this.status = status;
    this.body = body;
  }
}

/** Turns a parsed Metrica error body into a short, readable message. */
function formatErrorBody(body: unknown): string {
  if (body == null) return "(no body)";
  if (typeof body === "string") return body.slice(0, 500);
  if (typeof body !== "object") return String(body);
  const obj = body as Record<string, unknown>;

  // Metrica style: { code, message, errors: [{ error_type, message }] }
  if (Array.isArray(obj.errors) && obj.errors.length > 0) {
    const parts = (obj.errors as Array<Record<string, unknown>>).map((e) => {
      const type = typeof e.error_type === "string" ? `${e.error_type}: ` : "";
      const message = typeof e.message === "string" ? e.message : JSON.stringify(e);
      return `${type}${message}`;
    });
    return parts.join("; ").slice(0, 500);
  }

  // OAuth style: { error: "...", error_description: "..." }
  if (typeof obj.error === "string") {
    const desc = typeof obj.error_description === "string" ? `: ${obj.error_description}` : "";
    return `${obj.error}${desc}`;
  }

  if (typeof obj.message === "string") return obj.message.slice(0, 500);
  return JSON.stringify(obj).slice(0, 500);
}
