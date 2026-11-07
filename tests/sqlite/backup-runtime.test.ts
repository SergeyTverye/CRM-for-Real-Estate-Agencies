import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { backupControlCommand, archiveRoot } from "@/modules/desktop-backup/application/backup-control";
import { executeDesktopBackupRequest, businessFingerprint } from "@/modules/desktop-backup/application/desktop-coordinator";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { GenerationStore } from "@/modules/desktop-backup/application/restore";
import { resetDatabase, seedBase, db, type TestUsers } from "../helpers/fixtures";
import { sqliteFilePath } from "@/shared/db/sqlite-adapter";
let root: string, users: TestUsers;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL!;
const variables = ["DESKTOP_DATA_DIR", "BACKUP_SETTINGS_DIR", "BACKUP_PATH", "FILE_STORAGE_PATH", "CRM_DESKTOP_SUPERVISED_UPGRADE", "CRM_BACKUP_WRITERS_STOPPED", "DATABASE_URL"] as const;
const previous = Object.fromEntries(variables.map(k => [k, process.env[k]]));
beforeAll(async () => {
  // Match the no-symlink production contract even when Windows TEMP is an alias.
  root = await mkdtemp(path.join(await realpath(os.tmpdir()), "crm-runtime-backup-"));
  process.env.DESKTOP_DATA_DIR = root; process.env.BACKUP_SETTINGS_DIR = path.join(root, "backup-settings"); process.env.BACKUP_PATH = path.join(root, "backups"); process.env.FILE_STORAGE_PATH = path.join(root, "files");
  process.env.CRM_DESKTOP_SUPERVISED_UPGRADE = "1"; process.env.CRM_BACKUP_WRITERS_STOPPED = "1";
  await mkdir(process.env.FILE_STORAGE_PATH, { recursive: true }); await writeFile(path.join(process.env.FILE_STORAGE_PATH, "synthetic.txt"), "synthetic attachment");
  await writeFile(path.join(root, "identity.json"), JSON.stringify({ deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() }));
});
beforeEach(async () => { process.env.DATABASE_URL = ORIGINAL_DATABASE_URL; await resetDatabase(); users = await seedBase(); });
afterAll(async () => { for (const k of variables) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } await rm(root, { recursive: true, force: true }); });
it("supervisor creates encrypted online snapshot, verifies and atomically restores DB + storage", async () => {
  const secret = { passphrase: "synthetic desktop only phrase", recoveryKey: newRecoveryKey() };
  const queued = await backupControlCommand(users.manager, { action: "create", ...secret, recoveryKeySaved: true }) as { requestId: string };
  const result = await executeDesktopBackupRequest(queued.requestId);
  expect(result.status).toBe("verified");
  const id = (result.archive as { backupId: string }).backupId;
  expect(await readFile(path.join(archiveRoot(), id + ".crmbackup"))).not.toContain(Buffer.from(secret.passphrase));
  const verify = await backupControlCommand(users.manager, { action: "verify", backupId: id, recoveryKey: secret.recoveryKey }) as { requestId: string };
  expect((await executeDesktopBackupRequest(verify.requestId)).status).toBe("verified");
  const restore = await backupControlCommand(users.manager, { action: "restore", backupId: id, passphrase: secret.passphrase, confirmed: true }) as { requestId: string };
  const restored = await executeDesktopBackupRequest(restore.requestId);
  expect(restored.status).toBe("restored");
  expect(restored.protectiveBackupId).toEqual(expect.any(String));
  expect(restored.protectiveBackupId).not.toBe(id);
  const protectivePath = path.join(archiveRoot(), restored.protectiveBackupId + ".crmbackup");
  const protectiveMetadata = JSON.parse(await readFile(protectivePath + ".json", "utf8"));
  const protectiveBytes = await readFile(protectivePath);
  expect(protectiveBytes.length).toBeGreaterThan(0);
  expect(createHash("sha256").update(protectiveBytes).digest("hex")).toBe(protectiveMetadata.archive.sha256);
  const generation = await new GenerationStore(path.join(root, "runtime-generations")).currentPath();
  expect(await readFile(path.join(generation!, "documents", "synthetic.txt"), "utf8")).toBe("synthetic attachment");
  const restoredDatabase = new Database(path.join(generation!, "database.sqlite"), { readonly: true });
  try {
    expect(restoredDatabase.prepare("SELECT id FROM users WHERE login = ?").get(users.manager.login)).toEqual({ id: users.manager.userId });
    expect(restoredDatabase.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(restoredDatabase.pragma("foreign_key_check")).toEqual([]);
  } finally { restoredDatabase.close(); }
});
it("does not start a snapshot without the supervisor stop barrier", async () => {
  delete process.env.CRM_BACKUP_WRITERS_STOPPED;
  await expect(executeDesktopBackupRequest(randomUUID())).rejects.toMatchObject({ code: "WRITERS_NOT_STOPPED" });
  process.env.CRM_BACKUP_WRITERS_STOPPED = "1";
});

async function storageHash(dir: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string, base: string) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, base);
      else if (entry.isFile()) {
        hash.update(path.relative(base, full));
        hash.update(await readFile(full));
      }
    }
  }
  await walk(dir, dir);
  return hash.digest("hex");
}

