import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("файлы: русский выбор, счётчик, drop и удаление до отправки", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/properties/new");
  const upload = page.getByRole("region", { name: "Загрузка файлов", exact: true });
  await upload.getByLabel("Выбрать фотографии", { exact: true }).setInputFiles([
    { name: "demo-1.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") },
    { name: "demo-2.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") },
  ]);
  await expect(upload.getByText("Выбрано файлов: 2", { exact: true })).toBeVisible();
  await expect(upload.getByAltText("Предпросмотр demo-1.png")).toBeVisible();
  const drop = await page.evaluateHandle(() => { const dt = new DataTransfer(); dt.items.add(new File(["Синтетический документ"], "demo.txt", { type: "text/plain" })); return dt; });
  await upload.getByLabel("Выбрать документы", { exact: true }).locator("..").locator("..").dispatchEvent("drop", { dataTransfer: drop });
  await expect(upload.getByText(/demo.txt ·/)).toBeVisible();
  await upload.getByRole("button", { name: "Убрать", exact: true }).first().click();
  await expect(upload.getByAltText("Предпросмотр demo-1.png")).toHaveCount(0);
  await expect(upload.getByText("Выбрано файлов: 1", { exact: true })).toHaveCount(2);
  await expect(upload).not.toContainText(/Choose Files|No file chosen/);
});

test("календарь: рабочие часы и полные названия событий", async ({ page }) => {
  await login(page, "realtor1");
  await page.goto("/calendar");
  await expect(page.locator('.fc-timegrid-slot[data-time="07:00:00"]').first()).toBeVisible();
  await expect(page.locator('.fc-timegrid-slot[data-time="21:30:00"]').first()).toBeVisible();
  // v3.1 displays the full day so early/late deadlines are not hidden.
  await expect(page.locator('.fc-timegrid-slot[data-time="00:00:00"]').first()).toBeAttached();
  await expect(page.locator('.fc-timegrid-slot[data-time="23:30:00"]').first()).toBeAttached();
  const event = page.locator(".fc-event[title]").first();
  await expect(event).toHaveAttribute("title", /.+/);
  for (const [button, view] of [["День", ".fc-timeGridDay-view"], ["Месяц", ".fc-dayGridMonth-view"], ["Три месяца", ".fc-dayGridQuarter-view"], ["Неделя", ".fc-timeGridWeek-view"]]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator(view!)).toBeVisible();
  }
  await page.getByText("Фильтры и быстрые действия", { exact: true }).click();
  const filtered = page.waitForResponse(r => r.url().includes("/api/v1/calendar?") && new URL(r.url()).searchParams.get("type") === "task", { timeout: 15000 });
  await page.getByRole("combobox", { name: "Тип", exact: true }).selectOption("task");
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  const { items } = await (await filtered).json() as { items: { type: string }[] };
  expect(items.length).toBeGreaterThan(0);
  expect(items.every(item => item.type === "task")).toBeTruthy();
  await page.getByRole("combobox", { name: "Охват", exact: true }).selectOption("employee");
  await expect(page.getByRole("combobox", { name: "Сотрудник планера", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Статус", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/today");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

});

test("поиск: разрешённое фото из CRM в карточке результата", async ({ page }) => {
  await login(page, "realtor1");
  page.on("dialog", () => { throw new Error("Search must use an accessible dialog, never window.prompt"); });
  async function search() {
    await page.goto("/property-search");
    await page.getByLabel("Циан", { exact: true }).check();
    const response = page.waitForResponse(r => r.url().endsWith("/property-search/runs") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Искать", exact: true }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(page.getByRole("region", { name: "Выдача поиска" }).getByText("Завершён", { exact: true })).toBeVisible({ timeout: 60000 });
    await page.getByRole("tab", { name: /^Совпадения/ }).click();
  }
  await search();
  await page.locator("summary").filter({ hasText: /^Ещё$/ }).first().click();
  await page.getByRole("button", { name: "В каталог CRM", exact: true }).first().click();
  const transfer = page.getByRole("dialog", { name: "Перенос в каталог CRM" });
  await expect(transfer.getByLabel("Проверенный адрес")).toBeVisible();
  await transfer.getByLabel(/Я проверил первоисточник/).check();
  await transfer.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(transfer).not.toBeVisible({ timeout: 60000 });
  await page.locator("summary").filter({ hasText: /^Ещё$/ }).first().click();
  const property = page.getByRole("link", { name: "Открыть объект CRM", exact: true }).first();
  await expect(property).toBeVisible();
  await page.goto(`${await property.getAttribute("href")}?tab=photos`);
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#174b61" } }).png().toBuffer();
  await page.getByLabel("Выбрать фотографии", { exact: true }).setInputFiles({ name: "demo-permitted.png", mimeType: "image/png", buffer: image });
  const uploaded = page.waitForResponse(r => /\/properties\/[^/]+\/media$/.test(r.url()) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Загрузить файлы", exact: true }).click();
  expect((await uploaded).ok()).toBeTruthy();
  await search();
  const photo = page.getByRole("img", { name: /^Фото каталога CRM:/ }).first();
  await expect(photo).toBeVisible();
  await expect(photo).toHaveJSProperty("complete", true);
  expect(await photo.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});
