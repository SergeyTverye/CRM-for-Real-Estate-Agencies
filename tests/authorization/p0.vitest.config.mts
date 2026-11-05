import { defineConfig } from "vitest/config";
import base from "../../vitest.config.mts";

// The assigned database is already provisioned by the schema agent. Never migrate it here.
export default defineConfig({
  resolve: base.resolve,
  test: {
    env: base.test?.env,
    include: ["tests/authorization/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
