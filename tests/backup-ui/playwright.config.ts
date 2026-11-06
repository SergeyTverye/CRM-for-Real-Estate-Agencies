import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
const root = path.resolve(".");
const mode = process.env.BACKUP_UI_MODE === "desktop" ? "desktop" : "server";
const port = mode === "desktop" ? 3516 : 3515;
const dataRoot = path.join(os.tmpdir(), `crm-backup-ui-${mode}-${process.pid}`);
const databaseUrl = mode === "desktop" ? "file:" + path.join(dataRoot, "crm.db") : "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f";
export default defineConfig({
  metadata: { mode, dataRoot, databaseUrl },
  expect: { timeout: 30000 },
  testDir: "../e2e", testMatch: "backup-settings.spec.ts", globalSetup: "./setup.ts", workers: 1, retries: 0, timeout: 90000,
  reporter: "list", outputDir: "./artifacts/" + mode, use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1000 }, locale: "ru-RU", screenshot: "only-on-failure" },
  webServer: { command: `node node_modules/next/dist/bin/next dev --webpack -p ${port} -H 127.0.0.1`, cwd: root, url: `http://127.0.0.1:${port}/api/health/live`, timeout: 180000, reuseExistingServer: false,
    env: { NODE_OPTIONS: `--require="${path.join(root, "tests/backup-ui/no-private-env.cjs").replaceAll("\\", "/")}"`, BACKUP_UI_TSCONFIG: "tests/backup-ui/tsconfig." + mode + ".json", CRM_DEPLOYMENT_MODE: mode, CRM_DESKTOP_PORT: String(port), NEXT_DIST_DIR: ".next-backup-ui-" + mode, DATABASE_URL: databaseUrl, APP_TIMEZONE: "Asia/Novosibirsk", BACKUP_SETTINGS_MASTER_KEY: randomBytes(32).toString("base64"), BACKUP_SETTINGS_DIR: path.join(dataRoot,"settings"), BACKUP_PATH: path.join(dataRoot,"backups"), FILE_STORAGE_PATH: path.join(dataRoot,"files"), COOKIE_SECURE: "false", AI_ENABLED: "false", SCRAPER_ENABLED: "false", LOG_LEVEL: "silent", NEXT_TELEMETRY_DISABLED: "1" } },
});