it("empty desktop setup can receive an incoming snapshot", async () => {
  const secret = { passphrase: "synthetic desktop only phrase", recoveryKey: newRecoveryKey() };
  const queued = await backupControlCommand(users.manager, { action: "create", ...secret, recoveryKeySaved: true }) as { requestId: string };
  const created = await executeDesktopBackupRequest(queued.requestId);
  expect(created.status).toBe("verified");
  const backupId = (created.archive as { backupId: string }).backupId;
  await rm(path.join(root, "handoff-state.json"), { force: true });

  const receive = await backupControlCommand(users.manager, { action: "receive", backupId, passphrase: secret.passphrase, confirmed: true }) as { requestId: string };
  const result = await executeDesktopBackupRequest(receive.requestId);
  expect(result.status).toBe("restored");
  expect(result.errorCode).toBeUndefined();
});

it("task-only local workspace conflicts on incoming receive and leaves DB/files unchanged", async () => {
  const secret = { passphrase: "synthetic desktop only phrase", recoveryKey: newRecoveryKey() };
  const queued = await backupControlCommand(users.manager, { action: "create", ...secret, recoveryKeySaved: true }) as { requestId: string };
  const created = await executeDesktopBackupRequest(queued.requestId);
  expect(created.status).toBe("verified");
  const backupId = (created.archive as { backupId: string }).backupId;
  await rm(path.join(root, "handoff-state.json"), { force: true });

  await db.task.create({
    data: {
      title: "Synthetic task-only local row",
      taskType: "call_or_contact",
      status: "planned",
      priority: "normal",
      dueAt: new Date(Date.now() + 86400000),
      responsibleUserId: users.manager.userId,
      createdBy: users.manager.userId,
    },
  });

  const dbPath = sqliteFilePath(process.env.DATABASE_URL!);
  const beforeDb = businessFingerprint(dbPath);
  const beforeFiles = await storageHash(process.env.FILE_STORAGE_PATH!);

  const receive = await backupControlCommand(users.manager, { action: "receive", backupId, passphrase: secret.passphrase, confirmed: true }) as { requestId: string };
  const result = await executeDesktopBackupRequest(receive.requestId);
  expect(result.status).toBe("failed");
  expect(result.errorCode).toBe("TRANSFER_REVISION_CONFLICT");

  expect(businessFingerprint(dbPath)).toBe(beforeDb);
  expect(await storageHash(process.env.FILE_STORAGE_PATH!)).toBe(beforeFiles);
});

it("document-only local workspace conflicts on incoming receive and leaves DB/files unchanged", async () => {
  const secret = { passphrase: "synthetic desktop only phrase", recoveryKey: newRecoveryKey() };
  const queued = await backupControlCommand(users.manager, { action: "create", ...secret, recoveryKeySaved: true }) as { requestId: string };
  const created = await executeDesktopBackupRequest(queued.requestId);
  expect(created.status).toBe("verified");
  const backupId = (created.archive as { backupId: string }).backupId;
  await rm(path.join(root, "handoff-state.json"), { force: true });

  await db.document.create({
    data: {
      originalName: "synthetic-document.txt",
      documentTypeCode: "other",
      mimeType: "text/plain",
      fileSize: BigInt(1),
      storageKey: "synthetic-document-" + randomUUID(),
      uploadedBy: users.manager.userId,
      checksum: "synthetic",
    },
  });

  const dbPath = sqliteFilePath(process.env.DATABASE_URL!);
  const beforeDb = businessFingerprint(dbPath);
  const beforeFiles = await storageHash(process.env.FILE_STORAGE_PATH!);

  const receive = await backupControlCommand(users.manager, { action: "receive", backupId, passphrase: secret.passphrase, confirmed: true }) as { requestId: string };
  const result = await executeDesktopBackupRequest(receive.requestId);
  expect(result.status).toBe("failed");
  expect(result.errorCode).toBe("TRANSFER_REVISION_CONFLICT");

  expect(businessFingerprint(dbPath)).toBe(beforeDb);
  expect(await storageHash(process.env.FILE_STORAGE_PATH!)).toBe(beforeFiles);
});
