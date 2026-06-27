# Development

## Requirements

- Node.js 18+ (the published package ships compiled `dist/`; `npx` needs no separate install).

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
