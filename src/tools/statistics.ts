import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YandexMetrikaClient } from "../client.js";
import { compact, csv, fail, metrikaDate, ok, READ_ONLY, resolveCounter } from "./util.js";

/**
 * Max rows a single-page tool call may request. Kept well below the Stat API's
 * hard STAT_MAX_LIMIT (100k) so a single tool call can't pull an oversized page;
 * for larger exports use autoPaginate, which pages at STAT_PAGE_LIMIT.
 */
const MAX_TOOL_LIMIT = 10_000;

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
      title: "Статистика",
      annotations: READ_ONLY,
      description:
        "Запрашивает Reporting API Яндекс Метрики (stat/v1/data) по счётчику. ПО УМОЛЧАНИЮ возвращает одну строку, агрегированную за период (без измерений), с visits/users/pageviews/bounceRate/avgVisitDurationSeconds. `dimensions` разбивает результат на строки (ym:s:date — динамика по дням, ym:s:lastTrafficSource — источники трафика, ym:s:deviceCategory — устройства), `metrics` задаёт нужные метрики — для конверсий это ym:s:goal<goalId>reaches / ym:s:goal<goalId>conversionRate (идентификаторы целей даёт list_goals). В ответе есть `totals` (итог по ВСЕМ строкам — для вопросов «сколько всего» суммировать не нужно), `total_rows` и `sampled`/`sample_share` (sampled=true означает, что данные приблизительные; для точных цифр нужно сузить период или передать accuracy=full). Если counterId не передан, берётся YANDEX_METRIKA_COUNTER_ID.",
      inputSchema: {
        counterId: z
          .number()
          .int()
          .optional()
          .describe("Идентификатор счётчика. По умолчанию YANDEX_METRIKA_COUNTER_ID."),
        metrics: z
          .array(z.string())
          .optional()
          .describe("Метрики, например ym:s:visits, ym:s:users, ym:s:bounceRate, ym:s:goal<id>reaches. По умолчанию — типовой набор."),
        dimensions: z
          .array(z.string())
          .optional()
          .describe("Измерения для группировки, например ym:s:date, ym:s:lastTrafficSource, ym:s:deviceCategory. Без них — итог за период."),
        date1: metrikaDate()
          .optional()
          .describe("Дата начала: YYYY-MM-DD или относительная (today, yesterday, NdaysAgo). По умолчанию 7daysAgo."),
        date2: metrikaDate()
          .optional()
          .describe("Дата конца: YYYY-MM-DD или относительная (today, yesterday, NdaysAgo). По умолчанию yesterday."),
        filters: z
          .string()
          .optional()
          .describe("Выражение фильтра Метрики, например ym:s:deviceCategory=='mobile'."),
        sort: z
          .string()
          .optional()
          .describe("Поле сортировки; префикс '-' — по убыванию, например -ym:s:visits."),
        accuracy: z
          .union([z.string(), z.number().min(0).max(1)])
          .optional()
          .describe("Точность сэмплирования: 'full' — точный расчёт (медленнее) или доля 0..1. По умолчанию — авторежим API."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_TOOL_LIMIT)
          .optional()
          .describe("Максимум строк на странице (игнорируется, если задан autoPaginate)."),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Смещение по строкам для постраничной выдачи, отсчёт с 1."),
        autoPaginate: z
          .boolean()
          .optional()
          .describe(
            "Забирает все строки, листая страницами максимального для API размера (склеивает data, сохраняет totals). " +
              "Игнорирует `limit`; ограничен maxPages и лимитами по строкам/байтам (при их достижении выставляет _truncated).",
          ),
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Лимит страниц для autoPaginate. По умолчанию 100."),
      },
    },
    async ({ counterId, metrics, dimensions, date1, date2, filters, sort, accuracy, limit, offset, autoPaginate, maxPages }) => {
      try {
        const counter = resolveCounter(counterId, client);
        if (counter === undefined) {
          return fail(
            "Не задан идентификатор счётчика: нужно передать counterId или задать YANDEX_METRIKA_COUNTER_ID.",
          );
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
          ? await client.getAllStat(query, maxPages)
          : await client.get("stat/v1/data", query);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
