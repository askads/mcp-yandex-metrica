# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
проект придерживается [семантического версионирования](https://semver.org/lang/ru/).

## [Unreleased]

## [1.1.0] — 2026-07-02

### Безопасность
- SSRF-гард в HTTP-клиенте: `raw_request` с абсолютным или протокол-относительным
  путём (`https://…`, `http://…`, `\\host/…`) теперь отклоняется — запрос с
  OAuth-токеном не может уйти на чужой хост.

### Исправлено
- Ретрай `5xx` только для идемпотентных запросов (`GET`); `POST`/`DELETE` больше не
  повторяются на `5xx` (исключён риск дубля записи). `429` по-прежнему ретраится
  для любого метода — запрос не был обработан.
- `accuracy` в `get_statistics` принимает число `0..1` или строку (`full`), а не
  только строку — числовой ввод модели больше не падает на валидации.
- Таймаут запроса покрывает и чтение тела ответа (`res.text()` внутри охраняемой
  зоны), а не только заголовки — «медленное» тело больше не висит после таймера.
- Синхронизированы версии `server.json` (root + package) с `package.json`/npm (1.0.3);
  дрейф версий теперь ловит `prepublishOnly` (проверка `check:version`).

### Добавлено
- Ретрай сетевых ошибок/таймаутов для идемпотентных `GET` (ECONNRESET, DNS,
  AbortError); не-`GET` не ретраятся.
- Жёсткие лимиты авто-пагинации `get_statistics`: cap по строкам/байтам
  (`STAT_MAX_ROWS`/`STAT_MAX_BYTES`) и параметр `maxPages` у тула — при упоре
  выставляется `_truncated`/`_truncatedNote`.
- Лимит одной страницы тула снижен до `MAX_TOOL_LIMIT` (10000); полный экспорт —
  через `autoPaginate` (пагинация на `STAT_PAGE_LIMIT`).
- `server.json`: env-переменные `YANDEX_METRIKA_API_BASE` / `TIMEOUT_MS` /
  `MAX_RETRIES` (необязательные, со значениями по умолчанию).
- Тесты: SSRF-гард, метод-зависимые ретраи, сетевые ретраи, cap авто-пагинации,
  `raw_request` confirmWrite-гейт (`raw.test.ts`), аннотации тулов
  (`annotations.test.ts`), схема `accuracy`/`limit`.

### Изменено
- `resolveCounter` вынесен в `tools/util.ts` и используется в `counters`/`statistics`.
- `smoke` печатает только агрегат (число счётчиков) — сырой JSON аккаунта в
  публичные логи CI не попадает; полный вывод за флагом `SMOKE_VERBOSE`.
- Документация: минимальная версия Node приведена к 20+ (соответствует
  `engines`/CI-матрице 20/22/24).

## [1.0.3] — 2026-06-30

### Изменено
- Аннотации read-only тулов: явно проставлены `destructiveHint: false` и
  `idempotentHint: true` (некоторые клиенты, напр. OpenAI Apps review, требуют все
  четыре хинта на каждом туле).

## [1.0.2] — 2026-06-30

### Исправлено
- `metrikaDate` сделан фабрикой — поля дат (`date1`/`date2`) инлайнятся в схему
  вместо `$ref`-дедупликации, которую часть потребителей схемы не разыменовывает.

### Изменено
- CI: least-privilege `permissions` + `concurrency`; матрица Node 20/22/24.
- Документация: значок Glama в README, полный чеклист релиза в CLAUDE.md.

## [1.0.1] — 2026-06-29

### Изменено
- Заголовок в реестре (`server.json`) унифицирован с H1 README — «Yandex Metrica MCP».
- CI: добавлен `health.yml` — ежедневный read-only smoke против реального API Метрики.
- Добавлен `glama.json` для листинга на Glama.

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

[Unreleased]: https://github.com/askads/mcp-yandex-metrica/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/askads/mcp-yandex-metrica/releases/tag/v1.0.3
[1.0.2]: https://github.com/askads/mcp-yandex-metrica/releases/tag/v1.0.2
[1.0.1]: https://github.com/askads/mcp-yandex-metrica/releases/tag/v1.0.1
[1.0.0]: https://github.com/askads/mcp-yandex-metrica/releases/tag/v1.0.0
