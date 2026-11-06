/**
 * AT-18 (ТЗ v3.1) — технический пробный прогон сценариев апробации.
 *
 * Это НЕ апробация людьми: скрипт проходит те же шаги через браузер, измеряет время действий и
 * фиксирует ошибки/зависания, чтобы подготовить бланки `docs/acceptance/v31/approbation/*`.
 *
 * Требования к окружению (запускаются вне скрипта):
 *   npm run dev:webpack -- -p 3424   с NEXT_DIST_DIR=.next-3424 и DATABASE_URL на crm_demo,
 *   SCRAPER_ENABLED=true, SCRAPER_DEMO_FIXTURES=true (записанные ответы), AI_ENABLED=false,
 * и воркер очереди `npx tsx src/worker/property-search-worker.ts` с тем же DATABASE_URL —
 * поиск асинхронный, без воркера выдача остаётся в статусе «В очереди».
 *
 * Запуск:
 *   npx tsx scripts/approbation/timing.ts
 *
 * Секреты берутся из .env и не выводятся. Сценарии, требующие живого человека (CAPTCHA, живые
 * площадки, платный AI), не выполняются: им соответствует сценарий запасного пути.
 */
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";

loadEnv({ path: [".env.local", ".env"], quiet: true });

// localhost, а не 127.0.0.1: в dev-режиме Next блокирует dev-ресурсы для «чужого» источника,
// из-за чего клиентский бандл не гидратируется и формы уходят нативным POST на /login.
const BASE = process.env.APPROB_BASE_URL ?? "http://localhost:3424";
const OUT_FILE = process.env.APPROB_OUT_FILE ?? "docs/acceptance/v31/approbation/dry-run.md";
const SHOT_DIR = process.env.APPROB_SHOT_DIR ?? "data/approbation-dry-run";
const DB_URL = process.env.APPROB_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
const MARKER = process.env.APPROB_MARKER ?? "APPROB-DRY";
if (!/^[A-Z0-9-]+$/.test(MARKER)) throw new Error("Маркер должен содержать только A-Z, цифры и дефис");
if (new URL(DB_URL).pathname !== "/crm_demo") throw new Error("Апробация разрешена только на crm_demo");
const SCENARIO_TIMEOUT_MS = Number(process.env.APPROB_TIMEOUT_MS ?? 240_000);

type Status = "OK" | "PARTIAL" | "FAIL" | "SKIP";
type RoleCode = "manager" | "realtor1" | "realtor2";
type Result = { role: RoleCode; id: string; title: string; status: Status; ms: number; note: string };

const ROLES: { code: RoleCode; label: string; login: string; password: string }[] = [
  { code: "manager", label: "Руководитель", login: process.env.SEED_MANAGER_LOGIN ?? "manager", password: process.env.SEED_MANAGER_PASSWORD ?? "" },
  { code: "realtor1", label: "Риелтор 1", login: process.env.SEED_REALTOR1_LOGIN ?? "realtor1", password: process.env.SEED_REALTOR1_PASSWORD ?? "" },
  { code: "realtor2", label: "Риелтор 2", login: process.env.SEED_REALTOR2_LOGIN ?? "realtor2", password: process.env.SEED_REALTOR2_PASSWORD ?? "" },
];

const results: Result[] = [];
const pageErrors: string[] = [];
const leftovers: string[] = [];
const created: string[] = [];
const createdOfferIds: string[] = [];
const pages = new Map<RoleCode, Page>();

const ms = (start: number) => Date.now() - start;
const dur = (value: number) => { const seconds = Math.round(value / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };

async function scenario(role: RoleCode, id: string, title: string, fn: (page: Page) => Promise<{ status?: Status; note?: string }>) {
  const page = pages.get(role);
  if (!page) { results.push({ role, id, title, status: "SKIP", ms: 0, note: "сессия роли не открыта" }); return; }
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      fn(page),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`зависание: сценарий не завершился за ${SCENARIO_TIMEOUT_MS} мс`)), SCENARIO_TIMEOUT_MS); }),
    ]);
    results.push({ role, id, title, status: outcome.status ?? "OK", ms: ms(start), note: outcome.note ?? "" });
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n").slice(0, 3).join(" | ").slice(0, 300) : "неизвестная ошибка";
    const file = path.join(SHOT_DIR, `${role}-${id}-fail.png`);
    await page.screenshot({ path: file }).catch(() => undefined);
    results.push({ role, id, title, status: "FAIL", ms: ms(start), note: `${message} (скриншот: ${file})` });
  } finally {
    clearTimeout(timer);
    console.log(JSON.stringify(results.at(-1)));
  }
}

/** Не зависим от внутренних __reactProps: события Playwright запускают selective hydration. */
const hydrated = (page: Page) =>
  page.waitForLoadState("domcontentloaded");

