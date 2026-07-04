#!/usr/bin/env node
// Демо-клиент для README-GIF: поднимает НАСТОЯЩИЙ сервер (dist/index.js) по stdio,
// делает настоящий MCP-хендшейк и настоящие tools/call через официальный SDK.
// Единственная подмена — ответы Yandex Metrica API законсервированы в
// docs/demo/mock-api.mjs (NODE_OPTIONS=--import), поэтому демо воспроизводится
// без токена и без сети. Запись GIF: vhs docs/demo.tape (см. docs/demo.tape).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mockPath = path.join(repoRoot, "docs", "demo", "mock-api.mjs");

// ---------- оформление ----------
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAUVE = "\x1b[35m";
const WIDTH = 92;

const out = process.stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeOut(text, msPerChar) {
  for (const ch of text) {
    out.write(ch);
    await sleep(msPerChar);
  }
}

async function spinner(ms, label) {
  const frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < ms) {
    out.write(`\r\x1b[2K  ${DIM}${frames[i++ % frames.length]} ${label}${RESET}`);
    await sleep(80);
  }
  out.write("\r\x1b[2K");
}

/** Перенос сырого текста результата по ширине, максимум maxLines строк. */
function wrapRaw(text, maxLines) {
  const flat = text.replace(/\s+/g, " ").trim();
  const body = WIDTH - 6;
  const lines = [];
  for (let pos = 0; pos < flat.length && lines.length < maxLines; pos += body) {
    lines.push(flat.slice(pos, pos + body));
  }
  if (flat.length > maxLines * body) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, body - 1) + "…";
  }
  return lines;
}

async function printResultLines(lines) {
  for (let i = 0; i < lines.length; i++) {
    out.write((i === 0 ? "  ⎿ " : "    ") + lines[i] + "\n");
    await sleep(60);
  }
}

// ---------- сценарий ----------
const QUESTION =
  "Какая конверсия по цели „Оформление заказа“ за 30 дней и откуда приходят покупатели?";

const COUNTER_ID = 44863217;
const GOAL_ID = 55123001;

// Финальный вывод «ассистента»: строки из сегментов [стиль, текст].
// Цифры согласованы с фикстурами mock-api.mjs: 925 заказов / 32 160 визитов =
// 2.88 %; реклама 8 240 × (3.57 % − 2.60 %) ≈ +80 заказов; 3.57 / 1.27 ≈ 2.8.
const ANSWER = [
  [[BOLD, "За 30 дней конверсия «Оформление заказа» — 2.88%: 925 заказов на 32 160 визитов."]],
  [],
  [
    ["", "  • "],
    [GREEN + BOLD, "Лучший источник"],
    ["", " — поиск: 588 заказов, конверсия 3.57% — в 2.8 раза выше соцсетей."],
  ],
  [
    ["", "  • "],
    [BOLD, "Отстаёт реклама"],
    ["", ": 2.60% при 8 240 визитах. Подтяните посадочные и минус-слова —"],
  ],
  [["", "    на том же трафике это ещё ~80 заказов в месяц."]],
  [
    ["", "  • "],
    [RED + BOLD, "Соцсети"],
    ["", " конвертят хуже всех (1.27%) — канал для охвата, бюджет сюда не масштабируйте."],
  ],
];

function renderCounters(text) {
  const lines = wrapRaw(text, 2);
  const c = JSON.parse(text).counters[0];
  return printResultLines([
    ...lines.map((l) => DIM + l + RESET),
    `${DIM}… найден счётчик ${c.id} — ${c.site2.domain} («${c.name}»)${RESET}`,
  ]);
}

function renderGoals(text) {
  const { goals } = JSON.parse(text);
  const width = Math.max(...goals.map((g) => g.name.length)) + 2;
  return printResultLines(
    goals.map((g) => `${DIM}${g.id}  ${`«${g.name}»`.padEnd(width)}  ${g.type}${RESET}`),
  );
}

