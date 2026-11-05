import { expect, type Page } from "@playwright/test";

export const PASSWORDS: Record<string, string> = { manager: "E2eRukovod2026", realtor1: "E2eAgentOne26", realtor2: "E2eAgentTwo26" };

export async function login(page: Page, loginName: "manager" | "realtor1" | "realtor2") {
  await page.goto("/login");
  // The SSR form is interactive only after React attaches its submit handler.
  await page.waitForFunction(() => Object.keys(document.querySelector("form") ?? {}).some(key => key.startsWith("__reactProps")));
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill(PASSWORDS[loginName]!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/today/, { timeout: 60000 });
}
