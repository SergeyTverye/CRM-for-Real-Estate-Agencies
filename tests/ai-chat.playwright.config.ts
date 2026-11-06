import { defineConfig, devices } from "@playwright/test";

/** Existing crm_demo only; no database reset, server spawn, traces or AI calls. */
export default defineConfig({
    testDir: "./e2e", testMatch: "ai-chat.ui.spec.ts", workers: 1, retries: 0,
    timeout: 90_000, expect: { timeout: 15_000 }, reporter: "list",
    use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3450", viewport: { width: 1440, height: 900 },
        locale: "ru-RU", timezoneId: "Asia/Novosibirsk", trace: "off", screenshot: "off", navigationTimeout: 60_000 },
});
