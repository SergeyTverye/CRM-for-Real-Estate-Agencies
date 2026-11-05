import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src") } },
  test: { include: ["scripts/vkr/display-regressions.test.ts"], env: { LOG_LEVEL: "silent", AI_ENABLED: "false" } },
});