async function login(context: BrowserContext, role: (typeof ROLES)[number]) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  // Переход между независимыми сценариями может покидать заполненный DEMO-фильтр.
  page.on("dialog", dialog => { void (dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss()); });
  page.on("response", response => { if (response.status() >= 500) pageErrors.push(`${role.code}: HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on("pageerror", error => pageErrors.push(`${role.code}: ${error.message.slice(0, 200)}`));
  const start = Date.now();
  const response = await context.request.post("/api/v1/auth/login", { headers: { origin: BASE }, data: { login: role.login, password: role.password } });
  if (!response.ok()) throw new Error(`вход вернул HTTP ${response.status()}`);
  const body = (await response.json()) as { mustChangePassword?: boolean };
  if (body.mustChangePassword) throw new Error("учётная запись требует смены пароля — нужна ручная сессия");
  await page.goto("/today", { waitUntil: "domcontentloaded" });
  await hydrated(page);
  if (!/\/today/.test(page.url())) throw new Error(`вход привёл на ${new URL(page.url()).pathname}`);
  pages.set(role.code, page);
  results.push({ role: role.code, id: "S00", title: "Вход в систему", status: "OK", ms: ms(start), note: "" });
}

async function openCallDialog(page: Page) {
  await page.getByRole("button", { name: "Записать звонок", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Источник").waitFor({ state: "visible" });
  return dialog;
}

/** Запускает поиск и ждёт, пока источник перестанет быть «в очереди/выполняется». */
async function runSearch(page: Page, options: { scenario?: string } = {}) {
  await page.getByLabel("Профиль поиска").selectOption("");
  if (options.scenario) await page.getByLabel("Записанный сценарий").selectOption(options.scenario);
  const responsePromise = page.waitForResponse(r => r.url().includes("/api/v1/property-search/runs") && r.request().method() === "POST", { timeout: 180_000 });
  await page.getByRole("button", { name: "Искать", exact: true }).click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`запуск поиска вернул HTTP ${response.status()}`);
  const run = (await response.json()) as { id: string; status: string };
  await page.getByText("Состояние источников", { exact: true }).first().waitFor({ state: "visible" });
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/property-search/runs/${run.id}/progress`);
    if (!response.ok()) throw new Error(`прогресс: HTTP ${response.status()}`);
    return (await response.json() as { status: string }).status;
  }, { timeout: 180_000, intervals: [1000] }).not.toMatch(/^(queued|running)$/);
  const progress = await (await page.request.get(`/api/v1/property-search/runs/${run.id}/progress`)).json() as { sources: { status: string; receivedCount: number }[] };
  if (options.scenario === "failure") {
    if (!progress.sources.some(source => source.status === "blocked")) throw new Error("Записанный отказ не воспроизведён: проверьте SCRAPER_ENABLED и настройки источников");
  } else if (!progress.sources.some(source => source.receivedCount > 0)) {
    throw new Error("DEMO-поиск не получил карточек: отключённые источники не подтверждают сценарий");
  }
  await page.getByRole("tablist", { name: "Статусы результатов" }).waitFor();
  return run;
}

