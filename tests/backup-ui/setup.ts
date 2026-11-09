import setupDatabase, { testDatabaseUrl } from "./database-setup";
import type { FullConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
export default async function setup(config: FullConfig) {
  const { mode, dataRoot, databaseUrl } = config.metadata as { mode: string; dataRoot: string; databaseUrl: string };
  process.env.DATABASE_URL = databaseUrl;
  process.env.CRM_DEPLOYMENT_MODE = mode;
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.LOG_LEVEL = "silent";
  if (mode !== "desktop") {
    if (databaseUrl !== testDatabaseUrl) throw new Error("BACKUP_TEST_DATABASE_REQUIRED");
    await setupDatabase();
  }
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tests/backup-ui/seed.ts"], {
    env: { ...process.env, BACKUP_UI_DATA_ROOT: dataRoot }, stdio: "pipe",
  });
}
