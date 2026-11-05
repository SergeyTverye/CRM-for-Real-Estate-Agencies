import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";
// Existing schema only. In particular, never invoke the repository's migrate/reset global setup.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname,"../src") } },
  test: {
    include: ["tests/integration/calendar-notifications.test.ts", "tests/authorization/calendar-notifications.test.ts"],
    fileParallelism: false, testTimeout: 30000, hookTimeout: 60000,
    env: { NODE_ENV:"test", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f",
      APP_TIMEZONE:"Asia/Novosibirsk", LOG_LEVEL:"silent", FILE_STORAGE_PATH:path.join(os.tmpdir(),"crm-calendar-tests/files"),
      IMPORT_STAGING_PATH:path.join(os.tmpdir(),"crm-calendar-tests/import"), BACKUP_PATH:path.join(os.tmpdir(),"crm-calendar-tests/backups") },
  },
});
