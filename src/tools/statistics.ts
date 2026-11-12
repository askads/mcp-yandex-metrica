import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QueryValue, StatPage, YandexMetrikaClient } from "../client.js";
import { YandexMetrikaError } from "../types.js";
import { compact, counterIdField, counterIdNote, csv, fail, metrikaDate, ok, READ_ONLY, resolveCounter } from "./util.js";

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

/** Tried in order after "Query is too complicated", only when the caller did not set accuracy. */
export const ACCURACY_FALLBACK: ReadonlyArray<string | number> = ["low", 0.1, 0.01];

function isTooComplicated(err: unknown): err is YandexMetrikaError {
  return err instanceof YandexMetrikaError && err.status === 400 && /too complicated/i.test(err.message);
}

function withHint(err: YandexMetrikaError, hint: string): YandexMetrikaError {
  const hinted = new YandexMetrikaError(err.status, err.body);
  hinted.message = `${err.message} ${hint}`;
  return hinted;
}

function markReducedAccuracy(result: StatPage, accuracy: string | number): StatPage {
  const share = typeof result.sample_share === "number" ? result.sample_share : undefined;
  const sampled = result.sampled === true || (share !== undefined && share < 1);
  const retried = `Метрика отклонила запрос с точностью по умолчанию как слишком сложный, поэтому сервер повторил его с accuracy=${accuracy}.`;
  const note = sampled
    ? `${retried} Данные СЕМПЛИРОВАНЫ: расчёт сделан по ${
        share === undefined
          ? "части данных (доля в ответе не указана)"
          : `${+(share * 100).toPrecision(3)}% данных (sample_share=${share})`
      }, все цифры приблизительные — об этом нужно сказать пользователю. Для точных цифр — сузить период date1..date2 или убрать часть dimensions/filters.`
    : `${retried} Семплирование при этом не применилось (sampled=false): данные полные.`;
  return { _accuracyReduced: true, _accuracyUsed: accuracy, _accuracyNote: note, ...result };
}

