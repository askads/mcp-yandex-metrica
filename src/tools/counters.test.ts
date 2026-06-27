import { test } from "node:test";
import assert from "node:assert/strict";
import { registerCounterTools } from "./counters.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(opts: { defaultCounterId?: number; getResult?: unknown } = {}) {
  const calls: { path: string; query?: Record<string, unknown> }[] = [];
  const client = {
    defaultCounterId: opts.defaultCounterId,
    get: async (path: string, query?: Record<string, unknown>) => {
      calls.push({ path, query });
      return opts.getResult ?? { counters: [] };
    },
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerCounterTools(server as never, client as never);
  return { calls, tools };
}

test("list_counters maps search to search_string and defaults per_page", async () => {
  const { calls, tools } = harness();
  await tools.list_counters({ search: "shop" });
  assert.equal(calls[0].path, "management/v1/counters");
  assert.equal(calls[0].query?.search_string, "shop");
  assert.equal(calls[0].query?.per_page, 100);
});

test("list_goals uses the default counter id in the path", async () => {
  const { calls, tools } = harness({ defaultCounterId: 12345 });
  await tools.list_goals({});
  assert.equal(calls[0].path, "management/v1/counter/12345/goals");
});

test("list_goals fails without a counter id and makes no request", async () => {
  const { calls, tools } = harness();
  const res = await tools.list_goals({});
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});
