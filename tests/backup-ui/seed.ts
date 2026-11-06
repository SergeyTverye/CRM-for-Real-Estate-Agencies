import { db, disconnectDb } from "../../src/shared/db/client";
import { hashPassword } from "../../src/modules/auth/infrastructure/password-hasher";
import { applySqliteMigrations } from "../../scripts/desktop/database-lifecycle";
import { mkdir } from "node:fs/promises";
import path from "node:path";

async function main() {
  if (process.env.CRM_DEPLOYMENT_MODE === "desktop") {
    const root = process.env.BACKUP_UI_DATA_ROOT!;
    await mkdir(root, { recursive: true });
    applySqliteMigrations(path.join(root, "crm.db"));
  } else if (process.env.DATABASE_URL !== "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_test_f") {
    throw new Error("BACKUP_TEST_DATABASE_REQUIRED");
  }
  try {
    for (const [login, roleCode, password] of [["manager", "manager", "E2eRukovod2026"], ["realtor1", "realtor", "E2eAgentOne26"]]) {
      await db.user.create({ data: { login: login!, roleCode: roleCode!, displayName: "Synthetic " + login, passwordHash: await hashPassword(password!) } });
    }
  } finally { await disconnectDb(); }
}
void main();
