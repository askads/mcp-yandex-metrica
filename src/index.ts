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
  "Yandex Metrica is site web-analytics — visits, sources, behaviour and goal conversions for one " +
  "counter — not Yandex Direct: nothing here creates, pauses or re-prices an ad campaign. No tool " +
  "creates or edits a counter or a goal: every dedicated tool is read-only and raw_request is the " +
  "only write path, and it reaches only the Metrica host, shared by the Management " +
  "(management/v1/...) and Reporting (stat/v1/data) surfaces. Metric and dimension names are " +
  "forwarded unvalidated, so they have to be exact; response labels follow Accept-Language, ru by " +
  "default. Reads already retry 429/5xx with backoff behind a 60s per-request timeout, so repeating " +
  "a failed call immediately will not help. An unfiltered list_counters coming back empty means the " +
  "token belongs to a Yandex account without access to those counters, not an API failure; a 403 " +
  "with error_type invalid_token means the token itself is expired or wrong. Metrica has no " +
  "sandbox: every call hits live production data, and a raw_request POST/DELETE mutates real " +
  "Metrica objects — it needs confirmWrite=true and nothing undoes it.";

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
    console.error(`Error: ${err.message}`);
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
  console.error("mcp-yandex-metrica running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting mcp-yandex-metrica:", err);
  process.exit(1);
});
