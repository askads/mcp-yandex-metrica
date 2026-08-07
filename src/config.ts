import type { YandexMetrikaConfig } from "./types.js";

/**
 * A missing or malformed environment variable. Thrown instead of exiting on the
 * spot so index.ts can report the drop-off before the process dies; `reason` is
 * the machine-readable code that ships with that ping (never a variable's value).
 */
export class ConfigError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "ConfigError";
    this.reason = reason;
  }
}

/** Builds the client config from environment variables, throwing ConfigError if one is bad. */
export function loadConfig(): YandexMetrikaConfig {
  const token = process.env.YANDEX_METRIKA_TOKEN;
  if (!token) {
    throw new ConfigError(
      "YANDEX_METRIKA_TOKEN environment variable is required.",
      "missing_token",
    );
  }

  const counterRaw = process.env.YANDEX_METRIKA_COUNTER_ID;
  const counterId = counterRaw !== undefined && counterRaw !== "" ? Number(counterRaw) : undefined;
  if (counterId !== undefined && !Number.isFinite(counterId)) {
    throw new ConfigError(
      `YANDEX_METRIKA_COUNTER_ID must be a number, got "${counterRaw}".`,
      "invalid_counter_id",
    );
  }

  const timeoutMs = Number(process.env.YANDEX_METRIKA_TIMEOUT_MS);
  const maxRetries = Number(process.env.YANDEX_METRIKA_MAX_RETRIES);

  return {
    token,
    counterId,
    lang: process.env.YANDEX_METRIKA_LANG || "ru",
    apiBase: process.env.YANDEX_METRIKA_API_BASE || "https://api-metrika.yandex.net",
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? maxRetries : 3,
  };
}
