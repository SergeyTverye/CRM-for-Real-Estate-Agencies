import { defineConfig } from "vitest/config";
import base from "../vitest.config.mts";
// The assigned crm_test_b database is already migrated. Never run Prisma here.
export default defineConfig({ resolve: base.resolve, test: { env: base.test?.env,
 include: ["tests/unit/p1a.test.ts", "tests/integration/p1a-workflow.test.ts", "tests/authorization/p1a-access.test.ts"],
 fileParallelism: false, testTimeout: 30000, hookTimeout: 60000 } });