export function registerStatisticsTools(server: McpServer, client: YandexMetrikaClient): void {
  server.registerTool(
    "get_statistics",
    {
      title: "Статистика",
      annotations: READ_ONLY,
      description:
        "Запрашивает Reporting API Яндекс Метрики (stat/v1/data) по счётчику. ПО УМОЛЧАНИЮ возвращает одну строку, агрегированную за период (без измерений), с visits/users/pageviews/bounceRate/avgVisitDurationSeconds. `dimensions` разбивает результат на строки (ym:s:date — динамика по дням, ym:s:lastTrafficSource — источники трафика, ym:s:deviceCategory — устройства), `metrics` задаёт нужные метрики — для конверсий это ym:s:goal<goalId>reaches / ym:s:goal<goalId>conversionRate (идентификаторы целей даёт list_goals). Префиксы не смешиваются: ym:s:* (визиты) и ym:pv:* (просмотры страниц) в одном запросе сочетаются только через filters. Ответ 400 «Incorrectly specified attribute» значит, что такого поля нет: не перебирать варианты имени, а взять поле из списка в `dimensions`. В ответе есть `totals` (итог по ВСЕМ строкам — для вопросов «сколько всего» суммировать не нужно), `total_rows` и `sampled`/`sample_share` (sampled=true означает, что данные приблизительные, посчитаны по доле sample_share; для точных цифр нужно сузить период или передать accuracy=full). Если Метрика отвечает 400 «Query is too complicated», а accuracy не задана, сервер сам повторяет запрос с меньшей точностью (low → 0.1 → 0.01) и помечает ответ полями `_accuracyReduced`/`_accuracyUsed`/`_accuracyNote` — такие цифры нужно подавать как приблизительные. Заданную accuracy сервер не меняет. users — уникальные посетители за весь период: сумма users по дням их не даёт." + counterIdNote(client),
      inputSchema: {
        counterId: counterIdField(client),
        metrics: z
          .array(z.string())
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Метрики (не больше 20 — лимит API), например ym:s:visits, ym:s:users, ym:s:bounceRate, ym:s:goal<id>reaches. По умолчанию — типовой набор.",
          ),
        dimensions: z
          .array(z.string())
          .optional()
          .describe(
            "Измерения для группировки; без них — итог за период. Частые: ym:s:date (по дням), ym:s:startOfWeek / ym:s:startOfMonth (по неделям / месяцам), " +
              "ym:s:startURL / ym:s:endURL (страница входа / выхода; ym:s:startURLPath / ym:s:endURLPath — без домена), ym:s:referer, " +
              "ym:s:lastTrafficSource, ym:s:lastsignSourceEngine (конкретный источник), ym:s:lastsignDirectClickOrder (кампания Директа), ym:s:lastsignUTMCampaign, ym:s:deviceCategory. " +
              "Полей ym:s:URL, ym:s:page, ym:s:pageTitle, ym:s:week нет. Все просмотренные страницы: ym:pv:URL, ym:pv:URLPath, ym:pv:title, только с метриками ym:pv:* (ym:pv:pageviews, ym:pv:users).",
          ),
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
        directClientLogins: z
          .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._@-]{0,99}$/))
          .optional()
          .describe(
            "Логины клиентов Яндекс Директа — нужны метрикам расходов Директа (ym:ad:*), без них API отвечает 403 direct_client_logins.",
          ),
        sort: z
          .string()
          .optional()
          .describe("Поле сортировки; префикс '-' — по убыванию, например -ym:s:visits."),
        accuracy: z
          .union([z.string(), z.number().min(0).max(1)])
          .optional()
          .describe(
            "Точность (размер выборки): low, medium, high, full (без сэмплирования, медленнее) или доля от 0 до 1 — API округляет её до степени десяти (0.1, 0.01). По умолчанию medium. " +
              "Без accuracy сервер сам снижает точность на слишком сложном запросе; заданное значение не меняет.",
          ),
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
    async ({
      counterId,
      metrics,
      dimensions,
      date1,
      date2,
      filters,
      directClientLogins,
      sort,
      accuracy,
      limit,
      offset,
      autoPaginate,
      maxPages,
    }) => {
      try {
        // "goal#" is the docs' placeholder, not a field: the API answers a bare
        // "Incorrectly specified metric" that does not say what to put instead.
        const placeholder = metrics?.find((m) => m.includes("goal#"));
        if (placeholder) {
          return fail(
            `${placeholder}: вместо # нужен идентификатор цели, например ym:s:goal12345reaches. Идентификаторы целей даёт list_goals.`,
          );
        }
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
          direct_client_logins: csv(directClientLogins),
          sort,
          accuracy,
          limit,
          offset,
        });
        const run = (q: Record<string, QueryValue>): Promise<StatPage> =>
          autoPaginate ? client.getAllStat(q, maxPages) : client.get<StatPage>("stat/v1/data", q);
        try {
          return ok(await run(query));
        } catch (e) {
          if (!isTooComplicated(e)) throw e;
          if (accuracy !== undefined) {
            return fail(
              withHint(
                e,
                `Запрос шёл с заданной accuracy=${accuracy}, сервер её не менял. Варианты: не передавать accuracy — тогда сервер сам ступенчато снизит точность и пометит ответ как семплированный; либо сократить период date1..date2, убрать часть dimensions, упростить filters.`,
              ),
            );
          }
          let last = e;
          for (const step of ACCURACY_FALLBACK) {
            try {
              return ok(markReducedAccuracy(await run({ ...query, accuracy: step }), step));
            } catch (retryError) {
              if (!isTooComplicated(retryError)) throw retryError;
              last = retryError;
            }
          }
          return fail(
            withHint(
              last,
              `Сервер уже сам повторил запрос с accuracy=${ACCURACY_FALLBACK.join(", ")} — не помогло, тот же запрос повторять бессмысленно. Нужно сократить период date1..date2 (длинный период разбить на месяцы или недели и запросить по частям), убрать часть dimensions, упростить filters или сократить список metrics.`,
            ),
          );
        }
      } catch (e) {
        return fail(e);
      }
    },
  );
}
