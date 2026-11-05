import { defineConfig } from "vitest/config";
import base from "../../vitest.config.mts";
// Already migrated database: no generate/migrate or destructive global setup.
export default defineConfig({ resolve: base.resolve, test: { env: { ...base.test?.env, APP_TIMEZONE: "Asia/Novosibirsk" },
  include: ["tests/integration/calendar-agent.test.ts"], fileParallelism: false, testTimeout: 30000, hookTimeout: 60000 } });
