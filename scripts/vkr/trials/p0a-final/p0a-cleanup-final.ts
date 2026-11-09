import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { db, disconnectDb } from "../../../../src/shared/db/client";
config({ path: [".env.local", ".env"], quiet: true });
process.env.DATABASE_URL = "postgresql://crm:crm_test_password@127.0.0.1:55432/crm_demo";
async function main() {
  const evidence = JSON.parse(await readFile("docs/vkr/p0a-final-ai.json", "utf8"));
  const rows = await db.user.findMany({ where: { displayName: { in: ["Приёмка P0-A", "Приёмка P0-A: площадь"] }, createdAt: { gte: new Date("2026-11-06T01:34:00Z") } }, select: { id: true, isActive: true } });
  const userIds = rows.map(r => r.id);
  const activeSessions = await db.userSession.count({ where: { OR: [{ userId: { in: userIds } }, { userAgent: "P0-A final acceptance", createdAt: { gte: new Date("2026-11-06T01:34:00Z") } }], revokedAt: null } });
  const settings = await db.aiSetting.findFirstOrThrow();
  const cleanup = { at: new Date().toISOString(), temporaryUsers: rows.length, activeTemporaryUsers: rows.filter(r => r.isActive).length, activeTemporarySessions: activeSessions, monthlyBudgetRub: settings.monthlyBudgetRub.toString(), perJobLimit: settings.perJobLimit, settingsMatchInitial: settings.monthlyBudgetRub.toString() === evidence.settingsBefore.monthlyBudgetRub && settings.perJobLimit === evidence.settingsBefore.perJobLimit, database: "crm_demo", paidTrials: ["p0a-final-ai.json", "p0a-final-parse.json"], sourceHttpAttempts: JSON.parse(await readFile("tests/fixtures/scraper/p0a-final/ledger.json", "utf8")).attempts.length };
  await writeFile("docs/vkr/p0a-final-cleanup.json", JSON.stringify(cleanup, null, 2) + "\n");
  console.log(JSON.stringify(cleanup));
  if (cleanup.activeTemporaryUsers || activeSessions || !cleanup.settingsMatchInitial) throw Error("Cleanup audit failed");
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Audit failed"); process.exitCode = 1; }).finally(disconnectDb);
