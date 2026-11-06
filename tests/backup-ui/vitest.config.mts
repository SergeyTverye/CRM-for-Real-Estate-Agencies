import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";
import { testDatabaseUrl } from "./database-setup";

const tmp = path.join(os.tmpdir(), `crm-backup-check-${process.pid}`);
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: {
    include: ["tests/integration/backup-control.test.ts"],
    globalSetup: ["tests/backup-ui/database-setup.ts"],
    environment: "node", fileParallelism: false, maxWorkers: 1, testTimeout: 30000,
    env: { NODE_ENV: "test", CRM_DEPLOYMENT_MODE: "server", DATABASE_URL: testDatabaseUrl,
      FILE_STORAGE_PATH: path.join(tmp, "files"), BACKUP_PATH: path.join(tmp, "backups"),
      BACKUP_SETTINGS_DIR: path.join(tmp, "settings"), LOG_LEVEL: "silent", AI_ENABLED: "false", SCRAPER_ENABLED: "false" },
  },
});
