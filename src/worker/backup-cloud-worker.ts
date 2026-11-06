import { setTimeout } from "node:timers/promises";
import { tickBackupWorker } from "../modules/desktop-backup/application/backup-worker";
import { disconnectDb } from "../shared/db/client";
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => controller.abort());
async function main() {
  while (!controller.signal.aborted) {
    try { await tickBackupWorker(new Date(), controller.signal); } catch { console.error("BACKUP_QUEUE_RETRY"); }
    if (!controller.signal.aborted) await setTimeout(30000, undefined, { signal: controller.signal }).catch(() => undefined);
  }
  await disconnectDb();
}
void main();
