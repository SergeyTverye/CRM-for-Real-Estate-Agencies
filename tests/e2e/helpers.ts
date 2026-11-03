import { expect, type Page } from "@playwright/test";

export const PASSWORDS: Record<string, string> = { manager: "E2eManager2026", realtor1: "E2eAgentOne26", realtor2: "E2eAgentTwo26" };

export async function login(page: Page, loginName: "manager" | "realtor1" | "realtor2") {
  await page.goto("/login");
  await page.getByLabel("Логин").fill(loginName);
  await page.getByLabel("Пароль").fill(PASSWORDS[loginName]!);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/today/);
}
