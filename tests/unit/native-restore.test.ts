import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, utimes, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { createArchive } from "@/modules/desktop-backup/infrastructure/archive";
import { SqliteSnapshotValidator } from "@/modules/desktop-backup/infrastructure/sqlite-validator";
import { newRecoveryKey } from "@/modules/desktop-backup/infrastructure/encryption";
import { GenerationStore, restoreArchive } from "@/modules/desktop-backup/application/restore";
import { importNativeArchive, nativeIncomingRoot, readNativeDialog, requestNativeDialog } from "@/modules/desktop-backup/application/native-dialog";

// No application database or credentials; all fixtures are synthetic and local.
vi.mock("@/shared/db/client", () => ({ db: { backupQueueJournal: { create: vi.fn() } } }));
vi.mock("@/modules/operations/application/operations-service", () => ({ startManualBackup: vi.fn() }));
const credentials = vi.hoisted(() => ({ put: vi.fn(async () => undefined) }));
vi.mock("@/modules/desktop-backup/infrastructure/destinations-runtime", async importOriginal => ({
  ...await importOriginal<typeof import("@/modules/desktop-backup/infrastructure/destinations-runtime")>(),
  runtimeCredentialStore: () => credentials,
}));
import { backupCommandSchema, backupControlCommand } from "@/modules/desktop-backup/application/backup-control";
import type { Actor } from "@/modules/auth/domain/actor";

const phrase = "synthetic-only-passphrase";
const actor = { userId: randomUUID(), role: "manager" } as Actor;
let temp: string;
let runtime: {
  NATIVE_IMPORT_TTL: number;
  stageNativeImport(file: string, root: string, id: string, actor: string, maxBytes?: number): Promise<{ status: string }>;
  cleanupNativeIncoming(root: string): Promise<void>;
};
beforeEach(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "native-restore-"));
  vi.stubEnv("LOCALAPPDATA", temp);
  vi.stubEnv("BACKUP_SETTINGS_DIR", path.join(temp, "settings"));
  vi.stubEnv("BACKUP_PATH", path.join(temp, "backups"));
  vi.stubEnv("CRM_DEPLOYMENT_MODE", "desktop");
  vi.stubEnv("CRM_DESKTOP_SUPERVISED_UPGRADE", "1");
  const runtimeModule = "../../scripts/desktop/runtime/supervisor.mjs";
  runtime = await import(runtimeModule);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(temp, { recursive: true, force: true }); });
