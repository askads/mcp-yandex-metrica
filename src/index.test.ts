import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Boots the real entrypoint as a child process and completes a real MCP handshake
 * over stdio. Run from source (`node --import tsx src/index.ts`) rather than dist/,
 * because `npm test` runs before the build in the publish lifecycle. No network:
 * the handshake never calls the Metrica API, so a dummy token is enough.
 */
async function connectToServer(overrides: Record<string, string | undefined> = {}): Promise<Client> {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  const merged: Record<string, string> = {
    ...env,
    YANDEX_METRIKA_TOKEN: "test-token",
    ASKADS_TELEMETRY: "0",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", fileURLToPath(new URL("./index.ts", import.meta.url))],
    cwd: repoRoot,
    stderr: "ignore",
    env: merged,
  });
  const client = new Client({ name: "instructions-smoke", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/**
 * A server with no token at all: no env var, and a config dir that cannot hold a
 * stored login. Both halves matter — pointing XDG_CONFIG_HOME at a fresh temp dir
 * is what keeps the developer's own credentials.json from making this pass.
 */
async function connectUnconfigured(): Promise<Client> {
  return connectToServer({
    YANDEX_METRIKA_TOKEN: undefined,
    XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "mcp-metrica-unconfigured-")),
  });
}

test("initialize carries non-empty server instructions", async () => {
  const client = await connectToServer();
  try {
    const instructions = client.getInstructions();
    // The only prose the calling model reads before it picks a tool: losing the
    // wiring (e.g. passing it next to name/version) drops it from initialize.
    assert.ok(instructions, "initialize result must carry instructions");
    assert.ok(instructions.trim().length > 0, "instructions must not be blank");
    // Prepended to every session's context — keep it a paragraph, not a manual.
    assert.ok(
      instructions.length <= 1500,
      `instructions must stay within budget, got ${instructions.length} chars`,
    );
    // The facts the tool list cannot state: read-only surface and the write gate.
    assert.match(instructions, /только на чтение/);
    assert.match(instructions, /confirmWrite=true/);
  } finally {
    await client.close();
  }
});

/**
 * The regression this whole flow exists for: without a token the server used to
 * exit(1) before the handshake, so the client showed a dead server and the user
 * never learned why. It must now start, list its tools, and say what to do.
 */
test("without a token the server still starts and completes the handshake", async () => {
  const client = await connectUnconfigured();
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes("start_login"), "an unconfigured server must offer the login tool");
    assert.ok(tools.includes("list_counters"), "and must not hide the real tools");

    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /не подключена/, "instructions must state the server is unusable");
    assert.match(instructions, /start_login/, "and must name the tool that fixes it");
  } finally {
    await client.close();
  }
});

test("an unconfigured data call returns actionable text, not a dead connection", async () => {
  const client = await connectUnconfigured();
  try {
    const result = (await client.callTool({ name: "list_counters", arguments: {} })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    assert.equal(result.isError, true);
    const text = result.content.map((c) => c.text ?? "").join(" ");
    // The message has to survive to the model verbatim: it is the only channel
    // to the user, and it must stop the model from retrying a call that cannot work.
    assert.match(text, /start_login/);
    assert.match(text, /не поможет|не сбой сети/);
  } finally {
    await client.close();
  }
});

test("start_login hands back a PKCE authorize URL without a secret", async () => {
  const client = await connectUnconfigured();
  try {
    const result = (await client.callTool({ name: "start_login", arguments: {} })) as {
      isError?: boolean;
      content: Array<{ type: string; text?: string }>;
    };
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as { authorizeUrl?: string };
    const url = new URL(payload.authorizeUrl ?? "");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("response_type"), "code");
    // No redirect, no session to tie back — the URL carries no `state`.
    assert.equal(url.searchParams.get("state"), null);
    assert.ok(!url.search.includes("client_secret"), "a public client must not leak a secret");
  } finally {
    await client.close();
  }
});

test("auth_status reports the disconnected state without touching the network", async () => {
  const client = await connectUnconfigured();
  try {
    const result = (await client.callTool({ name: "auth_status", arguments: {} })) as {
      content: Array<{ type: string; text?: string }>;
    };
    const status = JSON.parse(result.content[0]?.text ?? "{}") as {
      configured?: boolean;
      path?: string;
    };
    assert.equal(status.configured, false);
    assert.match(status.path ?? "", /credentials\.json$/);
  } finally {
    await client.close();
  }
});
