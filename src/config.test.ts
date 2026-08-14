import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigError, loadConfig } from "./config.js";

/**
 * The reason codes below are the vocabulary the dashboard groups by — renaming
 * one silently splits a bar in two, so they are pinned here.
 */
function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function reasonOf(vars: Record<string, string | undefined>): string {
  let caught: unknown;
  withEnv(vars, () => {
    try {
      loadConfig();
    } catch (err) {
      caught = err;
    }
  });
  assert.ok(caught instanceof ConfigError, "config problems must throw ConfigError, not exit");
  return caught.reason;
}

/**
 * A missing token used to throw, which killed the process before the MCP
 * handshake and left the user with a silent failure. It is now a survivable
 * state: the server starts, serves the login tools and resolves the token per
 * request. Pinned here because reverting it would restore that dead end.
 */
test("a missing token does not throw — the server must start and offer login", () => {
  withEnv({ YANDEX_METRIKA_TOKEN: undefined, YANDEX_METRIKA_COUNTER_ID: undefined }, () => {
    const config = loadConfig();
    assert.equal(config.token, undefined);
    assert.equal(config.apiBase, "https://api-metrika.yandex.net");
  });
});

test("an empty token is treated as absent, not as an empty credential", () => {
  withEnv({ YANDEX_METRIKA_TOKEN: "", YANDEX_METRIKA_COUNTER_ID: undefined }, () => {
    assert.equal(loadConfig().token, undefined);
  });
});

test("a non-numeric counter id is its own reason", () => {
  assert.equal(
    reasonOf({ YANDEX_METRIKA_TOKEN: "t0ken", YANDEX_METRIKA_COUNTER_ID: "not-a-number" }),
    "invalid_counter_id",
  );
});

test("a configured server loads without throwing", () => {
  withEnv({ YANDEX_METRIKA_TOKEN: "t0ken", YANDEX_METRIKA_COUNTER_ID: "42" }, () => {
    assert.equal(loadConfig().counterId, 42);
  });
});
