import { defineConfig, devices } from "@playwright/test";

/** Десктоп-QA: supervisor собранного пакета, URL из DESKTOP_QA_URL. Сервер уже запущен harness-скриптом. */
const URL = process.env.DESKTOP_QA_URL ?? "http://127.0.0.1:3390";
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
    baseURL: URL,
    locale: "ru-RU",
    timezoneId: "Asia/Novosibirsk",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } }],
});
