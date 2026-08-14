#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenStore } from "./auth.js";
import { YandexMetrikaClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { YandexMetrikaConfig } from "./types.js";

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

import { registerAuthTools } from "./tools/auth.js";
import { registerCounterTools } from "./tools/counters.js";
import { registerStatisticsTools } from "./tools/statistics.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Prose returned in the MCP `initialize` result — the only text the calling model
 * reads before it picks a tool. It carries what the tool list cannot: what this API
 * is (and is not), where it refuses to write, and the failures that look like
 * something else. Keep it dense; it is prepended to every session's context.
 */
const INSTRUCTIONS =
  "Яндекс Метрика — это веб-аналитика сайта: визиты, источники, поведение и конверсии по целям " +
  "одного счётчика, а не Яндекс Директ: здесь ничто не создаёт рекламные кампании, не " +
  "останавливает их и не меняет ставки. Ни один инструмент не создаёт и не редактирует счётчик " +
  "или цель: специализированные инструменты работают только на чтение, единственный путь записи — " +
  "raw_request, и он ходит только на хост Метрики, общий для Management (management/v1/...) и " +
  "Reporting (stat/v1/data). Имена метрик и измерений передаются без проверки, поэтому должны " +
  "быть точными; подписи в ответе зависят от Accept-Language, по умолчанию ru. Чтения уже " +
  "повторяются при 429/5xx с нарастающей паузой, таймаут запроса — 60 с, поэтому немедленный " +
  "повтор упавшего вызова не поможет. Пустой ответ list_counters без фильтров означает, что токен " +
  "принадлежит аккаунту Яндекса без доступа к этим счётчикам, а не сбой API; 403 с error_type " +
  "invalid_token означает, что просрочен или неверен сам токен. У Метрики нет песочницы: любой " +
  "вызов идёт по живым боевым данным, а POST/DELETE через raw_request меняет реальные объекты " +
  "Метрики — ему нужен confirmWrite=true, и откатить это нечем.";

/**
 * Prepended to INSTRUCTIONS when no token is available. The model reads this
 * before it picks a tool, so an unconfigured session opens with the fix rather
 * than with a failed call.
 */
const UNCONFIGURED_PREFIX =
  "ВНИМАНИЕ: Яндекс Метрика ещё не подключена — токена нет, поэтому любой инструмент данных " +
  "вернёт ошибку. Подключение делается прямо в диалоге и без перезапуска клиента: вызовите " +
  "start_login, покажите пользователю ссылку, попросите войти под аккаунтом с доступом к нужным " +
  "счётчикам и прислать код подтверждения, затем передайте код в finish_login. ";

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a red cross and no reason — the
 * failure that used to account for nearly every unconfigured install. Instead the
 * problem is carried into the session, where the model can read it and relay it.
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: YandexMetrikaConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Ошибка конфигурации: ${err.message}`);
    // Fire-and-forget now that the process survives: the historical
    // `startup_failed` funnel stays comparable, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      config: {
        lang: process.env.YANDEX_METRIKA_LANG || "ru",
        apiBase: process.env.YANDEX_METRIKA_API_BASE || "https://api-metrika.yandex.net",
      },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a missing token
  // can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const { config, problem } = loadConfigOrDegraded(telemetry);
  const tokens = new TokenStore(config.token);
  const client = new YandexMetrikaClient(config, tokens);

  // Resolved once, at startup, only to pick the instructions text: the token
  // itself is re-read per request, so a login mid-session still takes effect.
  const connected = tokens.hasToken();

  // `instructions` lives in the SDK's ServerOptions (2nd argument) — putting it
  // next to name/version would be silently dropped from the initialize result.
  const server = new McpServer(
    {
      name: "mcp-yandex-metrica",
      version: readVersion(),
    },
    {
      instructions: connected
        ? INSTRUCTIONS
        : UNCONFIGURED_PREFIX + (problem ? `Проблема конфигурации: ${problem.message} ` : "") + INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that number.
    if (connected) telemetry.send("server_start");
    else telemetry.send("unconfigured_start", { reason: problem?.reason ?? "missing_token" });
  };

  registerAuthTools(server, client, tokens);
  registerCounterTools(server, client);
  registerStatisticsTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-yandex-metrica запущен на stdio${connected ? "" : " (без токена — подключение через start_login)"}`,
  );
}

main().catch((err) => {
  console.error("Не удалось запустить mcp-yandex-metrica:", err);
  process.exit(1);
});
