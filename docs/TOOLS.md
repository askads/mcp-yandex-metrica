# Инструменты

Все инструменты работают только на чтение, кроме `raw_request` — он может писать, но лишь при `confirmWrite=true`.

## Счётчики — Management API

| Инструмент | Что делает |
|---|---|
| `list_counters` | Счётчики, доступные токену (id, имя, сайт). Фильтр — `search`, постраничная выдача — `perPage`/`offset`. |
| `list_goals` | Цели (конверсии) счётчика. Если `counterId` не задан, берётся `YANDEX_METRIKA_COUNTER_ID`. |

## Статистика — Reporting API

| Инструмент | Что делает |
|---|---|
| `get_statistics` | Отчёты из `stat/v1/data`: `metrics`, `dimensions`, `date1`/`date2`, `filters`, `sort`, `accuracy`, `autoPaginate`. По умолчанию — итог за период по visits/users/pageviews/bounceRate/avgVisitDurationSeconds. |

Примечания:
- **Конверсии:** `metrics: ["ym:s:goal<goalId>reaches", "ym:s:goal<goalId>conversionRate"]`
  (id целей отдаёт `list_goals`).
- **Динамика по дням:** `dimensions: ["ym:s:date"]`. **Источники трафика:** `ym:s:lastTrafficSource`.
- В ответе приходят `totals` (итог по всем строкам), `total_rows` и `sampled`/`sample_share`:
  `sampled: true` означает, что цифры приблизительные — для точных нужен более узкий период
  или `accuracy: "full"`.

## Универсальный запрос

| Инструмент | Что делает |
|---|---|
| `raw_request` | Любой путь API Метрики (`management/v1/...` или `stat/v1/data`). GET выполняется свободно, POST/DELETE требуют `confirmWrite=true`. |

## Переменные окружения

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `YANDEX_METRIKA_TOKEN` | да | — | OAuth-токен, scope `metrika:read`. |
| `YANDEX_METRIKA_COUNTER_ID` | нет | — | Счётчик по умолчанию для инструментов, вызванных без `counterId`. |
| `YANDEX_METRIKA_LANG` | нет | `ru` | Заголовок `Accept-Language`. |
| `YANDEX_METRIKA_API_BASE` | нет | `https://api-metrika.yandex.net` | Корневой хост API. |
| `YANDEX_METRIKA_TIMEOUT_MS` | нет | `60000` | Таймаут запроса, мс. |
| `YANDEX_METRIKA_MAX_RETRIES` | нет | `3` | Повторы при временных ошибках (429, 5xx). |
