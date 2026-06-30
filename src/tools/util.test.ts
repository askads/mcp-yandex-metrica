import { test } from "node:test";
import assert from "node:assert/strict";
import { compact, csv, fail, metrikaDate, ok } from "./util.js";

test("compact drops only undefined values", () => {
  assert.deepEqual(compact({ a: 1, b: undefined, c: 0, d: "" }), { a: 1, c: 0, d: "" });
});

test("csv joins non-empty arrays and returns undefined otherwise", () => {
  assert.equal(csv(["a", "b"]), "a,b");
  assert.equal(csv([]), undefined);
  assert.equal(csv(undefined), undefined);
});

test("metrikaDate accepts ISO and relative tokens, rejects junk", () => {
  const d = metrikaDate(); // factory → fresh schema
  assert.equal(d.safeParse("2026-06-01").success, true);
  assert.equal(d.safeParse("today").success, true);
  assert.equal(d.safeParse("yesterday").success, true);
  assert.equal(d.safeParse("7daysAgo").success, true);
  assert.equal(d.safeParse("June").success, false);
});

test("ok emits compact JSON; fail flags isError", () => {
  assert.equal((ok({ a: 1 }).content[0] as { text: string }).text, '{"a":1}');
  assert.equal(fail(new Error("boom")).isError, true);
});
