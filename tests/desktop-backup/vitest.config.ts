import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@": path.resolve("src") } }, test: { include: ["tests/desktop-backup/*.test.ts"], environment: "node", fileParallelism: false, maxWorkers: 1, testTimeout: 60000, hookTimeout: 120000 } });
