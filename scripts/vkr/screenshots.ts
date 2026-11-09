import { chromium, expect as baseExpect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { db, disconnectDb } from "../../src/shared/db/client";

config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = process.env.VKR_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
if (new URL(process.env.DATABASE_URL).pathname !== "/crm_demo") throw new Error("Requires crm_demo");
const baseURL = process.env.VKR_BASE_URL ?? "http://127.0.0.1:3370";
const output = "docs/screenshots/vkr";
const expect = baseExpect.configure({ timeout: 60000 });
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
  await navigate(page, "/login");
  await page.getByLabel("Логин").fill(process.env[`SEED_${role}_LOGIN`] ?? (role === "MANAGER" ? "manager" : "realtor1"));
  await page.getByLabel("Пароль").fill(password);
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some(key => key.startsWith("__reactProps")));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 60000 });
}
async function navigate(page: Page, url: string) {
  try { await page.goto(url); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ERR_ABORTED")) throw error;
    await page.goto(url);
  }
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
  await expect(page.locator("main").first()).toBeVisible();
  await expect(file === "10b-offer-print" ? page.frameLocator('iframe[title="Печатное коммерческое предложение A4"]').locator("h1").first() : page.locator("h1").first()).toBeVisible();
  await page.waitForFunction(() => [...document.querySelectorAll("input,textarea,select")].every(element => Object.keys(element).some(key => key.startsWith("__reactProps"))));
  await expect(page.locator("body")).not.toContainText(/Application error:|Internal Server Error|Код запроса:|Запись не найдена или недоступна/);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter(i => i.loading !== "lazy" || i.getBoundingClientRect().top < innerHeight).map(i => i.complete ? Promise.resolve() : new Promise<void>(r => { i.onload = () => r(); i.onerror = () => r(); })));
  });
  const closeToasts = page.locator('[data-sonner-toast] button[aria-label="Close toast"], [role="status"] button[aria-label="Закрыть уведомление"]');
  for (let attempt = 0; attempt < 10 && await closeToasts.count(); attempt++) await closeToasts.first().click({ timeout: 1000 }).catch(() => undefined);
  await expect(page.locator('[data-sonner-toast], .toast')).toHaveCount(0, { timeout: 15000 });
  if (file === "08-selection") {
    await page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }) }).screenshot({ path: `${output}/${file}.png`, animations: "disabled", caret: "initial" });
  } else await page.screenshot({ path: `${output}/${file}.png`, fullPage, animations: "disabled", caret: "initial" });
  records.push({ sha256: createHash("sha256").update(await readFile(`${output}/${file}.png`)).digest("hex"), file: `${file}.png`, scenario, date: new Date().toISOString(), sha, role, url: new URL(page.url()).pathname + new URL(page.url()).search,
    mode: file === "07-web-fallback" ? "DEMO: FixtureScraperAdapter + FakeResponsesProvider; живого AI/веб-сбора нет" : "DEMO: фикстуры площадок; AI выключен; синтетические данные crm_demo" });
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
  const districts = page.getByRole("group", { name: "Районы · любой из выбранных" });
  await districts.locator("summary").click();
  await districts.getByLabel("Центральный", { exact: true }).check();
  await districts.locator("summary").click();
}
async function run(page: Page, scenario: string) {
  await page.getByLabel("Записанный сценарий").selectOption(scenario);
  const response = page.waitForResponse(r => r.url().endsWith("/property-search/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Искать", exact: true }).click();
  const paid = page.getByRole("dialog", { name: "Подтверждение платного поиска" });
  await Promise.race([response, paid.waitFor({ state: "visible" }).then(() => paid.getByRole("button", { name: "Подтверждаю запуск", exact: true }).click())]);
  const result = await response.catch(async error => { await page.screenshot({ path: "data/qa2-search-failure.png", fullPage: true }); throw error; });
  expect(result.ok(), await result.text()).toBeTruthy();
  await expect(page.getByText("Поиск завершён", { exact: true })).toBeVisible();
  return await result.json() as { webSearchUsed: boolean };
}
async function main() {
  await mkdir(output, { recursive: true });
  if (process.env.VKR_WEB_ONLY === "true") records.push(...JSON.parse(await readFile(`${output}/manifest.json`, "utf8")).filter((record: { file: string }) => record.file !== "07-web-fallback.png"));
  if (process.env.VKR_FROM_OFFER === "true") records.push(...JSON.parse(await readFile(`${output}/manifest.json`, "utf8")).filter((record: { file: string }) => /^(0[1-9])/.test(record.file)));
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
    if (process.env.VKR_WEB_ONLY !== "true") {
    const context = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on("dialog", d => d.type() === "beforeunload" ? d.accept() : d.dismiss());
    await login(page, "REALTOR1");
    if (process.env.VKR_FROM_OFFER !== "true") {
    await shot(page, "01-today", "Ежедневные задачи, просрочки и ближайшие действия");
    await navigate(page, `/clients/${id("client:0")}`);
    await shot(page, "02-client-card", "Карточка синтетического клиента ООО «Сибирь Коммерция 1»");
    await navigate(page, `/needs/${id("need:0")}`);
    await shot(page, "03-need-card", "Активная потребность и обязательное следующее действие");
    await navigate(page, `/property-search?needId=${id("need:0")}`);
    await filters(page);
    await shot(page, "04-property-search-filters", "Ручные условия поиска: Новосибирск, торговля, первый этаж, 80–150 м²", "realtor1", true);
    await page.getByLabel("Обязательные признаки", { exact: true }).fill("Отдельный вход; витрина");
    await page.getByLabel("Цена до", { exact: true }).fill("16000000");
    await shot(page, "05-property-search-ai-adjust", "Ручная корректировка фильтров при выключенном ИИ; ответ ИИ не имитируется", "realtor1", true);
    await run(page, "partial");
    await page.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "06-source-failure", "Частичный отказ HTTP 429; успешные результаты Циан сохранены; ТЕСТОВЫЙ РЕЖИМ", "realtor1", true);
    await navigate(page, `/needs/${id("need:0")}`);
    await page.getByRole("heading", { name: "Подборка (кандидаты)", exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => { const h = Array.from(document.querySelectorAll("h2,h3")).find(e => e.textContent === "Подборка (кандидаты)"); if (h) window.scrollTo(0, window.scrollY + h.getBoundingClientRect().top - 100); });
    await shot(page, "08-selection", "Кандидаты подборки и отдельная связь с каталогом CRM");
    await navigate(page, `/properties/${id("property:0")}?tab=photos`);
    await page.getByRole("region", { name: "Фотографии", exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "09-property-gallery", "Галерея синтетических фотографий и главное фото", "realtor1", true);
    await page.getByRole("region", { name: "Фотографии", exact: true }).locator("article button").first().click();
    await expect(page.getByRole("dialog", { name: "Просмотр фотографии" })).toBeVisible();
    await shot(page, "09b-lightbox", "Увеличение подлинного файла из StorageAdapter");
    await page.keyboard.press("Escape");
    }
    const offer = await db.commercialOffer.findFirstOrThrow({ where: { title: "[DEMO-V241] Подборка — черновик" } });
    await navigate(page, `/offers/${offer.id}`);
    await shot(page, "10-offer", "Структурированное КП с тремя объектами и сохранёнными снимками");
    const pdfResponse = page.waitForResponse(r => r.url().endsWith(`/offers/${offer.id}/pdf`));
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Скачать PDF", exact: true }).click();
    const pdf = await pdfResponse;
    expect(pdf.ok()).toBeTruthy();
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    await (await download).saveAs("data/qa2-offer.pdf");
    expect((await readFile("data/qa2-offer.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
    execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1600", "-png", "data/qa2-offer.pdf", `${output}/10c-offer-pdf-page1`]);
    records.push({ file: "10c-offer-pdf-page1.png", scenario: "Первая страница настоящего многостраничного A4 PDF из кнопки «Скачать PDF»", date: new Date().toISOString(), sha, role: "realtor1", url: `/api/v1/offers/${offer.id}/pdf`, mode: "DEMO: синтетические данные crm_demo; Poppler render", sha256: createHash("sha256").update(await readFile(`${output}/10c-offer-pdf-page1.png`)).digest("hex") });
    await navigate(page, `/offers/${offer.id}/print`);
    await expect(page).toHaveURL(/\/print$/, { timeout: 60000 });
    await expect(page.getByTitle("Печатное коммерческое предложение A4")).toBeVisible();
    await shot(page, "10b-offer-print", "DEMO: предпросмотр A4 в изолированном iframe, нейтральный шаблон", "realtor1", true);
    await navigate(page, "/calendar");
    await expect(page.locator(".fc-timeGridWeek-view")).toBeVisible();
    await expect(page.locator(".fc-event").first()).toBeVisible();
    await shot(page, "11-calendar-week", "Неделя: задачи, показы, встречи в Asia/Novosibirsk");
    await page.getByRole("button", { name: "+ Встреча / личная запись", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Заголовок", { exact: false }).fill("[DEMO] Утренний обзор подборок");
    await page.getByRole("dialog").getByLabel("Повторение", { exact: true }).selectOption("weekdays");
    await page.getByRole("dialog").getByLabel("Окончание серии", { exact: true }).selectOption("count");
    await page.getByRole("dialog").getByLabel("Количество встреч в серии", { exact: false }).fill("10");
    await shot(page, "11b-calendar-recurrence", "DEMO: редактируемая серия по будням, десять встреч; форма без сохранения");
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).last().click();
    await page.getByRole("dialog", { name: "Подтверждение действия", exact: true }).getByRole("button", { name: "Подтвердить", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await navigate(page, "/notifications");
    await shot(page, "12-notifications", "Внутренние уведомления из демонстрационной БД");
    await navigate(page, `/deals/${id("deal:0")}`);
    await page.getByText("Чек-лист документов сделки", { exact: true }).scrollIntoViewIfNeeded();
    await shot(page, "13-deal-documents-checklist", "Статусы документов сделки и связи с файлами", "realtor1", true);
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate(page, "/today");
    await shot(page, "16-mobile-today", "Сегодня на мобильном экране 390 px");
    await navigate(page, "/clients");
    await shot(page, "16b-mobile-list", "DEMO: карточки списка клиентов и нижняя панель на 390 px");
    await page.setViewportSize({ width: 1440, height: 900 });
    await context.close();
    const managerContext = await browser.newContext({ baseURL, locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const manager = await managerContext.newPage();
    await login(manager, "MANAGER");
    await navigate(manager, "/reports?from=2026-09-01&to=2026-12-31");
    await shot(manager, "14-report-kpi", "KPI руководителя за фиксированный период 01.09–31.12.2026", "manager");
    await manager.locator('a[href^="/reports/detail?"][href*="metric=newRequests"]').first().click();
    await expect(manager).toHaveURL(/\/reports\/detail\?/, { timeout: 60000 });
    await shot(manager, "14b-report-drilldown", "Переход из KPI в первичные записи с теми же границами", "manager");
    await navigate(manager, "/settings/ai");
    await shot(manager, "15-settings-ai", "Настройки и ограничения ИИ, доступные руководителю", "manager");
    await managerContext.close();
    }
    // Отдельный процесс 3211: только записанный отказ и FakeResponsesProvider, без секрета.
    const webContext = await browser.newContext({ baseURL: process.env.VKR_WEB_BASE_URL ?? "http://127.0.0.1:3211", locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    // В seed уже есть синтетические AI-вызовы. Руководитель временно расширяет дневной
    // лимит через настоящий UI и затем возвращает его. предохранители ENV сохраняются.
    const webAdmin = await browser.newContext({ baseURL: process.env.VKR_WEB_BASE_URL ?? "http://127.0.0.1:3211", locale: "ru-RU", timezoneId: "Asia/Novosibirsk", viewport: { width: 1440, height: 900 } });
    const settings = await webAdmin.newPage();
    settings.setDefaultTimeout(60000);
    console.log("Preparing DEMO fallback limits");
    await login(settings, "MANAGER");
    await settings.goto("/settings/ai");
    const daily = settings.getByLabel(/^(AI-)?[Вв]ызовов на сотрудника/);
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
    web.setDefaultTimeout(60000);
    try {
    await login(web, "REALTOR1");
    console.log("Running DEMO fallback");
    await navigate(web, "/property-search");
    await filters(web);
    const fallback = await run(web, "failure");
    expect(fallback.webSearchUsed).toBe(true);
    await web.getByRole("tab", { name: "Требуют проверки", exact: true }).click();
    await web.getByRole("heading", { name: "Состояние источников", exact: true }).scrollIntoViewIfNeeded();
    await shot(web, "07-web-fallback", "DEMO: полный отказ скрапера → записанный веб-резерв; результат текущих серверных проверок первоисточника", "realtor1", true);
    } finally { console.log("Restoring DEMO limits"); await saveDaily(originalDaily, originalAgencyDaily); await webAdmin.close(); }
    await webContext.close();
    const checksums = await Promise.all(records.map(async r => `${createHash("sha256").update(await readFile(`${output}/${r.file}`)).digest("hex")}  ${r.file}`));
    await writeFile(`${output}/SHA256SUMS`, checksums.join("\n") + "\n");
    await mkdir("docs/vkr/screenshots", { recursive: true });
    const rows = records.map(r => `| [${r.file}](../screenshots/vkr/${r.file}) | ${r.scenario} | ${r.date} | ${r.sha} | ${r.role} | Синтетические, crm_demo | ${r.mode} |`).join("\n");
    await writeFile("docs/vkr/screenshots.md", `# Подлинные экраны ВКР\n\nСняты Playwright, viewport 1440×900 (мобильный 390×844), часовой пояс Asia/Novosibirsk. Локаль ru-RU. Режим DEMO, dev-сервер webpack на порту 3370, NEXT_DIST_DIR=.next-qa; веб-резерв — отдельный fake-only сервер 3371. Рабочая копия включает незакоммиченные доработки UI v2.4.1. Production build в этом QA-прогоне заблокирован Deny ACL в стандартной .next. В crm_demo — 25 клиентов, 25 потребностей, 40 обращений, 27 задач; три новых перспективных обращения с актуальным действием, шесть завершённых контактов (три в срок и три с опозданием). Рабочие часы 09:00–19:00 Asia/Novosibirsk; фикстуры поиска — Новосибирск, вымышленные улицы. Клиенты и коммерческие данные синтетические. В общей crm_demo сохранены также ссылки и пометки LIVE от параллельных испытаний; в карточке клиента и кадре 08 они видны как существующая история и не являются доказательством живого поиска этого DEMO-прогона. Кадр 08 снимает отдельно блок кандидатов, его статусы и перенос в каталог; тосты закрыты штатными кнопками. SHA256 каждого PNG записан в manifest.json и SHA256SUMS. Статус внешних площадок и веб-резерв демонстрируются записанными ответами и не доказывают доступность живых интеграций. [Воспроизведение и исправленный дефект](../../scripts/vkr/README.md). Каждый PNG открыт и визуально проверен; длинные страницы сняты целиком.\n\n| Файл | Сценарий | Дата UTC | HEAD | Роль | Данные | Режим |\n|---|---|---|---|---|---|---|\n${rows}\n`);
    await writeFile("docs/vkr/screenshots/README.md", "# Скриншоты ВКР\n\nПодлинные PNG находятся в [docs/screenshots/vkr/](../../screenshots/vkr/). [Описание, дата, версия, роли и режимы](../screenshots.md). Генератор: `npx tsx scripts/vkr/screenshots.ts`.\n");
  } finally { await browser.close(); await disconnectDb(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Screenshot capture failed"); process.exitCode = 1; });
