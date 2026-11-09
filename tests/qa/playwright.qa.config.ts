import { defineConfig, devices } from "@playwright/test";

/** QA-стенд серверной версии: http://127.0.0.1:3390, БД crm_qa. Сервер уже запущен вручную. */
const PORT = Number(process.env.QA_PORT ?? 3390);
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20000 },
  reporter: [["list"]],
  use: {
    actionTimeout: 25000,
    navigationTimeout: 60000,
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Asia/Novosibirsk",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
