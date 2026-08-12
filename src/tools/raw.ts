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
      title: "Произвольный запрос к API Яндекс Метрики",
      // Escape hatch: can POST/DELETE, so flag it destructive.
      annotations: WRITE_DELETE,
      description:
        'Универсальный запрос: обращается напрямую к любому пути API Яндекс Метрики — например "management/v1/counters", "management/v1/counter/{id}/goals", "stat/v1/data". Нужен для эндпоинтов, у которых нет отдельного инструмента. `query` уходит в строку запроса, `body` отправляется как JSON для POST. GET выполняется свободно; POST и DELETE — это запись, им нужен confirmWrite=true.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Путь API, например "stat/v1/data" или "management/v1/counter/12345/goals".'),
        method: z
          .enum(["GET", "POST", "DELETE"])
          .optional()
          .describe("HTTP-метод. По умолчанию GET."),
        query: z
          .record(z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Параметры строки запроса (ids, metrics, dimensions, date1, date2, ...)."),
        body: z.record(z.any()).optional().describe("Тело запроса в JSON для POST."),
        confirmWrite: z
          .boolean()
          .optional()
          .describe("Должен быть true для записи (POST или DELETE)."),
      },
    },
    async ({ path, method, query, body, confirmWrite }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        if (!isReadMethod(m) && confirmWrite !== true) {
          return fail(`"${m} ${path}" — это операция записи. Для выполнения нужен повтор с confirmWrite=true.`);
        }
        const result = await client.request(m, path, { query, body });
        return ok(result);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
