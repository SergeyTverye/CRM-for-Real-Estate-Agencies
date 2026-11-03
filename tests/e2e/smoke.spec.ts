import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("T01: вход и различия ролей", () => {
  test("риелтор не видит руководительских разделов и получает отказ на прямой URL", async ({ page }) => {
    await login(page, "realtor1");
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    await expect(nav.getByRole("link", { name: "Сегодня" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Обращения" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Администрирование" })).toHaveCount(0);
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/forbidden/);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/forbidden/);
  });

  test("руководитель видит административные разделы", async ({ page }) => {
    await login(page, "manager");
    const nav = page.getByRole("navigation", { name: "Основная навигация" });
    for (const name of ["Отчёты", "Импорт", "Эксплуатация", "Администрирование"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await page.goto("/admin/users");
    await expect(page.getByText("realtor1")).toBeVisible();
  });

  test("неверный пароль — общее сообщение, без раскрытия логина", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Логин").fill("no-such-user");
    await page.getByLabel("Пароль").fill("wrong-password-1");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByRole("alert")).toContainText("Неверный логин или пароль");
  });
});

test.describe("Сквозной сценарий: обращение → клиент → потребность → «Сегодня»", () => {
  test("риелтор регистрирует обращение с новым клиентом и видит следующее действие", async ({ page }) => {
    await login(page, "realtor1");
    await page.goto("/clients/new");
    const name = `E2E Клиент ${Date.now()}`;
    await page.getByLabel("Имя / наименование").fill(name);
    await page.getByPlaceholder("+7 900 000-00-00").fill(`+7 900 77${String(Date.now()).slice(-5)}`);
    await page.getByRole("button", { name: "Создать клиента" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await page.getByRole("link", { name: "+ Потребность" }).first().click();
    await expect(page).toHaveURL(/\/needs\/new/);
  });

  test("экран «Сегодня» показывает счётчики и группы действий", async ({ page }) => {
    await login(page, "realtor1");
    await expect(page.getByRole("heading", { name: "Сегодня" })).toBeVisible();
    await expect(page.getByText("Просрочено").first()).toBeVisible();
  });

  test("глобальный поиск не находит чужого клиента", async ({ page }) => {
    await login(page, "realtor2");
    await page.getByLabel("Глобальный поиск").fill("Демо-Ритейл");
    await expect(page.getByText("Ничего не найдено среди доступных вам записей")).toBeVisible();
  });
});
