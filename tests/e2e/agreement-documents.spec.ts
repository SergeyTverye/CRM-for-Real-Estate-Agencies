import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic agreement") });

test("договор с файлом, допсоглашение, защищённое скачивание и архив", async ({ page }) => {
  await login(page, "realtor1");
  const clientResponse = await page.request.post("/api/v1/clients", { headers: { origin: new URL(page.url()).origin }, data: { displayName: "Синтетический клиент документов", clientKind: "person", contacts: [{ contactType: "email", value: `docs-${Date.now()}@example.test` }] } });
  expect(clientResponse.status()).toBe(201);
  const client = await clientResponse.json();
  await page.goto(`/agreements/new?clientId=${client.id}`);
  await page.getByLabel("Номер", { exact: true }).fill(`E2E-DOC-${Date.now()}`);
  await page.getByLabel("Выбрать файлы договора").setInputFiles(pdf("договор.pdf"));
  await page.getByRole("button", { name: "Создать договор", exact: true }).click();
  await expect(page).toHaveURL(/\/agreements\/[^/]+#documents$/, { timeout: 60000 });
  const documents = page.getByRole("region", { name: "Документы договора" });
  await expect(documents.getByRole("link", { name: "договор.pdf", exact: true })).toBeVisible();
  await documents.getByRole("button", { name: "+ Загрузить" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Тип документа").selectOption("agreement_addendum");
  await modal.getByLabel("Выбрать документы").setInputFiles(pdf("допсоглашение.pdf"));
  await modal.getByRole("button", { name: "Загрузить", exact: true }).click();
  const row = documents.getByRole("row").filter({ hasText: "допсоглашение.pdf" });
  await expect(row).toContainText("Дополнительное соглашение");
  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("link", { name: "допсоглашение.pdf" }).click();
  const downloaded = await downloadPromise;
  expect(downloaded.suggestedFilename()).toBe("допсоглашение.pdf");
  expect(await downloaded.failure()).toBeNull();
  await row.getByRole("button", { name: "В архив" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Подтвердить" }).click();
  await expect(row).toHaveCount(0);
  await expect(documents.getByRole("link", { name: "договор.pdf", exact: true })).toBeVisible();
});

test("сбой сохранения сохраняет файлы, сбой загрузки позволяет повторить без нового договора", async ({ page }) => {
  await login(page, "realtor1");
  const clientResponse = await page.request.post("/api/v1/clients", { headers: { origin: new URL(page.url()).origin }, data: { displayName: "Синтетический клиент повтора", clientKind: "person", contacts: [{ contactType: "email", value: `retry-${Date.now()}@example.test` }] } });
  expect(clientResponse.status()).toBe(201);
  const client = await clientResponse.json();
  await page.goto(`/agreements/new?clientId=${client.id}`);
  await page.getByLabel("Выбрать файлы договора").setInputFiles([pdf("основной.pdf"), pdf("повтор.pdf")]);
  let saves = 0;
  await page.route("**/api/v1/agreements", async route => {
    if (route.request().method() !== "POST") return route.continue();
    saves += 1;
    if (saves === 1) return route.fulfill({ status: 400, json: { error: { code: "VALIDATION_ERROR", message: "Синтетическая ошибка сохранения" } } });
    return route.continue();
  });
  let uploads = 0;
  await page.route("**/api/v1/documents", async route => {
    if (route.request().method() !== "POST") return route.continue();
    uploads += 1;
    if (uploads === 2) return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Синтетический сбой загрузки" } } });
    return route.continue();
  });
  await page.getByRole("button", { name: "Создать договор", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Синтетическая ошибка сохранения" }).first()).toBeVisible();
  expect(uploads).toBe(0);
  await expect(page.getByText("Выбрано файлов: 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Создать договор", exact: true }).click();
  await expect(page.getByText("Договор сохранён.", { exact: false })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "повтор.pdf" })).toContainText("Синтетический сбой загрузки");
  await page.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(page).toHaveURL(/\/agreements\/[^/]+#documents$/, { timeout: 60000 });
  expect(saves).toBe(2);
  expect(uploads).toBe(3);
  const documents = page.getByRole("region", { name: "Документы договора" });
  await expect(documents.getByRole("link", { name: "основной.pdf" })).toBeVisible();
  await expect(documents.getByRole("link", { name: "повтор.pdf" })).toBeVisible();
});
