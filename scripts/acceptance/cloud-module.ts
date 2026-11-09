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

export const MODULE_STAGES = [
  "CREATE_ARCHIVE", "FIRST_QUEUE", "RESUME_FIRST", "SECOND_QUEUE", "RESUME_SECOND",
  "DOWNLOAD_YANDEX", "RESTORE_YANDEX", "DOWNLOAD_MAILRU", "RESTORE_MAILRU", "ANONYMOUS", "CLEANUP",
] as const;
export type ModuleStage = typeof MODULE_STAGES[number];
type ModuleProvider = "NONE" | "YANDEX" | "MAILRU";
export interface ModuleFailureDiagnostic {
  scope: "MODULE_TRANSFER_RESTORE";
  stage: ModuleStage;
  status: "FAILED";
  code: string;
  provider: ModuleProvider;
  cleanupStatus: "COMPLETED" | "FAILED";
  cleanupCode: string;
  cleanupProvider: ModuleProvider;
}
class ModuleFailure extends Error {
  constructor(readonly diagnostic: ModuleFailureDiagnostic) { super("CLOUD_MODULE_FAILED"); }
}
export function safeModuleErrorCode(error: unknown): string {
  return error instanceof BackupError && typeof error.code === "string" && error.code.length <= 80
    && /^[A-Z]/.test(error.code) && !/[^A-Z0-9_]/.test(error.code)
    ? error.code : "MODULE_OPERATION_FAILED";
}
export function moduleFailureDiagnostic(error: unknown): ModuleFailureDiagnostic | undefined {
  if (!(error instanceof ModuleFailure)) return;
  const d = error.diagnostic;
  if (!MODULE_STAGES.includes(d.stage) || !["NONE", "YANDEX", "MAILRU"].includes(d.provider)
    || !["NONE", "YANDEX", "MAILRU"].includes(d.cleanupProvider) || !["COMPLETED", "FAILED"].includes(d.cleanupStatus)) return;
  return {
    scope: "MODULE_TRANSFER_RESTORE", stage: d.stage, status: "FAILED",
    code: safeModuleErrorCode(new BackupError(d.code)), provider: d.provider,
    cleanupStatus: d.cleanupStatus, cleanupCode: safeModuleErrorCode(new BackupError(d.cleanupCode)), cleanupProvider: d.cleanupProvider,
  };
}

export async function probeS3Anonymous(
  input: { bucket: string; prefix: string; archive: ArchiveRef }, request: typeof fetch = fetch,
): Promise<{ getStatus: number; listStatus: number }> {
  const bucketUrl = new URL(`https://storage.yandexcloud.net/${encodeURIComponent(input.bucket)}/`);
  const archiveUrl = new URL(`${input.prefix.split("/").map(encodeURIComponent).join("/")}/${input.archive.backupId}.crmbackup`, bucketUrl);
  const listUrl = new URL(bucketUrl);
  listUrl.searchParams.set("list-type", "2");
  listUrl.searchParams.set("prefix", `${input.prefix}/`);
  listUrl.searchParams.set("max-keys", "1");
  const requestStatus = async (url: URL) => {
    const response = await request(url, { method: "GET", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000) });
    const status = response.status;
    await response.body?.cancel();
    return status;
  };
  const [getStatus, listStatus] = await Promise.all([requestStatus(archiveUrl), requestStatus(listUrl)]);
  return { getStatus, listStatus };
}

