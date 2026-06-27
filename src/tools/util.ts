import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * A Metrica date: an ISO day (YYYY-MM-DD) or a relative token the Stat API
 * accepts (today, yesterday, NdaysAgo).
 */
export const metrikaDate = z
  .string()
  .regex(
    /^(\d{4}-\d{2}-\d{2}|today|yesterday|\d+daysAgo)$/,
    "Must be YYYY-MM-DD or a relative token (today, yesterday, NdaysAgo)",
  );

/** Wraps a value as a compact-JSON tool result (compact: the consumer is an LLM). */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: text ?? "null" }] };
}

export function fail(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Drops keys whose value is `undefined` so they are not sent to the API. */
export function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as T;
}

/** Joins a list into a comma-separated value, or undefined when empty. */
export function csv(values?: Array<string | number>): string | undefined {
  return values && values.length ? values.join(",") : undefined;
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool (e.g. auto-approve reads, warn before writes). Every tool here talks to
 * the remote Metrica API, so openWorldHint is always true.
 *
 *   READ_ONLY    — get/list tools; never mutate.
 *   WRITE_CREATE — create tools; introduce new objects.
 *   WRITE_UPDATE — update tools; re-applying the same input is idempotent.
 *   WRITE_DELETE — delete tools and raw_request.
 */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
export const WRITE_CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
export const WRITE_UPDATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;
export const WRITE_DELETE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
