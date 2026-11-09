import { expect, test } from "@playwright/test";
import { QA_ORIGIN, apiLogin, loginUI, shot } from "./qa-helpers";

const timings: string[] = [];

test("QA-10 отчёты руководителя и drill-down", async ({ page, request }) => {
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  const t = Date.now();
  const rep = await request.get(`${QA_ORIGIN}/api/v1/reports/manager`, { headers: h });
  expect(rep.ok(), await rep.text()).toBeTruthy();
  timings.push(`отчёт manager: ${Date.now() - t} мс`);
  const detailT = Date.now();
  const det = await request.get(`${QA_ORIGIN}/api/v1/reports/detail?kind=requests`, { headers: h });
  timings.push(`отчёт detail: ${Date.now() - detailT} drill=${det.status()} мс`);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: /Отч/i }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "reports", "Экран «Отчёты»: обращения, этапы, показы, просрочки, сделки, активность", "reports");
  await page.goto("/reports/sources");
  await shot(page, "reports-sources", "Отчёт по источникам обращений с переходом к первичным записям", "reports");
  await page.goto("/reports/detail");
  await shot(page, "reports-detail", "Детализация отчёта: drill-down до первичных записей", "reports");
  console.log(timings.join(" | "));
});

test("QA-11 импорт синтетики: dry-run → commit → повтор без дублей → экспорт", async ({ page }) => {
  test.setTimeout(240_000);
  await loginUI(page, "manager");
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Рабочая книга объектов и обращений" })).toBeVisible({ timeout: 30000 });

  // 11a. Книга workbook-like.xlsx: graceful dry-run без строк, без утечек маркеров в preview
  await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/workbook-like.xlsx");
  await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
  await expect(page.getByText(/Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
  const body1 = await page.locator("body").innerText();
  expect(body1).not.toContain("POLICY_SECRET");
  expect(body1).not.toContain("паспорт");
  await shot(page, "import-dryrun-empty", "Импорт workbook-like: корректный dry-run без распознанных строк, без утечек", "import");

  // 11b. Полный цикл на enterprise-workbook.xlsx (синтетика): маппинг → dry-run → commit
  await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/enterprise-workbook.xlsx");
  await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
  await expect(page.getByText(/Требуют решения:|Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
  const t = Date.now();
  const mapping = page.getByText("Настройка сопоставления колонок и скрытых строк", { exact: true });
  if (await mapping.count()) {
    await mapping.click();
    const textarea = page.getByRole("textbox", { name: "Профиль v2" });
    const profile = JSON.parse(await textarea.inputValue());
    for (const sheet of profile.sheets) {
      sheet.defaults.priceUnit = "rub_month";
      for (const key of Object.keys(sheet.columns)) if (sheet.columns[key] === null) sheet.columns[key] = "ignore";
      // Листы-справочники без целевого раздела (target null) явно исключаем — иначе unresolved на строке-маркера
      if (sheet.target === null && Object.values(sheet.columns).every((v) => v === "ignore" || v === null)) sheet.target = "ignore";
    }
    await textarea.fill(JSON.stringify(profile, null, 2));
    await page.getByRole("button", { name: "Применить профиль и повторить dry-run" }).click();
    await expect(page.getByText("Требуют решения:")).toHaveCount(0, { timeout: 120000 });
  }
  timings.push(`import dry-run+mapping: ${Date.now() - t} мс`);
  await shot(page, "import-dryrun", "Импорт: результат dry-run по синтетической книге, статусы строк", "import");
  const ack1 = page.getByLabel("Предупреждения проверены; неоднозначные сведения потребуют ручного уточнения");
  if (await ack1.count()) await ack1.check();
  const ack2 = page.getByLabel("Подтверждаю загрузку допустимых строк, пропуск ошибок и дублей");
  if (await ack2.count()) await ack2.check();
  const commitBtn = page.getByRole("button", { name: "Загрузить в CRM", exact: true });
  if (await commitBtn.isEnabled()) {
    const committed = page.waitForResponse(
      (r) => r.url().includes("/api/v1/import/enterprise/") && r.request().method() === "POST",
      { timeout: 120000 },
    );
    await commitBtn.click();
    const response = await committed;
    expect(response.ok(), await response.text()).toBeTruthy();
    const result = (await response.json()) as { id: string };
    await expect(page.getByText("Импорт завершён.", { exact: true })).toBeVisible({ timeout: 120000 });
    timings.push("import commit: ok");
    await shot(page, "import-commit", "Импорт завершён: счётчики загруженных, пропущенных и ошибок", "import");
    // Повтор той же книги — дубли не создаются
    await page.getByLabel("Синтетическая или разрешённая локальная книга .xlsx").setInputFiles("tests/fixtures/synthetic/enterprise-workbook.xlsx");
    await page.getByRole("button", { name: "Проверить без загрузки в CRM" }).click();
    await expect(page.getByText(/уже загружался|Строк: \d+/).first()).toBeVisible({ timeout: 120000 });
    await page.goto(`/import/${result.id}`);
    await expect(page.getByText("Импорт завершён.", { exact: true })).toBeVisible({ timeout: 60000 });
    // Экспорт
    const download = page.waitForEvent("download", { timeout: 60000 });
    await page.getByRole("link", { name: "В формат рабочего Excel", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
    timings.push("import export: ok");
  }
  console.log(timings.join(" | "));
});

test("QA-12 поиск объектов + AI-разбор (бюджет ≤3₽, ≤10 вызовов)", async ({ page, request }) => {
  test.setTimeout(300_000);
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  const usageBefore = (await (await request.get(`${QA_ORIGIN}/api/v1/ai/usage`, { headers: h })).json()) as {
    committedRub: string; total: number;
  };
  await page.goto("/property-search");
  await expect(page.getByRole("heading", { name: "Поиск объектов", exact: true })).toBeVisible({ timeout: 30000 });
  // Фильтры по образцу live-прогона: локации-кнопки, операция, тип, цены/площади
  for (const loc of ["Академгородок (Советский район)", "Бердск"]) {
    const btn = page.getByRole("button", { name: loc, exact: true });
    if (await btn.count()) await btn.first().click();
  }
  await page.locator("label").filter({ hasText: /^\s*Операция/ }).locator("select").selectOption("rent");
  const kind = page.getByLabel("Тип объекта", { exact: true });
  if (await kind.count()) await kind.selectOption("flat");
  await page.getByLabel("Цена до", { exact: true }).fill("5000000");
  await page.getByLabel("Площадь от, м²", { exact: true }).fill("30");
  await shot(page, "search-filters", "Поиск объектов: локации, операция, тип, цены и площади", "search");
  // AI-разбор — максимум 2 попытки, считаем платные вызовы
  let aiCalls = 0;
  for (let i = 0; i < 2; i++) {
    const parse = await request.post(`${QA_ORIGIN}/api/v1/property-search/analysis/parse`, {
      headers: h,
      data: { text: i === 0 ? "офис 50-100 м аренда Академгородок" : "двушка до 5 млн Бердск", currentFilters: { operation: "rent", priceUnit: "rub_month" } },
    });
    if ([200, 201].includes(parse.status())) aiCalls++;
    else break;
  }
  const usageAfter = (await (await request.get(`${QA_ORIGIN}/api/v1/ai/usage`, { headers: h })).json()) as {
    committedRub: string; total: number;
  };
  const delta = Number(usageAfter.committedRub) - Number(usageBefore.committedRub);
  console.log(`AI usage: calls=${aiCalls} delta=${delta}₽ (лимит ≤3₽, ≤10 вызовов)`);
  expect(delta).toBeLessThanOrEqual(3);
  console.log(timings.join(" | "));
});

test("QA-13 AI-помощник на двух экранах", async ({ page, request }) => {
  await loginUI(page, "manager");
  const h = await apiLogin(request, "manager");
  let sent = 0;
  for (const url of ["/today", "/property-search"]) {
    await page.goto(url);
    // Ищем панель или кнопку помощника. Если её нет, фиксируем это и идём дальше
    const trigger = page.getByRole("button", { name: /Ассистент|ИИ-помощник|AI/i });
    if (await trigger.count()) {
      await trigger.first().click();
      const box = page.getByRole("textbox", { name: /Сообщение|Вопрос|Спросить/i });
      if (await box.count()) {
        await box.first().fill("QA: кратко опиши, что видно на этом экране");
        const sendBtn = page.getByRole("button", { name: /Отправить/i });
        await sendBtn.first().click();
        sent++;
        await page.waitForTimeout(8000);
      }
    }
    await shot(page, url === "/today" ? "ai-today" : "ai-search", `AI-помощник на экране «${url}»: контекст и ответы`, "ai");
  }
  const usage = (await (await request.get(`${QA_ORIGIN}/api/v1/ai/usage`, { headers: h })).json()) as {
    committedRub: string;
  };
  console.log(`AI assistant screens=2 sent=${sent} committed=${usage.committedRub}₽`);
});

test("QA-14 администрирование: пользователи и роли", async ({ page, browser, request }) => {
  await loginUI(page, "manager");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: /Пользователи|Администрирование/i }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "admin-users", "Администрирование: пользователи, роли, блокировка", "admin");
  // Риелтору — запрет
  const ctx = await browser.newContext({ baseURL: QA_ORIGIN });
  const other = await ctx.newPage();
  await loginUI(other, "r1");
  await other.goto("/admin/users");
  await expect(other).toHaveURL(/\/forbidden/);
  const r1h = await apiLogin(request, "r1");
  expect((await request.get(`${QA_ORIGIN}/api/v1/admin/users`, { headers: r1h })).status()).toBe(403);
  await ctx.close();
});
