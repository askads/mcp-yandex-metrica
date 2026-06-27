# Tools

All tools are read-only except `raw_request` (which can write only with `confirmWrite=true`).

## Counters — Management API

| Tool | Description |
|---|---|
| `list_counters` | Counters the token can access (id, name, site). Filter with `search`; paginate with `perPage`/`offset`. |
| `list_goals` | Goals (conversions) on a counter. `counterId` defaults to `YANDEX_METRIKA_COUNTER_ID`. |

## Statistics — Reporting API

| Tool | Description |
|---|---|
| `get_statistics` | Reports from `stat/v1/data`: `metrics`, `dimensions`, `date1`/`date2`, `filters`, `sort`, `accuracy`, `autoPaginate`. Defaults to a period total with visits/users/pageviews/bounceRate/avgVisitDuration. |

Notes:
- **Conversions:** pass `metrics: ["ym:s:goal<goalId>reaches", "ym:s:goal<goalId>conversionRate"]`
  (get goal ids from `list_goals`).
- **Daily trend:** add `dimensions: ["ym:s:date"]`. **Traffic sources:** `ym:s:lastTrafficSource`.
- The response carries `totals` (grand total over all rows), `total_rows`, and
  `sampled`/`sample_share` — `sampled: true` means the figures are approximate; narrow the
  range or pass `accuracy: "full"` for exact numbers.

## Escape hatch

| Tool | Description |
|---|---|
| `raw_request` | Any Metrica API path (`management/v1/...` or `stat/v1/data`). GET runs freely; POST/DELETE require `confirmWrite=true`. |

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `YANDEX_METRIKA_TOKEN` | yes | — | OAuth token, scope `metrika:read`. |
| `YANDEX_METRIKA_COUNTER_ID` | no | — | Default counter id for tools that omit `counterId`. |
| `YANDEX_METRIKA_LANG` | no | `ru` | `Accept-Language` header. |
| `YANDEX_METRIKA_API_BASE` | no | `https://api-metrika.yandex.net` | API root host. |
| `YANDEX_METRIKA_TIMEOUT_MS` | no | `60000` | Per-request timeout, ms. |
| `YANDEX_METRIKA_MAX_RETRIES` | no | `3` | Retries on transient errors (429, 5xx). |