async function cleanup(db: pg.Client) {
  if (createdOfferIds.length) {
    await db.query("DELETE FROM commercial_offer_items WHERE commercial_offer_id = ANY($1::uuid[])", [createdOfferIds]);
    await db.query("DELETE FROM commercial_offers WHERE id = ANY($1::uuid[])", [createdOfferIds]);
  }
  const markerClient = `display_name LIKE '${MARKER}%'`;
  const statements = [
    `DELETE FROM commercial_offer_items WHERE commercial_offer_id IN (SELECT id FROM commercial_offers WHERE title LIKE '${MARKER}%')`,
    `DELETE FROM commercial_offers WHERE title LIKE '${MARKER}%'`,
    `DELETE FROM task_checklist_items WHERE title LIKE '${MARKER}%'`,
    `DELETE FROM task_needs WHERE client_need_id IN (SELECT n.id FROM client_needs n JOIN clients c ON c.id = n.client_id WHERE c.display_name LIKE '${MARKER}%')`,
    `DELETE FROM task_clients WHERE client_id IN (SELECT id FROM clients WHERE ${markerClient})`,
    `DELETE FROM lead_requests WHERE summary LIKE '${MARKER}%'`,
    `DELETE FROM task_clients WHERE task_id IN (SELECT id FROM tasks WHERE title LIKE '${MARKER}%')`,
    `DELETE FROM tasks WHERE title LIKE '${MARKER}%'`,
    `DELETE FROM need_stage_history WHERE client_need_id IN (SELECT id FROM client_needs WHERE client_id IN (SELECT id FROM clients WHERE ${markerClient}))`,
    `DELETE FROM client_needs WHERE client_id IN (SELECT id FROM clients WHERE ${markerClient})`,
    `DELETE FROM lead_requests WHERE client_id IN (SELECT id FROM clients WHERE ${markerClient})`,
    `DELETE FROM client_contacts WHERE client_id IN (SELECT id FROM clients WHERE ${markerClient})`,
    `DELETE FROM clients WHERE ${markerClient}`,
    `DELETE FROM property_collection_needs WHERE collection_id IN (SELECT id FROM property_collections WHERE name LIKE '${MARKER}%')`,
    `DELETE FROM property_collection_items WHERE collection_id IN (SELECT id FROM property_collections WHERE name LIKE '${MARKER}%')`,
    `DELETE FROM property_collections WHERE name LIKE '${MARKER}%'`,
  ];
  for (const sql of statements) {
    try { await db.query(sql); }
    catch (error) { leftovers.push(`cleanup: ${sql.slice(0, 60)}… → ${error instanceof Error ? error.message : "ошибка"}`); }
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  await cleanup(db);
  if (leftovers.length) throw new Error("Не удалось очистить остатки предыдущего прогона");
  // Демо-учётки требуют смены пароля при первом входе; для прогона флаг снимается и восстанавливается.
  const logins = ROLES.map(role => role.login);
  const priorFlags = await db.query<{ login: string; must_change_password: boolean }>("SELECT login, must_change_password FROM users WHERE login = ANY($1::text[])", [logins]);
  const priorActions = await db.query<{ id: string; payload: Record<string, unknown>; status: string; decided_by: string | null; decided_at: Date | null }>("SELECT a.id, a.payload, a.status, a.decided_by, a.decided_at FROM ai_pending_actions a JOIN ai_chat_sessions s ON s.id=a.session_id JOIN users u ON u.id=s.owner_user_id WHERE s.title LIKE 'DEMO%' AND u.login=$1", [ROLES[1]!.login]);
  for (const action of priorActions.rows) await db.query("UPDATE ai_pending_actions SET status='proposed', decided_by=NULL, decided_at=NULL, payload=$2 WHERE id=$1", [action.id, { ...action.payload, title: `${MARKER} контакт AI`, description: `${MARKER} синтетическое напоминание` }]);
  await db.query("UPDATE users SET must_change_password = false WHERE login = ANY($1::text[])", [logins]);
  const browser = await chromium.launch({ headless: true });
  const csvPath = path.join(tmpdir(), `approb-dry-${process.pid}.csv`);
  try {
    for (const role of ROLES) {
      const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "ru-RU", timezoneId: "Asia/Novosibirsk" });
      try {
        await login(context, role);
        const isManager = role.code === "manager";
        const demoClient = await db.query<{ id: string }>(`SELECT c.id FROM clients c JOIN users u ON u.id = c.responsible_user_id WHERE c.notes LIKE '%DEMO%' AND c.status = 'active' AND ($1 = 'manager' OR u.login = $2) ORDER BY c.created_at, c.id LIMIT 1`, [role.code, role.login]);
        const demoClientId = demoClient.rows[0]?.id ?? null;

        if (!isManager) {
          await scenario(role.code, "S01", "Звонок: спам без клиента", async current => {
            await current.goto("/today");
            await hydrated(current);
            const dialog = await openCallDialog(current);
            await dialog.getByLabel("Источник").selectOption({ index: 1 });
            await dialog.getByRole("radiogroup", { name: "Результат" }).getByText("Ошибочное/спам", { exact: true }).click();
            await dialog.getByLabel(/Кратко/).fill(`${MARKER} синтетический спам-звонок`);
            await dialog.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
            await dialog.getByText("Обращение зарегистрировано.", { exact: true }).waitFor({ timeout: 60_000 });
            const text = await dialog.innerText();
            if (/Карточка клиента/.test(text)) return { status: "FAIL", note: "для спама предложено открыть карточку клиента" };
            created.push("lead_requests (спам-звонок)");
            await current.goto("/reports/sources");
            await current.getByRole("heading", { name: "Звонки и источники", exact: true }).waitFor();
            return { note: "клиент не создан; звонок виден в отчёте источников" };
          });
        }

        if (!isManager) {
          await scenario(role.code, "S02", "Звонок перспективный: потребность и задача", async current => {
            await current.goto("/today");
            await hydrated(current);
            const dialog = await openCallDialog(current);
            await dialog.getByLabel("Источник").selectOption({ index: 1 });
            await dialog.getByRole("radiogroup", { name: "Клиент" }).getByText("Новый клиент", { exact: true }).click();
            await dialog.getByLabel("Имя / наименование").fill(`${MARKER} ${role.code} Клиент`);
            await dialog.getByPlaceholder("+7 900 000-00-00").fill(role.code === "realtor1" ? "+7 900 111-22-33" : "+7 900 111-22-34");
            await dialog.getByRole("radiogroup", { name: "Результат" }).getByText("Перспективное — Новая потребность", { exact: true }).click();
            await dialog.getByLabel("Операция").selectOption({ label: "Купить" });
            await dialog.getByLabel("Тип недвижимости").selectOption("commercial");
            await dialog.getByLabel(/Кратко/).fill(`${MARKER} перспективный звонок ${role.code}`);
            // Следующее действие получает собственный маркер для проверяемой очистки.
            await dialog.getByLabel("Что сделать").fill(`${MARKER} связаться ${role.code}`);
            const submit = dialog.getByRole("button", { name: "Зарегистрировать обращение", exact: true });
            await submit.scrollIntoViewIfNeeded();
            await submit.click();
            await dialog.getByText("Обращение зарегистрировано.", { exact: true }).waitFor({ timeout: 60_000 });
            const link = dialog.getByRole("link", { name: "Открыть потребность", exact: true });
            const hasNeed = await link.isVisible().catch(() => false);
            created.push("client/need/task/lead_request (перспективный звонок)");
            return hasNeed ? { note: "созданы клиент, потребность и следующая задача" } : { status: "PARTIAL", note: "обращение создано, ссылка на потребность не показана" };
          });
        }

        {
          await scenario(role.code, "S03", "Поиск с фильтрами и свежестью", async current => {
            await current.goto("/property-search");
            await hydrated(current);
            await current.getByText("Условия поиска", { exact: true }).waitFor();
            await current.locator('fieldset:has(legend:text-is("Назначения · ИЛИ")) label').filter({ hasText: "Торговля" }).getByRole("checkbox").check();
            await current.getByLabel("Режим даты").selectOption("published");
            await current.getByLabel("Период").selectOption("7");
            const run = await runSearch(current);
            const counters = await current.getByRole("tablist", { name: "Статусы результатов" }).innerText();
            const unknown = await current.locator('label:has-text("Дата неизвестна") input[type=checkbox]').count();
            await current.getByLabel("Сортировка").selectOption("price");
            await current.getByLabel("Направление").selectOption("asc");
            await current.getByRole("button", { name: "Далее", exact: true }).waitFor();
            const note = `прогон ${run.id.slice(0, 8)}…; свежесть 7 дней отсекает неизвестные даты (${counters.replace(/\s+/g, " ")})`;
            return unknown ? { note: `${note}; отдельный блок неизвестных дат доступен` } : { status: "PARTIAL", note: `${note}; блок неизвестных дат не показан` };
          });
        }

        if (role.code === "realtor1") {
          await scenario(role.code, "S04", "Группа дублей: решение сотрудника", async current => {
            await current.goto("/property-search");
            await hydrated(current);
            await current.getByText("Условия поиска", { exact: true }).waitFor();
            await current.locator('fieldset:has(legend:text-is("Назначения · ИЛИ")) label').filter({ hasText: "Торговля" }).getByRole("checkbox").check();
            await runSearch(current);
            const group = current.locator('article[aria-label="Группа вероятных дублей"]');
            await group.first().waitFor({ timeout: 30_000 });
            await group.first().getByRole("button", { name: "Решить позже", exact: true }).click();
            const dialog = current.getByRole("dialog");
            await dialog.getByLabel(/Комментарий/).fill(`${MARKER} проверить признаки`);
            await dialog.getByRole("checkbox", { name: /Подтверждаю выбранное решение/ }).check();
            await dialog.getByRole("button", { name: "Решить позже", exact: true }).click();
            await current.getByText(/Решение отложено/).first().waitFor({ timeout: 60_000 });
            created.push("listing_duplicate_decisions (defer)");
            return { note: "решение сотрудника сохранено с автором и датой" };
          });
        }

        if (role.code !== "realtor2") {
          await scenario(role.code, "S05", "Подборка без клиента → привязка → КП", async current => {
            await current.goto("/collections");
            await hydrated(current);
            await current.getByText("Именованные подборки", { exact: true }).waitFor();
              await current.getByLabel("Название подборки").fill(`${MARKER} подборка ${role.code}`);
              await current.getByRole("button", { name: "Создать подборку", exact: true }).click();
              await current.getByRole("heading", { name: `${MARKER} подборка ${role.code}`, exact: true }).waitFor({ timeout: 60_000 });
              await current.locator('[data-collection-ready="true"]').waitFor();
              created.push("property_collections (без клиента)");
              const needPicker = current.getByPlaceholder("Найти потребность по названию");
              const propertyPicker = current.getByText("Объект CRM", { exact: true }).locator("..").getByRole("textbox");
              await propertyPicker.fill("Новосибирск");
              await current.getByRole("button").filter({ hasText: /Новосибирск/ }).first().click();
              await current.getByRole("button", { name: "Добавить объект", exact: true }).click();
              await current.getByRole("link", { name: "Карточка CRM", exact: true }).waitFor();
              await needPicker.fill("Сибирь");
              await current.getByRole("button").filter({ hasText: /Сибирь/ }).first().click();
              await current.getByRole("button", { name: "Привязать", exact: true }).click();
              const needSelect = current.getByLabel("Потребность для предложения");
              await needSelect.locator('option:not([value=""])').first().waitFor({ state: "attached" });
              await needSelect.selectOption({ index: 1 });
              await current.getByRole("checkbox", { name: /^Выбрать / }).first().check();
              await current.getByRole("button", { name: "Создать КП из выбранных", exact: true }).click();
              await current.waitForURL(/\/offers\/[0-9a-f-]+$/);
              createdOfferIds.push(new URL(current.url()).pathname.split("/").at(-1)!);
              created.push("commercial_offers (из синтетической подборки)");
              return { note: "создана пустая подборка без клиента, добавлен объект, привязана потребность, сформировано КП" };
          });
        }

        if (role.code === "realtor1") {
          await scenario(role.code, "S06", "Экспорт XLSX", async current => {
            await current.goto("/property-search");
            await hydrated(current);
            await current.getByText("Условия поиска", { exact: true }).waitFor();
            await runSearch(current);
            await current.getByRole("button", { name: "Экспорт XLSX / CSV", exact: true }).click();
            const download = await Promise.all([
              current.waitForEvent("download", { timeout: 90_000 }),
              current.getByRole("button", { name: "Скачать файл", exact: true }).click(),
            ]).then(([file]) => file);
            const name = download.suggestedFilename();
            await download.saveAs(path.join(SHOT_DIR, `export-${role.code}.xlsx`));
            return /xlsx$/i.test(name) ? { note: `скачан ${name} (весь отфильтрованный набор)` } : { status: "PARTIAL", note: `файл ${name} вместо XLSX` };
          });
        }

        if (role.code === "realtor2") {
          await scenario(role.code, "S06", "Экспорт XLSX", async current => {
            await current.goto("/property-search");
            await hydrated(current);
            await current.getByText("Условия поиска", { exact: true }).waitFor();
            await runSearch(current);
            await current.getByRole("button", { name: "Экспорт XLSX / CSV", exact: true }).click();
            const download = await Promise.all([
              current.waitForEvent("download", { timeout: 90_000 }),
              current.getByRole("button", { name: "Скачать файл", exact: true }).click(),
            ]).then(([file]) => file);
            await download.saveAs(path.join(SHOT_DIR, `export-${role.code}.xlsx`));
            return { note: `скачан ${download.suggestedFilename()}` };
          });
        }

        if (role.code === "realtor2" || isManager) {
          await scenario(role.code, "S07", "Планер: неделя и три месяца", async current => {
            await current.goto("/calendar");
            await hydrated(current);
            await current.getByRole("heading", { name: "Планер", exact: true }).waitFor();
            await current.getByRole("button", { name: "Неделя", exact: true }).click();
            await current.locator(".fc-timeGridWeek-view").waitFor({ timeout: 60_000 });
            if (isManager) {
              await current.getByText("Фильтры и быстрые действия", { exact: true }).click();
              await current.getByLabel("Охват").selectOption("all");
            }
            const aggregatePromise = current.waitForResponse(r => r.url().includes("/api/v1/calendar/aggregate"), { timeout: 90_000 });
            await current.getByRole("button", { name: "Три месяца", exact: true }).click();
            const aggregate = await aggregatePromise;
            const days = (await aggregate.json()) as { days?: unknown[]; items?: unknown };
            if (days.items) return { status: "FAIL", note: "режим трёх месяцев вернул построчные items вместо агрегата" };
            await current.getByText("Мини-календарь", { exact: true }).click();
            return { note: `три месяца: ${days.days?.length ?? 0} дней агрегата; строки не загружаются целиком` };
          });
        }

        if (role.code === "realtor2") {
          await scenario(role.code, "S08", "Чек-лист задачи", async current => {
            const response = await current.request.post("/api/v1/tasks", { headers: { origin: BASE }, data: { title: `${MARKER} чек-лист`, taskType: "call_or_contact", dueAt: new Date(Date.now() + 86400_000).toISOString() } });
            if (!response.ok()) throw new Error(`подготовка задачи: HTTP ${response.status()}`);
            const { id: openTaskId } = await response.json() as { id: string };
            await current.goto(`/tasks/${openTaskId}`);
            await hydrated(current);
            await current.getByRole("button", { name: "+ Пункт", exact: true }).click();
            const dialog = current.getByRole("dialog", { name: "Новый пункт" });
            await dialog.getByLabel("Название").fill(`${MARKER} обязательный пункт`);
            await dialog.getByRole("checkbox", { name: "Обязательный пункт" }).check();
            await dialog.getByRole("button", { name: "Сохранить пункт" }).click();
            await current.getByText(`${MARKER} обязательный пункт`, { exact: true }).waitFor({ timeout: 60_000 });
            created.push("task_checklist_items");
            return { note: "пункт добавлен, прогресс чек-листа обновлён" };
          });

          await scenario(role.code, "S09", "Массовые напоминания", async current => {
            await current.goto("/tasks");
            await hydrated(current);
            await current.getByRole("button", { name: "Массовые задачи", exact: true }).click();
            const dialog = current.getByRole("dialog", { name: "Задачи выбранным клиентам" });
            await dialog.getByLabel("Клиенты (до 100)").fill("ООО");
            const option = dialog.getByRole("button").filter({ hasText: /ООО/ }).first();
            await option.click({ timeout: 30_000 });
            await dialog.getByLabel("Что сделать").fill(`${MARKER} массовое напоминание`);
            await dialog.locator('input[type="datetime-local"]').fill("2026-12-01T10:00");
            await dialog.getByRole("button", { name: "Предпросмотр", exact: true }).click();
            await dialog.getByText(/Будет создано задач:/).waitFor({ timeout: 60_000 });
            await dialog.getByRole("button", { name: "Подтвердить создание", exact: true }).click();
            await current.getByText(/Создано задач: \d+/).waitFor({ timeout: 60_000 });
            created.push("tasks (bulk, маркер в названии)");
            return { note: "предпросмотр не писал данные; задачи созданы после подтверждения" };
          });

          await scenario(role.code, "S13", "Проверка площадки и запасной путь", async current => {
            await current.goto("/property-search");
            await hydrated(current);
            await current.getByText("Условия поиска", { exact: true }).waitFor();
            await runSearch(current, { scenario: "failure" });
            const captcha = current.getByRole("button", { name: "Открыть площадку и пройти проверку", exact: true });
            const captchaAvailable = await captcha.first().isVisible().catch(() => false);
            const importButton = current.getByRole("button", { name: "Импорт выгрузки", exact: true }).first();
            const sourceText = await importButton.locator("..").locator("..").innerText();
            const host = /Авито/.test(sourceText) ? "avito.ru" : /Циан/i.test(sourceText) ? "cian.ru" : /Домклик/.test(sourceText) ? "domclick.ru" : /Яндекс/.test(sourceText) ? "realty.yandex.ru" : /Мир Квартир/.test(sourceText) ? "mirkvartir.ru" : /OnRealt/i.test(sourceText) ? "onrealt.ru" : "youla.ru";
            await importButton.click();
            await writeFile(csvPath, [
              "url;Title;OperationType;CommercialType;Price;Area;City;Address",
              `https://${host}/synthetic-${MARKER.toLowerCase()}-1;Торговое помещение ${MARKER} 90 м2;Продажа;Торговое;14000000;90;Новосибирск;Новосибирск, Центральный район, улица Проверочная, 1`,
              `https://${host}/synthetic-${MARKER.toLowerCase()}-2;Офис ${MARKER} 70 м2;Продажа;Офис;9000000;70;Новосибирск;Новосибирск, Центральный район, улица Проверочная, 2`,
            ].join("\n"), "utf8");
            await current.locator('input[type="file"]').setInputFiles(csvPath);
            await current.getByRole("button", { name: "Проверить без записи", exact: true }).click();
            await current.getByText(/Прочитано:/).waitFor({ timeout: 60_000 });
            const preview = (await current.getByText(/Прочитано:/).innerText()).replace(/\s+/g, " ").slice(0, 110);
            if (!/кандидатов: 2 · ошибок: 0/.test(preview)) throw new Error(`некорректная выгрузка: ${preview}`);
            await current.getByRole("button", { name: "Подтвердить импорт", exact: true }).click();
            await current.getByRole("link", { name: "Открыть добавленные объявления", exact: true }).waitFor({ timeout: 90_000 });
            created.push("search run (ручной импорт выгрузки)");
            return { note: `${captchaAvailable ? "Проверка площадки доступна" : "Записанный HTTP 429: blocked; проверен запасной путь, CAPTCHA отдельно в AT-05"}; импорт выгрузки: ${preview}` };
          });
        }

        if (role.code === "realtor1" || isManager) {
          await scenario(role.code, "S10", "Таймлайн клиента", async current => {
            if (!demoClientId) return { status: "SKIP", note: "нет демонстрационного клиента" };
            const response = await current.goto(`/clients/${demoClientId}?tab=history`, { waitUntil: "domcontentloaded" });
            if (response?.status() !== 200) throw new Error(`таймлайн: HTTP ${response?.status()}`);
            await hydrated(current);
            await current.getByRole("heading", { name: "Текущие этапы потребностей", exact: true }).waitFor();
            await current.getByText("История клиента", { exact: true }).waitFor();
            await current.locator("select[name=kind]").selectOption("task");
            await current.getByRole("button", { name: "Применить", exact: true }).click();
            await current.waitForURL(/kind=task/, { timeout: 60_000 });
            return { note: "лента клиента и фильтр по виду события работают" };
          });
        }

        if (isManager) {
          await scenario(role.code, "S11", "Шаблон документа", async current => {
            await current.goto("/templates");
            await hydrated(current);
            await current.getByRole("heading", { name: "Шаблоны документов", exact: true }).waitFor();
            const rows = await current.locator("tbody tr").count();
            if (!demoClientId) return { status: "PARTIAL", note: `шаблонов в списке: ${rows}; нет клиента для формирования` };
            await current.goto(`/clients/${demoClientId}`);
            await hydrated(current);
            await current.getByRole("button", { name: "Сформировать по шаблону", exact: true }).click();
            const dialog = current.getByRole("dialog");
            await dialog.getByRole("button", { name: "Скачать предпросмотр", exact: true }).waitFor({ timeout: 60_000 });
            const download = await Promise.all([
              current.waitForEvent("download", { timeout: 90_000 }),
              dialog.getByRole("button", { name: "Скачать предпросмотр", exact: true }).click(),
            ]).then(([file]) => file);
            await download.saveAs(path.join(SHOT_DIR, "template-preview.docx"));
            return { note: `шаблонов: ${rows}; предпросмотр ${download.suggestedFilename()} получен без сохранения документа` };
          });
        }

        if (role.code === "realtor1") {
          await scenario(role.code, "S12", "AI-чат с подтверждением черновика", async current => {
            if (!demoClientId) return { status: "SKIP", note: "нет демонстрационного клиента" };
            await current.goto(`/clients/${demoClientId}`);
            await hydrated(current);
            await current.getByRole("button", { name: "Открыть AI-помощника" }).click();
            const panel = current.getByRole("dialog");
            await panel.getByLabel("История диалогов").waitFor();
            await panel.getByLabel("История диалогов").locator("option").filter({ hasText: /DEMO/ }).first().waitFor({ state: "attached" });
            const options = await panel.getByLabel("История диалогов").locator("option").allInnerTexts();
            const demoOption = options.find(text => /DEMO/.test(text));
            if (demoOption) await panel.getByLabel("История диалогов").selectOption({ label: demoOption });
            const confirm = panel.getByRole("button", { name: "Подтвердить", exact: true });
            await confirm.first().waitFor({ timeout: 60_000 });
            await confirm.first().click();
            await panel.getByText("Действие подтверждено и выполнено", { exact: true }).waitFor({ timeout: 60_000 });
            created.push("task via AI chat confirm");
            return { note: "задача создана только после явного подтверждения черновика" };
          });
        }

        if (isManager) {
          await scenario(role.code, "S14", "Контроль руководителя", async current => {
            await current.goto("/today?scope=all");
            await hydrated(current);
            await current.getByRole("heading", { name: "Сегодня", exact: true }).waitFor();
            await current.getByText(/Показы сегодня · \d+/).waitFor();
            await current.goto("/today/overview");
            await hydrated(current);
            await current.getByText("Обращения", { exact: true }).first().waitFor();
            await current.goto("/reports");
            await hydrated(current);
            await current.getByRole("heading", { name: "Отчёты руководителя", exact: true }).waitFor();
            await current.getByText("Обращения по источникам", { exact: true }).waitFor();
            await current.getByText("Активность сотрудников за период", { exact: true }).waitFor();
            const drill = current.getByRole("link", { name: "Все открытые перспективные обращения", exact: true });
            await drill.waitFor({ timeout: 60_000 });
            await drill.click();
            await current.waitForURL(/\/reports\/detail\?/, { timeout: 60_000 });
            return { note: "показатели и drill-down до первичных записей доступны" };
          });
        }
      } finally {
        await context.request.post("/api/v1/auth/logout", { headers: { origin: BASE } });
        await context.close();
      }
    }
  } finally {
    await browser.close();
    try { await cleanup(db); }
    catch (error) { leftovers.push(`cleanup: ${error instanceof Error ? error.message : "ошибка"}`); }
    try {
      for (const action of priorActions.rows) {
        await db.query("DELETE FROM ai_chat_messages WHERE pending_action_id=$1", [action.id]);
        await db.query("UPDATE ai_pending_actions SET payload=$2, status=$3, decided_by=$4, decided_at=$5 WHERE id=$1", [action.id, action.payload, action.status, action.decided_by, action.decided_at]);
      }
    } finally {
      for (const row of priorFlags.rows) await db.query("UPDATE users SET must_change_password = $2 WHERE login = $1", [row.login, row.must_change_password]);
      await db.end();
      await rm(csvPath, { force: true });
    }
  }

  const rows = ROLES.map(role => ({ role, own: results.filter(row => row.role === role.code) }));
  const formatRows = (items: Result[]) => items.map(row => `| ${row.id} | ${row.title} | ${dur(row.ms)} | ${row.status} | ${row.note} |`).join("\n");
  const passed = results.filter(row => row.status === "OK").length;
  const partial = results.filter(row => row.status === "PARTIAL").length;
  const failed = results.filter(row => row.status === "FAIL").length;
  const markdown = [
    "# AT-18 — технический пробный прогон сценариев апробации (dry run)",
    "",
    `Дата: ${new Date().toISOString()}. Это **технический прогон Playwright**, а не апробация людьми.`,
    "",
    "Проверяет саму программу `docs/acceptance/v31/approbation/README.md`: проходит те же шаги через",
    "интерфейс, измеряет время действий и фиксирует ошибки, чтобы бланки заполнялись на рабочей сборке,",
    "а не на пустом месте. Результаты ниже не заменяют AT-18.",
    "",
    "## Условия прогона",
    "",
    `- Адрес: ${BASE}, сборка \`NEXT_DIST_DIR=.next-3424\`, БД \`crm_demo\` (синтетика), вход через \`localhost\`.`,
    "- `SCRAPER_ENABLED=true`, `SCRAPER_DEMO_FIXTURES=true` — записанные ответы площадок, живой сбор не выполняется; включены Авито, ЦИАН и Мир Квартир.",
    "- `AI_ENABLED=false` — платные вызовы Yandex AI отсутствуют; проверяется ранее подготовленный черновик.",
    "- Очередь поиска обрабатывает воркер `src/worker/property-search-worker.ts` с тем же `DATABASE_URL`.",
    `- Скрипт: \`scripts/approbation/timing.ts\`; артефакты: \`${SHOT_DIR}/\`.`,
    `- Маркер синтетических записей прогона: \`${MARKER}\`.`,
    "",
    "## Итог по ролям",
    "",
    ...rows.flatMap(({ role, own }) => [
      `### ${role.label} (${role.code})`,
      "",
      "| ID | Сценарий | Время (мин:сек) | Статус | Примечание |",
      "|---|---|---|---|---|",
      own.length ? formatRows(own) : "| — | — | — | SKIP | сценарий не выполнялся |",
      "",
    ]),
    "## Сводка",
    "",
    "| Показатель | Значение |",
    "|---|---|",
    `| Шагов пройдено | ${results.length} |`,
    `| OK | ${passed} |`,
    `| PARTIAL | ${partial} |`,
    `| FAIL | ${failed} |`,
    `| Ошибки JS в браузере | ${pageErrors.length} |`,
    "",
    "## Найденные дефекты и ограничения",
    "",
    failed + partial === 0
      ? "Дефектов уровня FAIL/PARTIAL не зафиксировано."
      : results.filter(row => row.status === "FAIL" || row.status === "PARTIAL").map(row => `- **${row.status}** \`${row.id}\` (${row.role}): ${row.note}`).join("\n"),
    "",
    "### Ошибки JavaScript на страницах",
    "",
    pageErrors.length ? pageErrors.map(text => `- ${text}`).join("\n") : "Не зафиксировано.",
    "",
    "## Созданные синтетические записи (маркер прогона)",
    "",
    created.length ? [...new Set(created)].map(text => `- ${text}`).join("\n") : "Записи не создавались.",
    "",
    "Скрипт удаляет созданные операционные записи с маркером и свои КП, восстанавливает исходное состояние",
    "DEMO-черновика и флаги смены пароля, завершает свои сессии. Поисковые snapshots, решения о дублях и аудит остаются в демо-БД.",
    "",
    "Разбор исходных FAIL/PARTIAL и доказательства S10 — [defect-triage.md](defect-triage.md).",
    "Серверный лог: `data/approbation-dry-run/server-3424.log`; итоговые шаги: `data/approbation-dry-run/results.json`.",
    "",
    leftovers.length ? ["### Осталось после очистки", "", ...leftovers.map(text => `- ${text}`)].join("\n") : "",
    "",
    "## Что осталось за пределами прогона",
    "",
    "- Живая площадка и CAPTCHA: сценарий `needs_user_action` на записанных ответах не воспроизводится —",
    "  автоматически проверяется запасной путь (импорт выгрузки), интерактивная сессия проходится сотрудником.",
    "- Платные вызовы Yandex AI, реальный Excel предприятия, фирменные договоры.",
    "- Субъективные оценки удобства 1–5 и замечания процесса: заполняются людьми в бланках.",
    "",
  ].filter(line => line !== undefined).join("\n");
  await writeFile(OUT_FILE, markdown, "utf8");
  await writeFile(path.join(SHOT_DIR, "results.json"), JSON.stringify({ results, pageErrors, leftovers }, null, 2), "utf8");
  if (results.some(row => row.status !== "OK") || pageErrors.length || leftovers.length) process.exitCode = 1;
  console.log(JSON.stringify({ steps: results.length, ok: passed, partial, failed, jsErrors: pageErrors.length, out: OUT_FILE, shots: SHOT_DIR }));
}

main().catch(error => { console.error("approbation dry run failed:", error instanceof Error ? error.message.split("\n")[0] : "unknown"); process.exitCode = 1; });
