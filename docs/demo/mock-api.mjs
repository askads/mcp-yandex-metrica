// Законсервированный Yandex Metrica API для README-демо: патчит глобальный fetch,
// так что настоящий код сервера проходит весь свой путь (заголовки, ретраи,
// таймауты, парсинг), но ни один байт не уходит в сеть. Подключается в процесс
// сервера через NODE_OPTIONS=--import из docs/demo/run.mjs; продовый код не
// меняется. Цифры согласованы со сценарием в run.mjs.

// Терминал vhs при наших настройках — 95 колонок: имена счётчика/целей и
// названия источников подобраны так, чтобы таблицы помещались без переносов.

const COUNTER_ID = 44863217;

// Management API: GET management/v1/counters
const COUNTERS = {
  rows: 1,
  counters: [
    {
      id: COUNTER_ID,
      status: "Active",
      owner_login: "velodrive-shop",
      name: "Велодрайв — интернет-магазин",
      code_status: "CS_OK",
      site2: { site: "velodrive.ru", domain: "velodrive.ru" },
      permission: "own",
      type: "simple",
      favorite: 0,
      create_time: "2023-04-18T12:30:41+03:00",
    },
  ],
};

// Management API: GET management/v1/counter/{id}/goals
const GOALS = {
  goals: [
    {
      id: 55123001,
      name: "Оформление заказа",
      type: "action",
      is_retargeting: 0,
      goal_source: "user",
      default_price: 0,
      conditions: [{ type: "exact", url: "order_success" }],
    },
    {
      id: 55123007,
      name: "Добавление в корзину",
      type: "action",
      is_retargeting: 0,
      goal_source: "user",
      default_price: 0,
      conditions: [{ type: "exact", url: "add_to_cart" }],
    },
    {
      id: 55123013,
      name: "Подписка на рассылку",
      type: "form",
      is_retargeting: 0,
      goal_source: "auto",
      default_price: 0,
    },
  ],
};

// Reporting API: GET stat/v1/data — визиты + конверсия по цели «Оформление
// заказа» в разрезе последнего источника трафика за 30 дней.
// Арифметика согласована: totals = сумма/средневзвешенное строк
// (925 заказов / 32 160 визитов = 2.876 % общая конверсия).
const STAT = {
  query: {
    ids: [COUNTER_ID],
    dimensions: ["ym:s:lastTrafficSource"],
    metrics: ["ym:s:visits", "ym:s:goal55123001reaches", "ym:s:goal55123001conversionRate"],
    sort: ["-ym:s:visits"],
    date1: "2026-06-04",
    date2: "2026-07-03",
    limit: 100,
    offset: 1,
    group: "Week",
    auto_group_size: "1",
    quantile: "50",
    attribution: "LastSign",
    currency: "RUB",
    adfox_event_id: "0",
  },
  data: [
    {
      dimensions: [
        { icon_id: "2", icon_type: "traffic-source", name: "Переходы из поисковых систем", id: "organic" },
      ],
      metrics: [16480, 588, 3.56796116],
    },
    {
      dimensions: [{ icon_id: "3", icon_type: "traffic-source", name: "Переходы по рекламе", id: "ad" }],
      metrics: [8240, 214, 2.59708738],
    },
    {
      dimensions: [{ icon_id: "0", icon_type: "traffic-source", name: "Прямые заходы", id: "direct" }],
      metrics: [5310, 96, 1.8079096],
    },
    {
      dimensions: [
        { icon_id: "8", icon_type: "traffic-source", name: "Переходы из социальных сетей", id: "social" },
      ],
      metrics: [2130, 27, 1.26760563],
    },
  ],
  total_rows: 4,
  total_rows_rounded: false,
  sampled: false,
  contains_sensitive_data: false,
  sample_share: 1,
  sample_size: 32160,
  sample_space: 32160,
  data_lag: 78,
  totals: [32160, 925, 2.87624378],
  min: [2130, 27, 1.26760563],
  max: [16480, 588, 3.56796116],
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));

  if (url.host === "api-metrika.yandex.net") {
    if (url.pathname === "/management/v1/counters") return json(COUNTERS);
    if (url.pathname === `/management/v1/counter/${COUNTER_ID}/goals`) return json(GOALS);
    if (url.pathname === "/stat/v1/data") return json(STAT);
    // Формат ошибки Метрики (не-2xx) — сервер покажет её как обычный tool-error:
    // если сценарий demo уехал от фикстур, это видно сразу, а в сеть запрос не уходит.
    return json(
      {
        errors: [{ error_type: "not_mocked", message: `Not mocked in demo: ${url.pathname}` }],
        code: 400,
        message: `Not mocked in demo: ${url.pathname}`,
      },
      400,
    );
  }

  return realFetch(input, init);
};
