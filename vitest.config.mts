import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

/**
 * Unit — чистая бизнес-логика без БД.
 * Integration / authorization — реальная PostgreSQL 18 (compose.test.yaml, БД crm_test),
 * последовательно в одном процессе: файлы делят одну тестовую БД.
 */

// Должен совпадать с tests/helpers/test-env.ts (глобальная подготовка БД).
const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test";
const tmp = path.join(os.tmpdir(), `crm-test-${process.pid}`);

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  CRM_DEPLOYMENT_MODE: "server",
  DATABASE_URL: TEST_DB,
  APP_TIMEZONE: "Asia/Novosibirsk",
  FILE_STORAGE_PATH: path.join(tmp, "files"),
  IMPORT_STAGING_PATH: path.join(tmp, "import-staging"),
  BACKUP_PATH: path.join(tmp, "backups"),
  LOG_LEVEL: "silent",
  AI_ENABLED: "false",
  SCRAPER_ENABLED: "false",
  SCRAPER_DEMO_FIXTURES: "false",
  MAX_UPLOAD_MB: "2",
};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    env,
    // All database projects share one database and reset their fixtures.
    fileParallelism: false,
    maxWorkers: 1,
    projects: [
      { extends:true, test:{name:"desktop-transfer",include:["tests/desktop-transfer/**/*.test.ts"],globalSetup:["tests/helpers/global-setup.ts"],environment:"node",testTimeout:120000,hookTimeout:60000} },
      { extends: true, test: { name: "integration-sqlite", include: ["tests/sqlite/**/*.test.ts", "tests/integration/**/*.test.ts", "tests/authorization/**/*.test.ts"], exclude: ["tests/integration/browser-sessions/browser-cycle.test.ts"], globalSetup: ["tests/sqlite/global-setup.ts"], setupFiles: ["tests/sqlite/setup.ts"], environment: "node", testTimeout: 30000, hookTimeout: 60000, env: { CRM_DEPLOYMENT_MODE: "desktop", SQLITE_TEST_TEMPLATE: path.join(tmp, "sqlite-template.db") } } },
      {
        extends: true,
        test: { name: "unit", testTimeout: 15000, include: ["tests/unit/**/*.test.ts", "scripts/vkr/display-regressions.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "browser-cycle",
          include: ["tests/integration/browser-sessions/browser-cycle.test.ts"],
          environment: "node",
          testTimeout: 45_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "demo",
          include: ["scripts/demo/demo.test.ts"],
          environment: "node",
          env: { DATABASE_URL: process.env.DEMO_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo", FILE_STORAGE_PATH: "./data/demo/files" },
          testTimeout: 30_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: ["tests/integration/browser-sessions/browser-cycle.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "authorization",
          include: ["tests/authorization/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
