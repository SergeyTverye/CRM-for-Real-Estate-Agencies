import { test, expect } from "@playwright/test";
import { captchaStand } from "../fixtures/captcha-stand/server";

/** DEMO: механика продолжения в той же браузерной сессии (синтетический стенд, без внешних сайтов).
 * Проверяет: needs_user_action → ручной ввод → выдача в том же контексте (cookies),
 * повторный визит использует сессию без повторной проверки.
 */
test.describe("CAPTCHA-стенд DEMO: продолжение в той же сессии", () => {
  test("ручная проверка открывает выдачу и cookies переиспользуются", async ({ page }) => {
    const stand = await captchaStand({ cian: false });
    try {
      await page.goto(`${stand.origin}/check`);
      await expect(page.locator("[data-needs-user-action]")).toBeVisible();
      await expect(page.locator("[data-listing]")).toHaveCount(0);
      await page.locator("input[name=proof]").fill("человек");
      await page.getByRole("button", { name: "Я не робот" }).click();
      await expect(page.locator("[data-listing]")).toBeVisible({ timeout: 10_000 });
      const first = await page.locator("[data-listing]").getAttribute("data-listing");
      expect(first).toBe("synthetic-1");
      // Повторный визит в том же контексте: проверка не повторяется, выдача сразу доступна.
      await page.goto(`${stand.origin}/check`);
      await expect(page.locator("[data-listing]")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("[data-needs-user-action]")).toHaveCount(0);
      expect(stand.stats().proofAccepted).toBe(1);
      expect(stand.stats().verifiedRequests).toBeGreaterThanOrEqual(2);
    } finally {
      await stand.close();
    }
  });

  test("вторая страница после блокировки честно остаётся недоступной", async ({ page }) => {
    const stand = await captchaStand({ cian: false, blockNextPage: true });
    try {
      await page.goto(`${stand.origin}/check`);
      await page.locator("input[name=proof]").fill("человек");
      await page.getByRole("button", { name: "Я не робот" }).click();
      await expect(page.locator("[data-listing]")).toBeVisible({ timeout: 10_000 });
      // Синтетическая вторая страница заблокирована: стенд снова требует проверку.
      await page.goto(`${stand.origin}/cat.php?p=2`);
      await expect(page.locator("[data-needs-user-action]")).toBeVisible({ timeout: 10_000 });
    } finally {
      await stand.close();
    }
  });
});
