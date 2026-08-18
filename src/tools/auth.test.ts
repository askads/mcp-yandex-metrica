import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TokenStore } from "../auth.js";
import { readCredentials } from "../credentials.js";
import { clearPendingLogin, DEFAULT_CLIENT_ID } from "../oauth.js";
import { registerAuthTools } from "./auth.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/**
 * Fake server + fake client + a REAL TokenStore over a temp config dir: the
 * whole point of these tools is what ends up on disk, so the store is not
 * faked. Global fetch is stubbed for the OAuth exchange (no network).
 */
function harness(opts: { envToken?: string; counters?: unknown[]; countersError?: Error } = {}) {
  const clientCalls: unknown[] = [];
  const client = {
    get: async (path: string, params: unknown) => {
      clientCalls.push({ path, params });
      if (opts.countersError) throw opts.countersError;
      return { counters: opts.counters ?? [{ id: 1 }] };
    },
  };
  const tokens = new TokenStore(opts.envToken);
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerAuthTools(server as never, client as never, tokens);
  return { tools, tokens, clientCalls };
}

/** Runs `fn` with an isolated credentials dir and a clean pending-login slot. */
async function isolated<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mcp-metrica-tools-"));
  clearPendingLogin();
  try {
    return await fn();
  } finally {
    clearPendingLogin();
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
}

function payload(res: { content: { text: string }[] }): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

test("registers the four auth tools", async () => {
  await isolated(async () => {
    const { tools } = harness();
    assert.deepEqual(Object.keys(tools).sort(), [
      "auth_status",
      "finish_login",
      "logout",
      "start_login",
    ]);
  });
});

test("auth_status reports 'not connected' without touching the network", async () => {
  await isolated(async () => {
    const { tools, clientCalls } = harness();
    const status = payload(await tools.auth_status({}));
    assert.equal(status.configured, false);
    assert.match(String(status.path), /credentials\.json$/);
    assert.equal(clientCalls.length, 0, "auth_status must not call the API");
  });
});

test("start_login returns a PKCE authorize URL for the Metrica app, no network", async () => {
  await isolated(async () => {
    const savedFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      throw new Error("start_login must not touch the network");
    }) as typeof fetch;
    try {
      const { tools } = harness();
      const res = payload(await tools.start_login({}));
      const url = new URL(String(res.authorizeUrl));
      assert.equal(url.origin + url.pathname, "https://oauth.yandex.ru/authorize");
      assert.equal(url.searchParams.get("client_id"), DEFAULT_CLIENT_ID);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.ok(url.searchParams.get("code_challenge"), "must carry a challenge");
      // No redirect, no session to tie back — the URL carries no `state`.
      assert.equal(url.searchParams.get("state"), null);
      assert.ok(!url.search.includes("client_secret"), "a public client must not leak a secret");
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test("finish_login without a pending login fails with start_login advice", async () => {
  await isolated(async () => {
    const { tools } = harness();
    const res = await tools.finish_login({ code: "1234567" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /start_login/);
  });
});

test("finish_login exchanges the code, stores the token and verifies it live", async () => {
  await isolated(async () => {
    const savedFetch = globalThis.fetch;
    const forms: URLSearchParams[] = [];
    globalThis.fetch = (async (_url: unknown, init: unknown) => {
      forms.push(new URLSearchParams(String((init as RequestInit).body)));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ access_token: "minted", refresh_token: "rt", expires_in: 3600 }),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const { tools, tokens, clientCalls } = harness();
      await tools.start_login({});
      const res = payload(await tools.finish_login({ code: " 1234567 " }));

      assert.equal(res.connected, true);
      assert.equal(res.countersVisible, 1);
      // The exchange carried the code (trimmed) and the PKCE verifier, no secret.
      assert.equal(forms[0].get("code"), "1234567");
      assert.ok(forms[0].get("code_verifier"), "the stored verifier must accompany the code");
      assert.equal(forms[0].get("client_secret"), null);
      // The token landed on disk — the next data call picks it up per request.
      assert.equal(readCredentials()?.access_token, "minted");
      assert.equal(await tokens.getToken(), "minted");
      // And it was proven with a live read before reporting success.
      assert.equal(clientCalls.length, 1);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test("finish_login warns when the connected account sees no counters", async () => {
  await isolated(async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "minted" }),
      }) as unknown as Response) as typeof fetch;
    try {
      const { tools } = harness({ counters: [] });
      await tools.start_login({});
      const res = payload(await tools.finish_login({ code: "1234567" }));
      assert.equal(res.countersVisible, 0);
      assert.match(String(res.note), /другим аккаунтом/);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test("finish_login stays successful when the live check fails after the token is saved", async () => {
  await isolated(async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ access_token: "minted", refresh_token: "rt", expires_in: 3600 }),
      }) as unknown as Response) as typeof fetch;
    try {
      // The exchange succeeds and the token lands on disk, then the verification
      // read dies on the network. That is a login that WORKED — reporting it as
      // isError would send the user to redo it for nothing.
      const { tools } = harness({ countersError: new Error("fetch failed: ECONNRESET") });
      await tools.start_login({});
      const res = await tools.finish_login({ code: "1234567" });

      assert.notEqual(res.isError, true, "a failed check must not read as a failed login");
      const body = payload(res);
      assert.equal(body.connected, true);
      assert.equal(body.verified, false);
      assert.match(String(body.note), /сохранён/);
      assert.match(String(body.note), /ECONNRESET/, "the note must carry the actual failure");
      assert.equal(readCredentials()?.access_token, "minted", "the token really is on disk");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });
});

test("logout removes only the stored token and leaves the env token alone", async () => {
  await isolated(async () => {
    const { tools, tokens } = harness({ envToken: "env-token" });
    tokens.save({ access_token: "stored" });

    const res = payload(await tools.logout({}));
    assert.equal(res.removed, true);
    assert.equal(res.envTokenStillSet, true);
    assert.equal(readCredentials(), undefined, "the file is gone");
    assert.equal(await tokens.getToken(), "env-token", "the env token is not ours to delete");

    const again = payload(await tools.logout({}));
    assert.equal(again.removed, false, "nothing left to delete");
  });
});
