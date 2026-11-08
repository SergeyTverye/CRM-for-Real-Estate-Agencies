import { readFileSync } from "node:fs";
import pg from "pg";
import setup from "./global-setup";

/** The shared setup copies crm_demo's schema, which may predate this branch. */
export default async function prepareAgreementDocuments() {
  await setup();
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_e2e";
  if (new URL(url).pathname !== "/crm_e2e") throw new Error("Requires isolated crm_e2e");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(readFileSync("prisma/migrations/20261108190000_agreement_document_types/migration.sql", "utf8"));
  } finally { await db.end(); }
}
