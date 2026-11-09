import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

vi.mock("@/shared/db/client", () => ({ disconnectDb: async () => {}, db: { backupQueueJournal: {
  upsert: async () => ({ revision: 0, payload: { version: 1, rows: [] } }), updateMany: async () => ({ count: 1 }),
} } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
vi.mock("../../scripts/desktop/database-lifecycle", () => ({ applySqliteMigrations: () => {} }));
import { executeDesktopBackupRequest, businessFingerprint } from "@/modules/desktop-backup/application/desktop-coordinator";
import { archiveRoot, commandRoot } from "@/modules/desktop-backup/application/backup-control";
import { backupRuntimeRoot, runtimeCredentialStore } from "@/modules/desktop-backup/infrastructure/destinations-runtime";
import { WindowsDpapiProtector, ServerAesProtector } from "@/modules/desktop-backup/infrastructure/credential-store";
import { createArchive, extractArchive } from "@/modules/desktop-backup/infrastructure/archive";
import { SqliteSnapshotValidator } from "@/modules/desktop-backup/infrastructure/sqlite-validator";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { defaultSettings } from "@/modules/desktop-backup/domain/settings";
import { atomicJson } from "@/modules/desktop-backup/infrastructure/fs";
import { createDesktopSafetySnapshot } from "../../scripts/desktop/runtime/upgrade";

let root: string;
let identity: { deploymentId: string; instanceId: string; deviceId: string };
const secret = { passphrase: "synthetic standby safety passphrase", recoveryKey: newRecoveryKey() };
const validator = new SqliteSnapshotValidator();
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "crm-standby-command-"));
  const aes = new ServerAesProtector(() => Buffer.alloc(32, 9).toString("base64"));
  vi.spyOn(WindowsDpapiProtector.prototype, "seal").mockImplementation((b, c) => aes.seal(b, c));
  vi.spyOn(WindowsDpapiProtector.prototype, "open").mockImplementation((b, c) => aes.open(b, c));
  identity = { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() };
  for (const [key, value] of Object.entries({ DESKTOP_DATA_DIR: root, DATABASE_URL: "file:" + path.join(root, "crm.db"), FILE_STORAGE_PATH: path.join(root, "files"), BACKUP_PATH: path.join(root, "backups"), BACKUP_SETTINGS_DIR: path.join(root, "backup-settings"), CRM_DEPLOYMENT_MODE: "desktop", CRM_BACKUP_WRITERS_STOPPED: "1", INSTANCE_ROLE: "active", DEPLOYMENT_ID: identity.deploymentId, INSTANCE_ID: identity.instanceId })) vi.stubEnv(key, value);
  await mkdir(process.env.FILE_STORAGE_PATH!);
  const db = new Database(path.join(root, "crm.db"));
  db.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT); INSERT INTO sample VALUES ('synthetic', 'local work')"); db.close();
  await writeFile(path.join(root, "files", "control.txt"), "synthetic attachment");
  await atomicJson(path.join(root, "identity.json"), identity);
  await mkdir(commandRoot(), { recursive: true });
  const settings = defaultSettings(); settings.retention.keep = 100;
  await atomicJson(path.join(backupRuntimeRoot(), "settings.json"), settings);
  await runtimeCredentialStore().put("8eec6cb8-1441-47c9-bf72-5c134870ab18", { token: "synthetic credential must stay private" });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function queue(action: string, backupId?: string, confirmed = true) {
  const id = randomUUID(), ref = randomUUID();
  await runtimeCredentialStore().put(ref, secret);
  await atomicJson(path.join(commandRoot(), id + ".json"), { id, secretRef: ref, createdAt: new Date().toISOString(), command: { action, backupId, confirmed, recoveryKeySaved: true } });
  return { id, ref };
}
async function run(action: string, backupId?: string, confirmed = true) { return executeDesktopBackupRequest((await queue(action, backupId, confirmed)).id); }
async function snapshot(skipRef?: string) {
  const files: Record<string, string> = {};
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (file === commandRoot() || (skipRef && e.name === skipRef + ".secret.json")) continue;
      if (e.isDirectory()) await walk(file);
      else files[path.relative(root, file)] = (await readFile(file)).toString("base64");
    }
  }
  await walk(root); return files;
}
async function denied(request: Awaited<ReturnType<typeof queue>>, code: string) {
  const before = await snapshot(request.ref), url = process.env.DATABASE_URL;
  const open = vi.spyOn(WindowsDpapiProtector.prototype, "open"); open.mockClear();
  const result = await executeDesktopBackupRequest(request.id);
  expect(result).toEqual({ status: "failed", errorCode: code });
  expect(open).not.toHaveBeenCalled();
  expect(await snapshot()).toEqual(before); expect(process.env.DATABASE_URL).toBe(url);
  const output = await readFile(path.join(commandRoot(), request.id + ".result.json"), "utf8");
  for (const value of [root, request.ref, secret.passphrase, secret.recoveryKey, "synthetic credential must stay private"]) expect(output).not.toContain(value);
  await expect(readFile(path.join(commandRoot(), request.id + ".json"))).rejects.toMatchObject({ code: "ENOENT" });
}
async function validState() {
  return { ...identity, backupId: randomUUID(), parentBackupId: null, snapshotRevision: 1, manifestSha256: "a".repeat(64), fingerprint: businessFingerprint(path.join(root, "crm.db")), dirtySinceBackup: false, readOnly: true };
}

