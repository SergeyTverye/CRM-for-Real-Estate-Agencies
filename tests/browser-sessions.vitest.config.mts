import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } },
  test: { environment: "node", include: ["tests/unit/browser-sessions/**/*.test.ts", "tests/integration/browser-sessions/**/*.test.ts"],
    fileParallelism: false, maxWorkers: 1, testTimeout: 45_000, hookTimeout: 30_000,
    env: { NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_c", APP_TIMEZONE: "Asia/Novosibirsk" },
  },
});