async function removeOwnedTempRoot(root: string) {
  const expectedParent = await realpath(os.tmpdir());
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("crm-module-cloud-live-")) {
    throw new BackupError("SYNTHETIC_TEMP_ROOT_INVALID");
  }
  const metadata = await lstat(resolved);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new BackupError("SYNTHETIC_TEMP_ROOT_INVALID");
  const actual = await realpath(resolved);
  if (path.dirname(actual) !== expectedParent || actual !== resolved) throw new BackupError("SYNTHETIC_TEMP_ROOT_INVALID");
  await rm(actual, { recursive: true, force: false });
}
const liveDestinations: ModuleDestinationFactory = ({ root, prefix, secrets }) => {
  const yandex = new YandexS3({ id: "yandex", bucket: secrets.yandex.bucket, prefix, partBytes: 5 * 1024 ** 2, workRoot: path.join(root, "s3"), credentials: { accessKeyId: secrets.yandex.accessKeyId, secretAccessKey: secrets.yandex.secretAccessKey } });
  const mailru = new MailruWebDav({ id: "mailru", prefix, workRoot: path.join(root, "dav"), email: secrets.mailru.email, applicationPassword: secrets.mailru.applicationPassword, partBytes: 1024 ** 2, useMove: false });
  return {
    destinations: [yandex, mailru],
    probeS3Anonymous,
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

const providerFor = (id: string): ModuleProvider => id === "yandex" ? "YANDEX" : id === "mailru" ? "MAILRU" : "NONE";
class DestinationFailure extends BackupError {
  constructor(code: string, readonly provider: ModuleProvider) { super(code); }
}
function observeTransfers(destination: BackupDestination, failures: Map<string, string>): BackupDestination {
  const observe = async (work: () => Promise<void>) => {
    try { await work(); }
    catch (error) { failures.set(destination.id, safeModuleErrorCode(error)); throw error; }
  };
  return {
    id: destination.id,
    put: (archive, source, signal) => observe(() => destination.put(archive, source, signal)),
    verify: (archive, signal) => observe(() => destination.verify(archive, signal)),
    list: () => destination.list(), get: (id, target, signal) => destination.get(id, target, signal),
    delete: id => destination.delete(id),
  };
}
function assertQueue(rows: Awaited<ReturnType<ReplicationQueue["snapshot"]>>, id: string, destination: string, status: string, failures: Map<string, string>) {
  if (!rows.some(row => row.archive.backupId === id && row.destinationId === destination && row.status === status)) {
    throw new DestinationFailure(failures.get(destination) ?? "SYNTHETIC_QUEUE_EXPECTATION_FAILED", providerFor(destination));
  }
}

export async function runModuleTransferRestore(secrets: CloudLiveSecrets, makeDestinations: ModuleDestinationFactory = liveDestinations): Promise<ModuleEvidence> {
  let root: string | undefined;
  let stage: ModuleStage = "CREATE_ARCHIVE";
  let provider: ModuleProvider = "NONE";
  let failure: ModuleFailureDiagnostic | undefined;
  let evidence: ModuleEvidence | undefined;
  let destinations: BackupDestination[] = [];
  let disposeDestinations: (() => void | Promise<void>) | undefined;
  let backup: { archive: ArchiveRef; path: string } | undefined;
  try {
    root = await mkdtemp(path.join(os.tmpdir(), "crm-module-cloud-live-"));
    const runPrefix = `crm-synthetic-smoke/${randomUUID()}`;
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

    stage = "FIRST_QUEUE";
    const made = makeDestinations({ root, prefix: runPrefix, secrets });
    destinations = made.destinations;
    disposeDestinations = made.dispose;
    const transferFailures = new Map<string, string>();
    const yandex = observeTransfers(made.destinations[0], transferFailures);
    const mailru = observeTransfers(made.destinations[1], transferFailures);

    const firstQueuePath = path.join(root, "queue-first-put");
    const firstQueue = new ReplicationQueue(firstQueuePath, [failOnce(yandex, "SYNTHETIC_FIRST_PUT_FAILURE"), mailru]);
    await firstQueue.enqueue(created.archive, created.path);
    let rows = await firstQueue.pump();
    assertQueue(rows, created.archive.backupId, "yandex", "failed", transferFailures);
    assertQueue(rows, created.archive.backupId, "mailru", "verified", transferFailures);
    stage = "RESUME_FIRST";
    transferFailures.clear();
    const resumedQueue = new ReplicationQueue(firstQueuePath, [yandex, mailru]);
    rows = await resumedQueue.snapshot();
    assertQueue(rows, created.archive.backupId, "mailru", "verified", transferFailures);
    await resumedQueue.retry(created.archive.backupId, "yandex");
    rows = await resumedQueue.pump();
    assertQueue(rows, created.archive.backupId, "yandex", "verified", transferFailures);
    assertQueue(rows, created.archive.backupId, "mailru", "verified", transferFailures);

    stage = "SECOND_QUEUE";
    transferFailures.clear();
    const networkQueuePath = path.join(root, "queue-network-fault");
    const networkQueue = new ReplicationQueue(networkQueuePath, [yandex, failOnce(mailru, "SYNTHETIC_NETWORK_INTERRUPTION")]);
    await networkQueue.enqueue(created.archive, created.path);
    rows = await networkQueue.pump();
    assertQueue(rows, created.archive.backupId, "yandex", "verified", transferFailures);
    assertQueue(rows, created.archive.backupId, "mailru", "failed", transferFailures);
    stage = "RESUME_SECOND";
    transferFailures.clear();
    const resumedNetworkQueue = new ReplicationQueue(networkQueuePath, [yandex, mailru]);
    await resumedNetworkQueue.snapshot();
    await resumedNetworkQueue.retry(created.archive.backupId, "mailru");
    rows = await resumedNetworkQueue.pump();
    assertQueue(rows, created.archive.backupId, "yandex", "verified", transferFailures);
    assertQueue(rows, created.archive.backupId, "mailru", "verified", transferFailures);

    const restored: string[] = [];
    for (const destination of destinations) {
      provider = providerFor(destination.id);
      stage = destination.id === "yandex" ? "DOWNLOAD_YANDEX" : "DOWNLOAD_MAILRU";
      const catalog = await destination.list();
      if (!catalog.some(item => item.backupId === created.archive.backupId)) throw new BackupError("SYNTHETIC_REMOTE_OBJECT_MISSING");
      const downloaded = path.join(root, `${destination.id}.crmbackup`);
      await destination.get(created.archive.backupId, downloaded);
      const actualArchiveHash = await hashFile(downloaded);
      if (actualArchiveHash.size !== created.archive.size || actualArchiveHash.sha256 !== created.archive.sha256) throw new BackupError("SYNTHETIC_ARCHIVE_HASH_MISMATCH");
      stage = destination.id === "yandex" ? "RESTORE_YANDEX" : "RESTORE_MAILRU";
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
        if (row?.value !== "synthetic-ok") throw new BackupError("SYNTHETIC_CONTROL_ROW_MISMATCH");
      } finally { restoredDb.close(); }
      const restoredFile = await hashFile(path.join(result.activePath, "documents", "synthetic-control.bin"));
      if (restoredFile.size !== expectedFile.size || restoredFile.sha256 !== expectedFile.sha256) throw new BackupError("SYNTHETIC_FILE_HASH_MISMATCH");
      restored.push(destination.id);
    }
    stage = "ANONYMOUS";
    provider = "YANDEX";
    const anonymous = await made.probeS3Anonymous({ bucket: secrets.yandex.bucket, prefix: runPrefix, archive: created.archive });
    if (anonymous.getStatus !== 403) throw new BackupError("S3_ANONYMOUS_GET_NOT_DENIED");
    if (anonymous.listStatus !== 403) throw new BackupError("S3_ANONYMOUS_LIST_NOT_DENIED");
    const s3Parts = Math.ceil(created.archive.size / (5 * 1024 ** 2));
    const mailruChunks = Math.ceil(created.archive.size / (1024 ** 2));
    if (s3Parts < 2 || mailruChunks < 2) throw new BackupError("SYNTHETIC_CHUNKING_NOT_EXERCISED");
    evidence = { stage: "MODULE_TRANSFER_RESTORE", status: "COMPLETED", providers: destinations.length, bytes: created.archive.size, s3Parts, mailruChunks, restoredInstances: restored.length, failureModes: 2, anonymousDenied: 2, hashesMatch: true };
  } catch (error) {
    failure = {
      scope: "MODULE_TRANSFER_RESTORE", stage, status: "FAILED", code: safeModuleErrorCode(error),
      provider: error instanceof DestinationFailure ? error.provider : provider,
      cleanupStatus: "COMPLETED", cleanupCode: "NONE", cleanupProvider: "NONE",
    };
  } finally {
    let cleanupFailure: { code: string; provider: ModuleProvider } | undefined;
    const cleanup = async (cleanupProvider: ModuleProvider, work: () => void | Promise<void>) => {
      try { await work(); }
      catch (error) { cleanupFailure ??= { code: safeModuleErrorCode(error), provider: cleanupProvider }; }
    };
    const ownBackup = backup;
    if (ownBackup) for (const destination of destinations) {
      await cleanup(providerFor(destination.id), () => destination.delete(ownBackup.archive.backupId));
    }
    await cleanup("NONE", () => disposeDestinations?.());
    if (root) { const ownRoot = root; await cleanup("NONE", () => removeOwnedTempRoot(ownRoot)); }
    if (cleanupFailure) {
      failure ??= { scope: "MODULE_TRANSFER_RESTORE", stage: "CLEANUP", status: "FAILED", ...cleanupFailure, cleanupStatus: "FAILED", cleanupCode: "NONE", cleanupProvider: "NONE" };
      failure.cleanupStatus = "FAILED";
      failure.cleanupCode = cleanupFailure.code;
      failure.cleanupProvider = cleanupFailure.provider;
    }
  }
  if (failure) throw new ModuleFailure(failure);
  return evidence!;
}
