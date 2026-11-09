import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const state = vi.hoisted(() => ({ root: "", secrets: new Map<string, Record<string, string>>() }));
vi.mock("@/shared/db/client", () => ({ disconnectDb: async () => {}, db: { backupQueueJournal: {
  upsert: async () => ({ revision: 0, payload: { version: 1, rows: [] } }),
  updateMany: async () => ({ count: 1 }),
} } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
vi.mock("@/modules/desktop-backup/infrastructure/destinations-runtime", () => ({
  backupRuntimeRoot: () => path.join(state.root, "settings"),
  runtimeCredentialStore: () => ({
    get: async (ref: string) => { const secret = state.secrets.get(ref); if (!secret) throw new Error("missing synthetic secret"); return secret; },
    put: async (ref: string, secret: Record<string, string>) => { state.secrets.set(ref, secret); },
    delete: async (ref: string) => { state.secrets.delete(ref); },
  }),
  withBackupDestinations: async (work: (destinations: never[]) => Promise<unknown>) => work([]),
}));
vi.mock("../../scripts/desktop/database-lifecycle", () => ({ applySqliteMigrations: () => {} }));
import { executeDesktopBackupRequest, businessFingerprint } from "@/modules/desktop-backup/application/desktop-coordinator";
import { archiveRoot, commandRoot } from "@/modules/desktop-backup/application/backup-control";
import { createArchive, extractArchive } from "@/modules/desktop-backup/infrastructure/archive";
import { SqliteSnapshotValidator } from "@/modules/desktop-backup/infrastructure/sqlite-validator";
import { GenerationStore } from "@/modules/desktop-backup/application/restore";
import { defaultSettings } from "@/modules/desktop-backup/domain/settings";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { atomicJson } from "@/modules/desktop-backup/infrastructure/fs";

const keys = ["DESKTOP_DATA_DIR", "DATABASE_URL", "FILE_STORAGE_PATH", "BACKUP_PATH", "CRM_DEPLOYMENT_MODE", "CRM_BACKUP_WRITERS_STOPPED", "INSTANCE_ROLE"] as const;
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const secret = { passphrase: "synthetic return integration phrase", recoveryKey: newRecoveryKey() };
const validator = new SqliteSnapshotValidator();
let identity: { deploymentId: string; instanceId: string; deviceId: string };
let parentId: string;
let originalFingerprint: string;
beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), "crm-return-handoff-runtime-")); state.secrets.clear();
  process.env.DESKTOP_DATA_DIR = state.root; process.env.CRM_DEPLOYMENT_MODE = "desktop";
  process.env.CRM_BACKUP_WRITERS_STOPPED = "1"; process.env.INSTANCE_ROLE = "standby";
  process.env.DATABASE_URL = "file:" + path.join(state.root, "local.sqlite");
  process.env.FILE_STORAGE_PATH = path.join(state.root, "files"); process.env.BACKUP_PATH = path.join(state.root, "backups");
  await mkdir(process.env.FILE_STORAGE_PATH); await writeFile(path.join(process.env.FILE_STORAGE_PATH, "sample.txt"), "synthetic local attachment");
  const db = new Database(path.join(state.root, "local.sqlite"));
  db.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT); INSERT INTO sample VALUES ('own', 'synthetic local row')"); db.close();
  identity = { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID() }; parentId = randomUUID();
  originalFingerprint = businessFingerprint(path.join(state.root, "local.sqlite"));
  await atomicJson(path.join(state.root, "identity.json"), identity);
  await atomicJson(path.join(state.root, "handoff-state.json"), { ...identity, backupId: parentId, manifestSha256: "a".repeat(64), snapshotRevision: 1, parentBackupId: null, readOnly: true, dirtySinceBackup: false, fingerprint: originalFingerprint });
  await mkdir(commandRoot(), { recursive: true });
  await atomicJson(path.join(state.root, "settings", "settings.json"), defaultSettings());
});
afterEach(async () => {
  for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  await rm(state.root, { recursive: true, force: true });
});
async function incoming(change: Partial<typeof identity & { parentBackupId: string; snapshotRevision: number }> = {}) {
  const incomingDb = path.join(state.root, "incoming.sqlite"); const db = new Database(incomingDb);
  db.exec("CREATE TABLE sample(id TEXT PRIMARY KEY, label TEXT); INSERT INTO sample VALUES ('returned', 'synthetic returned row')"); db.close();
  const docs = path.join(state.root, "incoming-docs"); await mkdir(docs); await writeFile(path.join(docs, "sample.txt"), "synthetic returned attachment");
  return createArchive({
    outputDir: archiveRoot(), stagingRoot: path.join(state.root, "incoming-stage"), validator,
    barrier: { run: async work => work() }, source: { async createConsistentSnapshot(dest) { const source = new Database(incomingDb); try { await source.backup(dest); } finally { source.close(); } } },
    metadata: { ...identity, instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 2, parentBackupId: parentId, ...change, crmVersion: "synthetic", schemaVersion: 1 },
    ...secret, recoveryKeySaved: true, storage: { documents: docs }, settings: { timeZone: "UTC" },
  });
}
async function run(backupId: string, action: "receive" | "restore" = "receive") {
  const id = randomUUID(), ref = randomUUID(); state.secrets.set(ref, secret);
  await atomicJson(path.join(commandRoot(), id + ".json"), { id, secretRef: ref, actorUserId: "synthetic-manager", createdAt: new Date().toISOString(), command: { action, backupId, confirmed: true } });
  return executeDesktopBackupRequest(id);
}
describe("real stopped-runtime receive on isolated synthetic SQLite/files", () => {
  it.each([
    { dirty: false, readOnly: true }, { dirty: false, readOnly: false },
    { dirty: true, readOnly: true }, { dirty: true, readOnly: false },
  ])("known snapshot receive is a byte-preserving no-op (dirty=$dirty, readOnly=$readOnly)", async ({ dirty, readOnly }) => {
    const known = await incoming();
    await atomicJson(path.join(state.root, "handoff-state.json"), { ...identity, backupId: known.manifest.backupId, manifestSha256: known.manifest.manifestSha256, snapshotRevision: known.manifest.snapshotRevision, parentBackupId: known.manifest.parentBackupId, readOnly, dirtySinceBackup: false, fingerprint: originalFingerprint });
    if (dirty) {
      const db = new Database(path.join(state.root, "local.sqlite")); db.exec("UPDATE sample SET label = 'synthetic unsaved-to-backup work'"); db.close();
      await writeFile(path.join(process.env.FILE_STORAGE_PATH!, "sample.txt"), "synthetic changed attachment");
    }
    const beforeDb = await readFile(path.join(state.root, "local.sqlite"));
    const beforeFile = await readFile(path.join(process.env.FILE_STORAGE_PATH!, "sample.txt"));
    const beforeState = await readFile(path.join(state.root, "handoff-state.json"));
    const beforeIdentity = await readFile(path.join(state.root, "identity.json"));
    const beforeArchive = await readFile(known.path);
    const beforeArchives = (await readdir(archiveRoot())).sort();
    const beforeUrl = process.env.DATABASE_URL;
    expect(await run(known.archive.backupId)).toEqual({ status: dirty ? "local_changed" : "same" });
    expect(await readFile(path.join(state.root, "local.sqlite"))).toEqual(beforeDb);
    expect(await readFile(path.join(process.env.FILE_STORAGE_PATH!, "sample.txt"))).toEqual(beforeFile);
    expect(await readFile(path.join(state.root, "handoff-state.json"))).toEqual(beforeState);
    expect(await readFile(path.join(state.root, "identity.json"))).toEqual(beforeIdentity);
    expect(await readFile(known.path)).toEqual(beforeArchive);
    expect((await readdir(archiveRoot())).sort()).toEqual(beforeArchives);
    await expect(readdir(path.join(state.root, "runtime-generations"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(process.env.DATABASE_URL).toBe(beforeUrl);
    expect(state.secrets.size).toBe(0);
  });
  it.each([false, true])("active ordinary restore still applies the known snapshot (dirty=%s)", async dirty => {
    process.env.INSTANCE_ROLE = "active";
    const known = await incoming();
    await atomicJson(path.join(state.root, "handoff-state.json"), { ...identity, backupId: known.manifest.backupId, manifestSha256: known.manifest.manifestSha256, snapshotRevision: known.manifest.snapshotRevision, parentBackupId: known.manifest.parentBackupId, readOnly: false, dirtySinceBackup: false, fingerprint: originalFingerprint });
    if (dirty) { const db = new Database(path.join(state.root, "local.sqlite")); db.exec("UPDATE sample SET label = 'synthetic newer work'"); db.close(); }
    expect(await run(known.archive.backupId, "restore")).toMatchObject({ status: "restored", protectiveBackupId: expect.any(String) });
    const active = (await new GenerationStore(path.join(state.root, "runtime-generations")).currentPath())!;
    const db = new Database(path.join(active, "database.sqlite"), { readonly: true });
    try { expect(db.prepare("SELECT label FROM sample").pluck().get()).toBe("synthetic returned row"); } finally { db.close(); }
    expect(await readFile(path.join(active, "documents", "sample.txt"), "utf8")).toBe("synthetic returned attachment");
  });
  it("successful give records source read-only, then explicit child receive returns ownership without cloning device identity", async () => {
    process.env.INSTANCE_ROLE = "active";
    const initialStatePath = path.join(state.root, "handoff-state.json");
    const initialState = JSON.parse(await readFile(initialStatePath, "utf8"));
    await atomicJson(initialStatePath, { ...initialState, readOnly: false });
    const id = randomUUID(), ref = randomUUID(); state.secrets.set(ref, secret);
    await atomicJson(path.join(commandRoot(), id + ".json"), { id, secretRef: ref, actorUserId: "synthetic-manager", createdAt: new Date().toISOString(), command: { action: "give", recoveryKeySaved: true } });
    const given = await executeDesktopBackupRequest(id);
    expect(given).toMatchObject({ status: "verified", readOnly: true });
    const own = JSON.parse(await readFile(path.join(state.root, "handoff-state.json"), "utf8"));
    expect(own.readOnly).toBe(true); parentId = own.backupId;
    const child = await incoming({ snapshotRevision: own.snapshotRevision + 1 });
    expect(await run(child.archive.backupId)).toMatchObject({ status: "restored" });
    expect(JSON.parse(await readFile(path.join(state.root, "handoff-state.json"), "utf8"))).toMatchObject({ ...identity, readOnly: false, backupId: child.archive.backupId });
  });
  it("empty first receive adopts the source deployment while retaining local instance/device IDs", async () => {
    await rm(path.join(state.root, "handoff-state.json"));
    const db = new Database(path.join(state.root, "local.sqlite")); db.exec("DELETE FROM sample"); db.close();
    const sourceDeployment = randomUUID();
    const child = await incoming({ deploymentId: sourceDeployment });
    expect(await run(child.archive.backupId)).toMatchObject({ status: "restored" });
    expect(JSON.parse(await readFile(path.join(state.root, "handoff-state.json"), "utf8"))).toMatchObject({ deploymentId: sourceDeployment, instanceId: identity.instanceId, deviceId: identity.deviceId, backupId: child.archive.backupId });
    expect(JSON.parse(await readFile(path.join(state.root, "identity.json"), "utf8"))).toEqual(identity);
  });
  it("receives a valid child on standby, preserves installation identity and makes a verifiable protective archive", async () => {
    const child = await incoming(); const result = await run(child.archive.backupId);
    expect(result, JSON.stringify(result)).toMatchObject({ status: "restored" });
    const store = new GenerationStore(path.join(state.root, "runtime-generations"));
    expect((await store.current())?.backupId).toBe(child.archive.backupId);
    const active = (await store.currentPath())!; const db = new Database(path.join(active, "database.sqlite"), { readonly: true });
    expect(db.prepare("SELECT label FROM sample").pluck().get()).toBe("synthetic returned row"); db.close();
    expect(await readFile(path.join(active, "documents", "sample.txt"), "utf8")).toBe("synthetic returned attachment");
    const local = JSON.parse(await readFile(path.join(state.root, "handoff-state.json"), "utf8"));
    expect(local).toMatchObject({ ...identity, backupId: child.archive.backupId, readOnly: false });
    expect(businessFingerprint(path.join(state.root, "local.sqlite"))).toBe(originalFingerprint);
    const protectivePath = path.join(archiveRoot(), result.protectiveBackupId + ".crmbackup");
    const recovery = JSON.parse(await readFile(protectivePath + ".recovery.json", "utf8"));
    const checked = await extractArchive({ archivePath: protectivePath, credential: { passphrase: state.secrets.get(recovery.secretRef)!.passphrase! }, validator, schemaVersion: 1, stagingRoot: path.join(state.root, "verify") });
    expect(businessFingerprint(path.join(checked.stage, "database.sqlite"))).toBe(originalFingerprint); await checked.dispose();
    expect(await readFile(child.path)).not.toHaveLength(0);
  });
  it.each(["foreign-deployment", "sibling", "stale-revision", "dirty-local"])("refuses %s without switching generations or losing either version", async kind => {
    const child = await incoming(kind === "foreign-deployment" ? { deploymentId: randomUUID() } : kind === "sibling" ? { parentBackupId: randomUUID() } : kind === "stale-revision" ? { snapshotRevision: 1 } : {});
    if (kind === "dirty-local") { const db = new Database(path.join(state.root, "local.sqlite")); db.exec("UPDATE sample SET label = 'synthetic divergent row'"); db.close(); }
    const beforeDb = businessFingerprint(path.join(state.root, "local.sqlite"));
    const beforeState = await readFile(path.join(state.root, "handoff-state.json")); const beforeArchive = await readFile(child.path);
    expect(await run(child.archive.backupId)).toMatchObject({ status: "failed", errorCode: "TRANSFER_REVISION_CONFLICT" });
    expect(await new GenerationStore(path.join(state.root, "runtime-generations")).current()).toBeNull();
    expect(await readFile(path.join(state.root, "handoff-state.json"))).toEqual(beforeState);
    expect(businessFingerprint(path.join(state.root, "local.sqlite"))).toBe(beforeDb);
    expect(await readFile(child.path)).toEqual(beforeArchive);
    expect(await readFile(path.join(process.env.FILE_STORAGE_PATH!, "sample.txt"), "utf8")).toBe("synthetic local attachment");
    expect((await readdir(archiveRoot())).filter(name => name.endsWith(".crmbackup"))).toHaveLength(1);
  });
});
