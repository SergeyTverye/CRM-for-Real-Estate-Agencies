import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "@/shared/db/client";
import { createArchive, extractArchive, type Credential } from "../infrastructure/archive";
import { atomicJson, protectedDir, regularFile } from "../infrastructure/fs";
import { backupRuntimeRoot, runtimeCredentialStore, withBackupDestinations } from "../infrastructure/destinations-runtime";
import { DatabaseReplicationJournal } from "../infrastructure/database-journal";
import { archiveRoot } from "./backup-control";
import { ReplicationQueue } from "./replication-queue";
import { BackupError, archiveRefSchema } from "../domain/contracts";
const execute = promisify(execFile);
export const pgDumpValidator = { async validate(file: string) { await execute("pg_restore", ["--list", file], { timeout: 120000, maxBuffer: 32 * 1024 ** 2, windowsHide: true }); } };
function uuidFor(value: string) { const h = createHash("sha256").update(value).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; }
/** Replicate only immutable, completed existing ops backups. No live SQLite dependency. */
export async function packageServerBackups() {
  const configured = await db.backupQueueJournal.findUnique({ where: { id: "server-backup-credential-v1" } });
  if (!configured) return;
  const secret = await runtimeCredentialStore().get((configured.payload as { secretRef: string }).secretRef);
  const converted = new Set<string>();
  for (const name of await readdir(archiveRoot()).catch(() => [])) {
    if (!/^[a-f0-9-]{36}\.crmbackup\.json$/.test(name)) continue;
    const data = JSON.parse(await readFile(path.join(archiveRoot(), name), "utf8"));
    if (typeof data.serverBackupId === "string") {
      const archive = archiveRefSchema.parse(data.archive);
      // Recover a crash between publishing the immutable archive and enqueuing it.
      await withBackupDestinations(async destinations => {
        const queue = new ReplicationQueue(path.join(backupRuntimeRoot(), "queue"), destinations, {}, new DatabaseReplicationJournal());
        await queue.enqueue(archive, path.join(archiveRoot(), archive.backupId + ".crmbackup"));
      });
      converted.add(data.serverBackupId);
    }
  }
  const runs = await db.backupRun.findMany({ where: { localStatus: "success" }, orderBy: { startedAt: "desc" }, take: 20 });
  for (const run of runs) {
    if (converted.has(run.backupId) || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(run.backupId)) continue;
    const source = path.join(path.resolve(process.env.BACKUP_PATH ?? "backups"), run.backupId);
    const staging = path.join(backupRuntimeRoot(), "server-staging"); await protectedDir(staging);
    const stage = await mkdtemp(path.join(staging, "ops-"));
    try {
      // Validate the existing bundle using the existing toolchain before wrapping it.
      await execute("bash", [path.resolve("ops/backup/scripts/verify.sh"), run.backupId], { env: { ...process.env, BACKUP_DIR: path.resolve(process.env.BACKUP_PATH ?? "backups") }, timeout: 600000, maxBuffer: 1024 ** 2, windowsHide: true });
      for (const name of ["files.tar.zst", "files.sha256", "manifest.json", "checksums.sha256"]) { await regularFile(path.join(source, name)); await copyFile(path.join(source, name), path.join(stage, name)); }
      const result = await createArchive({ databaseKind: "postgres", outputDir: archiveRoot(), stagingRoot: staging, validator: pgDumpValidator,
        source: { async createConsistentSnapshot(dest) { await regularFile(path.join(source, "database.dump")); await copyFile(path.join(source, "database.dump"), dest); } },
        // The input is the already completed immutable pg_dump/files bundle, never live DB/storage.
        barrier: { run: work => work() }, metadata: { deploymentId: run.deploymentId, instanceId: uuidFor(process.env.INSTANCE_ID ?? "server"), deviceId: uuidFor(process.env.INSTANCE_ID ?? "server"), snapshotRevision: run.startedAt.getTime(), parentBackupId: null, crmVersion: run.appVersion ?? "server", schemaVersion: 1 },
        passphrase: secret.passphrase!, recoveryKey: secret.recoveryKey!, recoveryKeySaved: true, settings: { timeZone: process.env.APP_TIMEZONE }, storage: { documents: stage },
      });
      await atomicJson(result.path + ".json", { archive: result.archive, serverBackupId: run.backupId, format: "postgres-ops-v1" });
      await withBackupDestinations(async destinations => { const queue = new ReplicationQueue(path.join(backupRuntimeRoot(), "queue"), destinations, {}, new DatabaseReplicationJournal()); await queue.enqueue(result.archive, result.path); });
    } finally { await rm(stage, { recursive: true, force: true }); }
    break; // Bounded: at most one completed ops generation is packaged per worker tick.
  }
}
export async function verifyServerPortable(file: string, credential: Credential) {
  const checked = await extractArchive({ archivePath: file, credential, validator: pgDumpValidator, schemaVersion: 1, stagingRoot: path.join(backupRuntimeRoot(), "server-staging") });
  try { if (!checked.manifest.components.includes("postgres")) throw new BackupError("SERVER_ARCHIVE_REQUIRED"); return { verified: true, backupId: archiveRefSchema.shape.backupId.parse(checked.manifest.backupId) }; }
  finally { await checked.dispose(); }
}
