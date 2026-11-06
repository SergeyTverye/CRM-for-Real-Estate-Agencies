import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

export const testDatabaseUrl = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f";
export default async function setupDatabase() {
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try { await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"); }
  finally { await client.end(); }
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "tests/backup-ui/prisma.config.ts"], {
    cwd: path.resolve("."), stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
}
