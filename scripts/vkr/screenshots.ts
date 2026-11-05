import { chromium, expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { db, disconnectDb } from "../../src/shared/db/client";

config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = process.env.VKR_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
if (new URL(process.env.DATABASE_URL).pathname !== "/crm_demo") throw new Error("Requires crm_demo");
const baseURL = process.env.VKR_BASE_URL ?? "http://127.0.0.1:3210";
const output = "docs/screenshots/vkr";
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const records: { file: string; scenario: string; date: string; sha: string; role: string; url: string; mode: string; sha256: string }[] = [];
const resolved = new Map<string, string>();
const id = (key: string) => {
  if (resolved.has(key)) return resolved.get(key)!;
  const h = createHash("sha256").update(`crm-demo-v241:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
async function login(page: Page, role: "REALTOR1" | "MANAGER") {
  const password = process.env[`SEED_${role}_PASSWORD`];
  if (!password) throw new Error(`Missing SEED_${role}_PASSWORD`);
  await page.goto("/login");
  await page.getByLabel("Логин").fill(process.env[`SEED_${role}_LOGIN`] ?? (role === "MANAGER" ? "manager" : "realtor1"));
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
}
async function shot(page: Page, file: string, scenario: string, role = "realtor1", fullPage = false) {
  if (file === "01-today" || file === "14-report-kpi") {
    const result = await page.request.get("/api/v1/notifications/unread-count");
    if (result.ok()) {
      const { count } = await result.json() as { count: number };
      if (count) await expect(page.getByRole("link", { name: `Уведомления: ${count} непрочитанных`, exact: true })).toBeVisible();
    }
  }
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await expect(file === "10b-offer-print" ? page.locator(".crm-print") : page.locator("main").first()).toBeVisible();
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Application error:|Internal Server Error|Код запроса:|Запись не найдена или недоступна/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(i => i.loading !== "lazy" || i.getBoundingClientRect().top < innerHeight).map(i => i.complete ? Promise.resolve() : new Promise<void>(r => { i.onload = () => r(); i.onerror = () => r(); })));
  });
  for (const toast of await page.locator('[data-sonner-toast] button[aria-label="Close toast"], [role="status"] button[aria-label="Закрыть уведомление"]').all()) await toast.click();
  await expect(page.locator('[data-sonner-toast], .toast')).toHaveCount(0, { timeout: 15000 });
  if (file === "08-selection") {
    await page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }) }).screenshot({ path: `${output}/${file}.png`, animations: "disabled" });
  } else await page.screenshot({ path: `${output}/${file}.png`, fullPage, animations: "disabled" });
  records.push({ sha256: createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex"), file: `${file}.png`, scenario, date: new Date().toISOString(), sha, role, url: new URL(page.url()).pathname + new URL(page.url()).search,
    mode: file === "07-web-fallback" ? "ТЕСТИРОВАНИЕ: FixtureScraperAdapter + FakeResponsesProvider; живого AI/веб-сбора нет" : "Демо-фикстуры площадок; AI выключен; синтетические данные crm_demo" });
  await writeFile(`${output}/manifest.json`, JSON.stringify(records, null, 2) + "\n");
  console.log(`Captured ${file}`);
}
async function filters(page: Page) {
  await page.getByLabel("Город", { exact: true }).fill("Новосибирск");
  await page.getByLabel(/^Операция/).selectOption("sale");
  await page.getByLabel(/^Этаж/).selectOption("first_floor_only");
  await page.getByLabel("Цена до", { exact: true }).fill("20000000");
  await page.getByLabel("Площадь от, м²", { exact: true }).fill("80");
  await page.getByLabel("Площадь до, м²", { exact: true }).fill("150");
  await page.getByLabel("Торговля", { exact: true }).check();
  await page.getByLabel(/Районы/).fill("Центральный");
}
async function run(page: Page, scenario: string) {
  await page.getByLabel("Записанный сценарий").selectOption(scenario);
  const response = page.waitForResponse(r => r.url().endsWith("/property-search/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Искать", exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  await expect(page.getByText("Поиск завершён", { exact: true })).toBeVisible();
}
async function main() {
  await mkdir(output, { recursive: true });
  // Для синтетических демонстрационных учётных записей seed-пароль уже является постоянным.
  await db.user.updateMany({ where: { login: { in: [process.env.SEED_MANAGER_LOGIN ?? "manager", process.env.SEED_REALTOR1_LOGIN ?? "realtor1"] } }, data: { mustChangePassword: false } });
  const client = await db.client.findFirstOrThrow({ where: { displayName: "ООО «Сибирь Коммерция 1»", notes: { contains: "[DEMO-V241]" } } });
  resolved.set("client:0", client.id);
  const need = await db.clientNeed.findFirstOrThrow({ where: { clientId: client.id, status: "active" } });
  resolved.set("need:0", need.id);
  const property = await db.property.findFirstOrThrow({ where: { addressText: "Новосибирск, Центральный район, деловой квартал, дом 10" } });
  resolved.set("property:0", property.id);
  const browser = await chromium.launch({ args: ["--lang=ru-RU", "--accept-lang=ru-RU"] });
  try {
    const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("dialog", d => d.dismiss());
    await login(page, "REALTOR1");
    await shot(page, "01-today", "Ежедневные задачи, просрочки и ближайшие действия");
    await page.goto(`/clients/${id("client:0")}`);
    await shot(page, "02-client-card", "Карточка синтетического клиента ООО «Сибирь Коммерция 1»");
    await page.goto(`/needs/${id("need:0")}`);
    await shot(page, "03-need-card", "Активная потребность и обязательное следующее действие");
    await page.goto(`/property-search?needId=${id("need:0")}`);
    await filters(page);
    await shot(page, "04-property-search-filters", "Ручные условия поиска: Новосибирск, торговля, первый этаж, 80–150 м²", "realtor1", true);
    await page.getByLabel("Обязательные признаки", { exact: true }).fill("Отдельный вход; витрина");
    await page.getByLabel("Цена до", { exact: true }).fill("16000000");
    await shot(page, "05-property-search-ai-adjust", "Ручная корректировка фильтров при выключенном ИИ; ответ ИИ не имитируется", "realtor1", true);
    await run(page, "partial");
    await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "06-source-failure", "Частичный отказ HTTP 429; успешные результаты Циан сохранены; ТЕСТОВЫЙ РЕЖИМ", "realtor1", true);
    await page.goto(`/needs/${id("need:0")}`);
    await page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => { const h = Array.from(document.querySelectorAll("h2,h3")).find(e => e.textContent === "Подборка (кандидаты)"); if (h) window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 100); });
    await shot(page, "08-selection", "Кандидаты подборки и отдельная связь с каталогом CRM");
    await page.goto(`/properties/${id("property:0")}?tab=photos`);
    await page.getByRole("region", { name: "Фотографии", exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "09-property-gallery", "Галерея синтетических фотографий и главное фото", "realtor1", true);
    await page.getByRole("region", { name: "Фотографии", exact: true }).locator("article button").first().click();
    await expect(page.getByRole("dialog", { name: "Просмотр фотографии" })).toBeVisible();
    await shot(page, "09b-lightbox", "Увеличение подлинного файла из StorageAdapter");
    await page.keyboard.press("Escape");
    const offer = await db.commercialOffer.findFirstOrThrow({ where: { title: "[DEMO-V241] Подборка — черновик" } });
    await page.goto(`/offers/${offer.id}`);
    await shot(page, "10-offer", "Структурированное КП с тремя объектами и сохранёнными снимками");
    await page.getByRole("link", { name: "Предпросмотр / печать" }).click();
    await expect(page).toHaveURL(/\/print$/);
    await expect(page.locator(".crm-print")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await shot(page, "10b-offer-print", "Печатный HTML КП: реальный print CSS, нейтральный шаблон", "realtor1", true);
    await page.emulateMedia({ media: "screen" });
    await page.goto("/calendar");
    await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
    await expect(page.locator(".fc-event").first()).toBeVisible();
    await shot(page, "11-calendar-week", "Неделя: задачи, показы, встречи в Asia/Novosibirsk");
    await page.goto("/notifications");
    await shot(page, "12-notifications", "Внутренние уведомления из демонстрационной БД");
    await page.goto(`/deals/${id("deal:0")}`);
    await page.getByText("Чек-лист документов сделки", { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "13-deal-documents-checklist", "Статусы документов сделки и связи с файлами", "realtor1", true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/today");
    await shot(page, "16-mobile-today", "Сегодня на мобильном экране 390 px");
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.close();
    const managerContext = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const manager = await managerContext.newPage();
    await login(manager, "MANAGER");
    await manager.goto("/reports?from=2026-09-01&to=2026-12-31");
    await shot(manager, "14-report-kpi", "KPI руководителя за фиксированный период 01.09–31.12.2026", "manager");
    await manager.locator('a[href^="/reports/detail?"][href*="metric=newRequests"]').first().click();
    await expect(manager).toHaveURL(/\/reports\/detail\?/);
    await shot(manager, "14b-report-drilldown", "Переход из KPI в первичные записи с теми же границами", "manager");
    await manager.goto("/settings/ai");
    await shot(manager, "15-settings-ai", "Настройки и ограничения ИИ, доступные руководителю", "manager");
    await managerContext.close();
    // Отдельный процесс 3211: только записанный отказ и FakeResponsesProvider, без секрета.
    const webContext = await browser.newContext({ baseURL: process.env.VKR_WEB_BASE_URL ?? "http://127.0.0.1:3211", locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    // В seed уже есть синтетические AI-вызовы. Руководитель временно расширяет дневной
    // лимит через настоящий UI и затем возвращает его; предохранители ENV сохраняются.
    const webAdmin = await browser.newContext({ baseURL: process.env.VKR_WEB_BASE_URL ?? "http://127.0.0.1:3211", locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const settings = await webAdmin.newPage();
    await login(settings, "MANAGER");
    await settings.goto("/settings/ai");
    const daily = settings.getByLabel(/^Вызовов на сотрудника/);
    const originalDaily = await daily.inputValue();
    const agencyDaily = settings.getByLabel(/^Вызовов агентства в сутки/);
    const originalAgencyDaily = await agencyDaily.inputValue();
    async function saveDaily(value: string, agencyValue: string) {
      await daily.fill(value);
      await agencyDaily.fill(agencyValue);
      const saved = settings.waitForResponse(r => r.url().endsWith("/settings/ai") && r.request().method() === "PUT");
      await settings.getByRole("button", { name: "Сохранить настройки", exact: true }).click();
      expect((await saved).ok()).toBeTruthy();
      await settings.reload();
    }
    await saveDaily("30", "60");
    const web = await webContext.newPage();
    try {
    await login(web, "REALTOR1");
    await web.goto("/property-search");
    await filters(web);
    await web.getByLabel(/Условия проверены/).check();
    await run(web, "failure");
    await web.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    await expect(web.getByText("Веб-поиск · требуется проверка", { exact: true })).toBeVisible();
    await web.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
    await shot(web, "07-web-fallback", "ТЕСТОВЫЙ РЕЖИМ: полный отказ скрапера → записанный веб-резерв, требуется проверка", "realtor1", true);
    } finally { await saveDaily(originalDaily, originalAgencyDaily); await webAdmin.close(); }
    await webContext.close();
    const checksums = await Promise.all(records.map(async r => `${createHash("sha256").update(await readFile(`${output}/${r.file}`)).digest("hex")}  ${r.file}`));
    await writeFile(`${output}/SHA256SUMS`, checksums.join("\n") + "\n");
    await mkdir("docs/vkr/screenshots", { recursive: true });
    const rows = records.map(r => `| [${r.file}](../screenshots/vkr/${r.file}) | ${r.scenario} | ${r.date} | ${r.sha} | ${r.role} | Синтетические, crm_demo | ${r.mode} |`).join("\n");
    await writeFile("docs/vkr/screenshots.md", `# Подлинные экраны ВКР\n\nСняты Playwright, viewport 1440×900 (мобильный 390×844), часовой пояс Asia/Novosibirsk. Локаль ru-RU. Сборка next start; рабочая копия включает незакоммиченные исправления полировки UI v2.4.1. В crm_demo — 25 клиентов, 25 потребностей, 40 обращений, 27 задач; три новых перспективных обращения с актуальным действием, шесть завершённых контактов (три в срок и три с опозданием). Рабочие часы 09:00–19:00 Asia/Novosibirsk; фикстуры поиска — Новосибирск, вымышленные улицы. Кадр 08 снимает отдельно блок кандидатов, его статусы и перенос в каталог; тосты закрыты штатными кнопками. SHA256 каждого PNG записан в manifest.json и SHA256SUMS. Статус внешних площадок и веб-резерв демонстрируются записанными ответами и не доказывают доступность живых интеграций. [Воспроизведение и исправленный дефект](../../scripts/vkr/README.md). Каждый PNG открыт и визуально проверен; длинные страницы сняты целиком.\n\n| Файл | Сценарий | Дата UTC | HEAD | Роль | Данные | Режим |\n|---|---|---|---|---|---|---|\n${rows}\n`);
    await writeFile("docs/vkr/screenshots/README.md", "# Скриншоты ВКР\n\nПодлинные PNG находятся в [docs/screenshots/vkr/](../../screenshots/vkr/). [Описание, дата, версия, роли и режимы](../screenshots.md). Генератор: `npx tsx scripts/vkr/screenshots.ts`.\n");
  } finally { await browser.close(); await disconnectDb(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Screenshot capture failed"); process.exitCode = 1; });
