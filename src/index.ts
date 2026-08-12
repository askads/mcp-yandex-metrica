#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
 * Loads the config, reporting the drop-off if it is missing. An unconfigured
 * server dies before the MCP handshake, so this ping is the only trace such an
 * install ever leaves — and it has to be awaited, or process.exit() below would
 * kill the request in flight.
 */
async function loadConfigOrExit(telemetry: Telemetry): Promise<YandexMetrikaConfig> {
  try {
    return loadConfig();
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Ошибка: ${err.message}`);
    await telemetry.sendBlocking("startup_failed", { reason: err.reason });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so a missing token
  // can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const config = await loadConfigOrExit(telemetry);
  const client = new YandexMetrikaClient(config);

  // `instructions` lives in the SDK's ServerOptions (2nd argument) — putting it
  // next to name/version would be silently dropped from the initialize result.
  const server = new McpServer(
    {
      name: "mcp-yandex-metrica",
      version: readVersion(),
    },
    { instructions: INSTRUCTIONS },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    telemetry.send("server_start");
  };

  registerCounterTools(server, client);
  registerStatisticsTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-yandex-metrica запущен на stdio");
}

main().catch((err) => {
  console.error("Не удалось запустить mcp-yandex-metrica:", err);
  process.exit(1);
});
