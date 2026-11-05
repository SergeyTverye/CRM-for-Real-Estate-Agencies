import { defineConfig } from "vitest/config";
import base from "../vitest.config.mts";

// The assigned gallery database is provisioned externally. Do not migrate or reset its schema.
export default defineConfig({ resolve: base.resolve, test: {
  env: base.test?.env, environment: "node", fileParallelism: false, testTimeout: 30_000,
  include: ["tests/unit/property-media*.test.ts", "tests/integration/property-media.test.ts", "tests/authorization/property-media.test.ts"],
} });
