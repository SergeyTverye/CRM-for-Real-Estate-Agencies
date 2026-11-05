import { defineConfig } from "vitest/config";
import path from "node:path";

// Deliberately do not load tests/setup: crm_demo is a persistent demonstration database.
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: { include: ["scripts/demo/demo.test.ts"], fileParallelism: false, testTimeout: 30000 },
});