it("real active create works; an already queued create/give/restore cannot clear a later legitimate give", async () => {
  expect(await run("create")).toMatchObject({ status: "verified", readOnly: false });
  const stale = await queue("create"), give = await queue("give"), restore = await queue("restore", randomUUID());
  expect(await run("give")).toMatchObject({ status: "verified", readOnly: true });
  expect(process.env.INSTANCE_ROLE).toBe("active");
  await denied(stale, "INSTANCE_READ_ONLY"); await denied(give, "INSTANCE_READ_ONLY"); await denied(restore, "INSTANCE_READ_ONLY");
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  await supervisor.configureHandoff(root); expect(process.env.INSTANCE_ROLE).toBe("standby");
}, 60000);

it.each(["create", "give", "restore"])("environment standby also denies %s without handoff state", async action => {
  vi.stubEnv("INSTANCE_ROLE", "standby"); await denied(await queue(action, randomUUID()), "INSTANCE_READ_ONLY");
});

const malformed = [null, [], false, "synthetic-invalid", {}, { readOnly: false }, { deploymentId: "bad", readOnly: false },
  ...[undefined, null, 0, 1, "false", "true", {}, []].map(readOnly => ({ deploymentId: "a2ef4a62-18a7-4e67-9070-e5c8fdb496e7", readOnly }))];
it.each(malformed.map((value, index) => ({ value, index })))("malformed adoption #$index refuses startup and upgrade before credentials or mutations", async ({ value }) => {
  await atomicJson(path.join(root, "handoff-state.json"), value);
  const before = await snapshot(), role = process.env.INSTANCE_ROLE, deployment = process.env.DEPLOYMENT_ID;
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  await expect(supervisor.configureHandoff(root)).rejects.toThrow("HANDOFF_STATE_INVALID");
  await expect(createDesktopSafetySnapshot()).rejects.toThrow("HANDOFF_STATE_INVALID");
  expect(process.env.INSTANCE_ROLE).toBe(role); expect(process.env.DEPLOYMENT_ID).toBe(deployment);
  expect(await snapshot()).toEqual(before);
});

it.each(["create", "give", "restore", "receive", "compare", "verify"])("corrupt durable state refuses %s with fixed diagnostic and no side effects", async action => {
  await atomicJson(path.join(root, "handoff-state.json"), { ...await validState(), readOnly: "false" });
  await denied(await queue(action, randomUUID()), "HANDOFF_STATE_INVALID");
});
it.each(["fingerprint", "backupId", "snapshotRevision", "dirtySinceBackup", "parentBackupId", "manifestSha256"])("local state validates %s before command execution", async field => {
  await atomicJson(path.join(root, "handoff-state.json"), { ...await validState(), [field]: "invalid" });
  await denied(await queue("create"), "HANDOFF_STATE_INVALID");
});

it("upgrade independently rejects malformed adoption before creating credential or archive files", async () => {
  await atomicJson(path.join(root, "handoff-state.json"), { deploymentId: identity.deploymentId, readOnly: 0 });
  const before = await snapshot();
  const open = vi.spyOn(WindowsDpapiProtector.prototype, "open"); open.mockClear();
  await expect(createDesktopSafetySnapshot()).rejects.toThrow("HANDOFF_STATE_INVALID");
  expect(open).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
});

it("invalid JSON is fail-closed at startup, upgrade and the durable command boundary", async () => {
  await writeFile(path.join(root, "handoff-state.json"), "{synthetic malformed JSON");
  const before = await snapshot();
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  await expect(supervisor.configureHandoff(root)).rejects.toThrow("HANDOFF_STATE_INVALID");
  await expect(createDesktopSafetySnapshot()).rejects.toThrow("HANDOFF_STATE_INVALID");
  expect(await snapshot()).toEqual(before);
  await denied(await queue("create"), "HANDOFF_STATE_INVALID");
});

