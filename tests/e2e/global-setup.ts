import { execFileSync } from "node:child_process";
import pg from "pg";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";


export default async function globalSetup() {
  if (new URL(E2E_DB).pathname !== "/crm_e2e") throw new Error("E2E requires isolated crm_e2e database");
  const admin = new pg.Client({ connectionString: E2E_DB.replace(/\/crm_e2e$/, "/crm_test") });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS crm_e2e WITH (FORCE)");
  await admin.query("CREATE DATABASE crm_e2e");
  await admin.end();
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DB,
    APP_TIMEZONE: "Europe/Moscow",
    SEED_MANAGER_PASSWORD: "E2eRukovod2026",
    SEED_REALTOR1_PASSWORD: "E2eAgentOne26",
    SEED_REALTOR2_PASSWORD: "E2eAgentTwo26",
    SEED_MUST_CHANGE_PASSWORD: "false",
    SEED_DEMO_DATA: "true",
  };
  const container = process.env.E2E_DB_CONTAINER ?? "crm-test-testdb-1";
  const schema = execFileSync("docker", ["exec", container, "pg_dump", "-U", "crm", "-d", "crm_demo", "--schema-only", "--no-owner", "--no-privileges"], { maxBuffer: 10 * 1024 * 1024 });
  execFileSync("docker", ["exec", "-i", container, "psql", "-U", "crm", "-d", "crm_e2e", "-v", "ON_ERROR_STOP=1"], { input: schema, stdio: ["pipe", "pipe", "pipe"] });
  execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"], { env, stdio: "pipe" });
  const db = new pg.Client({ connectionString: E2E_DB });
  await db.connect();
  await db.query("UPDATE ai_settings SET scraper_enabled=true, enabled_sources=ARRAY['cian','mirkvartir','avito'], ai_enabled=false");
  await db.end();
}
