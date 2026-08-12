import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Boots the real entrypoint as a child process and completes a real MCP handshake
 * over stdio. Run from source (`node --import tsx src/index.ts`) rather than dist/,
 * because `npm test` runs before the build in the publish lifecycle. No network:
 * the handshake never calls the Metrica API, so a dummy token is enough.
 */
async function connectToServer(): Promise<Client> {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", fileURLToPath(new URL("./index.ts", import.meta.url))],
    cwd: repoRoot,
    stderr: "ignore",
    env: { ...env, YANDEX_METRIKA_TOKEN: "test-token", ASKADS_TELEMETRY: "0" },
  });
  const client = new Client({ name: "instructions-smoke", version: "0.0.0" });
  await client.connect(transport);
  return client;
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
    assert.match(instructions, /read-only/);
    assert.match(instructions, /confirmWrite=true/);
  } finally {
    await client.close();
  }
});
