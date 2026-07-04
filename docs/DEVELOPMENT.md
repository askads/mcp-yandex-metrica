# Development

## Requirements

- Node.js 20+ (the published package ships compiled `dist/`; `npx` needs no separate install). CI runs on Node 20/22/24.

## Commands

```bash
npm install
npm run dev        # run from source with tsx watch
npm test           # unit tests (node:test), no network
npm run typecheck  # type-check src + tests (no emit)
npm run build      # clean dist/ and compile with tsc
npm run smoke      # live READ-ONLY call: lists counters (needs YANDEX_METRIKA_TOKEN)
```

## Local run

```bash
npm run build
YANDEX_METRIKA_TOKEN=... node dist/index.js
# optional: YANDEX_METRIKA_COUNTER_ID=12345 to default a counter
```

## Tests

Unit tests mock `globalThis.fetch` (client) or use a fake server + mock client
(tools), so the whole suite runs offline. Put a `*.test.ts` next to the code it
covers; `npm run typecheck && npm test` is the gate (also run by `prepublishOnly`).

## Demo GIF in the README

`docs/demo.gif` is a recording of a real MCP session: `docs/demo/run.mjs` spawns
the built server over stdio and makes real tools/call requests through the
official SDK, while `docs/demo/mock-api.mjs` (loaded into the server process via
`NODE_OPTIONS=--import`) patches the global `fetch` and serves canned Yandex
Metrica API responses — no token and no network needed. To regenerate:

```bash
npm run build && vhs docs/demo.tape   # requires vhs: brew install vhs
```

Important: with the settings in `docs/demo.tape` the vhs terminal is 97 columns
× 33 rows, and the capture freezes if the buffer scrolls. When changing the
script or the fixtures, make sure the whole output still fits on one screen.
