import { test } from "node:test";
import assert from "node:assert/strict";
import { YandexMetrikaClient, STAT_PAGE_LIMIT } from "./client.js";
import { YandexMetrikaError } from "./types.js";

const BASE = "https://api-metrika.yandex.net";

function makeClient(overrides: Partial<ConstructorParameters<typeof YandexMetrikaClient>[0]> = {}) {
  return new YandexMetrikaClient({
    token: "T",
    lang: "ru",
    apiBase: BASE,
    retryBaseMs: 0,
    ...overrides,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const u = String(url);
    const i = (init ?? {}) as RequestInit;
    calls.push({ url: u, init: i });
    return handler(u, i);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

test("get() sends the OAuth token header and parses JSON", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({ data: [], total_rows: 0 }), { status: 200 }));
  try {
    const result = await makeClient().get("stat/v1/data", { ids: 123, metrics: "ym:s:visits" });
    assert.deepEqual(result, { data: [], total_rows: 0 });
    assert.equal(
      mock.calls[0].url,
      "https://api-metrika.yandex.net/stat/v1/data?ids=123&metrics=ym%3As%3Avisits",
    );
    assert.equal(mock.calls[0].init.method, "GET");
    const headers = mock.calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "OAuth T");
    assert.equal(headers["Accept-Language"], "ru");
  } finally {
    mock.restore();
  }
});

test("get() drops undefined and empty query values", async () => {
  const mock = mockFetch(() => new Response(JSON.stringify({}), { status: 200 }));
  try {
    await makeClient().get("management/v1/counters", { a: undefined, b: "", c: 0, d: "x" });
    assert.equal(mock.calls[0].url, "https://api-metrika.yandex.net/management/v1/counters?c=0&d=x");
  } finally {
    mock.restore();
  }
});

test("request() throws YandexMetrikaError with the status and parsed errors body", async () => {
  const mock = mockFetch(
    () =>
      new Response(
        JSON.stringify({ errors: [{ error_type: "invalid_token", message: "expired" }], code: 403, message: "Forbidden" }),
        { status: 403 },
      ),
  );
  try {
    await assert.rejects(
      () => makeClient().get("stat/v1/data"),
      (err: unknown) =>
        err instanceof YandexMetrikaError && err.status === 403 && /invalid_token: expired/.test(err.message),
    );
  } finally {
    mock.restore();
  }
});

test("request() retries a 429 rate limit then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().get("stat/v1/data");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() retries a 5xx then returns the result", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    if (calls === 1) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const result = await makeClient().get("stat/v1/data");
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    mock.restore();
  }
});

test("request() does not retry a 400 and gives up after maxRetries on 429", async () => {
  let calls = 0;
  const mock = mockFetch(() => {
    calls++;
    return new Response("nope", { status: 400 });
  });
  try {
    await assert.rejects(() => makeClient().get("stat/v1/data"), /HTTP 400/);
    assert.equal(calls, 1);
  } finally {
    mock.restore();
  }

  calls = 0;
  const mock2 = mockFetch(() => {
    calls++;
    return new Response("slow down", { status: 429 });
  });
  try {
    await assert.rejects(() => makeClient({ maxRetries: 2 }).get("stat/v1/data"), /HTTP 429/);
    assert.equal(calls, 3); // initial + 2 retries
  } finally {
    mock2.restore();
  }
});

test("getAllStat() merges data pages and carries totals/total_rows", async () => {
  let calls = 0;
  const mock = mockFetch((url) => {
    calls++;
    const offset = Number(new URL(url).searchParams.get("offset"));
    if (offset === 1) {
      const data = Array.from({ length: STAT_PAGE_LIMIT }, (_, i) => ({ i }));
      return new Response(
        JSON.stringify({ data, total_rows: STAT_PAGE_LIMIT + 1, totals: [[42]] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: [{ i: 999 }], total_rows: STAT_PAGE_LIMIT + 1 }), { status: 200 });
  });
  try {
    const result = await makeClient().getAllStat({ ids: 1, metrics: "ym:s:visits" });
    assert.equal(result.data.length, STAT_PAGE_LIMIT + 1);
    assert.equal(result.total_rows, STAT_PAGE_LIMIT + 1);
    assert.deepEqual(result.totals, [[42]]);
    assert.equal(calls, 2);
    assert.equal(new URL(mock.calls[0].url).searchParams.get("limit"), String(STAT_PAGE_LIMIT));
    assert.equal(new URL(mock.calls[0].url).searchParams.get("offset"), "1");
    assert.equal(new URL(mock.calls[1].url).searchParams.get("offset"), String(STAT_PAGE_LIMIT + 1));
  } finally {
    mock.restore();
  }
});

test("getAllStat() flags truncation loudly at the maxPages cap", async () => {
  const mock = mockFetch(() => {
    const data = Array.from({ length: STAT_PAGE_LIMIT }, (_, i) => ({ i }));
    return new Response(JSON.stringify({ data, total_rows: 999999 }), { status: 200 });
  });
  try {
    const result = await makeClient().getAllStat({ ids: 1 }, 2);
    assert.equal(result._truncated, true);
    assert.match(result._truncatedNote ?? "", /of 999999/);
  } finally {
    mock.restore();
  }
});

test("request() aborts and reports a timeout when the request hangs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init: unknown) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    const client = makeClient({ timeoutMs: 10 });
    await assert.rejects(() => client.get("stat/v1/data"), /timed out after 10ms/);
  } finally {
    globalThis.fetch = original;
  }
});
