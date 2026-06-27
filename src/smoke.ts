import { loadConfig } from "./config.js";
import { YandexMetrikaClient } from "./client.js";

/** Live READ-ONLY smoke check: lists the counters the token can access. */
async function main(): Promise<void> {
  const client = new YandexMetrikaClient(loadConfig());
  const counters = await client.get("management/v1/counters", { per_page: 5 });
  console.log(JSON.stringify(counters, null, 2));
}

main().catch((err) => {
  console.error("smoke failed:", err);
  process.exit(1);
});
