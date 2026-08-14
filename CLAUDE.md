# CLAUDE.md — mcp-yandex-metrica

MCP server for the Yandex Metrica API (TypeScript, stdio). Read-only MVP: tools wrap
the Management and Reporting APIs; `raw_request` is the escape hatch for everything
without a dedicated tool.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live READ-ONLY call (needs YANDEX_METRIKA_TOKEN)
```

More detail in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Tool list: [docs/TOOLS.md](docs/TOOLS.md).

## Architecture

- `src/client.ts` — HTTP client over `https://api-metrika.yandex.net` (override with
  `YANDEX_METRIKA_API_BASE`): `OAuth` auth header, AbortController timeout, retry/backoff
  on 429 + 5xx (honors `Retry-After`), `getAllStat` limit/offset pagination of the Stat
  API, `YandexMetrikaError(status, body)`. The client targets a full path
  ("management/v1/..." or "stat/v1/data") — Metrica has two API surfaces on one host.
- `src/oauth.ts` — the OAuth flow: PKCE pair (S256), authorize URL against
  `https://oauth.yandex.ru/verification_code`, code exchange and refresh. **No `client_secret`** —
  this is a public client, and a secret inside an npm package would protect nothing. The pending
  verifier lives in one module-level slot (one stdio server = one user); a second `start_login`
  replaces it.
- `src/credentials.ts` — `~/.config/mcp-yandex-metrica/credentials.json`, mode `0600`. An
  unparsable file reads as "not connected", never as an empty token.
- `src/auth.ts` — `TokenStore`: resolves the token per request (env wins over stored), refreshes
  on expiry, and raises `AuthRequiredError` whose *message* is the product — it is the only text
  the user ever sees about a missing token.
- `src/tools/*.ts` — `auth` (auth_status, start_login, finish_login, logout), `counters`
  (list_counters, list_goals), `statistics` (get_statistics), `raw` (raw_request); each exports
  `register<Name>Tools(server, client)`.
- `src/tools/util.ts` — shared helpers (see conventions below).
- `src/index.ts` — wires every `register*` into the McpServer.
- `src/telemetry.ts` — anonymous usage pings (ids/names/versions only, never data or
  arguments; fire-and-forget, must never block or throw; opt-out `ASKADS_TELEMETRY=0`).
  `startup_failed` is the exception: `sendBlocking` awaits it, because the caller
  exits right after and a fire-and-forget ping would die in flight. Its `reason`
  is a closed vocabulary (`missing_token`, …) — never a variable's name or value.
- `src/config.ts` — env → config; throws `ConfigError` (with a `reason` code) instead
  of exiting, so `index.ts` can report the drop-off before dying.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a red cross and no reason — telemetry showed that state accounted for nearly
  every unconfigured install, and 97% of them never recovered. Missing credentials are a
  survivable state: start, serve the login tools, and answer data calls with `AuthRequiredError`.
  `config.test.ts` and `index.test.ts` pin this.
- **Auth failures are not transport failures.** `AuthRequiredError` is rethrown before the
  retry/backoff branch in `request()` — retrying it burns seconds of backoff before the user
  sees the one message that helps. Pinned by a timing assertion in `client.test.ts`.
- **The token is resolved per request, never cached on the client.** That is what makes
  `finish_login` take effect mid-session without a client restart.
- **Read-only MVP.** Only get/list tools are exposed; the single write path is
  `raw_request`, gated by HTTP method (`isReadMethod` = GET only; POST/DELETE need
  `confirmWrite=true`).
- **counterId resolves to the env default.** Tools take an optional `counterId`; when
  omitted it falls back to `YANDEX_METRIKA_COUNTER_ID`, else the tool fails loud.
- **Two API surfaces, one client.** Pass the full path: Management API is
  `management/v1/...`, Reporting API is `stat/v1/data`. The Stat API offset is 1-based.
- **Validate inputs with zod** in `inputSchema`; dates via the shared `metrikaDate`
  (ISO `YYYY-MM-DD` or relative tokens like `7daysAgo`).
- **Output compact JSON via `ok`** — the consumer is an LLM; pretty-printing burns tokens.
- **Pagination:** `get_statistics` autoPaginate uses `getAllStat` at `STAT_PAGE_LIMIT`
  and flags `_truncated` instead of silently cutting.
- **Surface sampling.** The Stat API may sample; the response's `sampled`/`sample_share`
  pass through untouched so the model can warn or raise `accuracy`.
- **Runtime guidance for the consuming model goes in the tool `description`,** not in this
  file — the external agent never reads CLAUDE.md.

## Adding a tool

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. Import and call it in `src/index.ts`.
3. Add a `*.test.ts` using the mock-fetch / fake-client harness (no network).
4. Document the tool in `docs/TOOLS.md`.
5. `npm run typecheck && npm test`.

## Safety

- The token has **read access to real analytics data,** and Metrica has **no sandbox.**
  `smoke` is read-only by design. Keep writes out of the MVP — `raw_request` is the only escape.

## Releasing

Keep the version in sync across **all** channels in one go — publishing to npm alone silently
drifts from the rest (`git push --follow-tags` pushes the tag but does **not** create a GitHub
Release; the registry is immutable per version, so even a metadata-only change needs a bump):

1. Bump `version` in `package.json` **and** `server.json` (root + `packages[].version`)
   together. `mcpName` in `package.json` must match `name` in `server.json`.
2. `npm publish` (runs typecheck + tests + build via `prepublishOnly` / `prepare`).
3. `git commit`, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push origin main --follow-tags`.
4. **GitHub Release:** `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`.
5. **Official MCP registry:** `mcp-publisher publish`.

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the registry details.
