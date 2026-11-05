import { defineConfig } from "vitest/config";
import base from "../vitest.config.mts";
// Dedicated provisioned DB. No global setup: schema/generation/migrations are owned by another agent.
export default defineConfig({ resolve: base.resolve, test: {
  env: { ...base.test?.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_d",
    AI_ENABLED: "true", APP_TIMEZONE: "Asia/Novosibirsk", YANDEX_AI_MAX_MONTHLY_COST_RUB: "1000" },
  include: ["tests/integration/ai-persistence.test.ts", "tests/authorization/ai-settings.test.ts", "tests/unit/ai/**/*.test.ts"],
  environment: "node", fileParallelism: false, testTimeout: 30000, hookTimeout: 60000,
} });
