import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { YandexMetrikaClient } from "../client.js";
import { compact, fail, ok, READ_ONLY, resolveCounter } from "./util.js";

export function registerCounterTools(server: McpServer, client: YandexMetrikaClient): void {
  server.registerTool(
    "list_counters",
    {
      title: "Список счётчиков Метрики",
      annotations: READ_ONLY,
      description:
        "Возвращает счётчики Яндекс Метрики, доступные токену (Management API). У каждого счётчика есть id, name и site2 (домен сайта) — id используется в get_statistics и list_goals. Фильтр по подстроке имени или сайта задаётся параметром `search`.",
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe("Подстрока для фильтра счётчиков по имени или сайту, без учёта регистра."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("Максимум счётчиков в ответе. По умолчанию 100."),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Смещение для постраничной выдачи, отсчёт с 1."),
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
      title: "Список целей счётчика",
      annotations: READ_ONLY,
      description:
        "Возвращает цели (конверсии), настроенные на счётчике Метрики (Management API). Идентификаторы целей нужны, чтобы запросить метрики конверсий (ym:s:goal<id>reaches / ym:s:goal<id>conversionRate) в get_statistics. Если counterId не передан, берётся YANDEX_METRIKA_COUNTER_ID.",
      inputSchema: {
        counterId: z
          .number()
          .int()
          .optional()
          .describe("Идентификатор счётчика. По умолчанию YANDEX_METRIKA_COUNTER_ID."),
      },
    },
    async ({ counterId }) => {
      try {
        const counter = resolveCounter(counterId, client);
        if (counter === undefined) {
          return fail(
            "Не задан идентификатор счётчика: нужно передать counterId или задать YANDEX_METRIKA_COUNTER_ID.",
          );
        }
        const result = await client.get(`management/v1/counter/${counter}/goals`);
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
