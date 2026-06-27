import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YandexMetrikaClient } from "../client.js";
import { STAT_MAX_LIMIT } from "../client.js";
import { compact, csv, fail, metrikaDate, ok, READ_ONLY } from "./util.js";

/** Default KPIs returned when the caller does not pick metrics. */
const DEFAULT_METRICS = [
  "ym:s:visits",
  "ym:s:users",
  "ym:s:pageviews",
  "ym:s:bounceRate",
  "ym:s:avgVisitDurationSeconds",
];

export function registerStatisticsTools(server: McpServer, client: YandexMetrikaClient): void {
  server.registerTool(
    "get_statistics",
    {
      title: "Get statistics",
      annotations: READ_ONLY,
      description:
        "Queries the Yandex Metrica Reporting API (stat/v1/data) for a counter. By DEFAULT returns one aggregated row over the period (no dimensions) with visits/users/pageviews/bounceRate/avgVisitDuration. Add `dimensions` to split rows (ym:s:date for a daily trend, ym:s:lastTrafficSource for traffic sources, ym:s:deviceCategory for devices), `metrics` to pick KPIs — for conversions use ym:s:goal<goalId>reaches / ym:s:goal<goalId>conversionRate (get goal ids from list_goals). The response carries `totals` (grand total over ALL rows — use it for «сколько всего», no need to sum), `total_rows`, and `sampled`/`sample_share` (sampled=true means the data is approximate; narrow the range or pass accuracy=full for exact figures). counterId defaults to YANDEX_METRIKA_COUNTER_ID.",
      inputSchema: {
        counterId: z
          .number()
          .int()
          .optional()
          .describe("Counter id. Defaults to YANDEX_METRIKA_COUNTER_ID."),
        metrics: z
          .array(z.string())
          .optional()
          .describe("Metrics, e.g. ym:s:visits, ym:s:users, ym:s:bounceRate, ym:s:goal<id>reaches. Defaults to a common set."),
        dimensions: z
          .array(z.string())
          .optional()
          .describe("Group-by dimensions, e.g. ym:s:date, ym:s:lastTrafficSource, ym:s:deviceCategory. Omit for a period total."),
        date1: metrikaDate
          .optional()
          .describe("Start date YYYY-MM-DD or relative (today, yesterday, NdaysAgo). Default 7daysAgo."),
        date2: metrikaDate
          .optional()
          .describe("End date YYYY-MM-DD or relative. Default yesterday."),
        filters: z
          .string()
          .optional()
          .describe("Metrica filter expression, e.g. ym:s:deviceCategory=='mobile'."),
        sort: z
          .string()
          .optional()
          .describe("Sort field; prefix with '-' for descending, e.g. -ym:s:visits."),
        accuracy: z
          .string()
          .optional()
          .describe("Sampling accuracy: 'full' for exact (slower), or 0..1. Default the API's auto."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(STAT_MAX_LIMIT)
          .optional()
          .describe("Max rows per page."),
        offset: z.number().int().min(1).optional().describe("1-based row offset for pagination."),
        autoPaginate: z
          .boolean()
          .optional()
          .describe("Fetch all rows by following limit/offset (merges data, carries totals)."),
      },
    },
    async ({ counterId, metrics, dimensions, date1, date2, filters, sort, accuracy, limit, offset, autoPaginate }) => {
      try {
        const counter = counterId ?? client.defaultCounterId;
        if (counter === undefined) {
          return fail("No counter id: pass counterId or set YANDEX_METRIKA_COUNTER_ID.");
        }
        const query = compact({
          ids: counter,
          metrics: csv(metrics) ?? DEFAULT_METRICS.join(","),
          dimensions: csv(dimensions),
          date1: date1 ?? "7daysAgo",
          date2: date2 ?? "yesterday",
          filters,
          sort,
          accuracy,
          limit,
          offset,
        });
        const result = autoPaginate
          ? await client.getAllStat(query)
          : await client.get("stat/v1/data", query);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
