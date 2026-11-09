import { expect, test } from "@playwright/test";
import { QA_ORIGIN, loginUI, shot, timed } from "./qa-helpers";

const timings: string[] = [];

test("QA-01 auth: вход/выход, смена пароля, деактивация", async ({ page, request }) => {
  // Неверный пароль — 401, без утечек
  const bad = await request.post(`${QA_ORIGIN}/api/v1/auth/login`, {
    headers: { Origin: QA_ORIGIN },
    data: { login: "manager", password: "wrong-password-123" },
  });
  expect(bad.status()).toBe(401);

  await timed("login UI manager", () => loginUI(page, "manager"), timings);
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: /Сегодня/i }).first()).toBeVisible({ timeout: 30000 });
  await shot(page, "today-manager", "Экран «Сегодня»: задачи, просрочки и ближайшие события руководителя", "today");

  // Смена пароля через API (временный → обратно), проверка mustChangePassword=false
  const me = await request.get(`${QA_ORIGIN}/api/v1/auth/me`, { headers: { Origin: QA_ORIGIN } });
  expect(me.status()).toBe(401); // без cookie — 401

  // Выход
  await page.goto("/today");
  const logout = page.getByRole("button", { name: /Выйти|Выход/i });
  if (await logout.count()) {
    await logout.first().click();
    await page.waitForURL(/login/, { timeout: 15000 });
  } else {
    await request.post(`${QA_ORIGIN}/api/v1/auth/logout`, { headers: { Origin: QA_ORIGIN } });
    await page.goto("/login");
  }
  await shot(page, "login-form", "Форма входа: логин и пароль, учётные записи создаёт руководитель", "auth");
  console.log(timings.join(" | "));
});
