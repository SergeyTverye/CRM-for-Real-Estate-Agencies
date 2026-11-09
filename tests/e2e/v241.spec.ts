import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "./helpers";

async function listingMenu(card: Locator) {
  const menu = card.locator("details").filter({ has: card.page().locator("summary").filter({ hasText: /^Ещё$/ }) });
  if (!await menu.evaluate(element => element.hasAttribute("open"))) await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  return menu;
}

async function searchManually(page: Page, scenario = "success") {
  await page.getByLabel("Город", { exact: true }).fill("Новосибирск");
  await page.getByLabel(/^Операция/).selectOption("sale");
  await page.getByRole("combobox", { name: /^Этаж/ }).selectOption("first_floor_only");
  await page.getByLabel("Цена до", { exact: true }).fill("20000000");
  await page.getByLabel("Площадь от, м²", { exact: true }).fill("80");
  await page.getByLabel("Площадь до, м²", { exact: true }).fill("150");
  await page.getByLabel("Торговля", { exact: true }).check();
  for (const source of ["Циан", "Мир Квартир", "Авито", "Домклик", "OnRealt", "Яндекс Недвижимость", "Юла"]) await page.getByLabel(source, { exact: true }).uncheck();
  await page.getByLabel("Циан", { exact: true }).check();
  await page.getByLabel("Мир Квартир", { exact: true }).check();
  await page.getByLabel("Записанный сценарий").selectOption(scenario);
  const response = page.waitForResponse(r => r.url().endsWith("/property-search/runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Искать", exact: true }).click();
  const res = await response;
  expect(res.ok(), await res.text()).toBeTruthy();
  await expect(page.getByRole("region", { name: "Выдача поиска" }).getByText(/^(Завершён|Частично)$/, { exact: true }).first()).toBeVisible({ timeout: 60000 });
  const results = await page.request.get(`/api/v1/property-search/runs/${(await res.json()).id}/progress`);
  expect(["completed", "partial"]).toContain((await results.json()).status);
  await page.getByRole("tab", { name: /^Совпадения/ }).click();
}

