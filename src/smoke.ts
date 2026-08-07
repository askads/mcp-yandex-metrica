import { ConfigError, loadConfig } from "./config.js";
import { YandexMetrikaClient } from "./client.js";

/** Live READ-ONLY smoke check: lists the counters the token can access. */
async function main(): Promise<void> {
  const client = new YandexMetrikaClient(loadConfig());
  const counters = await client.get<{ counters?: unknown[] }>("management/v1/counters", { per_page: 5 });
  // Print only an aggregate by default — the raw account JSON (counter names,
  // sites, ids) must not leak into public CI logs. Full dump behind SMOKE_VERBOSE.
  const count = Array.isArray(counters.counters) ? counters.counters.length : 0;
  console.log(`smoke ok: management/v1/counters returned ${count} counter(s)`);
  if (process.env.SMOKE_VERBOSE) {
    console.log(JSON.stringify(counters, null, 2));
  }
}

main().catch((err) => {
  // A missing key is a user error, not a bug: report it without the stack.
  console.error("smoke failed:", err instanceof ConfigError ? err.message : err);
  process.exit(1);
});
