import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YandexMetrikaClient } from "../client.js";
import { compact, fail, ok, READ_ONLY, resolveCounter } from "./util.js";

export function registerCounterTools(server: McpServer, client: YandexMetrikaClient): void {
  server.registerTool(
    "list_counters",
    {
      title: "List Metrica counters",
      annotations: READ_ONLY,
      description:
        "Lists the Yandex Metrica counters the token can access (Management API). Each counter has id, name and site2 (site domain) — use the id with get_statistics and list_goals. Filter by a name/site substring with `search`.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Case-insensitive substring to filter counters by name or site."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Max counters to return. Default 100."),
        offset: z.number().int().min(1).optional().describe("1-based offset for pagination."),
      },
    },
    async ({ search, perPage, offset }) => {
      try {
        const result = await client.get(
          "management/v1/counters",
          compact({ search_string: search, per_page: perPage ?? 100, offset }),
        );
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_goals",
    {
      title: "List counter goals",
      annotations: READ_ONLY,
      description:
        "Lists the goals (conversions) configured on a Metrica counter (Management API). Goal ids are needed to read conversion metrics (ym:s:goal<id>reaches / ym:s:goal<id>conversionRate) in get_statistics. counterId defaults to YANDEX_METRIKA_COUNTER_ID when omitted.",
      inputSchema: {
        counterId: z
          .number()
          .int()
          .optional()
          .describe("Counter id. Defaults to YANDEX_METRIKA_COUNTER_ID."),
      },
    },
    async ({ counterId }) => {
      try {
        const counter = resolveCounter(counterId, client);
        if (counter === undefined) {
          return fail("No counter id: pass counterId or set YANDEX_METRIKA_COUNTER_ID.");
        }
        const result = await client.get(`management/v1/counter/${counter}/goals`);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
