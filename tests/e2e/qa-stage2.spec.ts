import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("КП: скачать настоящий многостраничный A4 PDF", async ({ page }) => {
  await login(page, "realtor1");
  const needs = await (await page.request.get("/api/v1/needs")).json();
  const properties = await (await page.request.get("/api/v1/properties")).json();
  const created = await page.request.post("/api/v1/offers", { headers: { origin: new URL(page.url()).origin }, data: {
    clientNeedId: needs.items[0].id, title: "E2E многостраничный PDF",
    items: properties.items.slice(0, 3).map((item: { id: string }) => ({ propertyId: item.id })),
  } });
  expect(created.ok(), await created.text()).toBeTruthy();
  await page.goto(`/offers/${(await created.json()).id}`);
  const response = page.waitForResponse(r => /\/api\/v1\/offers\/[^/]+\/pdf$/.test(r.url()));
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PDF", exact: true }).click();
  const pdfResponse = await response;
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const pdf = Buffer.concat(chunks);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});

test("календарь: сохранить серию по будням и проверить развёрнутые встречи", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "+ Встреча / личная запись", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Заголовок", { exact: false }).fill("E2E по будням");
  await dialog.getByLabel("Начало", { exact: false }).fill("2026-11-09T10:00");
  await dialog.getByRole("textbox", { name: /^Окончание\s*\*?$/ }).fill("2026-11-09T10:30");
  await dialog.getByLabel("Повторение", { exact: true }).selectOption("weekdays");
  await dialog.getByLabel("Окончание серии", { exact: true }).selectOption("count");
  await dialog.getByLabel("Количество встреч в серии", { exact: false }).fill("7");
  const saved = page.waitForResponse(r => r.url().endsWith("/calendar/events") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect(response.request().postDataJSON().recurrenceRule).toContain("BYDAY=MO,TU,WE,TH,FR");
  await expect(dialog).not.toBeVisible();
  const calendar = await page.request.get("/api/v1/calendar?from=2026-11-08T17:00:00Z&to=2026-11-18T17:00:00Z");
  expect(calendar.ok()).toBeTruthy();
  const { items } = await calendar.json();
  const series = items.filter((item: { title: string }) => item.title === "E2E по будням");
  expect(series).toHaveLength(7);
  for (const item of series) expect([0, 6]).not.toContain(new Date(item.start).getUTCDay());
});

test("390px: нижняя панель, создание и карточки списка без переполнения", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "realtor1");
  const bar = page.getByRole("navigation", { name: "Быстрые действия" });
  await expect(bar).toBeVisible();
  const bounds = await bar.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(845);
  await bar.getByRole("button", { name: "+ Создать", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Создать запись" })).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "Клиента", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/new$/);
  await page.goto("/clients");
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
