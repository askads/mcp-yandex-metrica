# Yandex Metrica MCP

Read Yandex Metrica web analytics from Claude: counters, goals, and traffic and conversion statistics.

This plugin is an **unofficial, third-party client** maintained by gistrec, part of the
AskAds line of MCP servers. It is not affiliated with, endorsed by, or operated by the
owner of the API it talks to.

## What the plugin does

Enabling the plugin registers one MCP server named `yandex-metrica`. Claude Code starts it by
running `npx -y mcp-yandex-metrica@1.4.2`, which downloads that exact published version of the
`mcp-yandex-metrica` npm package and runs it on your machine. The version is pinned, so the plugin never
pulls a newer release without an update to this plugin.

The server talks to the Yandex Metrica API (api-metrika.yandex.net) over HTTPS, using the credentials you enter when the plugin
is enabled. It sends nothing to AskAds except the telemetry described below.

## What it needs from you

The plugin asks for its credentials through the plugin configuration dialog, not through
environment variables, so nothing has to be exported in your shell. Sensitive values go to
your operating system's credential store rather than to `settings.json`.

- **Yandex Metrica OAuth token** (required) — OAuth token for the Yandex Metrica API. Stored in your operating system's credential store, never in settings.json. Stored securely.
- **Default counter id** — Counter to use when a request does not name one. Leave empty to choose the counter per request.
- **Anonymous telemetry** — Set to 0 to disable the anonymous usage telemetry the server sends by default. Leave as 1 to keep it on.

Every option has a default, so the server also starts with nothing filled in. Leave the
token empty and sign in from the conversation with the server's login tools: it opens a
Yandex OAuth link, you paste the confirmation code back, and the token is saved locally.
That is how the server authenticates in Cowork, which does not prompt for plugin
configuration.

## Telemetry

The underlying server sends anonymous technical events by default: a random installation
identifier, the name of the tool that was called, and the versions of the server, the AI
app, Node.js and the operating system. Your access token, your account data, tool arguments
and the names and values of environment variables are **not** sent. Set the
**Anonymous telemetry** option to `0` to turn it off.

## Privacy

[Privacy policy](https://askads.ru/privacy-policy).

The plugin stores no data of its own. Your credentials go to your operating system's
credential store. When you sign in from the conversation instead, the server writes the
token to `~/.config/mcp-yandex-metrica/credentials.json` with owner-only permissions. Data read from
the API is passed to your AI app and is never written to disk.

## Skills

`metrica-report` — Pull a traffic or conversion report from Yandex Metrica: pick the counter and goals, request one wide period, and read dimensions and metrics without double-counting.

## Source and license

Source: https://github.com/askads/mcp-yandex-metrica. Released under the MIT license.
