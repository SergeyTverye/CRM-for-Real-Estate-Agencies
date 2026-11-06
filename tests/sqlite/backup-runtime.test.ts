import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { backupControlCommand, archiveRoot } from "@/modules/desktop-backup/application/backup-control";
import { executeDesktopBackupRequest } from "@/modules/desktop-backup/application/desktop-coordinator";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { GenerationStore } from "@/modules/desktop-backup/application/restore";
import { resetDatabase, seedBase, type TestUsers } from "../helpers/fixtures";
let root: string, users: TestUsers;
const variables = ["DESKTOP_DATA_DIR", "BACKUP_SETTINGS_DIR", "BACKUP_PATH", "FILE_STORAGE_PATH", "CRM_DESKTOP_SUPERVISED_UPGRADE", "CRM_BACKUP_WRITERS_STOPPED", "DATABASE_URL"] as const;
const previous = Object.fromEntries(variables.map(k => [k, process.env[k]]));
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "crm-runtime-backup-"));
  process.env.DESKTOP_DATA_DIR = root; process.env.BACKUP_SETTINGS_DIR = path.join(root, "backup-settings"); process.env.BACKUP_PATH = path.join(root, "backups"); process.env.FILE_STORAGE_PATH = path.join(root, "files");
  process.env.CRM_DESKTOP_SUPERVISED_UPGRADE = "1"; process.env.CRM_BACKUP_WRITERS_STOPPED = "1";
  await mkdir(process.env.FILE_STORAGE_PATH, { recursive: true }); await writeFile(path.join(process.env.FILE_STORAGE_PATH, "synthetic.txt"), "synthetic attachment");
  await writeFile(path.join(root, "identity.json"), JSON.stringify({ deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() }));
});
beforeEach(async () => { await resetDatabase(); users = await seedBase(); });
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
