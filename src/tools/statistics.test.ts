import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerStatisticsTools } from "./statistics.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

/** Fake server + mock client (get/getAllStat) so the handler runs without network. */
function harness(opts: { defaultCounterId?: number; getResult?: unknown; getAllResult?: unknown } = {}) {
  const calls: { path: string; query: Record<string, unknown>; kind: "get" | "getAllStat"; maxPages?: number }[] = [];
  const client = {
    defaultCounterId: opts.defaultCounterId,
    get: async (path: string, query: Record<string, unknown>) => {
      calls.push({ path, query, kind: "get" });
      return opts.getResult ?? { data: [], totals: [] };
    },
    getAllStat: async (query: Record<string, unknown>, maxPages?: number) => {
      calls.push({ path: "stat/v1/data", query, kind: "getAllStat", maxPages });
      return opts.getAllResult ?? { data: [] };
    },
  };
  const tools: Record<string, Handler> = {};
  const schemas: Record<string, z.ZodRawShape> = {};
  const server = {
    registerTool: (name: string, cfg: { inputSchema: z.ZodRawShape }, handler: Handler) => {
      tools[name] = handler;
      schemas[name] = cfg.inputSchema;
    },
  };
  registerStatisticsTools(server as never, client as never);
  return { calls, tools, schemas };
}

test("get_statistics defaults metrics + 7daysAgo..yesterday with no dimensions", async () => {
  const { calls, tools } = harness({ defaultCounterId: 555 });
  await tools.get_statistics({});
  assert.equal(calls[0].path, "stat/v1/data");
  assert.equal(calls[0].query.ids, 555);
  assert.equal(calls[0].query.date1, "7daysAgo");
  assert.equal(calls[0].query.date2, "yesterday");
  assert.match(String(calls[0].query.metrics), /ym:s:visits/);
  assert.equal(calls[0].query.dimensions, undefined);
});

test("get_statistics maps counterId to ids and joins metrics/dimensions", async () => {
  const { calls, tools } = harness();
  await tools.get_statistics({
    counterId: 42,
    metrics: ["ym:s:visits", "ym:s:users"],
    dimensions: ["ym:s:date"],
  });
  assert.equal(calls[0].query.ids, 42);
  assert.equal(calls[0].query.metrics, "ym:s:visits,ym:s:users");
  assert.equal(calls[0].query.dimensions, "ym:s:date");
});

test("get_statistics fails without a counter id and makes no request", async () => {
  const { calls, tools } = harness();
  const res = await tools.get_statistics({});
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("get_statistics routes autoPaginate through getAllStat", async () => {
  const { calls, tools } = harness({ defaultCounterId: 7 });
  await tools.get_statistics({ autoPaginate: true });
  assert.equal(calls[0].kind, "getAllStat");
});

test("get_statistics passes maxPages through to getAllStat", async () => {
  const { calls, tools } = harness({ defaultCounterId: 7 });
  await tools.get_statistics({ autoPaginate: true, maxPages: 3 });
  assert.equal(calls[0].kind, "getAllStat");
  assert.equal(calls[0].maxPages, 3);
});

test("get_statistics accuracy accepts a number or a string (0..1), rejects out-of-range", () => {
  const { schemas } = harness();
  const accuracy = z.object(schemas.get_statistics).shape.accuracy;
  assert.equal(accuracy.safeParse(0.5).success, true, "numeric 0.5");
  assert.equal(accuracy.safeParse("full").success, true, "string full");
  assert.equal(accuracy.safeParse("0.5").success, true, "string 0.5");
  assert.equal(accuracy.safeParse(2).success, false, "number > 1");
  assert.equal(accuracy.safeParse(undefined).success, true, "optional");
});

test("get_statistics limit is capped at MAX_TOOL_LIMIT (10000), not the 100k API max", () => {
  const { schemas } = harness();
  const limit = z.object(schemas.get_statistics).shape.limit;
  assert.equal(limit.safeParse(10_000).success, true);
  assert.equal(limit.safeParse(10_001).success, false);
  assert.equal(limit.safeParse(50_000).success, false);
});

test("get_statistics metrics are capped at 20 (API limit)", () => {
  const { schemas } = harness();
  const metrics = z.object(schemas.get_statistics).shape.metrics;
  const many = (n: number) => Array.from({ length: n }, (_, i) => `ym:s:goal${i}reaches`);
  assert.equal(metrics.safeParse(many(20)).success, true);
  assert.equal(metrics.safeParse(many(21)).success, false);
  assert.equal(metrics.safeParse([]).success, false, "an empty list is refused, not swapped for the defaults");
});

test("get_statistics refuses the goal# placeholder before the request", async () => {
  const { calls, tools } = harness({ defaultCounterId: 7 });
  const res = await tools.get_statistics({ metrics: ["ym:s:visits", "ym:s:goal#reaches"] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /list_goals/);
  assert.equal(calls.length, 0);
});

test("get_statistics passes directClientLogins as direct_client_logins", async () => {
  const { calls, tools } = harness({ defaultCounterId: 7 });
  await tools.get_statistics({ metrics: ["ym:ad:clicks"], dimensions: ["ym:ad:date"], directClientLogins: ["a", "b-c"] });
  assert.equal(calls[0].query.direct_client_logins, "a,b-c");
  await tools.get_statistics({});
  assert.equal("direct_client_logins" in calls[1].query, false, "absent when not given");
});

test("counterId is required in the schema only when no YANDEX_METRIKA_COUNTER_ID default exists", () => {
  const without = z.object(harness().schemas.get_statistics).shape.counterId;
  assert.equal(without.safeParse(undefined).success, false, "no default → required");
  assert.equal(without.safeParse(42).success, true);
  const withDefault = z.object(harness({ defaultCounterId: 7 }).schemas.get_statistics).shape.counterId;
  assert.equal(withDefault.safeParse(undefined).success, true, "default → optional");
});
