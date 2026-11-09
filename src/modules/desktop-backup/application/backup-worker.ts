import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/shared/db/client";
import { dueBackupSlot } from "../domain/schedule";
import { JsonSettingsRepository } from "../infrastructure/settings-repository";
import { backupRuntimeRoot, runtimeCredentialStore, withBackupDestinations } from "../infrastructure/destinations-runtime";
import { DatabaseReplicationJournal } from "../infrastructure/database-journal";
import { protectedDir } from "../infrastructure/fs";
import { ReplicationQueue } from "./replication-queue";
import { commandRoot } from "./backup-control";

export async function tickBackupWorker(now = new Date(), signal?: AbortSignal) {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") { const { packageServerBackups } = await import("./server-archives"); await packageServerBackups(); }
  const state = await new JsonSettingsRepository(backupRuntimeRoot()).read();
  await withBackupDestinations(async destinations => {
    const journal = new DatabaseReplicationJournal();
    const pending = await journal.read();
    let changed = false;
    for (const d of destinations) {
      if (!pending.rows.some(r => r.destinationId === d.id && r.status === "failed" && r.attempts >= 5 && r.nextAttemptAt <= now.getTime())) continue;
      try { await d.list(); for (const row of pending.rows) if (row.destinationId === d.id && row.status === "failed" && row.attempts >= 5) { row.attempts = 0; row.nextAttemptAt = 0; row.status = "queued"; changed = true; } } catch {  }
    }
    if (changed) await journal.save(pending.revision, pending.rows);
    const queue = new ReplicationQueue(path.join(backupRuntimeRoot(), "queue"), destinations, {}, journal);
    await queue.pump(now.getTime(), signal);
  });
  if (process.env.INSTANCE_ROLE === "standby") return;
  const scheduler = await db.backupQueueJournal.upsert({ where: { id: "scheduler-v1" }, create: { id: "scheduler-v1", payload: { lastSlot: null } }, update: {} });
  const previous = scheduler.payload as { lastSlot: string | null };
  const slot = dueBackupSlot(state.schedule, now, previous.lastSlot);
  if (!slot) return;
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") {
    const credential = await db.backupQueueJournal.findUnique({ where: { id: "server-backup-credential-v1" } });
    if (!credential) return;
    const claimed = await db.backupQueueJournal.updateMany({ where: { id: scheduler.id, revision: scheduler.revision }, data: { revision: { increment: 1 }, payload: { lastSlot: slot } } });
    if (claimed.count !== 1) return;
    const { startManualBackup } = await import("@/modules/operations/application/operations-service");
    try {
      await startManualBackup({ userId: (credential.payload as { actorUserId: string }).actorUserId, role: "manager", sessionId: "backup-worker", login: "backup-worker", displayName: "Планировщик резервирования", mustChangePassword: false }, "scheduled");
    } catch (e) {
      await db.backupQueueJournal.updateMany({ where: { id: scheduler.id, revision: scheduler.revision + 1 }, data: { revision: { increment: 1 }, payload: { lastSlot: previous.lastSlot } } });
      throw e;
    }
    return;
  }
  let credentialRef: string;
  try { credentialRef = JSON.parse(await readFile(path.join(process.env.DESKTOP_DATA_DIR!, "portable-credential.json"), "utf8")).secretRef; } catch { return; }
  await protectedDir(commandRoot());
  if ((await readdir(commandRoot())).some(n => /^[a-f0-9-]{36}\.json$/.test(n))) return;
  const claimed = await db.backupQueueJournal.updateMany({ where: { id: scheduler.id, revision: scheduler.revision }, data: { revision: { increment: 1 }, payload: { lastSlot: slot } } });
  if (claimed.count !== 1) return;
  const ref = randomUUID(), id = randomUUID();
  try {
    await runtimeCredentialStore().put(ref, await runtimeCredentialStore().get(credentialRef));
    await writeFile(path.join(commandRoot(), id + ".json"), JSON.stringify({ id, secretRef: ref, command: { action: "create", recoveryKeySaved: true }, createdAt: now.toISOString(), trigger: "scheduled" }), { flag: "wx", mode: 0o600 });
  } catch {
    await db.backupQueueJournal.updateMany({ where: { id: scheduler.id, revision: scheduler.revision + 1 }, data: { revision: { increment: 1 }, payload: { lastSlot: previous.lastSlot } } });
    throw new Error("BACKUP_SCHEDULE_PUBLICATION_FAILED");
  }
}
