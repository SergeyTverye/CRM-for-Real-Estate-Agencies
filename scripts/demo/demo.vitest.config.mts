import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/crm_demo") throw new Error("Explicit crm_demo required");
// Read-only acceptance of the actual seed storage; never use integration global setup.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: { include: ["scripts/demo/demo.test.ts"], environment: "node", fileParallelism: false, maxWorkers: 1, testTimeout: 30000,
    env: { NODE_ENV: "test", DATABASE_URL: process.env.DATABASE_URL, FILE_STORAGE_PATH: process.env.FILE_STORAGE_PATH ?? "./data/files", LOG_LEVEL: "silent" } },
});
