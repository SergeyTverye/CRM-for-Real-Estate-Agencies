/**
 * FUTURE, EXPLICIT REAL-CLOUD TEST ONLY. Not run by CI or desktop startup.
 * npx tsx scripts/desktop/cloud-smoke.ts --execute-real-cloud-smoke
 * Reads D:\\crm-secrets\\clouds.env without printing credentials.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { parse } from "dotenv";
import { createArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { SqliteSnapshotValidator } from "../../src/modules/desktop-backup/infrastructure/sqlite-validator";
import { YandexS3 } from "../../src/modules/desktop-backup/infrastructure/yandex-s3";
import { MailruWebDav } from "../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { ReplicationQueue } from "../../src/modules/desktop-backup/application/replication-queue";
import type { BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";
async function main() {
  if (!process.argv.includes("--execute-real-cloud-smoke")) throw new Error("EXPLICIT_SMOKE_FLAG_REQUIRED");
  const secrets = parse(await readFile("D:\\crm-secrets\\clouds.env"));
  // Accept both the documented template names (D:\\crm-secrets\\clouds.env) and the module names.
  const aliases: Record<string, string[]> = {
    YANDEX_S3_BUCKET: ["YC_S3_BUCKET"], YANDEX_S3_ACCESS_KEY_ID: ["YC_S3_ACCESS_KEY_ID"], YANDEX_S3_SECRET_ACCESS_KEY: ["YC_S3_SECRET_ACCESS_KEY"],
    MAILRU_WEBDAV_EMAIL: ["MAILRU_EMAIL"], MAILRU_WEBDAV_APP_PASSWORD: ["MAILRU_APP_PASSWORD"],
  };
  const required = (name: string) => { const value = [name, ...(aliases[name] ?? [])].map(key => secrets[key]).find(Boolean); if (!value) throw new Error("CLOUD_CONFIGURATION_MISSING:" + name); return value; };
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-cloud-smoke-")); const deploymentId = randomUUID();
  const prefix = "crm-synthetic-smoke/" + deploymentId;
  const validator = new SqliteSnapshotValidator(); const passphrase = randomBytes(32).toString("hex");
  const destinations: BackupDestination[] = [];
  try {
    const dbPath = path.join(root, "synthetic.sqlite"); const db = new Database(dbPath);
    db.exec("CREATE TABLE smoke(id TEXT PRIMARY KEY, label TEXT); INSERT INTO smoke VALUES ('synthetic','synthetic cloud smoke')"); db.close();
    const docs = path.join(root, "documents"); await mkdir(docs); await writeFile(path.join(docs, "synthetic.txt"), "synthetic smoke document");
    await writeFile(path.join(docs, "synthetic-large.bin"), randomBytes(7 * 1024 ** 2));
    const backup = await createArchive({
      outputDir: path.join(root, "archives"), stagingRoot: path.join(root, "staging"),
      source: { async createConsistentSnapshot(dest) { const sqlite = new Database(dbPath); try { await sqlite.backup(dest); } finally { sqlite.close(); } } },
      barrier: { run: work => work() }, validator,
      metadata: { crmVersion: "3.2.1-smoke", schemaVersion: 1, deploymentId, instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null },
      passphrase, recoveryKey: newRecoveryKey(), recoveryKeySaved: true, settings: { locale: "ru-RU" }, storage: { documents: docs },
    });
    destinations.push(new YandexS3({ id: "yandex", bucket: required("YANDEX_S3_BUCKET"), prefix, partBytes: 5 * 1024 ** 2, workRoot: path.join(root, "s3"), credentials: { accessKeyId: required("YANDEX_S3_ACCESS_KEY_ID"), secretAccessKey: required("YANDEX_S3_SECRET_ACCESS_KEY") } }));
    destinations.push(new MailruWebDav({ id: "mailru", prefix, workRoot: path.join(root, "dav"), email: required("MAILRU_WEBDAV_EMAIL"), applicationPassword: required("MAILRU_WEBDAV_APP_PASSWORD"), partBytes: 1024 * 1024 }));
    const queue = new ReplicationQueue(path.join(root, "queue"), destinations); await queue.enqueue(backup.archive, backup.path);
    const rows = await queue.pump();
    const results: { destination: string; status: string }[] = [];
    for (const destination of destinations) {
      if (!rows.some(row => row.destinationId === destination.id && row.status === "verified")) { results.push({ destination: destination.id, status: "failed" }); continue; }
      const downloaded = path.join(root, destination.id + ".crmbackup"); await destination.get(backup.archive.backupId, downloaded);
      const store = new GenerationStore(path.join(root, "restore-" + destination.id));
      const restored = await restoreArchive({ archivePath: downloaded, credential: { passphrase }, schemaVersion: 1, validator, store, confirmed: true, hooks: { withStoppedRuntime: work => work(), async protectCurrent() { return { path: backup.path, archive: backup.archive, credential: { passphrase } }; }, async prepareStage() {} } });
      if (await readFile(path.join(restored.activePath, "documents/synthetic.txt"), "utf8") !== "synthetic smoke document") throw new Error("RESTORE_FILE_MISMATCH");
      results.push({ destination: destination.id, status: "restored" });
      await destination.delete(backup.archive.backupId); // Only this synthetic backup, never other objects.
    }
    console.log(JSON.stringify({ results }));
    if (results.some(r => r.status !== "restored")) process.exitCode = 1;
  } finally {
    for (const destination of destinations) if (destination instanceof YandexS3) destination.close();
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error: unknown) => {
  // Only stable error codes are printed; provider responses and credentials stay redacted.
  const raw = error instanceof Error ? error.message : "";
  const code = /^[A-Z][A-Z0-9_]+(:[A-Z0-9_]+)?$/.test(raw) ? raw : (error as { name?: string })?.name ?? "Error";
  console.error("CLOUD_SMOKE_FAILED " + code + " (credentials and provider responses redacted)"); process.exitCode = 1;
});
