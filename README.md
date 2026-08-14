# Yandex Metrica MCP

[![npm](https://img.shields.io/npm/v/mcp-yandex-metrica)](https://www.npmjs.com/package/mcp-yandex-metrica)
[![CI](https://github.com/askads/mcp-yandex-metrica/actions/workflows/ci.yml/badge.svg)](https://github.com/askads/mcp-yandex-metrica/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/askads/mcp-yandex-metrica/badges/score.svg)](https://glama.ai/mcp/servers/askads/mcp-yandex-metrica)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP-сервер для **Yandex Metrica (Яндекс Метрика)**: спрашивайте веб-аналитику — посещаемость,
источники, поведение и конверсии по целям — из Claude, Cursor, Codex и других AI-клиентов на
естественном языке.

Ассистент сам находит счётчики, тянет статистику из Reporting API и сопоставляет цели с
конверсиями — то, что в интерфейсе Метрики приходится собирать вручную по отчётам.

<img src="docs/demo.gif" alt="Демо: один вопрос — ассистент вызывает list_counters, list_goals и get_statistics и находит источник трафика с лучшей конверсией" width="1000">

<sub>Настоящая MCP-сессия: реальный сервер, хендшейк и tools/call по stdio через официальный SDK; ответы Яндекс Метрики — записанные фикстуры (<a href="docs/demo">docs/demo</a>), поэтому демо воспроизводится без токена и сети — <a href="docs/demo.tape">vhs docs/demo.tape</a>.</sub>

## Что умеет

- **Счётчики и цели** — `list_counters` (счётчики, к которым есть доступ) и `list_goals`
  (цели/конверсии счётчика) через Management API.
- **Статистика** — `get_statistics` по Reporting API (`stat/v1/data`): метрики и измерения,
  период (в т.ч. относительный — `7daysAgo`), фильтры, сортировка, авто-пагинация.
- **Конверсии** — метрики целей `ym:s:goal<id>reaches` / `ym:s:goal<id>conversionRate`.
- **Честная выборка** — ответ несёт `totals` (итог по всем строкам) и `sampled`/`sample_share`,
  чтобы было видно, когда данные семплированы.
- **Универсальный `raw_request`** — прямой вызов любого пути API; GET свободно, запись (POST/DELETE)
  только по `confirmWrite=true`.
- **Устойчивость** — ретраи на 429/5xx с бэкоффом и таймаут запроса.

## Установка

Токен не нужен: сервер подключается к Метрике [в диалоге](#подключение) после установки.
Требуется Node.js 20+ — он запускается через `npx`, отдельно ставить ничего не надо.

<details open>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add yandex-metrica -- npx -y mcp-yandex-metrica@latest
```

Либо через маркетплейс плагинов:

```
/plugin marketplace add askads/claude-plugins
/plugin install yandex-metrica@askads
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

`claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`

```json
{
  "mcpServers": {
    "yandex-metrica": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-metrica@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>Cursor</b></summary>

`~/.cursor/mcp.json` (или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "yandex-metrica": {
      "command": "npx",
      "args": ["-y", "mcp-yandex-metrica@latest"]
    }
  }
}
```

</details>

<details>
<summary><b>OpenAI Codex</b></summary>

```toml
[mcp_servers.yandex-metrica]
command = "npx"
args = ["-y", "mcp-yandex-metrica@latest"]
```

</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json` — ключ `servers` (не `mcpServers`)

```json
{
  "servers": {
    "yandex-metrica": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-yandex-metrica@latest"]
    }
  }
}
```

</details>

> **Совсем без установки:** Метрика входит в удалённый сервер Яндекс Директа — добавьте
> `https://mcp.askads.ru/mcp` по URL ([инструкция](https://github.com/askads/mcp-yandex-direct#подключение-по-url-без-установки)),
> инструменты Метрики видны с префиксом `metrika_`.

## Подключение

Скажите ассистенту:

> Подключи Яндекс Метрику

Он даст ссылку — откройте её **под аккаунтом с доступом к нужным счётчикам**, подтвердите
доступ и пришлите в чат показанный код. Всё, можно спрашивать про аналитику: перезапускать
клиент не нужно, конфигурацию править тоже.

Сервер просит единственное право — чтение статистики и параметров счётчиков. Ничего изменить
в Метрике он не может.

Дальше подключение живёт само: доступ продлевается автоматически и не отваливается через год.
Проверить состояние — попросите «покажи статус подключения», отключить — «отключи Метрику».
Выданный доступ отзывается в [Яндекс ID](https://id.yandex.ru/security).

## Примеры запросов

Попросите ассистента на русском — например:

- «Сколько визитов и какой процент отказов за последнюю неделю?»
- «Покажи трафик по источникам за июнь — сгруппируй по ym:s:lastTrafficSource»
- «Какая конверсия по цели "Оформление заказа" за 30 дней?»
- «Найди счётчик по домену shop.example и покажи его цели»

## Настройка

Настраивать нечего: всё нужное сервер спрашивает в диалоге. Переменные окружения пригодятся
только для CI и нестандартных случаев.

<details>
<summary>Переменные окружения и своё OAuth-приложение</summary>

Все переменные необязательные — сервер работает без единой из них.

| Переменная | По умолчанию | Описание |
|---|---|---|
| `YANDEX_METRIKA_COUNTER_ID` | — | Счётчик по умолчанию, если в вызове не задан `counterId`. |
| `YANDEX_METRIKA_TOKEN` | — | Готовый OAuth-токен (scope `metrika:read`) — для CI и автоматических установок, где диалога нет. Имеет приоритет над входом из чата; сервер такой токен не обновляет и не удаляет. |
| `YANDEX_METRIKA_OAUTH_CLIENT_ID` | приложение Ask Ads | ClientID своего OAuth-приложения для входа из чата. |
| `YANDEX_METRIKA_LANG` | `ru` | Заголовок `Accept-Language`. |
| `YANDEX_METRIKA_API_BASE` | `https://api-metrika.yandex.net` | Корень API. |
| `YANDEX_METRIKA_TIMEOUT_MS` | `60000` | Таймаут запроса, мс. |
| `YANDEX_METRIKA_MAX_RETRIES` | `3` | Повторы при 429/5xx. |

**Своё OAuth-приложение** — если не хотите пользоваться приложением Ask Ads:

1. Откройте [oauth.yandex.ru](https://oauth.yandex.ru/) → **Создать приложение**.
   Платформа — «Веб-сервисы», Redirect URI — `https://oauth.yandex.ru/verification_code`.
2. В правах доступа отметьте **Яндекс.Метрика → «Получение статистики, чтение параметров
   своих и доверенных счётчиков»** и сохраните. Скопируйте **ClientID**.
3. Задайте его в `YANDEX_METRIKA_OAUTH_CLIENT_ID` — вход из чата пойдёт через ваше приложение.

Для CI, где диалога нет, тем же приложением можно выпустить токен вручную: откройте
`https://oauth.yandex.ru/authorize?response_type=token&client_id=<ваш ClientID>` под нужным
аккаунтом и скопируйте показанный токен в `YANDEX_METRIKA_TOKEN`. Такой токен живёт около
года и хранится в конфиге открытым текстом — относитесь к нему как к паролю.

</details>

Полный список инструментов — в [docs/TOOLS.md](https://github.com/askads/mcp-yandex-metrica/blob/main/docs/TOOLS.md).

## Требования

- Node.js 20+ (запускается через `npx`, отдельная установка не нужна).
- Аккаунт Яндекса с доступом к нужным счётчикам.

## Ограничения

- **Только чтение (MVP)** — изменяющих операций нет; запись доступна только через `raw_request`
  с явным `confirmWrite=true`.
- Reporting API может **семплировать** данные на больших периодах — смотрите `sampled`/`sample_share`
  в ответе и при необходимости передавайте `accuracy: "full"`.
- У Метрики нет песочницы — все вызовы идут к боевому API (но MVP только читает).

## Документация

- [Все инструменты](https://github.com/askads/mcp-yandex-metrica/blob/main/docs/TOOLS.md)
- [Разработка](https://github.com/askads/mcp-yandex-metrica/blob/main/docs/DEVELOPMENT.md)

## Поддержка

Вопросы, идеи и доработки — пишите в Telegram: [@gistrec](http://t.me/gistrec).

## Лицензия

MIT — см. [LICENSE](./LICENSE).
