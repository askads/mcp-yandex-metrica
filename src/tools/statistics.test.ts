import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ACCURACY_FALLBACK, registerStatisticsTools } from "./statistics.js";
import { YandexMetrikaError } from "../types.js";
import { toolOutcome } from "../telemetry.js";

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

const tooComplicated = () =>
  new YandexMetrikaError(400, {
    code: 400,
    message: "Query is too complicated. Please reduce the date interval or sampling.",
    errors: [{ error_type: "query_error", message: "Query is too complicated. Please reduce the date interval or sampling." }],
  });

/** Client whose stat calls answer from `script` in order: an Error is thrown, anything else returned. */
function scripted(script: unknown[]) {
  const calls: { query: Record<string, unknown>; kind: "get" | "getAllStat" }[] = [];
  const next = (kind: "get" | "getAllStat", query: Record<string, unknown>) => {
    calls.push({ query, kind });
    const step = script[calls.length - 1];
    if (step instanceof Error) throw step;
    return step;
  };
  const client = {
    defaultCounterId: 7,
    get: async (_path: string, query: Record<string, unknown>) => next("get", query),
    getAllStat: async (query: Record<string, unknown>) => next("getAllStat", query),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerStatisticsTools(server as never, client as never);
  return { calls, tools };
}

test("get_statistics retries a too-complicated query at lower accuracy and labels the sampled answer", async () => {
  const { calls, tools } = scripted([
    tooComplicated(),
    tooComplicated(),
    { data: [{ metrics: [1200] }], totals: [1200], sampled: true, sample_share: 0.1 },
  ]);
  const res = await tools.get_statistics({ date1: "365daysAgo", dimensions: ["ym:s:startURL"] });
  assert.equal(res.isError, undefined);
  assert.deepEqual(calls.map((c) => c.query.accuracy), [undefined, "low", 0.1]);
  assert.equal(calls[2].query.date1, "365daysAgo", "the rest of the query is unchanged");
  assert.equal(calls[2].query.dimensions, "ym:s:startURL");
  const body = JSON.parse(res.content[0].text);
  assert.equal(body._accuracyReduced, true);
  assert.equal(body._accuracyUsed, 0.1);
  assert.match(body._accuracyNote, /СЕМПЛИРОВАНЫ/);
  assert.match(body._accuracyNote, /10% данных \(sample_share=0\.1\)/);
  assert.deepEqual(body.totals, [1200]);
  assert.equal(body.sampled, true);
  assert.ok(res.content[0].text.startsWith('{"_accuracyReduced":true'), "the label precedes the rows");
});

test("get_statistics says so when the lower-accuracy retry was not sampled after all", async () => {
  const { tools } = scripted([tooComplicated(), { data: [], totals: [5], sampled: false, sample_share: 1 }]);
  const body = JSON.parse((await tools.get_statistics({})).content[0].text);
  assert.equal(body._accuracyUsed, "low");
  assert.match(body._accuracyNote, /данные полные/);
  assert.doesNotMatch(body._accuracyNote, /СЕМПЛИРОВАНЫ/);
});

test("get_statistics labels a sampled retry even when the API omits sample_share", async () => {
  const { tools } = scripted([tooComplicated(), { data: [], sampled: true }]);
  const body = JSON.parse((await tools.get_statistics({})).content[0].text);
  assert.match(body._accuracyNote, /СЕМПЛИРОВАНЫ.*доля в ответе не указана/);
});

test("get_statistics gives up after the last accuracy step with advice to narrow the query", async () => {
  const { calls, tools } = scripted([tooComplicated(), tooComplicated(), tooComplicated(), tooComplicated()]);
  const res = await tools.get_statistics({});
  assert.equal(res.isError, true);
  assert.deepEqual(calls.map((c) => c.query.accuracy), [undefined, ...ACCURACY_FALLBACK]);
  const text = res.content[0].text;
  assert.match(text, /HTTP 400: query_error: Query is too complicated/);
  assert.match(text, /сократить период date1\.\.date2/);
  assert.match(text, /dimensions/);
  assert.equal(toolOutcome(res), "error_invalid_request");
});

test("get_statistics never overrides an accuracy the caller set", async () => {
  const { calls, tools } = scripted([tooComplicated()]);
  const res = await tools.get_statistics({ accuracy: "full" });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 1, "no retry");
  assert.match(res.content[0].text, /accuracy=full, сервер её не менял/);
  assert.match(res.content[0].text, /не передавать accuracy/);
  assert.equal(toolOutcome(res), "error_invalid_request");
});

test("get_statistics retries autoPaginate as a whole at the lower accuracy", async () => {
  const { calls, tools } = scripted([tooComplicated(), { data: [1, 2], total_rows: 2, sampled: true, sample_share: 0.01 }]);
  const res = await tools.get_statistics({ autoPaginate: true });
  assert.deepEqual(calls.map((c) => [c.kind, c.query.accuracy]), [["getAllStat", undefined], ["getAllStat", "low"]]);
  assert.match(JSON.parse(res.content[0].text)._accuracyNote, /1% данных/);
});

test("get_statistics leaves other errors alone, on the first call and during the fallback", async () => {
  const other = () => new YandexMetrikaError(400, { errors: [{ error_type: "invalid_parameter", message: "Incorrectly specified attribute" }] });
  const first = scripted([other()]);
  const res1 = await first.tools.get_statistics({});
  assert.equal(res1.isError, true);
  assert.equal(first.calls.length, 1);
  assert.doesNotMatch(res1.content[0].text, /accuracy/);

  const during = scripted([tooComplicated(), new YandexMetrikaError(403, { errors: [{ error_type: "access_denied", message: "Access denied" }] })]);
  const res2 = await during.tools.get_statistics({});
  assert.equal(res2.isError, true);
  assert.equal(during.calls.length, 2);
  assert.match(res2.content[0].text, /HTTP 403/);
});

test("get_statistics does not label an answer that needed no retry", async () => {
  const { tools } = scripted([{ data: [], sampled: true, sample_share: 0.5 }]);
  const body = JSON.parse((await tools.get_statistics({})).content[0].text);
  assert.equal("_accuracyReduced" in body, false);
  assert.equal(body.sample_share, 0.5);
});
