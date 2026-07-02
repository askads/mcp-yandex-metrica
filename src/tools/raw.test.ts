import { test } from "node:test";
import assert from "node:assert/strict";
import { isReadMethod, registerRawTool } from "./raw.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake server + mock client so the raw handler runs without network. */
function harness() {
  const calls: { method: string; path: string; opts: unknown }[] = [];
  let tool: Handler | undefined;
  const client = {
    request: async (method: string, path: string, opts: unknown) => {
      calls.push({ method, path, opts });
      return { ok: true };
    },
  };
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: Handler) => {
      tool = handler;
    },
  };
  registerRawTool(server as never, client as never);
  return { calls, raw: tool as Handler };
}

test("isReadMethod is true only for GET (case-insensitive)", () => {
  assert.equal(isReadMethod("GET"), true);
  assert.equal(isReadMethod("get"), true);
  assert.equal(isReadMethod("POST"), false);
  assert.equal(isReadMethod("DELETE"), false);
});

test("raw_request runs a GET without confirmWrite", async () => {
  const { calls, raw } = harness();
  const res = await raw({ path: "management/v1/counters", query: { per_page: 5 } });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "management/v1/counters");
});

test("raw_request blocks a POST without confirmWrite and makes no call", async () => {
  const { calls, raw } = harness();
  const res = await raw({ path: "management/v1/counter/1/goals", method: "POST", body: { name: "X" } });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("raw_request blocks a DELETE without confirmWrite and makes no call", async () => {
  const { calls, raw } = harness();
  const res = await raw({ path: "management/v1/counter/1/goal/2", method: "DELETE" });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("raw_request runs a POST when confirmWrite is true", async () => {
  const { calls, raw } = harness();
  const res = await raw({
    path: "management/v1/counter/1/goals",
    method: "POST",
    body: { name: "X" },
    confirmWrite: true,
  });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
});
