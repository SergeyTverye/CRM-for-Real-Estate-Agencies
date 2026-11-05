import { chromium, expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { db, disconnectDb } from "../../src/shared/db/client";
import { decodeReservation, microsToRub } from "../../src/modules/ai/infrastructure/prisma-repositories";
import type { AiSettingsInput } from "../../src/modules/ai/domain/settings";
import type { getAiSettings } from "../../src/modules/ai/application/settings-service";

config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const baseURL = "http://localhost:3310";
const output = "docs/screenshots/vkr/live-ai";
const statePath = "data/live-ai-trials-state.json";
type Settings = Awaited<ReturnType<typeof getAiSettings>>;
type State = { startedAt: string; runs: number; parses: number; screenshots: string[]; events: unknown[]; firstRunId?: string; savedSearchId?: string; needId?: string; offerId?: string };
let state: State;
async function save() { await writeFile(statePath, JSON.stringify(state, null, 2)); }
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const r = await page.request.fetch(`${baseURL}${path}`, { method, headers: { Origin: baseURL, "Content-Type": "application/json" }, data: body, timeout: 150000 });
  if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()}`);
  return await r.json() as T;
}
async function login(page: Page, role: "MANAGER" | "REALTOR1") {
  const password = process.env[`SEED_${role}_PASSWORD`];
  if (!password) throw new Error(`Missing seed password for ${role}`);
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Login via same-origin browser fetch avoids compiling the concurrently edited
  // /today route; credentials remain inside the local browser request.
  await api(page, "POST", "/api/v1/auth/login", { login: process.env[`SEED_${role}_LOGIN`] ?? role.toLowerCase(), password });
}
async function readySearch(page: Page) {
  await page.waitForFunction(() => Object.keys(document.querySelector("#query") ?? {}).some(k => k.startsWith("__reactProps")), { timeout: 60000 });
}
function settingInput(s: Settings["setting"]): AiSettingsInput {
  const { id, updatedBy, updatedAt, ...rest } = s;
  void id; void updatedBy;
  return { ...rest, expectedUpdatedAt: updatedAt } as AiSettingsInput;
}
async function shot(page: Page, name: string) {
  await expect(page.locator("main").getByText(/^Загрузка настроек/)).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByText("Загрузка...", { exact: true })).toHaveCount(0, { timeout: 60000 });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: "disabled" });
  state.screenshots.push(name); await save();
  console.log(`Screenshot ${name} LIVE`);
}
async function main() {
  const mode = process.argv[2] ?? "inspect";
  if (mode.startsWith("second-")) return secondTrial(mode);
  if (mode === "report") {
    const existing = JSON.parse(await readFile("docs/vkr/live-ai-evidence.json", "utf8"));
    if (existing.secondPass) throw new Error("Second pass exists: use second-report to preserve historical evidence and prose");
    const trialState = JSON.parse(await readFile(statePath, "utf8")) as State;
    const runs = await db.searchRun.findMany({ where: { startedAt: { gte: new Date(trialState.startedAt) }, needId: trialState.needId }, include: { sources: true, results: { include: { listing: { select: { source: true, address: true, priceRub: true, areaM2: true, url: true } } } } }, orderBy: { startedAt: "asc" } });
    const live = runs.filter(r => r.sources.length && !r.sources.some(s => s.reason?.includes("Записанный")));
    const snapshots = await db.externalListingSnapshot.findMany({ where: { searchRunId: { in: live.map(r => r.id) } }, select: { searchRunId: true, listingId: true, normalized: true }, orderBy: { fetchedAt: "desc" } });
    const usageRows = await db.aiUsageLog.findMany({ where: { createdAt: { gte: new Date(trialState.startedAt) }, callType: { in: ["parse", "description", "web_search"] } }, orderBy: { createdAt: "asc" } });
    const usage = usageRows.map(r => { const d = decodeReservation(r.result); return { id: r.id, time: r.createdAt, jobId: r.searchRunId, type: r.callType, model: r.model, input: r.inputTokens, output: r.outputTokens, webSearchCalls: r.webSearchCalls, estimatedRub: d ? microsToRub(d.estimatedMicros) : r.estimatedCostRub.toString(), actualCrmRub: d?.actualMicros === undefined ? null : microsToRub(d.actualMicros), chargedRub: d ? microsToRub(d.chargedMicros) : null, status: r.status }; });
    const evidence = { mode: "LIVE", exportedAt: new Date().toISOString(), cloudBillingAvailable: false, usage,
      runs: live.map(r => ({ id: r.id, time: r.startedAt, filters: r.filters, status: r.status, webSearchUsed: r.webSearchUsed, sources: r.sources.map(s => ({ source: s.source, status: s.status, count: s.resultCount, reason: s.reason })), results: r.results.map(v => {
        const snap = snapshots.find(s => s.searchRunId === r.id && s.listingId === v.listingId)?.normalized as Record<string, unknown> | undefined;
        return { verdict: v.verdict, isNew: v.isNew, priceChanged: v.priceChanged, source: v.listing.source, address: snap?.address ?? v.listing.address, priceRub: snap?.price ?? null, areaM2: snap?.area ?? null, url: snap?.url ?? v.listing.url };
      }) })) };
    await writeFile("docs/vkr/live-ai-evidence.json", JSON.stringify(evidence, null, 2));
    const summary = { runs: live.length, calls: usage.length, additionalAi: usage.filter(r => r.type !== "web_search").length, web: usage.filter(r => r.type === "web_search").length, toolCalls: usage.reduce((s, r) => s + r.webSearchCalls, 0), input: usage.reduce((s, r) => s + r.input, 0), output: usage.reduce((s, r) => s + r.output, 0), chargedRub: microsToRub(usageRows.reduce((s, r) => s + (decodeReservation(r.result)?.chargedMicros ?? 0n), 0n)) };
    const header = (await readFile("docs/vkr/live-ai-trials.md", "utf8")).split("## Журнал LIVE")[0];
    const parseEvents = trialState.events.filter(e => (e as { type?: string }).type === "parse") as { query: string }[];
    let parseIndex = 0;
    const callLines = usage.map(u => {
      const r = live.find(r => r.id === u.jobId);
      const query = u.type === "parse" ? parseEvents[parseIndex++]?.query ?? "Русский запрос: см. скриншот" : JSON.stringify(r?.filters ?? {});
      const kind = u.type === "web_search" ? u.jobId === trialState.firstRunId ? "web_search: после исправления каталогов" : r?.sources.some(s => s.source === "onrealt") ? "web_search: ручной" : "web_search: автоматический резерв" : u.type;
      return `| ${new Date(u.time).toISOString()} | ${kind} | ${u.model} | ${u.input}/${u.output} | ${u.webSearchCalls} | ${u.estimatedRub} | ${u.actualCrmRub ?? "неизвестно"} | ${u.status} |\n\nУсловия: ${query}\n`;
    }).join("\n");
    const runLines = evidence.runs.map(r => `| ${r.time.toISOString()} | ${r.id} | ${r.status} | ${r.sources.map(s => `${s.source}: ${s.status}/${s.count}`).join("; ")} | ${r.results.length} |`).join("\n");
    const named = evidence.runs[0]?.results.filter(r => r.address && (String(r.address).includes("Чаплыгина") || String(r.address).includes("Станиславского"))) ?? [];
    const propertyLines = named.map(r => `| ${r.address} | ${r.priceRub ?? "—"} | ${r.areaM2 ?? "—"} | ${r.url} |`).join("\n");
    const comparison = trialState.events.filter(e => (e as { type?: string }).type === "repeat-comparison");
    const final = `## Журнал LIVE\n\nВсе времена ниже — UTC. UI показывает Asia/Novosibirsk (UTC+7). Модель в каждой строке — aliceai-llm-flash/latest. Стоимость «CRM» рассчитана по полученным usage и проверенному тарифу; банковское списание/биллинг Cloud недоступны. Резервная оценка перед dispatch приведена отдельно, она не является списанием.\n\n| Время UTC | Тип | Модель | input/output | web calls | Резерв-оценка ₽ | Известный расход CRM ₽ | Статус |\n|---|---|---|---:|---:|---:|---:|---|\n${callLines}\n### Запуски скрапера\n\n| Начало UTC | Run ID | Итог | Источники: статус/количество | Сохранённых результатов* |\n|---|---|---|---|---:|\n${runLines}\n\n* Повторные запуски разделяют ExternalListing, каждый имеет собственный snapshot. Для ручного web результаты добавлены к исходной выдаче. До исправления счётчик web мог включать повторные URL: raw=4, уникальных сохранённых ссылок=3. Исторические дефектные ответы не переписывались. Они содержали каталоги, а не доказанные объявления.\n\nУсловия каждого запуска, вердикт, новизна, изменение цены и **все URL** с адресом/ценой/площадью на момент запуска: [live-ai-evidence.json](live-ai-evidence.json). ФИО/телефоны продавцов, описания и prompts в файл не экспортируются.\n\n### Реальные объекты для КП\n\n| Адрес площадки | Цена ₽ | Площадь м² | Первоисточник |\n|---|---:|---:|---|\n${propertyLines}\n\nДве записи OnRealt сохранены в личные закладки и SearchSelection потребности ${trialState.needId}, перенесены в Property и включены в отдельный черновик КП ${trialState.offerId}. Цены и площади зафиксированы snapshot. Продавец/наличие не проверялись звонком; объявление не признаётся подтверждённым собственником. Первоначальное действие «В КП» добавило записи в существовавший демо-черновик; финальное отдельное КП содержит **только два реальных объекта**. На экране потребности также видны старые демонстрационные кандидаты с явными пометками [DEMO-V241]; они не являются частью LIVE-испытания.\n\n### Итоги и ограничения\n\n| Показатель | Результат |\n|---|---:|\n| Полноценных подборов | ${summary.runs}/10 |\n| AI-вызовов всего, включая web | ${summary.calls} |\n| Дополнительных parse/description | ${summary.additionalAi}/25 |\n| Web Search запросов / фактических tool calls | ${summary.web}/5 / ${summary.toolCalls} |\n| input / output токенов | ${summary.input} / ${summary.output} |\n| Известная стоимость по журналу CRM | ${summary.chargedRub} ₽ |\n| Списание Yandex Cloud | недоступно; не утверждается |\n\n- **PASS:** настоящий русский parse, продажа офиса; аренда торговли/ПСН; склад/производство; диапазоны; районы Центральный/Заельцовский/Ленинский/Октябрьский; собственник, обязательные/желательные признаки; 3 LIVE description; подтверждение платного поиска; реальный скрапер; частичные отказы; сравнение; закладки; подборка; 2 Property; отдельное КП и печатный A4.\n- **PASS:** повторная выдача и сохранность истории. Измеренное сравнение: ${JSON.stringify(comparison)}. Реального изменения цены в этом коротком интервале не наблюдалось; priceChanged=true подтверждён integration-тестом на fake, не выдаётся за рыночное событие.\n- **PASS:** исправный ноль Юлы (цена до 1 ₽, площадь от 100000 м²), без web-резерва. После этого доступны прежние закладки, кандидаты, КП. Повторное открытие ?runId загружает прежний запуск с RBAC без оплаты.\n- **PARTIAL WEB:** ручной и автоматический Responses web_search реально вызваны, но модель дала преимущественно каталоги. Исправлен запрет каталогов известных площадок и счётчик принятых ссылок; один контрольный LIVE web после исправления вернул корректные 0 принятых карточек. Доступность API подтверждена, результативность веб-подбора конкретных объявлений этим срезом **не подтверждена**. Старые ошибочные ссылки в run 9e28eae7-3507-4937-8126-b2dccb4fe185 не использовать для предложений клиентам.\n- **PARTIAL AI:** обнаружены перенос старого района при «любые районы» и ослабление first_floor_only при уточнении «исключи цоколь». Добавлены детерминированные защиты и fake-регрессии; эти два исправления отдельно повторными платными parse не проверялись.\n- Лимитные гонки/исчерпание: только fake/integration. Демо-БД содержит прежние synthetic usage; их тарифные записи не удалялись, на снимке общего бюджета они видны. Сессия включает только parse/description/web текущего интервала; параллельные P2 call_note исключены. Для LIVE-процесса web jobs/day=10 (5 прежних synthetic + максимум 5 новых), monthly ENV=1000 сохранён.\n- Итого: **PARTIAL**, полный безусловный PASS для P0 LIVE-приёмки не заявляется. Бюджет и остальные исходные настройки восстановлены через API, тарифные версии сохранены. .env не менялся; миграций и npm install нет. Git commit/checkout/stash/reset/switch не выполнялись.\n\n### Проверки\n\n374 unit PASS; 33 integration/authorization PASS на crm_test_a; общий tsc --noEmit PASS. Целевой ESLint повторяется после финальных правок. Полный Playwright-набор и production Docker не запускались. Хост runtime Node.js 22.23.4; это dev-smoke, не подтверждение production baseline Node 24.\n\n### Скриншоты\n\nКаталог: [live-ai](../screenshots/vkr/live-ai/). Каждый созданный этим исполнителем кадр просмотрен. Режим каждого — LIVE, данные поиска — действующие площадки/реальный Yandex API, клиент — синтетический crm_demo. Снимки 01/02 и 12–18 показывают настоящий AI и его исходные ошибки; 04/06/19/25 — живые статусы/выдачу; 05 — evidence; 26 — реальное сравнение; 07/28 — исходный LIVE fallback с дефектными каталогами; 31 — состояние **после** исправления (0 карточек); 08/09 — сохранённые реальные кандидаты рядом с ранее существовавшими явно помеченными demo; 10/11 — чистое LIVE КП/A4. 21 показывает ручной web, результат проверяется по журналу, а не только по видимой верхней части списка источников. 29/30 — исправный ноль Юлы. 00-budget-parse-matrix — рабочий бюджет 250 ₽. Первые 00-budget-trial1/resume1 и 03-confirm содержали состояние загрузки/перехода и не служат доказательством готовности экрана. Скриншоты p2-* создаёт другой агент и в эту приёмку не включены.\n`;
    await writeFile("docs/vkr/live-ai-trials.md", header + final);
    console.log(JSON.stringify(summary)); await disconnectDb(); return;
  }
  if (mode === "ledger") {
    const since = new Date(JSON.parse(await readFile(statePath, "utf8")).startedAt);
    const runs = await db.searchRun.findMany({ where: { startedAt: { gte: since } }, include: { sources: true, _count: { select: { results: true } } }, orderBy: { startedAt: "asc" } });
    const usage = await db.aiUsageLog.findMany({ where: { createdAt: { gte: since } }, select: { callType: true, inputTokens: true, outputTokens: true, status: true, webSearchCalls: true, createdAt: true } });
    console.log(JSON.stringify({ runs: runs.map(r => ({ id: r.id, status: r.status, filters: r.filters, sources: r.sources, count: r._count.results })), usage }));
    await disconnectDb(); return;
  }
  if (mode === "server") {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", "3310"], {
      stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: ".next-live", NODE_ENV: "development", AI_ENABLED: "true", YANDEX_WEB_SEARCH_ENABLED: "true", YANDEX_WEB_SEARCH_AUTO_FALLBACK: "true",
        SCRAPER_ENABLED: "true", SCRAPER_DEMO_FIXTURES: "false", SCRAPER_BROWSER_ENABLED: process.env.SCRAPER_BROWSER_ENABLED ?? "true", SCRAPER_JOB_TIMEOUT_MS: process.env.SCRAPER_JOB_TIMEOUT_MS ?? "60000",
        SCRAPER_BROWSER_EXECUTABLE_PATH: "D:/chrome-win64/chrome.exe",
        YANDEX_WEB_SEARCH_ALLOWED_DOMAINS: "cian.ru,mirkvartir.ru,onrealt.ru,realty.yandex.ru,domclick.ru",
        // crm_demo already contains five synthetic web jobs for realtor1. Keep
        // those records; reserve at most five new LIVE jobs in this session.
        YANDEX_WEB_SEARCH_MAX_JOBS_PER_USER_DAY: "10",
        COOKIE_SECURE: "false", LOG_LEVEL: "warn", INSTANCE_ID: "vkr-live-ai-3310" },
    });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
    await new Promise<void>(resolve => child.on("exit", code => { process.exitCode = code ?? 1; resolve(); }));
    return;
  }
  await mkdir("data", { recursive: true }); await mkdir(output, { recursive: true });
  try { state = JSON.parse(await readFile(statePath, "utf8")); }
  catch { state = { startedAt: new Date().toISOString(), runs: 0, parses: 0, screenshots: [], events: [] }; await save(); }
  const browser = await chromium.launch();
  const manager = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  manager.on("pageerror", e => console.log(`Browser error: ${e.message.slice(0, 300)}`));
  let original: Settings | undefined;
  let applied: Settings | undefined;
  try {
    await login(manager, "MANAGER");
    if (mode === "restore") {
      const previous = JSON.parse(await readFile("data/live-ai-settings-original.json", "utf8")) as Settings["setting"];
      const current = await api<Settings>(manager, "GET", "/api/v1/settings/ai");
      await api(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(previous), expectedUpdatedAt: current.setting.updatedAt });
      console.log("Original AI settings restored from recovery file"); return;
    }
    if (mode === "inspect") await manager.goto(`${baseURL}/settings/ai`, { waitUntil: "domcontentloaded" });
    original = await api<Settings>(manager, "GET", "/api/v1/settings/ai");
    console.log(JSON.stringify({ originalBudgetRub: original.setting.monthlyBudgetRub, tariffs: original.tariffs.length, keyConfigured: !!process.env.YANDEX_CLOUD_API_KEY }));
    if (mode === "inspect") return;
    await writeFile("data/live-ai-settings-original.json", JSON.stringify(original.setting));
    const todayCount = await db.aiUsageLog.count({ where: { createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } } });
    const tariffs = original.tariffs.filter(t => t.model === "aliceai-llm-flash/latest");
    const effectiveFrom = new Date().toISOString();
    applied = await api<Settings>(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(original.setting), aiEnabled: true,
      scraperEnabled: true, browserEnabled: false, enabledSources: ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"], webSearchManualAllowed: true, webSearchAutoFallback: true,
      model: "aliceai-llm-flash/latest", webModel: null, searchContextSize: "low", monthlyBudgetRub: "250", perJobLimit: 3,
      perUserDailyLimit: Math.min(100, todayCount + 30), dailyLimit: Math.min(200, todayCount + 30),
      ...(!tariffs.length ? { tariffs: [{ model: "aliceai-llm-flash/latest", effectiveFrom,
        inputRubPerMillion: "100", outputRubPerMillion: "200", webRubPerCall: "0.915" }] } : {}) });
    expect(Number(applied.effective.values.monthlyBudgetRub)).toBe(250);
    await manager.goto(`${baseURL}/settings/ai`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(manager.getByRole("heading", { name: /ИИ и источники|Настройки ИИ/ }).first()).toBeVisible({ timeout: 60000 });
    await shot(manager, `00-budget-${mode}`);
    const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 }, locale: "ru-RU", timezoneId: "Asia/Novosibirsk" });
    page.setDefaultTimeout(30000);
    // The legacy UI uses native dialogs; no dialogs are introduced by this harness.
    page.on("dialog", d => d.accept());
    await login(page, "REALTOR1");
    const user = await db.user.findFirstOrThrow({ where: { login: process.env.SEED_REALTOR1_LOGIN ?? "realtor1" } });
    const need = await db.clientNeed.findFirstOrThrow({ where: { responsibleUserId: user.id, status: "active", client: { notes: { contains: "[DEMO-V241]" } } } });
    state.needId = need.id; await save();
    await page.goto(`${baseURL}/property-search?needId=${need.id}`);
    await readySearch(page);
    expect(await page.getByText("Режим тестирования: записанные ответы площадок", { exact: true }).count()).toBe(0);
    if (mode === "trial1" || mode === "resume1") {
      if (state.parses === 0) await parse(page, "Продажа офиса в Новосибирске, площадь от 30 до 500 м², цена от 1000000 до 50000000 рублей, любой этаж, любые районы, все продавцы", "01-query", "02-ai-parsed-filters");
      else {
        // Resume with the already paid parse by filling actual visible controls;
        // no provider call is repeated after a harness/UI selector change.
        await page.getByLabel(/^Операция/).selectOption("sale");
        await page.getByLabel(/^Этаж/).selectOption("any");
        await page.getByLabel("Цена от", { exact: true }).fill("1000000");
        await page.getByLabel("Цена до", { exact: true }).fill("50000000");
        await page.getByLabel("Площадь от, м²", { exact: true }).fill("30");
        await page.getByLabel("Площадь до, м²", { exact: true }).fill("500");
        for (const label of ["Торговля", "ПСН / универсальное", "Производство", "Склад", "Свободное назначение"]) await page.getByLabel(label, { exact: true }).uncheck();
        await page.getByLabel("Офис", { exact: true }).check();
      }
      for (const button of await page.getByRole("button", { name: /^Убрать район / }).all()) await button.click();
      // A broad first search avoids silently interpreting an empty subset as unavailable sources.
      await page.getByLabel("Обязательные признаки", { exact: true }).fill("");
      await page.getByLabel("Желательные признаки", { exact: true }).fill("");
      const result = mode === "resume1" ? await api<Record<string, unknown> & { id: string; filters: { sources: string[] }; results: { listingId: string; verdict: string; listing: { address: string | null; sourceMethod: string } }[] }>(page, "GET", "/api/v1/property-search/runs/33f90440-7a66-4d5f-bc8a-dadb0c271906") : await run(page, "03-confirm", "04-live-results");
      state.firstRunId = result.id;
      const saved = await api<{ id: string }>(page, "POST", "/api/v1/property-search/saved-searches", { name: "[LIVE 05.11] Офисы Новосибирска", filters: result.filters, sources: result.filters.sources, needId: need.id });
      state.savedSearchId = saved.id; await save();
      if (mode !== "resume1") {
        await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
        await shot(page, "06-source-statuses");
      }
      const rows = result.results.filter((r: { verdict: string; listing: { address: string | null; sourceMethod: string } }) => r.verdict !== "rejected" && r.listing.address && r.listing.sourceMethod === "scraper").slice(0, 2);
      for (const row of rows) {
        await api(page, "POST", `/api/v1/property-search/listings/${row.listingId}/bookmark`, { status: "study", note: "LIVE: найдено на действующей площадке; продавец и актуальность не проверены" });
        await api(page, "POST", `/api/v1/property-search/listings/${row.listingId}/selection`, { needId: need.id, comment: "LIVE: кандидат для проверки сотрудником" });
        await api(page, "POST", `/api/v1/property-search/listings/${row.listingId}/transfer`, { confirmed: true, identityConfirmed: true });
        const offer = await api<{ id: string }>(page, "POST", `/api/v1/property-search/listings/${row.listingId}/offer`, { needId: need.id });
        state.offerId = offer.id; await save();
      }
      await page.getByRole("tab", { name: "Закладки", exact: true }).click();
      await expect(page.getByRole("link", { name: "Источник ↗", exact: true }).first()).toBeVisible({ timeout: 60000 });
      await shot(page, "08-bookmarks");
      await page.goto(`${baseURL}/needs/${need.id}`); await shot(page, "09-selection");
      if (state.offerId) {
        await page.goto(`${baseURL}/offers/${state.offerId}`); await shot(page, "10-offer");
        await page.goto(`${baseURL}/offers/${state.offerId}/print`); await shot(page, "11-offer-print");
      }
    } else if (mode === "remaining" || mode === "finish") {
      if (mode === "remaining") {
      await page.getByRole("tab", { name: "Мои поиски", exact: true }).click();
      const row = page.locator("div.border-t").filter({ hasText: "[LIVE 05.11] Офисы Новосибирска" });
      await row.getByRole("button", { name: "Открыть / запустить", exact: true }).click();
      await expect(page.getByText("Условия загружены.", { exact: false })).toBeVisible();
      await run(page, "23-repeat-confirm", "04-live-results");
      const repeated = await run(page, "24-repeat-confirm", "25-repeat-results");
      state.events.push({ type: "repeat-comparison", id: repeated.id, time: new Date().toISOString(), isNew: repeated.results.filter((r: { isNew: boolean }) => r.isNew).length, priceChanged: repeated.results.filter((r: { priceChanged: boolean }) => r.priceChanged).length }); await save();
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "06-source-statuses");
      await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
      const compare = page.getByLabel("Сравнить объявление", { exact: true });
      if (await compare.count() >= 2) { await compare.nth(0).check(); await compare.nth(1).check(); await shot(page, "26-comparison"); }
      await page.getByRole("button", { name: "Веб-поиск", exact: true }).click();
      await expect(page.getByRole("button", { name: "Подтверждаю запуск", exact: true })).toBeEnabled({ timeout: 60000 });
      const webResponse = page.waitForResponse(r => r.url().endsWith("/web-search") && r.request().method() === "POST", { timeout: 90000 });
      await page.getByRole("button", { name: "Подтверждаю запуск", exact: true }).click();
      const web = await webResponse; state.events.push({ type: "manual-web", time: new Date().toISOString(), http: web.status() }); await save();
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "21-manual-web-browser");
      }
      await page.goto(`${baseURL}/property-search?needId=${need.id}`, { waitUntil: "domcontentloaded" });
      await readySearch(page);
      for (const source of ["Циан", "Мир Квартир", "OnRealt", "Яндекс Недвижимость", "Юла"]) await page.getByLabel(source, { exact: true }).uncheck();
      for (const label of ["Цена от", "Цена до", "Площадь от, м²", "Площадь до, м²"]) await page.getByLabel(label, { exact: true }).fill("");
      for (const button of await page.getByRole("button", { name: /^Убрать район / }).all()) await button.click();
      await run(page, "27-fallback-confirm", "07-web-fallback-live");
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "28-fallback-statuses");
      await page.goto(`${baseURL}/property-search?needId=${need.id}`, { waitUntil: "domcontentloaded" });
      await readySearch(page);
      for (const source of ["Циан", "Мир Квартир", "OnRealt", "Яндекс Недвижимость", "Авито", "Домклик"]) await page.getByLabel(source, { exact: true }).uncheck();
      await page.getByLabel("Цена до", { exact: true }).fill("1");
      await page.getByLabel("Цена от", { exact: true }).fill("");
      await page.getByLabel("Площадь от, м²", { exact: true }).fill("100000");
      await page.getByLabel("Площадь до, м²", { exact: true }).fill("");
      const empty = await run(page, "29-empty-confirm", "30-empty-results");
      expect(empty.results).toHaveLength(0); expect(empty.webSearchUsed).toBe(false);
      await page.getByRole("tab", { name: "Закладки", exact: true }).click();
      await expect(page.getByRole("link", { name: "Источник ↗", exact: true }).first()).toBeVisible({ timeout: 60000 });
      await page.getByRole("link", { name: "Источник ↗", exact: true }).first().scrollIntoViewIfNeeded(); await shot(page, "08-bookmarks");
      await page.goto(`${baseURL}/needs/${need.id}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "09-selection");
      await page.goto(`${baseURL}/offers/${state.offerId}`, { waitUntil: "domcontentloaded" }); await shot(page, "10-offer");
      await page.goto(`${baseURL}/offers/${state.offerId}/print`, { waitUntil: "domcontentloaded" }); await expect(page.locator(".crm-print")).toBeVisible(); await shot(page, "11-offer-print");
    } else if (mode === "final-check") {
      const selected = await db.searchSelection.findMany({ where: { needId: need.id, comment: { startsWith: "LIVE:" }, propertyId: { not: null } }, select: { propertyId: true }, take: 2 });
      const legal = await db.legalEntity.findFirst({ where: { isActive: true }, select: { id: true } });
      const existingClean = await db.commercialOffer.findFirst({ where: { clientNeedId: need.id, title: "[LIVE 05.11.2026] Реальные офисы Новосибирска" }, select: { id: true } });
      const clean = existingClean ?? await api<{ id: string }>(page, "POST", "/api/v1/offers", { clientNeedId: need.id, title: "[LIVE 05.11.2026] Реальные офисы Новосибирска", legalEntityId: legal?.id,
        items: selected.map(s => ({ propertyId: s.propertyId, comment: "LIVE: первоисточник найден скрапером; актуальность и продавец требуют проверки" })) });
      state.offerId = clean.id; await save();
      await page.goto(`${baseURL}/offers/${clean.id}`, { waitUntil: "domcontentloaded" }); await expect(page.locator("h1")).toBeVisible({ timeout: 30000 }); await shot(page, "10-offer");
      await page.goto(`${baseURL}/offers/${clean.id}/print`, { waitUntil: "domcontentloaded" });
      await expect(page.frameLocator('iframe[title="Печатное коммерческое предложение A4"]').locator("body")).toContainText("Станиславского", { timeout: 30000 }); await shot(page, "11-offer-print");
      if (!state.firstRunId) throw new Error("No initial LIVE run");
      const usedWeb = await db.aiUsageLog.count({ where: { createdAt: { gte: new Date(state.startedAt) }, callType: "web_search" } });
      if (usedWeb >= 5) throw new Error("LIVE web call cap reached");
      const web = await api<{ sources: unknown[]; results: { listing: { source: string; url: string } }[] }>(page, "POST", `/api/v1/property-search/runs/${state.firstRunId}/web-search`);
      state.events.push({ time: new Date().toISOString(), type: "web-after-catalogue-fix", sources: web.sources, urls: web.results.filter(r => r.listing.source === "web_search").map(r => r.listing.url) }); await save();
      await page.goto(`${baseURL}/property-search?runId=${state.firstRunId}`, { waitUntil: "domcontentloaded" }); await readySearch(page);
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "31-web-corrected");
      await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
      const compare = page.getByLabel("Сравнить объявление", { exact: true });
      if (await compare.count() >= 2) {
        await compare.nth(0).check(); await compare.nth(1).check(); await page.getByRole("button", { name: "Сравнить", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Сравнение объявлений" })).toBeVisible(); await shot(page, "26-comparison");
        await page.keyboard.press("Escape");
      }
      const evidence = page.getByText(/^Доказательства по критериям/).first(); await evidence.click(); await evidence.scrollIntoViewIfNeeded(); await shot(page, "05-evidence");
    } else if (mode === "capture-finish") {
      const latest = await db.searchRun.findFirstOrThrow({ where: { needId: need.id, webSearchUsed: true }, orderBy: { startedAt: "desc" } });
      await page.goto(`${baseURL}/property-search?runId=${latest.id}`, { waitUntil: "domcontentloaded" }); await readySearch(page);
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "07-web-fallback-live");
      await page.getByRole("tab", { name: "Требуют проверки", exact: true }).click(); await shot(page, "28-fallback-statuses");
      await page.goto(`${baseURL}/property-search?needId=${need.id}`, { waitUntil: "domcontentloaded" }); await readySearch(page);
      for (const source of ["Циан", "Мир Квартир", "OnRealt", "Яндекс Недвижимость", "Авито", "Домклик"]) await page.getByLabel(source, { exact: true }).uncheck();
      await page.getByLabel("Цена до", { exact: true }).fill("1"); await page.getByLabel("Цена от", { exact: true }).fill("");
      await page.getByLabel("Площадь от, м²", { exact: true }).fill("100000"); await page.getByLabel("Площадь до, м²", { exact: true }).fill("");
      const empty = await run(page, "29-empty-confirm", "30-empty-results");
      expect(empty.results).toHaveLength(0); expect(empty.webSearchUsed).toBe(false);
      await page.getByRole("tab", { name: "Закладки", exact: true }).click();
      await expect(page.getByRole("link", { name: "Источник ↗", exact: true }).first()).toBeVisible({ timeout: 60000 });
      await page.getByRole("link", { name: "Источник ↗", exact: true }).first().scrollIntoViewIfNeeded(); await shot(page, "08-bookmarks");
      await page.goto(`${baseURL}/needs/${need.id}`, { waitUntil: "domcontentloaded" }); await page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }).scrollIntoViewIfNeeded(); await shot(page, "09-selection");
      await page.goto(`${baseURL}/offers/${state.offerId}`, { waitUntil: "domcontentloaded" }); await shot(page, "10-offer");
      await page.goto(`${baseURL}/offers/${state.offerId}/print`, { waitUntil: "domcontentloaded" }); await expect(page.locator(".crm-print")).toBeVisible(); await shot(page, "11-offer-print");
    } else if (mode === "parse-matrix") {
      await parse(page, "Аренда торговли или ПСН в Новосибирске, Центральный или Заельцовский район, строго первый этаж, 50–200 м², от 50000 до 250000 рублей в месяц, только собственник; обязательный отдельный вход, желательна мокрая точка", "12-rent-query", "13-rent-parsed");
      await parse(page, "Добавь обязательную витрину и исключи цоколь, остальные условия сохрани", "14-refinement-query", "15-refinement-parsed");
      await parse(page, "Новый поиск: аренда склада или производства в Новосибирске, Ленинский или Октябрьский район, 200–1000 м², 100000–600000 рублей в месяц, без подвала и цоколя, все продавцы, обязательно ворота и мощность от 50 кВт", "16-warehouse-query", "17-warehouse-parsed");
      await run(page, "18-rent-confirm", "19-rent-results");
    } else if (mode === "repeat") {
      if (!state.savedSearchId) throw new Error("No saved LIVE search");
      const searches = await api<{ id: string; filters: unknown; sources: unknown; needId: string }[]>(page, "GET", "/api/v1/property-search/saved-searches");
      const saved = searches.find(s => s.id === state.savedSearchId)!;
      for (let i = 0; i < 2; i++) {
        const result = await apiRun(page, { filters: saved.filters, sources: saved.sources, needId: saved.needId, savedSearchId: saved.id, confirmedPaid: true });
        state.events.push({ type: "repeat-comparison", time: new Date().toISOString(), id: result.id, isNew: result.results.filter((r: { isNew: boolean }) => r.isNew).length, priceChanged: result.results.filter((r: { priceChanged: boolean }) => r.priceChanged).length }); await save();
      }
    } else if (mode === "fallback") {
      const filters = { city: "Новосибирск", operation: "sale", priceUnit: "rub_total", purposes: ["office"], floorMode: "any", districts: ["Железнодорожный"], seller: "all", requiredFeatures: [], preferredFeatures: [], sources: ["domclick", "avito"] };
      await apiRun(page, { filters, sources: filters.sources, needId: need.id, confirmedPaid: true });
      await shot(page, "20-auto-fallback-browser");
    } else if (mode === "manual-web") {
      if (!state.firstRunId) throw new Error("No first LIVE run");
      const data = await api(page, "POST", `/api/v1/property-search/runs/${state.firstRunId}/web-search`);
      state.events.push({ time: new Date().toISOString(), type: "manual-web", data }); await save();
      await shot(page, "21-manual-web-browser");
    } else if (mode === "empty") {
      const filters = { city: "Новосибирск", operation: "sale", priceUnit: "rub_total", purposes: ["office"], priceTo: "1", areaFrom: 100000, floorMode: "any", districts: [], seller: "all", requiredFeatures: [], preferredFeatures: [], sources: ["youla"] };
      const data = await apiRun(page, { filters, sources: filters.sources, needId: need.id, confirmedPaid: true });
      expect(data.results.filter((r: { verdict: string }) => r.verdict !== "rejected")).toHaveLength(0);
      expect(data.webSearchUsed).toBe(false);
      await page.getByRole("tab", { name: "Закладки", exact: true }).click(); await shot(page, "22-preserved-bookmarks");
    }
    console.log(`Finished ${mode}`);
  } finally {
    if (applied && original) {
      const current = await api<Settings>(manager, "GET", "/api/v1/settings/ai");
      // Do not overwrite a concurrent manager edit.
      if (current.setting.updatedAt !== applied.setting.updatedAt) throw new Error("Settings changed concurrently; manual reconciliation required; original saved in data");
      const restored = await api<Settings>(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(original.setting), expectedUpdatedAt: current.setting.updatedAt });
      expect(settingInput(restored.setting)).toEqual({ ...settingInput(original.setting), expectedUpdatedAt: restored.setting.updatedAt });
      state.events.push({ time: new Date().toISOString(), type: "settings-restored", budgetRub: restored.setting.monthlyBudgetRub }); await save();
      console.log("Original AI settings restored");
    }
    await browser.close(); await disconnectDb();
  }
}
async function parse(page: Page, query: string, before: string, after: string) {
  if (state.parses >= 10) throw new Error("Parse harness cap reached");
  await page.getByLabel("Опишите объект на русском", { exact: true }).fill(query); await shot(page, before);
  state.parses++; await save();
  const response = page.waitForResponse(r => r.url().endsWith("/property-search/parse") && r.request().method() === "POST", { timeout: 90000 });
  await page.getByRole("button", { name: "Разобрать с ИИ", exact: true }).click();
  const r = await response;
  const data = await r.json();
  state.events.push({ time: new Date().toISOString(), type: "parse", query, http: r.status(), result: data }); await save();
  console.log(`Parse HTTP ${r.status()}`); await shot(page, after);
  expect(r.ok()).toBeTruthy();
}
async function run(page: Page, before: string, after: string) {
  await readySearch(page);
  if (state.runs >= 10) throw new Error("Run cap reached");
  const counts = await db.aiUsageLog.groupBy({ by: ["callType"], where: { createdAt: { gte: new Date(state.startedAt) } }, _count: true });
  if (counts.filter(r => r.callType !== "web_search").reduce((s, r) => s + r._count, 0) > 22 || (counts.find(r => r.callType === "web_search")?._count ?? 0) >= 5) throw new Error("Live call cap reached");
  await page.getByRole("button", { name: "Искать", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Подтверждение платного поиска" })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "Подтверждаю запуск", exact: true })).toBeEnabled({ timeout: 60000 });
  await shot(page, before);
  state.runs++; await save();
  const response = page.waitForResponse(r => r.url().endsWith("/property-search/runs") && r.request().method() === "POST", { timeout: 150000 });
  await page.getByRole("button", { name: "Подтверждаю запуск", exact: true }).click();
  const r = await response; const data = await r.json();
  state.events.push({ time: new Date().toISOString(), type: "scraper run", http: r.status(), id: data.id,
    filters: data.filters, sources: data.sources, results: data.results?.map((v: { listingId: string; verdict: string; isNew: boolean; priceChanged: boolean; listing: { source: string; url: string; address: string; priceRub: string; areaM2: string } }) => ({ listingId: v.listingId, verdict: v.verdict, isNew: v.isNew, priceChanged: v.priceChanged, source: v.listing.source, url: v.listing.url, address: v.listing.address, price: v.listing.priceRub, area: v.listing.areaM2 })) }); await save();
  console.log(`Run HTTP ${r.status()} sources=${JSON.stringify(data.sources)} results=${data.results?.length}`);
  await expect(page.getByText("Поиск завершён", { exact: true })).toBeVisible();
  await shot(page, after); expect(r.ok()).toBeTruthy();
  return data;
}
async function apiRun(page: Page, body: unknown) {
  if (state.runs >= 10) throw new Error("Run cap reached");
  state.runs++; await save();
  const data = await api<Record<string, unknown> & { id: string; results: { isNew: boolean; priceChanged: boolean; verdict: string }[] }>(page, "POST", "/api/v1/property-search/runs", body);
  // Store only query, source status and public address/price/area/URL, never seller DTOs.
  state.events.push({ time: new Date().toISOString(), type: "scraper run", id: data.id, filters: data.filters, sources: data.sources }); await save();
  console.log(`Run ${data.id} sources=${JSON.stringify(data.sources)} results=${data.results.length}`);
  return data;
}
type SecondState = { startedAt: string; runs: number; web: number; other: number; runIds: string[]; events: unknown[] };
async function secondTrial(mode: string) {
  const path = "data/live-ai-second-state.json";
  let second: SecondState;
  try { second = JSON.parse(await readFile(path, "utf8")); }
  catch { second = { startedAt: new Date().toISOString(), runs: 0, web: 0, other: 0, runIds: [], events: [] }; }
  const persist = async () => writeFile(path, JSON.stringify(second, null, 2));
  await persist();
  const first = JSON.parse(await readFile(statePath, "utf8")) as State;
  if (mode === "second-report") { await secondReport(second); await disconnectDb(); return; }
  const browser = await chromium.launch();
  const manager = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await browser.newPage({ baseURL, viewport: { width: 1440, height: 1000 }, locale: "ru-RU" });
  const capture = async (name: string, runId?: string) => {
    if (runId) {
      await page.goto(`${baseURL}/property-search?runId=${runId}`, { waitUntil: "domcontentloaded" });
      await readySearch(page);
      await expect(page.getByRole("heading", { name: "Состояние источников", exact: true })).toBeVisible({ timeout: 60000 });
      await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
    }
    await page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
  };
  let original: Settings | undefined;
  let applied: Settings | undefined;
  try {
    for (const [target, role] of [[manager, "MANAGER"], [page, "REALTOR1"]] as const) {
      await api(target, "POST", "/api/v1/auth/login", { login: process.env[`SEED_${role}_LOGIN`] ?? role.toLowerCase(), password: process.env[`SEED_${role}_PASSWORD`] });
    }
    original = await api<Settings>(manager, "GET", "/api/v1/settings/ai");
    if (mode === "second-restore") {
      const savedOriginal = JSON.parse(await readFile("data/live-ai-second-settings-original.json", "utf8")) as Settings["setting"];
      await api(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(savedOriginal), expectedUpdatedAt: original.setting.updatedAt });
      second.events.push({ type: "settings-restored-after-dev-error", budgetRub: savedOriginal.monthlyBudgetRub }); await persist(); return;
    }
    await writeFile("data/live-ai-second-settings-original.json", JSON.stringify(original.setting));
    const baseline = await db.searchRunResult.count({ where: { runId: first.firstRunId } });
    if (mode === "second-timeout-shot") { await capture("33-timeout-recovery", second.runIds[0]); return; }
    if (mode === "second-preserved") {
      const restored = await api<{ id: string; results: unknown[] }>(page, "GET", `/api/v1/property-search/runs/${first.firstRunId}`);
      expect(restored.results.length).toBe(baseline);
      const recovered = await api<{ id: string; results: unknown[] }>(page, "GET", `/api/v1/property-search/runs/${second.runIds[1]}`);
      expect(recovered.results.length).toBeGreaterThan(0);
      await capture("36-preserved-after-restart", first.firstRunId);
      second.events.push({ type: "preserved-after-restart", at: new Date().toISOString(), runId: first.firstRunId, results: baseline, recoveredRunId: recovered.id, recoveredResults: recovered.results.length });
      await persist(); return;
    }
    applied = await api<Settings>(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(original.setting),
      aiEnabled: true, scraperEnabled: true, browserEnabled: mode === "second-recovery", enabledSources: ["cian", "mirkvartir", "onrealt", "domclick", "yandex", "youla", "avito"],
      webSearchManualAllowed: true, webSearchAutoFallback: mode === "second-fallback", monthlyBudgetRub: "250",
      model: "aliceai-llm-flash/latest", webModel: null, searchContextSize: "low", perJobLimit: 3,
      perUserDailyLimit: 100, dailyLimit: 200 });
    expect(Number(applied.effective.values.monthlyBudgetRub)).toBe(250);
    if (mode === "second-offer") {
      if (second.other >= 1) throw new Error("Second offer cap reached");
      const offerId = first.offerId!;
      await page.goto(`${baseURL}/offers/${offerId}`, { waitUntil: "domcontentloaded" });
      const button = page.getByRole("button", { name: "Сгенерировать введение", exact: true });
      await expect(button).toBeVisible({ timeout: 60000 });
      await expect.poll(() => button.evaluate(el => Object.keys(el).some(k => k.startsWith("__reactProps")))).toBe(true);
      second.other++; await persist();
      const pending = page.waitForResponse(r => r.url().endsWith("/api/v1/ai/offer-text") && r.request().method() === "POST", { timeout: 120000 });
      await button.click(); const response = await pending; const body = await response.json();
      second.events.push({ type: "offer_text", at: new Date().toISOString(), http: response.status(), result: body }); await persist();
      if (response.ok()) await expect(page.getByText(/LIVE.*Yandex AI/)).toBeVisible();
      await capture("35-offer-text-checked"); expect(response.ok()).toBe(true); return;
    }
    const saved = (await api<{ id: string; filters: Record<string, unknown>; sources: string[]; needId: string }[]>(page, "GET", "/api/v1/property-search/saved-searches")).find(r => r.id === first.savedSearchId)!;
    let filters = saved.filters;
    if (mode === "second-timeout") filters = { ...filters, sources: ["cian", "onrealt"] };
    if (mode === "second-fallback") filters = { ...filters, sources: ["domclick", "avito"] };
    if (mode === "second-empty") filters = { ...filters, sources: ["youla"], priceFrom: undefined, priceTo: "1", areaFrom: 100000, areaTo: undefined };
    if (!["second-timeout", "second-recovery", "second-fallback", "second-empty"].includes(mode)) throw new Error("Unknown second trial");
    if (second.runs >= 4) throw new Error("Second run cap reached");
    if (mode === "second-fallback") { if (second.web >= 2) throw new Error("Second web cap reached"); second.web++; }
    second.runs++; await persist();
    const at = Date.now();
    const result = await api<{ id: string; sources: unknown; webSearchUsed: boolean; results: { listingId: string; isNew: boolean; priceChanged: boolean; verdict: string }[] }>(page, "POST", "/api/v1/property-search/runs", {
      filters, sources: filters.sources, needId: saved.needId, ...(mode === "second-recovery" ? { savedSearchId: saved.id } : {}), confirmedPaid: true });
    second.runIds.push(result.id);
    second.events.push({ type: mode, at: new Date().toISOString(), id: result.id, durationMs: Date.now() - at,
      sources: result.sources, count: result.results.length, isNew: result.results.filter(r => r.isNew).length, priceChanged: result.results.filter(r => r.priceChanged).length, webSearchUsed: result.webSearchUsed });
    await persist();
    console.log(JSON.stringify({ mode, id: result.id, durationMs: Date.now() - at, count: result.results.length, sources: result.sources }));
    if (mode === "second-recovery") {
      await capture("32-cian-status", result.id);
      if (second.web >= 2) throw new Error("Second web cap reached");
      second.web++; await persist();
      await api(page, "POST", `/api/v1/property-search/runs/${result.id}/web-search`);
      second.events.push({ type: "manual-web", at: new Date().toISOString(), id: result.id }); await persist();
      await capture("31-web-cards", result.id);
    } else await capture(mode === "second-timeout" ? "33-timeout-recovery" : mode === "second-fallback" ? "34-auto-web-cards" : "37-empty-live", result.id);
    if (mode === "second-empty") { expect(result.results).toHaveLength(0); expect(result.webSearchUsed).toBe(false); }
  } finally {
    try {
      if (original && applied) {
        const current = await api<Settings>(manager, "GET", "/api/v1/settings/ai");
        if (current.setting.updatedAt !== applied.setting.updatedAt) throw new Error("Concurrent settings edit; reconcile data/live-ai-second-settings-original.json");
        const restored = await api<Settings>(manager, "PUT", "/api/v1/settings/ai", { ...settingInput(original.setting), expectedUpdatedAt: current.setting.updatedAt });
        second.events.push({ type: "settings-restored", at: new Date().toISOString(), budgetRub: restored.setting.monthlyBudgetRub }); await persist();
      }
    } finally { await browser.close(); await disconnectDb(); }
  }
}
async function secondReport(second: SecondState) {
  const path = "docs/vkr/live-ai-evidence.json";
  const evidence = JSON.parse(await readFile(path, "utf8"));
  const runs = await db.searchRun.findMany({ where: { id: { in: second.runIds } }, include: { sources: true,
    results: { include: { listing: { select: { source: true, url: true, address: true, priceRub: true, areaM2: true } } } } }, orderBy: { startedAt: "asc" } });
  const snapshots = await db.externalListingSnapshot.findMany({ where: { searchRunId: { in: second.runIds } }, orderBy: { fetchedAt: "desc" } });
  const offer = second.events.find(e => (e as { type?: string }).type === "offer_text") as { http: number; result: { text: string; usage: { inputTokens: number; outputTokens: number } } } | undefined;
  const rows = await db.aiUsageLog.findMany({ where: { OR: [
    { searchRunId: { in: second.runIds } },
    ...(offer ? [{ callType: "offer_text", createdAt: { gte: new Date(second.startedAt) }, inputTokens: offer.result.usage.inputTokens, outputTokens: offer.result.usage.outputTokens }] : []),
  ] }, orderBy: { createdAt: "asc" } });
  if (rows.filter(r => r.callType === "offer_text").length !== 1 || rows.filter(r => r.callType === "web_search").length !== 2) throw new Error("Unexpected second-pass ledger; reconcile before export");
  const usage = rows.map(r => { const d = decodeReservation(r.result); return { id: r.id, time: r.createdAt, jobId: r.searchRunId,
    type: r.callType, model: r.model, input: r.inputTokens, output: r.outputTokens, webSearchCalls: r.webSearchCalls,
    estimatedRub: d ? microsToRub(d.estimatedMicros) : r.estimatedCostRub.toString(), actualCrmRub: d?.actualMicros === undefined ? null : microsToRub(d.actualMicros),
    chargedRub: d ? microsToRub(d.chargedMicros) : null, status: r.status }; });
  const records = runs.map(r => ({ id: r.id, time: r.startedAt, filters: r.filters, status: r.status, webSearchUsed: r.webSearchUsed,
    sources: r.sources.map(s => ({ source: s.source, status: s.status, count: s.resultCount, reason: s.reason })),
    results: r.results.map(v => {
      const snap = snapshots.find(s => s.searchRunId === r.id && s.listingId === v.listingId)?.normalized as Record<string, unknown> | undefined;
      return { verdict: v.verdict, isNew: v.isNew, priceChanged: v.priceChanged, source: v.listing.source, address: snap?.address ?? v.listing.address,
        priceRub: snap?.price ?? null, areaM2: snap?.area ?? null, url: snap?.url ?? v.listing.url };
    }) }));
  const unique = <T extends { id: string }>(values: T[]): T[] => [...new Map(values.map(v => [v.id, v])).values()];
  evidence.usage = unique([...evidence.usage, ...usage]); evidence.runs = unique([...evidence.runs, ...records]);
  const screenshotNames = ["31-web-cards", "32-cian-status", "33-timeout-recovery", "34-auto-web-cards", "36-preserved-after-restart", "37-empty-live"];
  const screenshots = await Promise.all(screenshotNames.map(async name => ({ file: `${output}/${name}.png`, mode: "LIVE", sha256: createHash("sha256").update(await readFile(`${output}/${name}.png`)).digest("hex") })));
  const current = await db.aiSetting.findFirstOrThrow({ select: { monthlyBudgetRub: true } });
  evidence.secondPass = { mode: "LIVE", startedAt: second.startedAt, exportedAt: new Date().toISOString(), runs: second.runIds,
    usageIds: usage.map(u => u.id), counters: { runs: second.runs, web: second.web, other: second.other },
    events: second.events.filter(e => (e as { type?: string }).type !== "offer_text"),
    offerText: { http: offer?.http, text: offer?.result.text, postCheckPassed: offer?.http === 200 && rows.some(r => r.callType === "offer_text" && r.status === "success"), previewScreenshotAvailable: false },
    cianHttpDiagnostic: JSON.parse(await readFile("data/live-ai-cian-http.json", "utf8")),
    cianBrowserStatusNote: "The recorded run used an intermediate adapter that mapped a small CAPTCHA page to HTTP 403. This is a policy classification, not proof of the original browser HTTP status. Final parser guard emits ACCESS_BLOCKED/CIAN_ACCESS_CHALLENGE without synthesizing an HTTP status; covered by unit regression, no further live run.", screenshots,
    finalBudgetRub: current.monthlyBudgetRub.toString(), webCardsFound: records.flatMap(r => r.results).filter(r => r.source === "web_search").length };
  const sum = evidence.usage.reduce((a: { input: number; output: number; web: number; other: number; toolCalls: number; rub: number }, u: { input: number; output: number; type: string; webSearchCalls: number; chargedRub: string }) => ({
    input: a.input + u.input, output: a.output + u.output, web: a.web + Number(u.type === "web_search"), other: a.other + Number(u.type !== "web_search"), toolCalls: a.toolCalls + u.webSearchCalls, rub: a.rub + Number(u.chargedRub ?? 0),
  }), { input: 0, output: 0, web: 0, other: 0, toolCalls: 0, rub: 0 });
  evidence.totals = { ...sum, rub: sum.rub.toFixed(6), runs: evidence.runs.length, calls: evidence.usage.length, cloudBillingAvailable: false };
  evidence.exportedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ totals: evidence.totals, secondUsage: usage, finalBudgetRub: current.monthlyBudgetRub.toString() }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Live trials failed"); process.exitCode = 1; });
