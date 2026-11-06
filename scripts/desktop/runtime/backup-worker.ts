import { setTimeout } from "node:timers/promises";
import { tickBackupWorker } from "../../../src/modules/desktop-backup/application/backup-worker";
import { disconnectDb } from "../../../src/shared/db/client";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());
export async function pumpDesktopBackups(signal: AbortSignal) { await tickBackupWorker(new Date(), signal); }
async function main() {
  try {
    while (!controller.signal.aborted) {
      try { await pumpDesktopBackups(controller.signal); } catch { console.error("BACKUP_QUEUE_RETRY"); }
      if (!controller.signal.aborted) await setTimeout(30000, undefined, { signal: controller.signal }).catch(() => undefined);
    }
  } finally { await disconnectDb(); }
}
if (process.env.CRM_DESKTOP_WORKER === "1") void main().catch(() => { console.error("BACKUP_WORKER_FAILED"); process.exitCode = 1; });
