import type { YandexMetrikaConfig } from "./types.js";

/** Builds the client config from environment variables, exiting if the token is missing. */
export function loadConfig(): YandexMetrikaConfig {
  const token = process.env.YANDEX_METRIKA_TOKEN;
  if (!token) {
    console.error("Error: YANDEX_METRIKA_TOKEN environment variable is required.");
    process.exit(1);
  }

  const counterRaw = process.env.YANDEX_METRIKA_COUNTER_ID;
  const counterId = counterRaw !== undefined && counterRaw !== "" ? Number(counterRaw) : undefined;
  if (counterId !== undefined && !Number.isFinite(counterId)) {
    console.error(`Error: YANDEX_METRIKA_COUNTER_ID must be a number, got "${counterRaw}".`);
    process.exit(1);
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
