import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { AuthRequiredError, TokenStore } from "./auth.js";
import { credentialsPath, readCredentials, writeCredentials } from "./credentials.js";

/**
 * Every test gets its own XDG_CONFIG_HOME, so the suite never reads or writes the
 * developer's real credentials file. Awaits `run` — a synchronous finally would
 * restore the real config dir at the callback's first await, and the rest of the
 * test would then quietly read the developer's own credentials.
 */
async function withTempConfig<T>(run: () => T | Promise<T>): Promise<T> {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-metrica-test-"));
  try {
    return await run();
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

test("with nothing configured, getToken explains how to connect", async () => {
  await withTempConfig(async () => {
    const store = new TokenStore(undefined);
    assert.equal(store.hasToken(), false);
    await assert.rejects(() => store.getToken(), AuthRequiredError);
    // The message is the user-facing product here: it must name the tool to call.
    await assert.rejects(() => store.getToken(), /start_login/);
  });
});

test("an env token wins and is never refreshed", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "stored", refresh_token: "r", obtained_at: Date.now() });
    const store = new TokenStore("from-env");
    assert.equal(await store.getToken(), "from-env");
    assert.equal(store.canRefresh(), false, "an explicitly configured token is not ours to rotate");
    assert.equal(store.status().source, "env");
  });
});

test("a stored token is used when no env token is set", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "stored", obtained_at: Date.now() });
    const store = new TokenStore(undefined);
    assert.equal(await store.getToken(), "stored");
    assert.equal(store.status().source, "stored");
  });
});

test("the credentials file is owner-only", async () => {
  await withTempConfig(() => {
    const file = writeCredentials({ access_token: "s3cret", obtained_at: Date.now() });
    if (process.platform === "win32") return; // POSIX modes are not meaningful here
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

test("saving credentials leaves no temp files behind", async () => {
  await withTempConfig(() => {
    // Two writes: the second exercises the atomic replace of an existing file.
    writeCredentials({ access_token: "first", obtained_at: 1 });
    const file = writeCredentials({ access_token: "second", obtained_at: 2 });
    assert.deepEqual(readdirSync(dirname(file)), ["credentials.json"]);
    assert.equal(readCredentials()?.access_token, "second");
  });
});

test("a truncated credentials file reads as 'not connected', not as an empty token", async () => {
  await withTempConfig(() => {
    writeCredentials({ access_token: "x", obtained_at: Date.now() });
    writeFileSync(credentialsPath(), "{ oops");
    assert.equal(readCredentials(), undefined);
    assert.equal(new TokenStore(undefined).hasToken(), false);
  });
});

test("an expired token is refreshed transparently and the new one is stored", async () => {
  await withTempConfig(async () => {
    writeCredentials({
      access_token: "old",
      refresh_token: "rt",
      expires_at: Date.now() - 1000,
      obtained_at: Date.now() - 100_000,
    });
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "new", refresh_token: "rt2", expires_in: 3600 }),
      }) as unknown as Response) as unknown as typeof fetch;

    const store = new TokenStore(undefined, fetchImpl);
    assert.equal(await store.getToken(), "new");
    assert.equal(readCredentials()?.access_token, "new");
    assert.equal(readCredentials()?.refresh_token, "rt2", "the rotated refresh token must persist");
  });
});

test("a refresh answer without a refresh_token keeps the stored one", async () => {
  await withTempConfig(async () => {
    writeCredentials({
      access_token: "old",
      refresh_token: "rt",
      expires_at: Date.now() - 1000,
      obtained_at: Date.now() - 100_000,
    });
    // Yandex is allowed to omit refresh_token from a refresh answer; losing the
    // stored one here would make the *next* expiry a forced re-login.
    const fetchImpl = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "new", expires_in: 3600 }),
      }) as unknown as Response) as unknown as typeof fetch;

    const store = new TokenStore(undefined, fetchImpl);
    assert.equal(await store.getToken(), "new");
    assert.equal(readCredentials()?.refresh_token, "rt", "the old refresh token must survive");
  });
});

test("an expired token with nothing to refresh from asks for a new login", async () => {
  await withTempConfig(async () => {
    writeCredentials({ access_token: "old", expires_at: Date.now() - 1000, obtained_at: 1 });
    await assert.rejects(() => new TokenStore(undefined).getToken(), /start_login/);
  });
});

test("logout removes the stored token and reports whether there was one", async () => {
  await withTempConfig(() => {
    const store = new TokenStore(undefined);
    assert.equal(store.logout(), false, "nothing stored yet");
    writeCredentials({ access_token: "s", obtained_at: Date.now() });
    assert.equal(store.logout(), true);
    assert.equal(store.hasToken(), false);
  });
});

test("status never carries the token itself", async () => {
  await withTempConfig(() => {
    writeCredentials({ access_token: "super-secret", refresh_token: "r", obtained_at: Date.now() });
    const status = JSON.stringify(new TokenStore(undefined).status());
    assert.ok(!status.includes("super-secret"), "auth_status output must be safe to print");
    assert.ok(status.includes("credentials.json"), "but it must say where the file lives");
  });
});