async function fixture() {
  const recoveryKey = newRecoveryKey();
  const archive = await createArchive({
    outputDir: path.join(temp, "source"), stagingRoot: path.join(temp, "build"),
    validator: new SqliteSnapshotValidator(), barrier: { run: work => work() },
    source: { async createConsistentSnapshot(file) { const db = new Database(file); db.exec("CREATE TABLE synthetic (id INTEGER PRIMARY KEY); INSERT INTO synthetic VALUES (1)"); db.close(); } },
    metadata: { deploymentId: randomUUID(), instanceId: randomUUID(), deviceId: randomUUID(), snapshotRevision: 1, parentBackupId: null, crmVersion: "synthetic", schemaVersion: 1 },
    passphrase: phrase, recoveryKey, recoveryKeySaved: true, settings: {}, storage: {},
  });
  return { ...archive, recoveryKey };
}
describe("native file restore staging", () => {
  it("imports a standalone renamed encrypted archive without sidecar using authenticated manifest ID", async () => {
    const f = await fixture(); const selected = path.join(temp, "USB-renamed.crmbackup");
    await writeFile(selected, await readFile(f.path));
    const id = randomUUID();
    const result = await runtime.stageNativeImport(selected, nativeIncomingRoot(), id, actor.userId);
    expect(result.status).toBe("selected"); expect(JSON.stringify(result)).not.toContain(temp);
    const output = path.join(temp, "catalog");
    expect(await importNativeArchive(id, actor.userId, { passphrase: phrase }, output)).toBe(f.archive.backupId);
    expect(await readFile(path.join(output, f.archive.backupId + ".crmbackup"))).toEqual(await readFile(selected));
    expect(await readdir(nativeIncomingRoot())).toEqual([]);
    await expect(importNativeArchive(id, actor.userId, { passphrase: phrase }, output)).rejects.toThrow();
  });
  it("accepts recovery key and rejects wrong secret without publishing", async () => {
    const f = await fixture(); let id = randomUUID(); const output = path.join(temp, "catalog");
    await runtime.stageNativeImport(f.path, nativeIncomingRoot(), id, actor.userId);
    await expect(importNativeArchive(id, actor.userId, { passphrase: "wrong-synthetic-phrase" }, output)).rejects.toThrow();
    expect(await readdir(output).catch(() => [])).toEqual([]);
    id = randomUUID(); await runtime.stageNativeImport(f.path, nativeIncomingRoot(), id, actor.userId);
    expect(await importNativeArchive(id, actor.userId, { recoveryKey: f.recoveryKey }, output)).toBe(f.archive.backupId);
  });
  it("queues the existing credential-only restore command; generic restore verifies protective backup before switch", async () => {
    const f = await fixture(); const id = randomUUID();
    await runtime.stageNativeImport(f.path, nativeIncomingRoot(), id, actor.userId);
    const response = await backupControlCommand(actor, { action: "restore-from-file", requestId: id, confirmed: true, passphrase: phrase }) as { queued: boolean; requestId: string };
    expect(response.queued).toBe(true);
    const request = JSON.parse(await readFile(path.join(temp, "settings/commands", response.requestId + ".json"), "utf8"));
    expect(request.command).toEqual({ action: "restore", backupId: f.archive.backupId, confirmed: true });
    expect(request.actorUserId).toBe(actor.userId);
    expect(JSON.stringify(request)).not.toContain(phrase); expect(JSON.stringify(response)).not.toContain(temp);
    expect(credentials.put).toHaveBeenCalledWith(request.secretRef, { passphrase: phrase });
    const store = new GenerationStore(path.join(temp, "generations")); const events: string[] = [];
    await restoreArchive({ archivePath: path.join(temp, "backups/portable", request.command.backupId + ".crmbackup"), credential: { passphrase: phrase }, schemaVersion: 1, validator: new SqliteSnapshotValidator(), store, confirmed: true,
      hooks: { async prepareStage() { events.push("prepare"); }, async withStoppedRuntime(work) { events.push("stopped"); return work(); }, async protectCurrent() { expect(await store.current()).toBeNull(); events.push("protect"); return { ...f, credential: { passphrase: phrase } }; } },
    });
    expect(events).toEqual(["prepare", "stopped", "protect"]);
    const current = await store.current(); expect(current?.backupId).toBe(f.archive.backupId);
    const restored = new Database(path.join((await store.currentPath())!, "database.sqlite"), { readonly: true });
    expect(restored.prepare("SELECT id FROM synthetic").get()).toEqual({ id: 1 }); restored.close();
    await expect(backupControlCommand(actor, { action: "restore-from-file", requestId: id, confirmed: true, passphrase: phrase })).rejects.toThrow();
  });
  it("fails before generation switch when protective backup fails", async () => {
    const f = await fixture(); const store = new GenerationStore(path.join(temp, "generations"));
    await expect(restoreArchive({ archivePath: f.path, credential: { passphrase: phrase }, schemaVersion: 1, validator: new SqliteSnapshotValidator(), store, confirmed: true,
      hooks: { async prepareStage() {}, async withStoppedRuntime(work) { return work(); }, async protectCurrent() { throw Error("synthetic disk full"); } },
    })).rejects.toThrow("synthetic disk full");
    expect(await store.current()).toBeNull();
  });
  it("rejects malformed, oversized, directory and traversal inputs", async () => {
    const file = path.join(temp, "invalid.crmbackup"); await writeFile(file, Buffer.alloc(64));
    await expect(runtime.stageNativeImport(file, nativeIncomingRoot(), randomUUID(), actor.userId)).rejects.toThrow("IMPORT_FORMAT");
    const f = await fixture();
    await expect(runtime.stageNativeImport(f.path, nativeIncomingRoot(), randomUUID(), actor.userId, 32)).rejects.toThrow("IMPORT_SIZE");
    await expect(runtime.stageNativeImport(f.path, nativeIncomingRoot(), "../../escape", actor.userId)).rejects.toThrow("IMPORT_ID");
    await expect(runtime.stageNativeImport(path.dirname(f.path) + path.sep + ".." + path.sep + "invalid.crmbackup", nativeIncomingRoot(), randomUUID(), actor.userId)).rejects.toThrow("IMPORT_PATH");
    const directory = path.join(temp, "directory.crmbackup"); await mkdir(directory);
    await expect(runtime.stageNativeImport(directory, nativeIncomingRoot(), randomUUID(), actor.userId)).rejects.toThrow();
  });
  it("rejects junction paths", async () => {
    const f = await fixture(); const junction = path.join(temp, "junction");
    await symlink(path.dirname(f.path), junction, "junction");
    await expect(runtime.stageNativeImport(path.join(junction, path.basename(f.path)), nativeIncomingRoot(), randomUUID(), actor.userId)).rejects.toThrow("IMPORT_REPARSE_POINT");
    await expect(runtime.cleanupNativeIncoming(junction)).rejects.toThrow("IMPORT_REPARSE_POINT");
  });
  it("detects staging tampering, caps pending imports, and never overwrites catalog archives", async () => {
    const f = await fixture(); const id = randomUUID(); const output = path.join(temp, "catalog");
    await runtime.stageNativeImport(f.path, nativeIncomingRoot(), id, actor.userId);
    const metadataPath = path.join(nativeIncomingRoot(), id, "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, sha256: "0".repeat(64) }));
    await expect(importNativeArchive(id, actor.userId, { passphrase: phrase }, output)).rejects.toThrow("IMPORT_CHECKSUM");
    const next = randomUUID(); await runtime.stageNativeImport(f.path, nativeIncomingRoot(), next, actor.userId);
    await mkdir(output); await writeFile(path.join(output, f.archive.backupId + ".crmbackup.json"), "{}");
    await expect(importNativeArchive(next, actor.userId, { passphrase: phrase }, output)).rejects.toThrow("локальном каталоге");
    expect(await readdir(output)).toEqual([f.archive.backupId + ".crmbackup.json"]);
    for (let i = 0; i < 4; i++) await runtime.stageNativeImport(f.path, nativeIncomingRoot(), randomUUID(), actor.userId);
    await expect(runtime.stageNativeImport(f.path, nativeIncomingRoot(), randomUUID(), actor.userId)).rejects.toThrow("IMPORT_CAPACITY");
  });
  it("binds import to manager identity and expiry; cleanup removes only own expired UUID directories", async () => {
    const f = await fixture(); const id = randomUUID();
    await runtime.stageNativeImport(f.path, nativeIncomingRoot(), id, actor.userId);
    await expect(importNativeArchive(id, randomUUID(), { passphrase: phrase }, path.join(temp, "catalog"))).rejects.toThrow();
    const dir = path.join(nativeIncomingRoot(), id); const metadata = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8"));
    await writeFile(path.join(dir, "metadata.json"), JSON.stringify({ ...metadata, expiresAt: Date.now() - 1 }));
    await expect(importNativeArchive(id, actor.userId, { passphrase: phrase }, path.join(temp, "catalog"))).rejects.toThrow();
    const unrelated = path.join(nativeIncomingRoot(), "do-not-delete"); await mkdir(unrelated);
    const old = new Date(Date.now() - runtime.NATIVE_IMPORT_TTL - 1000); await utimes(dir, old, old);
    await runtime.cleanupNativeIncoming(nativeIncomingRoot());
    expect(await readdir(nativeIncomingRoot())).toEqual(["do-not-delete"]);
  });
  it("manager boundary accepts no path/command input and requires confirmation", async () => {
    for (const action of ["pick-archive", "restore-from-file", "native-result"]) {
      await expect(backupControlCommand({ ...actor, role: "realtor" }, { action })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(backupCommandSchema.safeParse({ action: "pick-archive", path: "C:/secret" }).success).toBe(false);
    expect(backupCommandSchema.safeParse({ action: "restore-from-file", requestId: randomUUID(), confirmed: false }).success).toBe(false);
    expect(backupCommandSchema.safeParse({ action: "restore-from-file", requestId: "../x", confirmed: true }).success).toBe(false);
    const selected = await backupControlCommand(actor, { action: "pick-archive" });
    expect(selected).toHaveProperty("requestId");
  });
  it("native result exposes no selected file path and rejects expired or foreign results", async () => {
    const { requestId } = await requestNativeDialog("import", undefined, actor.userId);
    const resultPath = path.join(temp, "settings/native-dialogs", requestId + ".result.json");
    await writeFile(resultPath, JSON.stringify({ status: "selected", kind: "import", actorUserId: actor.userId, expiresAt: Date.now() + 10000, selectedPath: "C:/private" }));
    expect(await readNativeDialog(requestId, actor.userId)).toEqual({ status: "selected", directory: undefined });
    await expect(readNativeDialog(requestId, randomUUID())).rejects.toThrow();
    await writeFile(resultPath, JSON.stringify({ status: "selected", kind: "import", actorUserId: actor.userId, expiresAt: 0 }));
    await expect(readNativeDialog(requestId, actor.userId)).rejects.toThrow();
  });
  it("Rust has fixed filtered file picker, API retains manager/CSRF and UI explicit confirmation", async () => {
    const rust = await readFile("src-tauri/src/main.rs", "utf8");
    expect(rust).toContain('kind == "NATIVE_IMPORT"'); expect(rust).toContain('["crmbackup"]).pick_file(callback)');
    const route = await readFile("src/app/api/v1/settings/backups/control/route.ts", "utf8");
    expect(route).toContain('api({ access: "manager" }');
    const boundary = await readFile("src/server/api-handler.ts", "utf8"); expect(boundary).toContain("assertSameOrigin(req)");
    const ui = await readFile("src/app/(crm)/settings/backups/backup-panel.tsx", "utf8");
    expect(ui).toContain("Восстановить из файла…"); expect(ui).toContain('status.nativeDialog && status.restoreSupported');
    expect(ui).toContain('dialog === "restore-from-file" || dialog === "receive-from-file") && <label');
  });
});
