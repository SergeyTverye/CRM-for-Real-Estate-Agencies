import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, lstat, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { BackupError, type ArchiveRef, type BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";
import { createArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { SqliteSnapshotValidator } from "../../src/modules/desktop-backup/infrastructure/sqlite-validator";
import { YandexS3 } from "../../src/modules/desktop-backup/infrastructure/yandex-s3";
import { MailruWebDav } from "../../src/modules/desktop-backup/infrastructure/mailru-webdav";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { ReplicationQueue } from "../../src/modules/desktop-backup/application/replication-queue";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";

export interface CloudLiveSecrets {
  yandex: { bucket: string; accessKeyId: string; secretAccessKey: string };
  mailru: { email: string; applicationPassword: string };
}
export interface ModuleEvidence {
  stage: string;
  status: string;
  providers: number;
  bytes: number;
  s3Parts: number;
  mailruChunks: number;
  restoredInstances: number;
  failureModes: number;
  anonymousDenied: number;
  hashesMatch: boolean;
}
export interface ModuleDestinations {
  destinations: [BackupDestination, BackupDestination];
  probeS3Anonymous(input: { bucket: string; prefix: string; archive: ArchiveRef }): Promise<{ getStatus: number; listStatus: number }>;
  dispose(): void | Promise<void>;
}
export type ModuleDestinationFactory = (input: { root: string; prefix: string; secrets: CloudLiveSecrets }) => ModuleDestinations;

async function removeOwnedTempRoot(root: string) {
  const expectedParent = await realpath(os.tmpdir());
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("crm-module-cloud-live-")) {
    throw new Error("SYNTHETIC_TEMP_ROOT_INVALID");
  }
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("SYNTHETIC_TEMP_ROOT_INVALID");
  const actual = await realpath(resolved);
  if (path.dirname(actual) !== expectedParent || actual !== resolved) throw new Error("SYNTHETIC_TEMP_ROOT_INVALID");
  await rm(actual, { recursive: true, force: false });
}
const liveDestinations: ModuleDestinationFactory = ({ root, prefix, secrets }) => {
  const yandex = new YandexS3({ id: "yandex", bucket: secrets.yandex.bucket, prefix, partBytes: 5 * 1024 ** 2, workRoot: path.join(root, "s3"), credentials: { accessKeyId: secrets.yandex.accessKeyId, secretAccessKey: secrets.yandex.secretAccessKey } });
  const mailru = new MailruWebDav({ id: "mailru", prefix, workRoot: path.join(root, "dav"), email: secrets.mailru.email, applicationPassword: secrets.mailru.applicationPassword, partBytes: 1024 ** 2, useMove: false });
  return {
    destinations: [yandex, mailru],
    async probeS3Anonymous({ bucket, prefix: objectPrefix, archive }) {
      const base = new URL(`https://storage.yandexcloud.net/${encodeURIComponent(bucket)}/${objectPrefix.split("/").map(encodeURIComponent).join("/")}`);
      const archiveUrl = new URL(`${archive.backupId}.crmbackup`, base.href.replace(/\/$/, "") + "/");
      const listUrl = new URL(archiveUrl);
      listUrl.searchParams.set("list-type", "2");
      listUrl.searchParams.set("prefix", `${objectPrefix}/${archive.backupId}.crmbackup`);
      const requestStatus = async (url: URL) => {
        const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000) });
        const status = response.status;
        await response.body?.cancel();
        return status;
      };
      const [getStatus, listStatus] = await Promise.all([requestStatus(archiveUrl), requestStatus(listUrl)]);
      return { getStatus, listStatus };
    },
    dispose() { yandex.close(); },
  };
};

function failOnce(destination: BackupDestination, code: string): BackupDestination {
  let failed = false;
  return {
    id: destination.id,
    async put(archive, source, signal) {
      if (!failed) { failed = true; throw new BackupError(code); }
      await destination.put(archive, source, signal);
    },
    list: () => destination.list(),
    get: (id, target, signal) => destination.get(id, target, signal),
    delete: id => destination.delete(id),
    verify: (archive, signal) => destination.verify(archive, signal),
  };
}

