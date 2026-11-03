import { execSync } from "node:child_process";
import pg from "pg";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";

/** Чистая БД для E2E: пересоздание, миграции, seed (пароли без обязательной смены, демо-данные). */
export default async function globalSetup() {
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
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx prisma db seed", { env, stdio: "pipe" });
}
