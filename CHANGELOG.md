# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [1.0.0] — 2026-06-27

### Добавлено
- Первый релиз. MCP-сервер для Yandex Metrica (read-only MVP):
  - `list_counters` и `list_goals` — Management API (счётчики и цели/конверсии);
  - `get_statistics` — Reporting API (`stat/v1/data`): метрики/измерения/период/фильтры,
    сортировка, `accuracy`, авто-пагинация (`getAllStat`), проброс `totals` и флага
    `sampled`/`sample_share`;
  - `raw_request` — escape hatch на любой путь API (`management/v1/...` или `stat/v1/data`);
    GET свободно, POST/DELETE — только с `confirmWrite=true`.
- OAuth-токен (scope `metrika:read`), ретраи на 429/5xx с бэкоффом, таймаут запроса,
  `counterId` с дефолтом из `YANDEX_METRIKA_COUNTER_ID`.

[1.0.0]: https://github.com/askads/mcp-yandex-metrica/releases/tag/v1.0.0
