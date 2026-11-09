import { expect, test, type Page } from "@playwright/test";
import { PASSWORDS } from "./helpers";

async function login(page: Page, loginName: "manager" | "realtor1") {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const response = await page.request.post("/api/v1/auth/login", { headers: { origin }, data: { login: loginName, password: PASSWORDS[loginName] } });
  expect(response.status()).toBe(200);
  expect((await page.context().cookies()).some(c => c.httpOnly)).toBe(true);
}
test("DEMO: manager backup page, independent destinations and schedule", async ({ page }) => {
  await login(page, "manager"); await page.goto("/settings/backups");
  await expect(page.getByRole("heading", { name: "Локальная установка и резервные копии" })).toBeVisible();
  for (const name of ["Яндекс Облако", "Облако Mail.ru", "USB/HDD", "Локально"]) await expect(page.getByRole("region", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("backup-settings-demo.png"), fullPage: true });
  await page.getByRole("button", { name: "Настроить расписание", exact: true }).click();
  await expect(page.getByLabel("Часовой пояс")).toBeVisible();
  await expect(page.getByRole("button", { name: "Сохранить расписание", exact: true })).toBeVisible();
  await page.getByLabel("Время", { exact: true }).fill("18:45");
  await page.getByRole("button", { name: "Сохранить расписание", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Настройки сохранены" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Настроить расписание", exact: true }).click();
  await expect(page.getByLabel("Время", { exact: true })).toHaveValue("18:45");
});
test("synthetic cloud secrets stay write-only through the UI in both backends", async ({ page }) => {
  await login(page, "manager"); await page.goto("/settings/backups");
  await page.getByRole("button", { name: "Настроить Яндекс Облако", exact: true }).click();
  await page.getByLabel("Включено", { exact: true }).check();
  await page.getByLabel("Bucket", { exact: true }).fill("synthetic-backups");
  await page.getByLabel("Access key ID (новый)", { exact: true }).fill("synthetic-access-id");
  await page.getByLabel("Secret access key", { exact: true }).fill("synthetic-secret-never-return");
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith("/api/v1/settings/backups") && r.request().method() === "PUT"),
    page.getByRole("button", { name: "Сохранить направление", exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toContain("synthetic-access-id"); expect(body).not.toContain("synthetic-secret-never-return");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Настроить Облако Mail.ru", exact: true }).click();
  await page.getByLabel("Включено", { exact: true }).check();
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Пароль внешнего приложения", { exact: true }).fill("synthetic-mail-secret-never-return");
  await page.getByRole("button", { name: "Сохранить направление", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const settings = await page.request.get("/api/v1/settings/backups");
  const text = await settings.text(); expect(text).not.toContain("synthetic-mail-secret-never-return");
  expect((await settings.json()).destinations.filter((d: { enabled: boolean }) => d.enabled)).toHaveLength(2);
  await page.getByRole("button", { name: "Настроить Яндекс Облако", exact: true }).click();
  await expect(page.getByLabel("Access key ID (новый)", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Secret access key", { exact: true })).toHaveValue("");
});
test("DEMO: realtor cannot open backup settings or download archives", async ({ page }) => {
  await login(page, "realtor1");
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByRole("link", { name: "Резервные копии" })).toHaveCount(0);
  await page.goto("/settings/backups"); await expect(page).toHaveURL(/\/forbidden/);
  expect((await page.request.get("/api/v1/settings/backups/control")).status()).toBe(403);
  expect((await page.request.get("/api/v1/settings/backups")).status()).toBe(403);
  expect((await page.request.get("/api/v1/settings/backups/archives/11111111-1111-4111-8111-111111111111")).status()).toBe(403);
});
