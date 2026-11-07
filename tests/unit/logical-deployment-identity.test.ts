import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

vi.mock("@/shared/db/client", () => ({ disconnectDb: async () => {}, db: { backupQueueJournal: {
  upsert: async () => ({ revision: 0, payload: { version: 1, rows: [] } }), updateMany: async () => ({ count: 1 }),
} } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
// Keep archive, SQLite, generation publication and credential-file encryption real.
// Only the OS-specific DPAPI envelope and CRM migrations are replaced.
vi.mock("../../scripts/desktop/database-lifecycle", () => ({ applySqliteMigrations: () => {} }));
import { WindowsDpapiProtector, ServerAesProtector } from "@/modules/desktop-backup/infrastructure/credential-store";
import { executeDesktopBackupRequest } from "@/modules/desktop-backup/application/desktop-coordinator";
import { archiveRoot, commandRoot } from "@/modules/desktop-backup/application/backup-control";
import { runtimeCredentialStore, backupRuntimeRoot } from "@/modules/desktop-backup/infrastructure/destinations-runtime";
import { extractArchive } from "@/modules/desktop-backup/infrastructure/archive";
import { SqliteSnapshotValidator } from "@/modules/desktop-backup/infrastructure/sqlite-validator";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { defaultSettings } from "@/modules/desktop-backup/domain/settings";
import { atomicJson } from "@/modules/desktop-backup/infrastructure/fs";
import { GenerationStore } from "@/modules/desktop-backup/application/restore";
import { createDesktopSafetySnapshot } from "../../scripts/desktop/runtime/upgrade";

type Installation = { root: string; identity: { deploymentId: string; instanceId: string; deviceId: string }; cloudRef: string };
const roots: string[] = [];
const secret = { passphrase: "synthetic logical identity passphrase", recoveryKey: newRecoveryKey() };
const validator = new SqliteSnapshotValidator();
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function select(installation: Installation) {
  const { root, identity } = installation;
  for (const [key, value] of Object.entries({ DESKTOP_DATA_DIR: root, DATABASE_URL: "file:" + path.join(root, "crm.db"), FILE_STORAGE_PATH: path.join(root, "files"), BACKUP_PATH: path.join(root, "backups"), BACKUP_SETTINGS_DIR: path.join(root, "backup-settings"), CRM_DEPLOYMENT_MODE: "desktop", CRM_BACKUP_WRITERS_STOPPED: "1", INSTANCE_ROLE: "active", DEPLOYMENT_ID: identity.deploymentId, INSTANCE_ID: identity.instanceId })) vi.stubEnv(key, value);
  // Explicit restart simulation: use the real supervisor's generation/role configuration,
  // not a fabricated database path. No launcher, server or worker is started.
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  await supervisor.configureActiveGeneration(root);
  await supervisor.configureHandoff(root);
}
async function fresh(empty: boolean): Promise<Installation> {
  const root = await mkdtemp(path.join(tmpdir(), "crm-logical-identity-")); roots.push(root);
  const installation = { root, identity: { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() }, cloudRef: randomUUID() };
  await mkdir(path.join(root, "files"));
  const db = new Database(path.join(root, "crm.db")); db.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT)");
  if (!empty) db.prepare("INSERT INTO sample VALUES (?, ?)").run("synthetic", "A work"); db.close();
  await writeFile(path.join(root, "files", "control.txt"), empty ? "B bootstrap" : "A attachment");
  await atomicJson(path.join(root, "identity.json"), installation.identity);
  await select(installation);
  const settings = defaultSettings(); settings.retention.keep = 100;
  settings.schedule.timeZone = empty ? "UTC" : "Asia/Novosibirsk";
  settings.destinations.push({ config: { id: randomUUID(), kind: "yandex_s3", enabled: false, bucket: "synthetic-bucket", prefix: empty ? "B" : "A", endpoint: "https://storage.yandexcloud.net", region: "ru-central1" }, secretRef: installation.cloudRef });
  await mkdir(commandRoot(), { recursive: true });
  await atomicJson(path.join(backupRuntimeRoot(), "settings.json"), settings);
  await runtimeCredentialStore().put(installation.cloudRef, { accessKeyId: "synthetic-" + installation.identity.deviceId, secretAccessKey: "synthetic-only" });
  return installation;
}
async function command(action: "give" | "receive" | "compare", backupId?: string) {
  const id = randomUUID(), ref = randomUUID(); await runtimeCredentialStore().put(ref, secret);
  await atomicJson(path.join(commandRoot(), id + ".json"), { id, secretRef: ref, createdAt: new Date().toISOString(), command: { action, backupId, confirmed: true, recoveryKeySaved: true } });
  return executeDesktopBackupRequest(id);
}
async function give() {
  expect(await command("give")).toMatchObject({ status: "verified", readOnly: true });
  const state = JSON.parse(await readFile(path.join(process.env.DESKTOP_DATA_DIR!, "handoff-state.json"), "utf8"));
  const file = path.join(archiveRoot(), state.backupId + ".crmbackup");
  const checked = await extractArchive({ archivePath: file, credential: { passphrase: secret.passphrase }, validator, schemaVersion: 1, stagingRoot: path.join(process.env.DESKTOP_DATA_DIR!, "inspection") });
  const manifest = checked.manifest; await checked.dispose(); return { file, manifest };
}
async function deliver(archive: Awaited<ReturnType<typeof give>>, to: Installation) {
  await select(to); await mkdir(archiveRoot(), { recursive: true });
  const dest = path.join(archiveRoot(), archive.manifest.backupId + ".crmbackup");
  if (dest !== archive.file) await copyFile(archive.file, dest);
}
async function unchangedReceive(id: string, status: string) {
  const root = process.env.DESKTOP_DATA_DIR!;
  const files = [path.join(root, "identity.json"), path.join(root, "handoff-state.json"), path.join(root, "runtime-generations", "current.json"), process.env.DATABASE_URL!.slice(5), path.join(process.env.FILE_STORAGE_PATH!, "control.txt")];
  const before = await Promise.all(files.map(f => readFile(f)));
  expect(await command("receive", id)).toMatchObject(status === "conflict" ? { status: "failed", errorCode: "TRANSFER_REVISION_CONFLICT" } : { status });
  expect(await Promise.all(files.map(f => readFile(f)))).toEqual(before);
}
it("preserves logical deployment through distinct A→B→A encrypted give/receive, restart and upgrade without cloning local configuration", async () => {
  const aes = new ServerAesProtector(() => Buffer.alloc(32, 7).toString("base64"));
  vi.spyOn(WindowsDpapiProtector.prototype, "seal").mockImplementation((b, c) => aes.seal(b, c));
  vi.spyOn(WindowsDpapiProtector.prototype, "open").mockImplementation((b, c) => aes.open(b, c));
  const a = await fresh(false), b = await fresh(true);
  expect(a.identity.deploymentId).not.toBe(b.identity.deploymentId);
  expect(a.identity.instanceId).not.toBe(b.identity.instanceId); expect(a.identity.deviceId).not.toBe(b.identity.deviceId);
  const settingsFile = path.join(b.root, "backup-settings", "settings.json"), credentialFile = path.join(b.root, "backup-settings", "credentials", b.cloudRef + ".secret.json");
  const settingsBefore = await readFile(settingsFile), credentialsBefore = await readFile(credentialFile);
  await select(a); const parent = await give();
  await deliver(parent, b); expect(await command("receive", parent.manifest.backupId)).toMatchObject({ status: "restored" });
  await select(b);
  expect(process.env.DEPLOYMENT_ID).toBe(a.identity.deploymentId);
  expect(process.env.INSTANCE_ID).toBe(b.identity.instanceId); expect(process.env.INSTANCE_ROLE).toBe("active");
  expect(JSON.parse(await readFile(path.join(b.root, "identity.json"), "utf8"))).toEqual(b.identity);
  expect(await readFile(settingsFile)).toEqual(settingsBefore); expect(await readFile(credentialFile)).toEqual(credentialsBefore);
  expect(await runtimeCredentialStore().get(b.cloudRef)).toMatchObject({ accessKeyId: "synthetic-" + b.identity.deviceId });
  await unchangedReceive(parent.manifest.backupId, "same");
  const db = new Database(process.env.DATABASE_URL!.slice(5)); db.exec("UPDATE sample SET label='B successor work'"); db.close();
  await writeFile(path.join(process.env.FILE_STORAGE_PATH!, "control.txt"), "B successor attachment");
  await unchangedReceive(parent.manifest.backupId, "local_changed");
  const upgrade = await createDesktopSafetySnapshot();
  expect(upgrade.manifest).toMatchObject({ deploymentId: a.identity.deploymentId, instanceId: b.identity.instanceId, deviceId: b.identity.deviceId });
  const child = await give();
  expect(child.manifest).toMatchObject({ deploymentId: a.identity.deploymentId, instanceId: b.identity.instanceId, deviceId: b.identity.deviceId, parentBackupId: parent.manifest.backupId, snapshotRevision: parent.manifest.snapshotRevision + 1 });
  await select(b); expect(process.env.DEPLOYMENT_ID).toBe(a.identity.deploymentId);
  expect(process.env.INSTANCE_ROLE).toBe("standby");
  await deliver(child, a); expect(await command("receive", child.manifest.backupId)).toMatchObject({ status: "restored" });
  await select(a); expect(process.env.DEPLOYMENT_ID).toBe(a.identity.deploymentId); expect(process.env.INSTANCE_ROLE).toBe("active");
  expect(process.env.INSTANCE_ID).toBe(a.identity.instanceId);
  expect(JSON.parse(await readFile(path.join(a.root, "identity.json"), "utf8"))).toEqual(a.identity);
  const returned = new Database(process.env.DATABASE_URL!.slice(5), { readonly: true });
  expect(returned.prepare("SELECT label FROM sample").pluck().get()).toBe("B successor work"); returned.close();
  expect(await readFile(path.join(process.env.FILE_STORAGE_PATH!, "control.txt"), "utf8")).toBe("B successor attachment");
  expect((await new GenerationStore(path.join(a.root, "runtime-generations")).current())?.backupId).toBe(child.manifest.backupId);
  // Both installations now know the same child. Two actual gives produce siblings.
  const siblingA = await give(); await select(b);
  // Synthetic split-brain fixture only: deliberately model an independently
  // authorized branch. Ordinary give on B's real standby state is now denied.
  const bStateFile = path.join(b.root, "handoff-state.json");
  const bState = JSON.parse(await readFile(bStateFile, "utf8"));
  await atomicJson(bStateFile, { ...bState, readOnly: false });
  await select(b); const siblingB = await give();
  expect(siblingA.manifest.parentBackupId).toBe(child.manifest.backupId);
  expect(siblingB.manifest.parentBackupId).toBe(child.manifest.backupId);
  await deliver(siblingA, b); await unchangedReceive(siblingA.manifest.backupId, "conflict");
  // Separate fresh foreign dataset generates its own real encrypted archive.
  const foreign = await fresh(false); await select(foreign); const unrelated = await give();
  await deliver(unrelated, a); await unchangedReceive(unrelated.manifest.backupId, "conflict");
  expect(await readFile(settingsFile)).toEqual(settingsBefore); expect(await readFile(credentialFile)).toEqual(credentialsBefore);
}, 120000);

it("uses bootstrap deployment before adoption and refuses malformed transferred identity on restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "crm-logical-identity-restart-")); roots.push(root);
  const supervisor = await import("../../scripts/desktop/runtime/supervisor.mjs");
  const bootstrap = randomUUID(); vi.stubEnv("DEPLOYMENT_ID", bootstrap); vi.stubEnv("INSTANCE_ROLE", "active");
  await supervisor.configureHandoff(root); expect(process.env.DEPLOYMENT_ID).toBe(bootstrap);
  await atomicJson(path.join(root, "handoff-state.json"), { deploymentId: "invalid", readOnly: false });
  await expect(supervisor.configureHandoff(root)).rejects.toThrow("HANDOFF_STATE_INVALID");
  expect(process.env.DEPLOYMENT_ID).toBe(bootstrap);
});
