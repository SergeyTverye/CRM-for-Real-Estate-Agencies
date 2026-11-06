/** Temporary executable interface; bundler prefers scripts/desktop/init-db.ts.
 * Use official Prisma migration history, never a parallel migration ledger. */
import { applySqliteMigrations } from "../database-lifecycle";
export async function initializeDesktopDatabase() {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") throw Error("DESKTOP_REQUIRED");
  const file = process.env.DATABASE_URL?.replace(/^file:/, "");
  if (!file) throw Error("DATABASE_URL_REQUIRED");
  applySqliteMigrations(file);
}
if (process.argv.includes("--initialize")) initializeDesktopDatabase().catch(() => { console.error("INIT_DATABASE_FAILED"); process.exitCode = 1; });