async function assertQueue(rows: Awaited<ReturnType<ReplicationQueue["snapshot"]>>, id: string, destination: string, status: string) {
  if (!rows.some(row => row.archive.backupId === id && row.destinationId === destination && row.status === status)) {
    throw new Error("SYNTHETIC_QUEUE_EXPECTATION_FAILED");
  }
}

export async function runModuleTransferRestore(secrets: CloudLiveSecrets, makeDestinations: ModuleDestinationFactory = liveDestinations): Promise<ModuleEvidence> {
  const root = await mkdtemp(path.join(os.tmpdir(), "crm-module-cloud-live-"));
  const runPrefix = `crm-synthetic-smoke/${randomUUID()}`;
  let destinations: BackupDestination[] = [];
  let disposeDestinations: (() => void | Promise<void>) | undefined;
  let backup: { archive: ArchiveRef; path: string } | undefined;
  try {
    const validator = new SqliteSnapshotValidator();
    const dbPath = path.join(root, "synthetic.sqlite");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE synthetic_control(id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO synthetic_control VALUES ('control-1','synthetic-ok')");
    } finally { db.close(); }
    const documents = path.join(root, "documents");
    await mkdir(documents);
    const controlFile = path.join(documents, "synthetic-control.bin");
    await writeFile(controlFile, randomBytes(7 * 1024 ** 2));
    const expectedFile = await hashFile(controlFile);
    const passphrase = randomBytes(32).toString("base64url");
    const recoveryKey = newRecoveryKey();
    const created = await createArchive({
      outputDir: path.join(root, "archives"), stagingRoot: path.join(root, "staging"),
      source: { async createConsistentSnapshot(target) { const source = new Database(dbPath); try { await source.backup(target); } finally { source.close(); } } },
      barrier: { run: work => work() }, validator,
      metadata: { crmVersion: "3.2.1-synthetic-live", schemaVersion: 1, deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null },
      passphrase, recoveryKey, recoveryKeySaved: true, settings: { locale: "ru-RU" }, storage: { documents },
    });
    backup = created;

    const made = makeDestinations({ root, prefix: runPrefix, secrets });
    destinations = made.destinations;
    disposeDestinations = made.dispose;
    const [yandex, mailru] = made.destinations;

    // Controlled first-put fault on Yandex; Mail.ru performs a real provider transfer.
    const firstQueuePath = path.join(root, "queue-first-put");
    const firstQueue = new ReplicationQueue(firstQueuePath, [failOnce(yandex, "SYNTHETIC_FIRST_PUT_FAILURE"), mailru]);
    await firstQueue.enqueue(created.archive, created.path);
    let rows = await firstQueue.pump();
    await assertQueue(rows, created.archive.backupId, "yandex", "failed");
    await assertQueue(rows, created.archive.backupId, "mailru", "verified");
    // New queue instance reloads durable state, explicitly retries only the failed destination.
    const resumedQueue = new ReplicationQueue(firstQueuePath, destinations);
    rows = await resumedQueue.snapshot();
    await assertQueue(rows, created.archive.backupId, "mailru", "verified");
    await resumedQueue.retry(created.archive.backupId, "yandex");
    rows = await resumedQueue.pump();
    await assertQueue(rows, created.archive.backupId, "yandex", "verified");
    await assertQueue(rows, created.archive.backupId, "mailru", "verified");

    // Separate controlled network-interruption simulation: Mail.ru throws a stable synthetic error;
    // Yandex still verifies via the actual provider. This is not a physical network disconnect.
    const networkQueuePath = path.join(root, "queue-network-fault");
    const networkQueue = new ReplicationQueue(networkQueuePath, [yandex, failOnce(mailru, "SYNTHETIC_NETWORK_INTERRUPTION")]);
    await networkQueue.enqueue(created.archive, created.path);
    rows = await networkQueue.pump();
    await assertQueue(rows, created.archive.backupId, "yandex", "verified");
    await assertQueue(rows, created.archive.backupId, "mailru", "failed");
    const resumedNetworkQueue = new ReplicationQueue(networkQueuePath, destinations);
    await resumedNetworkQueue.snapshot();
    await resumedNetworkQueue.retry(created.archive.backupId, "mailru");
    rows = await resumedNetworkQueue.pump();
    await assertQueue(rows, created.archive.backupId, "yandex", "verified");
    await assertQueue(rows, created.archive.backupId, "mailru", "verified");

    const restored: string[] = [];
    for (const destination of destinations) {
      const downloaded = path.join(root, `${destination.id}.crmbackup`);
      await destination.get(created.archive.backupId, downloaded);
      const actualArchiveHash = await hashFile(downloaded);
      if (actualArchiveHash.size !== created.archive.size || actualArchiveHash.sha256 !== created.archive.sha256) throw new Error("SYNTHETIC_ARCHIVE_HASH_MISMATCH");
      const store = new GenerationStore(path.join(root, `generation-${destination.id}`));
      const result = await restoreArchive({
        archivePath: downloaded, credential: { passphrase }, schemaVersion: 1, validator, store, confirmed: true,
        hooks: {
          withStoppedRuntime: work => work(),
          async protectCurrent() { return { path: created.path, archive: created.archive, credential: { passphrase } }; },
          async prepareStage() {},
        },
      });
      const restoredDb = new Database(path.join(result.activePath, "database.sqlite"), { readonly: true, fileMustExist: true });
      try {
        const row = restoredDb.prepare("SELECT value FROM synthetic_control WHERE id = ?").get("control-1") as { value?: string } | undefined;
        if (row?.value !== "synthetic-ok") throw new Error("SYNTHETIC_CONTROL_ROW_MISMATCH");
      } finally { restoredDb.close(); }
      const restoredFile = await hashFile(path.join(result.activePath, "documents", "synthetic-control.bin"));
      if (restoredFile.size !== expectedFile.size || restoredFile.sha256 !== expectedFile.sha256) throw new Error("SYNTHETIC_FILE_HASH_MISMATCH");
      restored.push(destination.id);
    }
    const s3Objects = await yandex.list(); const davObjects = await mailru.list();
    if (!s3Objects.some(item => item.backupId === created.archive.backupId) || !davObjects.some(item => item.backupId === created.archive.backupId)) throw new Error("SYNTHETIC_REMOTE_OBJECT_MISSING");
    const anonymous = await made.probeS3Anonymous({ bucket: secrets.yandex.bucket, prefix: runPrefix, archive: created.archive });
    if (anonymous.getStatus !== 403 || anonymous.listStatus !== 403) throw new Error("SYNTHETIC_S3_PUBLIC_ACCESS_NOT_DENIED");
    const s3Parts = Math.ceil(created.archive.size / (5 * 1024 ** 2));
    const mailruChunks = Math.ceil(created.archive.size / (1024 ** 2));
    if (s3Parts < 2 || mailruChunks < 2) throw new Error("SYNTHETIC_CHUNKING_NOT_EXERCISED");
    return { stage: "MODULE_TRANSFER_RESTORE", status: "COMPLETED", providers: destinations.length, bytes: created.archive.size, s3Parts, mailruChunks, restoredInstances: restored.length, failureModes: 2, anonymousDenied: 2, hashesMatch: true };
  } finally {
    // Exact archive ID beneath this run's unique prefix only. Never enumerate-delete a bucket/prefix.
    let cleanupFailed = false;
    if (backup) for (const destination of destinations) { try { await destination.delete(backup.archive.backupId); } catch { cleanupFailed = true; } }
    await disposeDestinations?.();
    await removeOwnedTempRoot(root);
    if (cleanupFailed) throw new Error("SYNTHETIC_REMOTE_CLEANUP_FAILED");
  }
}