function renderStat(text) {
  const r = JSON.parse(text);
  const rows = [
    ...r.data.map((d) => [d.dimensions[0].name, ...d.metrics]),
    ["Итого", ...r.totals],
  ];
  const table = [
    ["Источник", "Визиты", "Заказы", "Конверсия"],
    ...rows.map(([name, visits, orders, cr]) => [
      name,
      String(visits),
      String(orders),
      cr.toFixed(2) + "%",
    ]),
  ];
  const widths = table[0].map((_, c) => Math.max(...table.map((row) => row[c].length)));
  const fmt = (row) =>
    row
      .map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c])))
      .join("  ")
      .trimEnd();
  return printResultLines([DIM + fmt(table[0]) + RESET, ...table.slice(1).map(fmt)]);
}

const STEPS = [
  {
    tool: "list_counters",
    args: { search: "velodrive" },
    spin: 700,
    label: "Management API: counters",
    render: renderCounters,
  },
  {
    tool: "list_goals",
    args: { counterId: COUNTER_ID },
    spin: 600,
    label: "Management API: goals",
    render: renderGoals,
  },
  {
    tool: "get_statistics",
    args: {
      counterId: COUNTER_ID,
      metrics: ["ym:s:visits", `ym:s:goal${GOAL_ID}reaches`, `ym:s:goal${GOAL_ID}conversionRate`],
      dimensions: ["ym:s:lastTrafficSource"],
      date1: "30daysAgo",
      date2: "yesterday",
      sort: "-ym:s:visits",
    },
    spin: 1300,
    label: "Reporting API: stat/v1/data…",
    render: renderStat,
  },
];

// ---------- прогон ----------
async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, "dist", "index.js")],
    cwd: repoRoot,
    stderr: "ignore",
    env: {
      ...process.env,
      YANDEX_METRIKA_TOKEN: "demo",
      YANDEX_METRIKA_COUNTER_ID: "",
      YANDEX_METRIKA_API_BASE: "",
      NODE_OPTIONS: `--import ${mockPath}`,
    },
  });
  const client = new Client({ name: "readme-demo", version: "1.0.0" });
  await client.connect(transport);

  const info = client.getServerVersion();
  const { tools } = await client.listTools();
  out.write("\x1b[2J\x1b[H"); // чистый экран: контент обязан уместиться без скролла
  out.write(`${GREEN}●${RESET} ${BOLD}${info.name}${RESET} ${DIM}v${info.version} · stdio · ${tools.length} инструмента${RESET}\n\n`);
  await sleep(900);

  out.write(`${CYAN}${BOLD}❯${RESET} `);
  await sleep(600);
  await typeOut(QUESTION, 42);
  await sleep(700);
  out.write("\n\n");

  for (const step of STEPS) {
    // Аргументы в одну строку: длинный JSON обрезаем, чтобы строка вызова не заворачивалась.
    let argsShown = JSON.stringify(step.args);
    const argsMax = WIDTH - step.tool.length - 3;
    if (argsShown.length > argsMax) argsShown = argsShown.slice(0, argsMax - 2) + "…}";
    out.write(`${GREEN}⏺${RESET} ${BOLD}${step.tool}${RESET} ${DIM}${argsShown}${RESET}\n`);
    const [res] = await Promise.all([
      client.callTool({ name: step.tool, arguments: step.args }),
      spinner(step.spin, step.label),
    ]);
    const text = res.content?.[0]?.text ?? "";
    if (res.isError) {
      out.write(`  ${RED}${text}${RESET}\n`);
      process.exit(1);
    }
    await step.render(text);
    out.write("\n");
    await sleep(400);
  }

  await sleep(500);
  out.write(`${MAUVE}✦${RESET} `);
  for (const line of ANSWER) {
    for (const [style, seg] of line) {
      for (const word of seg.split(/(?<= )/)) {
        out.write(style + word + RESET);
        await sleep(34);
      }
    }
    out.write("\n");
    if (line.length === 0) await sleep(120);
  }

  out.write("\x1b[?25l"); // спрятать курсор — чистый финальный кадр
  await client.close();
  // Держим кадр, пока vhs не закончит запись (короткий hold — для ручного прогона).
  await sleep(Number(process.env.DEMO_HOLD_MS ?? 120_000));
}

main().catch((err) => {
  console.error(`${RED}demo failed:${RESET}`, err);
  process.exit(1);
});
