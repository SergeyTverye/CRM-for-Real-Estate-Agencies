import { defineConfig } from "vitest/config";
import path from "node:path";
// Deliberately no globalSetup: shared-worktree contract prohibits generate/migrate.
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("/crm_test_c")) throw new Error("Use assigned TEST_DATABASE_URL ending /crm_test_c");
export default defineConfig({ resolve: { alias: { "@": path.resolve(import.meta.dirname, "../src") } }, test: {
  include: ["tests/integration/property-search.test.ts", "tests/authorization/property-search.test.ts", "tests/unit/property-search/regressions.test.ts"],
  fileParallelism: false, testTimeout: 30000, hookTimeout: 60000,
  env: { NODE_ENV: "test", DATABASE_URL: url, LOG_LEVEL: "silent", APP_TIMEZONE: "Asia/Novosibirsk", AI_ENABLED: "false", SCRAPER_ENABLED: "true", SCRAPER_DEMO_FIXTURES: "false" },
} });
