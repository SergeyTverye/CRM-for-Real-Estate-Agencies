import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E/smoke (ТЗ 10, 31.1): production-сборка приложения на отдельной БД crm_e2e
 * (global-setup: копия применённой схемы crm_demo → seed с демо-данными; без migrate/generate).
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const HOST = process.env.E2E_DEV === "true" ? "localhost" : "127.0.0.1";
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";

export const E2E_PASSWORDS = {
  manager: "E2eRukovod2026",
  realtor1: "E2eAgentOne26",
  realtor2: "E2eAgentTwo26",
};

const serverEnv = {
  NODE_ENV: process.env.E2E_DEV === "true" ? "development" : "production",
  DATABASE_URL: E2E_DB,
  APP_TIMEZONE: "Asia/Novosibirsk",
  DEPLOYMENT_ID: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  INSTANCE_ID: "e2e",
  FILE_STORAGE_PATH: "./data/e2e/files",
  IMPORT_STAGING_PATH: "./data/e2e/import-staging",
  BACKUP_PATH: "./data/e2e/backups",
  COOKIE_SECURE: "false",
  LOG_LEVEL: "warn",
  SCRAPER_DEMO_FIXTURES: "true",
  SCRAPER_ENABLED: "true",
  AI_ENABLED: "false",
  YANDEX_WEB_SEARCH_ENABLED: "false",
  PORT: String(PORT),
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    actionTimeout: 20000,
    navigationTimeout: 60000,
    baseURL: `http://${HOST}:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Asia/Novosibirsk",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: process.env.E2E_DEV === "true" ? `npx next dev --webpack -p ${PORT}` : `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health/live`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: serverEnv,
  },
});
