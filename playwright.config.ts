import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E/smoke (ТЗ 10, 31.1): production-сборка приложения на отдельной БД crm_e2e
 * (подготавливается tests/e2e/global-setup.ts: чистая схема → миграции → seed с демо-данными).
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";

export const E2E_PASSWORDS = {
  manager: "E2eManager2026",
  realtor1: "E2eAgentOne26",
  realtor2: "E2eAgentTwo26",
};

const serverEnv = {
  NODE_ENV: "production",
  DATABASE_URL: E2E_DB,
  APP_TIMEZONE: "Europe/Moscow",
  DEPLOYMENT_ID: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  INSTANCE_ID: "e2e",
  FILE_STORAGE_PATH: "./data/e2e/files",
  IMPORT_STAGING_PATH: "./data/e2e/import-staging",
  BACKUP_PATH: "./data/e2e/backups",
  COOKIE_SECURE: "false",
  LOG_LEVEL: "warn",
  PORT: String(PORT),
};

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health/live`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: serverEnv,
  },
});
