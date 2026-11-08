import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL } from "./test-env";

/**
 * Готовит отдельную тестовую БД: пересоздаёт схему и применяет все миграции с нуля
 * (заодно проверяет критерий «миграции применяются к чистой БД»).
 */
export default async function setup() {
  const url = TEST_DATABASE_URL;
  if (!/crm_test|_test\b|test/.test(url)) throw new Error(`Отказ: DATABASE_URL не похож на тестовую БД: ${url}`);
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(
      `Тестовая PostgreSQL недоступна (${(e as Error).message}). Запустите: docker compose -f compose.test.yaml up -d --wait`,
    );
  }
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy --config prisma.test.config.ts", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
