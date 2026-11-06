import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("v3.1: планер переключает четыре периода и получает серверные агрегаты", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Планер", exact: true })).toBeVisible();
  for (const label of ["День", "Неделя", "Месяц", "Три месяца"]) {
    const loaded = page.waitForResponse(r => r.url().includes(label === "Три месяца" ? "/api/v1/calendar/aggregate?" : "/api/v1/calendar?") && r.ok());
    await page.getByRole("button", { name: label, exact: true }).click();
    const response = await loaded;
    const data = await response.json();
    expect(Array.isArray(label === "Три месяца" ? data.days : data.items)).toBe(true);
    await expect(page.getByText(/^Событий в периоде:/)).toBeVisible();
  }
});

test("v3.1: ручной звонок без клиента сохраняет итог и источник", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/requests/new");
  await page.getByRole("radiogroup", { name: "Клиент", exact: true }).getByText("Без клиента", { exact: true }).click();
  await page.getByRole("radiogroup", { name: "Результат", exact: true }).getByText("Ошибочное/спам", { exact: true }).click();
  await page.getByLabel(/^Канал/).selectOption("phone");
  await page.getByLabel(/^Источник/).selectOption({ index: 1 });
  const summary = `Синтетический спам release ${Date.now()}`;
  await page.getByLabel("Кратко: что хотел клиент, о чём договорились").fill(summary);
  const saved = page.waitForResponse(r => r.url().endsWith("/api/v1/requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Зарегистрировать обращение", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect((await response.json()).clientId).toBeNull();
  await expect(page.getByText("Обращение зарегистрировано.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Обращение", exact: true }).click();
  await expect(page.getByText(summary, { exact: true })).toBeVisible();
});

test("v3.1: независимая подборка сохраняется и экспортируется без клиента", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/collections");
  const name = `Release подборка ${Date.now()}`;
  await page.getByLabel("Название подборки", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Создать подборку", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const csv = await page.request.get(await page.getByRole("link", { name: "Экспорт CSV", exact: true }).getAttribute("href") ?? "");
  expect(csv.ok()).toBe(true);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect((await csv.body()).length).toBeGreaterThan(0);
});

test("v3.1: руководитель вводит шаблон без перезапуска и скачивает DOCX", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/templates");
  await page.getByRole("button", { name: "Загрузить шаблон", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const name = `Release шаблон ${Date.now()}`;
  await dialog.getByLabel("Стабильный код").fill(`release_${Date.now()}`);
  await dialog.getByLabel("Название", { exact: true }).fill(name);
  const saved = page.waitForResponse(r => r.url().endsWith("/api/v1/templates") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Проверить и сохранить", exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  const href = await row.getByRole("link", { name: "Проверить / скачать предпросмотр", exact: true }).getAttribute("href");
  const preview = await page.request.get(href!);
  expect(preview.ok()).toBe(true);
  expect(preview.headers()["content-type"]).toContain("wordprocessingml");
  expect((await preview.body()).subarray(0, 2).toString()).toBe("PK");
});