test("v2.4.1: обращение → поиск → подборка → КП → показ → сделка → повторный контакт", async ({ page }) => {
  test.setTimeout(300_000);
  await login(page, "realtor1");
  
  page.on("dialog", d => { if (d.type() === "beforeunload") void d.accept(); else throw new Error("Unexpected native dialog"); });
  const name = `ВКР E2E ${Date.now()}`;
  await page.goto("/requests/new");
  await page.getByLabel("Источник", { exact: false }).selectOption({ index: 1 });
  await page.getByLabel("Имя / наименование").fill(name);
  await page.getByPlaceholder("+7 900 000-00-00").fill(`+7901${String(Date.now()).slice(-7)}`);
  await page.getByLabel("Операция", { exact: false }).selectOption("buy");
  await page.getByLabel("Тип недвижимости").selectOption("commercial");
  await page.getByLabel("Что сделать").fill("");
  const invalid = page.waitForResponse(r => r.url().endsWith("/api/v1/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
  expect((await invalid).status()).toBe(400);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await page.getByLabel("Что сделать").fill("Согласовать подбор объектов E2E");
  const registered = page.waitForResponse(r => r.url().endsWith("/api/v1/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
  const leadResponse = await registered;
  expect(leadResponse.ok(), await leadResponse.text()).toBeTruthy();
  const lead = await leadResponse.json();
  expect(lead.needId).toBeTruthy();
  await expect(page.getByText("Обращение зарегистрировано.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Открыть потребность", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/needs/${lead.needId}$`), { timeout: 30000 });
  await expect(page.getByText("Согласовать подбор объектов E2E", { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await page.locator(`a[href="/property-search?needId=${lead.needId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/property-search\\?needId=${lead.needId}`));
  await expect(page.getByRole("button", { name: "Искать", exact: true })).toBeEnabled();
  expect((await (await page.request.get("/api/v1/ai/limits")).json()).aiEnabled).not.toBe(true);
  await searchManually(page);
  const untransferred = page.locator("[data-listing-id]").filter({ has: page.locator("button").filter({ hasText: /^В каталог CRM$/ }) }).first();
  const listingUrl = await untransferred.locator('a[target="_blank"]').first().getAttribute("href");
  expect(listingUrl).toBeTruthy();
  const listingCard = page.locator("[data-listing-id]").filter({ has: page.locator(`a[href=${JSON.stringify(listingUrl)}]`) });
  await listingCard.getByRole("button", { name: "В подборку клиента", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
  await (await listingMenu(listingCard)).getByRole("button", { name: "В каталог CRM", exact: true }).click();
  await page.getByRole("dialog").getByLabel(/Я проверил первоисточник/).check();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Объект сохранён в каталоге CRM", { exact: true })).toBeVisible();
  const propertyHref = await (await listingMenu(listingCard)).getByRole("link", { name: "Открыть объект CRM", exact: true }).getAttribute("href");
  const propertyId = propertyHref!.split("/").pop()!;
  await (await listingMenu(listingCard)).getByRole("button", { name: "Предложить клиенту", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 60000 });
  await expect(page.getByText("Изменения сохранены", { exact: true })).toBeVisible();
  const offerMenu = await listingMenu(listingCard);
  const offered = page.waitForResponse(r => /\/listings\/[^/]+\/offer$/.test(r.url()));
  await offerMenu.getByRole("button", { name: "В КП", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить", exact: true }).click();
  const offerResponse = await offered;
  expect(offerResponse.ok(), await offerResponse.text()).toBeTruthy();
  const offer = await offerResponse.json();
  await page.goto(`/offers/${offer.id}`);
  await page.getByRole("link", { name: "Предпросмотр / печать" }).click();
  const printed = page.frameLocator('iframe[title="Печатное коммерческое предложение A4"]').locator("body");
  await expect(printed).toContainText("Демонстрационная");
  await page.emulateMedia({ media: "print" });
  await expect(printed).toContainText("15");
  await page.emulateMedia({ media: "screen" });
  await page.goto(`/showings/new?needId=${lead.needId}&propertyId=${propertyId}`);
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some(key => key.startsWith("__reactProps")));
  const showingCreated = page.waitForResponse(r => r.url().endsWith("/api/v1/showings") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Назначить показ", exact: true }).click();
  const showingResponse = await showingCreated;
  expect(showingResponse.ok(), await showingResponse.text()).toBeTruthy();
  await expect(page).toHaveURL(/\/showings\/[0-9a-f-]+$/, { timeout: 60000 });
  await page.getByRole("button", { name: "Зафиксировать результат", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Результат", { exact: false }).selectOption("interested");
  await page.getByRole("button", { name: "Сохранить результат", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("body")).toContainText("Заинтересован");
  await page.goto(`/deals/new?needId=${lead.needId}&propertyId=${propertyId}&clientId=${lead.clientId}`);
  await page.getByLabel("ИП/ООО").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Открыть сделку", exact: true }).click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "Закрыть сделку", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const rows = dialog.locator("fieldset > div");
  const repeatTitle = `Повторный контакт ${name}`;
  const localNow = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
  for (const row of await rows.all()) {
    await row.getByLabel(/^Ответственный/).selectOption({ index: 1 });
    await row.getByLabel("Срок", { exact: true }).fill(localNow);
  }
  await dialog.getByLabel("Последующий контакт", { exact: true }).fill(repeatTitle);
  const closed = page.waitForResponse(r => /\/deals\/[^/]+\/close$/.test(r.url()) && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Закрыть сделку", exact: true }).click();
  const closeResponse = await closed;
  expect(closeResponse.ok(), await closeResponse.text()).toBeTruthy();
  const { taskIds } = await closeResponse.json() as { taskIds: string[] };
  expect(taskIds.length).toBeGreaterThan(1);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(repeatTitle, { exact: true })).toBeVisible();
  await page.goto("/today");
  await expect(page.getByText(repeatTitle, { exact: true }).first()).toBeVisible();
  await page.goto("/calendar");
  await expect(page.locator(".fc-event").first()).toBeVisible();
  const repeatEvent = page.locator(".fc-event-title").filter({ hasText: repeatTitle }).first();
  if (!await repeatEvent.isVisible()) await page.locator(".fc-timegrid-more-link").first().click();
  await expect(repeatEvent).toBeVisible();
  
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/e2e/notification-tick.ts"], {
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e", APP_TIMEZONE: "Asia/Novosibirsk" }, stdio: "pipe",
  });
  await page.reload();
  await expect(page.getByRole("link", { name: /Уведомления: \d+ непрочитанных/ })).toBeVisible();
  await page.getByRole("link", { name: /Уведомления: \d+ непрочитанных/ }).click();
  await expect(page.getByRole("heading", { name: /^Уведомления/ })).toBeVisible();
  await expect(page.locator(`a[href="/tasks/${taskIds.at(-1)}"]`).first()).toBeVisible();
});

test("v2.4.1: чужой клиент недоступен по прямому URL", async ({ page, browser }) => {
  await login(page, "realtor1");
  await page.goto("/clients");
  const created = await page.request.post("/api/v1/clients", { headers: { origin: new URL(page.url()).origin }, data: { displayName: `E2E private ${Date.now()}` } });
  expect(created.status()).toBe(201);
  const href = `/clients/${(await created.json()).id}`;
  expect(href).toMatch(/\/clients\/[0-9a-f-]+$/);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const other = await context.newPage();
    await login(other, "realtor2");
    await other.goto(href!);
    await expect(other).toHaveURL(new RegExp(`${href}$`));
    expect((await other.request.get(`/api/v1${href}`)).status()).toBe(404);
    await expect(other.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
    await expect(other.getByRole("heading", { name: "Запись не найдена или недоступна", exact: true })).toBeVisible();
    await expect(other.locator("body")).toContainText(/не найден|нет доступа|404/i);
  } finally { await context.close(); }
});

test("v2.4.1: настройки ИИ доступны только руководителю", async ({ page, browser }) => {
  await login(page, "realtor1");
  await page.goto("/settings/ai");
  await expect(page).toHaveURL(/\/forbidden/);
  expect((await page.request.get("/api/v1/settings/ai")).status()).toBe(403);
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const manager = await context.newPage();
    await login(manager, "manager");
    await manager.goto("/settings/ai");
    await expect(manager.getByRole("heading", { name: /ИИ/ }).first()).toBeVisible();
  } finally { await context.close(); }
});

test("v2.4.1: частичный отказ площадки сохраняет успешные результаты", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/property-search");
  await expect(page.getByText("Режим тестирования: записанные ответы площадок")).toBeVisible();
  await searchManually(page, "partial");
  await expect(page.locator("strong").filter({ hasText: /^Мир Квартир$/ }).locator("..")).toContainText("Заблокирован");
  await expect(page.locator("strong").filter({ hasText: /^Циан$/ }).locator("..")).toContainText("Получено");
  const reason = page.locator("strong").filter({ hasText: /^Мир Квартир$/ }).locator("..");
  await expect(reason).toBeVisible();
  await expect(reason).toContainText("Записанный ответ: HTTP 429");
  await expect(reason.getByRole("button", { name: "Добавить по ссылке", exact: true })).toBeVisible();
  const runId = new URL(page.url()).searchParams.get("runId");
  const progress = await (await page.request.get(`/api/v1/property-search/runs/${runId}/progress`)).json();
  expect(progress.sources.find((source: {source:string}) => source.source === "mirkvartir").reason).toContain("HTTP 429");
  await expect(page.getByRole("button", { name: "В закладки", exact: true }).first()).toBeVisible();
});