it("ordinary explicit restore remains available to an active installation but is never a standby promotion", async () => {
  expect(await run("create")).toMatchObject({ status: "verified", readOnly: false });
  const own = JSON.parse(await readFile(path.join(root, "handoff-state.json"), "utf8"));
  expect(await run("restore", own.backupId, false)).toEqual({ status: "failed", errorCode: "RESTORE_CONFIRMATION_REQUIRED" });
  const db = new Database(path.join(root, "crm.db")); db.exec("UPDATE sample SET label='new local work'"); db.close();
  expect(await run("restore", own.backupId)).toMatchObject({ status: "restored", protectiveBackupId: expect.any(String) });
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  await supervisor.configureActiveGeneration(root); await supervisor.configureHandoff(root);
  expect(process.env.INSTANCE_ROLE).toBe("active");
  const restored = new Database(process.env.DATABASE_URL!.slice(5));
  expect(restored.prepare("SELECT label FROM sample").pluck().get()).toBe("local work"); restored.close();
}, 60000);

it("valid legacy adoption tolerates extra fields and retains boolean roles", async () => {
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  for (const readOnly of [true, false]) {
    await atomicJson(path.join(root, "handoff-state.json"), { ...await validState(), readOnly, futureField: "compatible" });
    await supervisor.configureHandoff(root); expect(process.env.INSTANCE_ROLE).toBe(readOnly ? "standby" : "active");
    const checked = await createDesktopSafetySnapshot(); expect(checked.manifest.deploymentId).toBe(identity.deploymentId);
  }
}, 60000);

it("standby permits verify/compare, byte-preserving same/local_changed receive and confirmed child recovery only", async () => {
  expect(await run("give")).toMatchObject({ status: "verified", readOnly: true });
  const own = JSON.parse(await readFile(path.join(root, "handoff-state.json"), "utf8"));
  vi.stubEnv("INSTANCE_ROLE", "standby");
  for (const action of ["verify", "compare", "receive"]) {
    const before = await snapshot();
    expect(await run(action, own.backupId)).toMatchObject({ status: action === "verify" ? "verified" : "same" });
    expect(await snapshot()).toEqual(before);
  }
  const db = new Database(path.join(root, "crm.db")); db.exec("UPDATE sample SET label='local changed'"); db.close();
  const changed = await snapshot(); expect(await run("receive", own.backupId)).toEqual({ status: "local_changed" }); expect(await snapshot()).toEqual(changed);
  const local = new Database(path.join(root, "crm.db")); local.exec("UPDATE sample SET label='local work'"); local.close();
  const source = path.join(root, "child.sqlite"), childDb = new Database(source);
  childDb.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT); INSERT INTO sample VALUES ('synthetic', 'returned work')"); childDb.close();
  const docs = path.join(root, "child-docs"); await mkdir(docs); await writeFile(path.join(docs, "control.txt"), "returned attachment");
  const child = await createArchive({ outputDir: archiveRoot(), stagingRoot: path.join(root, "child-stage"), validator,
    source: { async createConsistentSnapshot(dest) { const db = new Database(source); try { await db.backup(dest); } finally { db.close(); } } }, barrier: { run: async work => work() },
    metadata: { ...identity, instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: own.snapshotRevision + 1, parentBackupId: own.backupId, crmVersion: "synthetic", schemaVersion: 1 },
    ...secret, recoveryKeySaved: true, storage: { documents: docs }, settings: { timeZone: "UTC" } });
  const before = await snapshot(); expect(await run("receive", child.archive.backupId, false)).toEqual({ status: "failed", errorCode: "RESTORE_CONFIRMATION_REQUIRED" }); expect(await snapshot()).toEqual(before);
  expect(await run("receive", child.archive.backupId)).toMatchObject({ status: "restored" });
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs"); await supervisor.configureActiveGeneration(root); await supervisor.configureHandoff(root);
  expect(process.env.INSTANCE_ROLE).toBe("active");
  expect(await readFile(path.join(process.env.FILE_STORAGE_PATH!, "control.txt"), "utf8")).toBe("returned attachment");
  const returned = new Database(process.env.DATABASE_URL!.slice(5)); expect(returned.prepare("SELECT label FROM sample").pluck().get()).toBe("returned work"); returned.close();
  const checked = await extractArchive({ archivePath: child.path, stagingRoot: path.join(root, "inspection"), validator, schemaVersion: 1, credential: { passphrase: secret.passphrase } }); await checked.dispose();
}, 60000);
