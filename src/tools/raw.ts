import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HttpMethod, YandexMetrikaClient } from "../client.js";
import { fail, ok, WRITE_DELETE } from "./util.js";

/** Only GET reads data; POST and DELETE mutate Metrica objects. */
export function isReadMethod(method: string): boolean {
  return method.toUpperCase() === "GET";
}

export function registerRawTool(server: McpServer, client: YandexMetrikaClient): void {
  server.registerTool(
    "raw_request",
    {
      title: "Raw Yandex Metrica API call",
      // Escape hatch: can POST/DELETE, so flag it destructive.
      annotations: WRITE_DELETE,
      description:
        'Escape hatch to call any Yandex Metrica API path directly — e.g. "management/v1/counters", "management/v1/counter/{id}/goals", "stat/v1/data". Use it for endpoints without a dedicated tool. `query` becomes the query string; `body` is sent as JSON for POST. GET runs freely; POST and DELETE are writes and require confirmWrite=true.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('API path, e.g. "stat/v1/data" or "management/v1/counter/12345/goals".'),
        method: z.enum(["GET", "POST", "DELETE"]).optional().describe("HTTP method. Default GET."),
        query: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query string parameters (ids, metrics, dimensions, date1, date2, ...)."),
        body: z.record(z.any()).optional().describe("JSON body for POST requests."),
        confirmWrite: z
          .boolean()
          .optional()
          .describe("Must be true for a write (POST or DELETE)."),
      },
    },
    async ({ path, method, query, body, confirmWrite }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        if (!isReadMethod(m) && confirmWrite !== true) {
          return fail(`"${m} ${path}" is a write operation. Re-run with confirmWrite=true to proceed.`);
        }
        const result = await client.request(m, path, { query, body });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
