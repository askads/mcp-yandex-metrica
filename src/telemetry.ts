/**
 * Anonymous usage telemetry — fire-and-forget pings to usage.gistrec.cloud.
 *
 * Privacy contract (mirrored by the receiver): only an anonymous random
 * instance id, event/tool names, a fixed-vocabulary failure reason or tool outcome and
 * environment versions ever leave the machine. The API token, account data,
 * tool arguments, prompts and the names or values of environment variables are
 * never read, serialized or sent. Sends are capped at 2 s and swallow every
 * error — telemetry must never affect the server's operation.
 * Opt out for every Ask Ads MCP server at once: ASKADS_TELEMETRY=0
 * (also accepts false/off/no).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const ENDPOINT = "https://usage.gistrec.cloud/v1/events";
const APP = "mcp-yandex-metrica";
const SEND_TIMEOUT_MS = 2000;

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.ASKADS_TELEMETRY ?? "").trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

/**
 * Stable anonymous installation id, persisted under the user's config dir.
 * Any filesystem failure degrades to an ephemeral id: the ping still counts
 * today's activity, just not installation uniqueness across restarts.
 */
function loadInstanceId(): string {
  try {
    const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
    const dir = join(base, APP);
    const file = join(dir, "instance-id");
    try {
      const existing = readFileSync(file, "utf8").trim();
      if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(existing)) return existing;
    } catch {
      // first run — fall through and mint one
    }
    const id = randomUUID();
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${id}\n`);
    return id;
  } catch {
    return randomUUID();
  }
}

export interface ClientInfo {
  name?: string;
  version?: string;
}

/**
 * `server_start` fires after the MCP handshake, `tool_call` per invocation and
 * `startup_failed` when the process dies on missing credentials — the only
 * signal that someone installed the server but never got a key in.
 */
/**
 * `startup_failed` predates the login flow and still means "config unusable at
 * startup"; it is kept unchanged so the historical funnel stays comparable.
 * `unconfigured_start` is its live counterpart — the server now survives that
 * state and completes the handshake, so this is the first event that can carry
 * the client's name for an install that has no token yet.
 */
export type TelemetryEvent =
  | "server_start"
  | "tool_call"
  | "startup_failed"
  | "unconfigured_start";

/** `tool` rides with tool_call; `reason` with tool_call (a TOOL_OUTCOMES constant) and startup_failed. */
export interface EventFields {
  tool?: string;
  reason?: string;
}

export class Telemetry {
  private readonly instanceId: string;
  private clientInfo: ClientInfo | undefined;

  constructor(
    private readonly appVersion: string,
    private readonly enabled: boolean = telemetryEnabled(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.instanceId = enabled ? loadInstanceId() : "";
  }

  /** The MCP initialize handshake tells us which agent host is on the other side. */
  setClientInfo(info: ClientInfo | undefined): void {
    this.clientInfo = info;
  }

  /** Fire-and-forget: the server's own work never waits on a ping. */
  send(event: TelemetryEvent, fields: EventFields = {}): void {
    void this.post(event, fields);
  }

  /**
   * The same ping, awaited. Only for the startup_failed path: that caller
   * calls process.exit() immediately after, which would kill an in-flight
   * fire-and-forget request before it ever left the machine.
   */
  async sendBlocking(event: TelemetryEvent, fields: EventFields = {}): Promise<void> {
    await this.post(event, fields);
  }

  private async post(event: TelemetryEvent, fields: EventFields): Promise<void> {
    if (!this.enabled) return;
    const body = JSON.stringify({
      app: APP,
      event,
      instance_id: this.instanceId,
      app_version: this.appVersion,
      client_name: this.clientInfo?.name,
      client_version: this.clientInfo?.version,
      tool: fields.tool,
      reason: wireReason(event, fields.reason),
      node_version: process.version,
      os: process.platform,
    });
    try {
      await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      // network failure, timeout abort or a synchronous throw — all silent
    }
  }
}

/**
 * How a tool call ended — the only thing about it, besides the tool name, that leaves the
 * machine. A closed vocabulary: the error text is matched HERE, locally, and only one of
 * these constants is sent; the receiver drops any `tool_call` reason outside this list.
 */
export const TOOL_OUTCOMES = [
  "ok",
  "error_auth",
  "error_permission",
  "error_not_found",
  "error_rate_limit",
  "error_invalid_request",
  "error_upstream",
  "error_timeout",
  "error_network",
  "error_internal",
  "error_other",
] as const;
export type ToolOutcome = (typeof TOOL_OUTCOMES)[number];

/**
 * The last check before the wire, independent of the callers: a tool_call ships its reason
 * only if it is one of TOOL_OUTCOMES; anything else is dropped here.
 */
function wireReason(event: TelemetryEvent, reason: string | undefined): string | undefined {
  if (event !== "tool_call" || reason === undefined) return reason;
  return (TOOL_OUTCOMES as readonly string[]).includes(reason) ? reason : undefined;
}

// First match wins, so the order matters: an auth failure often also says "invalid",
// a rate limit often also says "403". Codes in brackets are Yandex Direct's ("[53] …").
const OUTCOME_PATTERNS: ReadonlyArray<readonly [ToolOutcome, RegExp]> = [
  ["error_timeout", /timed?[ _-]?out|таймаут|ETIMEDOUT|AbortError|не был готов|not ready/i],
  ["error_network", /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|fetch failed|socket hang up/i],
  ["error_rate_limit", /\b429\b|rate[ _-]?limit|too many requests|quota|квот|лимит|\[(?:56|152|506|9000)\]/i],
  [
    "error_auth",
    /\b401\b|unauthori[sz]ed|unauthenticated|invalid[ _-]?(?:token|grant|credentials)|token (?:expired|revoked)|login required|AuthRequired|авториз|не подключ|\[53\]/i,
  ],
  ["error_permission", /\b403\b|forbidden|access[ _-]?denied|permission|insufficient[ _-]?scope|нет доступа|\[(?:54|3228)\]/i],
  ["error_not_found", /\b404\b|not[ _-]?found|не найден|не существует|\[8800\]/i],
  ["error_upstream", /\b5\d\d\b|\b204\b|unavailable|недоступ|internal server error|bad gateway|\[(?:52|1000|1001|1002)\]/i],
  ["error_invalid_request", /\b400\b|\b422\b|bad request|invalid|syntax|некоррект|неверн|недопустим|required|обязател|expected|must (?:be|contain|have)|\[(?:4000|4001|4003|5000|8000)\]/i],
];

function resultText(value: unknown): string {
  if (value instanceof Error) return `${value.name} ${value.message}`;
  const content = (value as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

/** Classifies a finished call. Reads the result/error text, returns only a TOOL_OUTCOMES constant. */
export function toolOutcome(result: unknown, thrown?: unknown): ToolOutcome {
  if (thrown === undefined && !(result as { isError?: unknown } | null)?.isError) return "ok";
  const text = resultText(thrown ?? result);
  for (const [outcome, pattern] of OUTCOME_PATTERNS) if (pattern.test(text)) return outcome;
  return thrown === undefined ? "error_other" : "error_internal";
}

/**
 * Count every tool invocation by name and how it ended. Wraps registerTool once, before the
 * domain modules register their tools, so no per-tool wiring is needed. Only the tool *name*
 * and a TOOL_OUTCOMES constant are recorded — arguments and result text never reach telemetry.
 * The ping goes out when the call finishes; telemetry failures never touch the result.
 */
export function instrumentToolCalls(server: McpServer, telemetry: Telemetry): void {
  const original = server.registerTool.bind(server);
  // registerTool's generic signature does not survive a wrapper; the runtime
  // shape (name, config, callback) is stable per SDK contract.
  server.registerTool = ((name: string, config: unknown, callback: unknown) =>
    original(
      name,
      config as never,
      (async (...args: unknown[]) => {
        try {
          const result = await (callback as (...a: unknown[]) => unknown)(...args);
          telemetry.send("tool_call", { tool: name, reason: toolOutcome(result) });
          return result;
        } catch (e) {
          telemetry.send("tool_call", { tool: name, reason: toolOutcome(undefined, e) });
          throw e;
        }
      }) as never,
    )) as typeof server.registerTool;
}
