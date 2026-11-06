import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, lstat, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { RemovableDrive } from "../../src/modules/desktop-backup/infrastructure/local-destination";
import { createArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { SqliteSnapshotValidator } from "../../src/modules/desktop-backup/infrastructure/sqlite-validator";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { hashFile } from "../../src/modules/desktop-backup/infrastructure/fs";
import type { BackupDestination } from "../../src/modules/desktop-backup/domain/contracts";

const CONTROL_BYTES = 7 * 1024 * 1024;
const REQUIRED_FREE = 128 * 1024 * 1024;
const emit = (code: string, values: Record<string, string | number | boolean> = {}) => process.stdout.write(`${JSON.stringify({ code, ...values })}\n`);

export function parseUsbSmokeArgs(argv: string[]) {
  if (!argv.includes("--execute-usb-smoke")) return null;
  const index = argv.indexOf("--drive");
  const drive = argv[index + 1];
  if (!drive || !/^[A-Za-z]:$/.test(drive)) throw new Error("DRIVE_ARGUMENT_INVALID");
  return drive.toUpperCase();
}

async function removeOwnRoot(root: string, prefix: string, parent: string) {
  const expectedParent = await realpath(parent);
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) throw new Error("OWN_ROOT_INVALID");
  const info = await lstat(resolved);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("OWN_ROOT_INVALID");
  const actual = await realpath(resolved);
  if (actual !== resolved || path.dirname(actual) !== expectedParent) throw new Error("OWN_ROOT_INVALID");
  await rm(actual, { recursive: true, force: false });
}

async function restoreTo(backupPath: string, targetRoot: string, sourceArchive: Awaited<ReturnType<typeof createArchive>>, passphrase: string, validator: SqliteSnapshotValidator) {
  const store = new GenerationStore(path.join(targetRoot, "restore"));
  const result = await restoreArchive({
    archivePath: backupPath, credential: { passphrase }, schemaVersion: 1, validator, store, confirmed: true,
    hooks: {
      withStoppedRuntime: work => work(),
      async protectCurrent() { return { path: sourceArchive.path, archive: sourceArchive.archive, credential: { passphrase } }; },
      async prepareStage() {},
    },
  });
  return result.activePath;
}

export async function runUsbBackupSmoke(drive: string) {
  const volume = `${drive}\\`;
  const driveInfo = await stat(volume);
  if (!driveInfo.isDirectory()) throw new Error("DRIVE_UNAVAILABLE");
  const available = (await import("node:fs")).statfsSync(volume).bavail * (await import("node:fs")).statfsSync(volume).bsize;
  if (available < REQUIRED_FREE) throw new Error("DRIVE_CAPACITY_LOW");
  const usbParent = await realpath(volume);
  const usbRoot = await mkdtemp(path.join(usbParent, "crm-synthetic-"));
  const tempParent = os.tmpdir();
  const workRoot = await mkdtemp(path.join(tempParent, "crm-usb-smoke-"));
  let archive: Awaited<ReturnType<typeof createArchive>> | undefined;
  try {
    const validator = new SqliteSnapshotValidator();
    const dbPath = path.join(workRoot, "synthetic.sqlite");
    const db = new Database(dbPath);
    try { db.exec("CREATE TABLE synthetic_control(id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO synthetic_control VALUES ('usb-control','synthetic-ok')"); }
    finally { db.close(); }
    const documents = path.join(workRoot, "documents");
    await mkdir(documents);
    const controlPath = path.join(documents, "synthetic-control.bin");
    await writeFile(controlPath, randomBytes(CONTROL_BYTES), { flag: "wx" });
    const controlHash = await hashFile(controlPath);
    const passphrase = randomBytes(32).toString("base64url");
    archive = await createArchive({
      outputDir: path.join(workRoot, "archives"), stagingRoot: path.join(workRoot, "staging"),
      source: { async createConsistentSnapshot(target) { const source = new Database(dbPath); try { await source.backup(target); } finally { source.close(); } } },
      barrier: { run: work => work() }, validator,
      metadata: { crmVersion: "3.2.1-usb-synthetic", schemaVersion: 1, deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null },
      passphrase, recoveryKey: newRecoveryKey(), recoveryKeySaved: true, settings: { locale: "ru-RU" }, storage: { documents },
    });

    const target = new RemovableDrive("usb", usbRoot);
    await target.put(archive.archive, archive.path);
    await target.verify(archive.archive);
    const readback = path.join(workRoot, "readback.crmbackup");
    await target.get(archive.archive.backupId, readback);
    const readbackHash = await hashFile(readback);
    if (readbackHash.sha256 !== archive.archive.sha256 || readbackHash.size !== archive.archive.size) throw new Error("READBACK_CHECKSUM_MISMATCH");

    const restoredDir = await mkdtemp(path.join(tempParent, "crm-usb-restore-"));
    try {
      const active = await restoreTo(readback, restoredDir, archive, passphrase, validator);
      const restoredDb = new Database(path.join(active, "database.sqlite"), { readonly: true, fileMustExist: true });
      try {
        const row = restoredDb.prepare("SELECT value FROM synthetic_control WHERE id = ?").get("usb-control") as { value?: string } | undefined;
        if (row?.value !== "synthetic-ok") throw new Error("RESTORE_CONTROL_ROW_MISMATCH");
      } finally { restoredDb.close(); }
      const restoredHash = await hashFile(path.join(active, "documents", "synthetic-control.bin"));
      if (restoredHash.sha256 !== controlHash.sha256 || restoredHash.size !== CONTROL_BYTES) throw new Error("RESTORE_CONTROL_FILE_MISMATCH");
    } finally { await removeOwnRoot(restoredDir, "crm-usb-restore-", tempParent); }

    const injectedFailure: BackupDestination = {
      id: "injected-io-failure",
      async put() { throw new Error("INJECTED_IO_FAILURE"); }, async list() { return []; }, async get() { throw new Error("INJECTED_IO_FAILURE"); },
      async delete() {}, async verify() { throw new Error("INJECTED_IO_FAILURE"); },
    };
    let injected = false;
    try { await injectedFailure.put(archive.archive, archive.path); } catch (error) { injected = (error as Error).message === "INJECTED_IO_FAILURE"; }
    if (!injected) throw new Error("INJECTED_IO_CHECK_FAILED");
  } finally {
    if (archive) {
      const ownArchivePath = path.join(workRoot, "archives", `${archive.archive.backupId}.crmbackup`);
      const archiveDir = await realpath(path.dirname(ownArchivePath));
      if (archiveDir !== path.join(workRoot, "archives")) throw new Error("OWN_ARCHIVE_PATH_INVALID");
      await rm(ownArchivePath, { force: true });
    }
    await removeOwnRoot(workRoot, "crm-usb-smoke-", tempParent);
    await removeOwnRoot(usbRoot, "crm-synthetic-", usbParent);
  }
  emit("USB_SMOKE_PASS", { archiveBytes: archive.archive.size, controlBytes: CONTROL_BYTES, checks: 5, failureMode: "INJECTED_IO_NOT_UNPLUG" });
}

async function main() {
    const drive = parseUsbSmokeArgs(process.argv.slice(2));
    if (!drive) { emit("USB_SMOKE_OPT_IN_REQUIRED"); process.exitCode = 2; }
    else await runUsbBackupSmoke(drive);
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath.toLowerCase().endsWith(`${path.sep}scripts${path.sep}acceptance${path.sep}usb-backup-live.ts`.toLowerCase())) {
  void main().catch(error => {
    emit(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "USB_SMOKE_FAILED");
    process.exitCode = 1;
  });
}
