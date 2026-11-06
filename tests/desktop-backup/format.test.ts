import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { fixture, passphrase, validator } from "./fixtures";
import { createArchive, extractArchive, validateManifest } from "../../src/modules/desktop-backup/infrastructure/archive";
import { canonical, safeRelative, sha256 } from "../../src/modules/desktop-backup/infrastructure/fs";
import { decodeRecoveryKey, newRecoveryKey } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { DEFAULT_LIMITS, type BackupManifest } from "../../src/modules/desktop-backup/domain/contracts";
import { GenerationStore, restoreArchive } from "../../src/modules/desktop-backup/application/restore";
import { compareState } from "../../src/modules/desktop-backup/domain/handoff";
import { StateTransfer } from "../../src/modules/desktop-backup/application/handoff";
import { planRetention } from "../../src/modules/desktop-backup/domain/retention";
import { LocalDir, RemovableDrive } from "../../src/modules/desktop-backup/infrastructure/local-destination";
const cleanup: string[] = [];
afterEach(async () => { for (const root of cleanup.splice(0)) await rm(root, { recursive: true, force: true }); });
async function f(bytes = 0) { const data = await fixture(bytes); cleanup.push(data.root); return data; }
function resign(m: BackupManifest): BackupManifest { const { manifestSha256: _, ...base } = m; return { ...base, manifestSha256: sha256(canonical(base)) }; }
describe("crmbackup v1", () => {
  it("round trips SQLite, files, safe settings and independent recovery key", async () => {
    const a = await f(2 * 1024 ** 2);
    for (const credential of [{ passphrase }, { recoveryKey: a.recoveryKey }]) {
      const result = await extractArchive({ archivePath: a.path, credential, stagingRoot: a.input.stagingRoot, schemaVersion: 1, validator });
      const db = new Database(path.join(result.stage, "database.sqlite"), { readonly: true });
      expect(db.prepare("SELECT label FROM sample").pluck().get()).toBe("synthetic-record"); db.close();
      expect(await readFile(path.join(result.stage, "documents/sample.txt"), "utf8")).toBe("synthetic document");
      expect(result.manifest.manifestSha256).toBe(a.manifest.manifestSha256); await result.dispose();
    }
    const data = await readFile(a.path);
    expect(data.includes(Buffer.from("synthetic document"))).toBe(false);
    expect(data.includes(Buffer.from(a.recoveryKey))).toBe(false);
  });
  it("rejects wrong phrase, damaged key, ciphertext, header and truncation", async () => {
    const a = await f(); expect(() => decodeRecoveryKey(newRecoveryKey().slice(0, -1) + "z")).toThrow();
    await expect(extractArchive({ archivePath: a.path, credential: { passphrase: "wrong phrase long enough" }, stagingRoot: a.input.stagingRoot, schemaVersion: 1, validator })).rejects.toThrow("AUTHENTICATION_FAILED");
    const original = await readFile(a.path);
    for (const offset of [30, original.length - 22]) {
      const tampered = Buffer.from(original); tampered[offset] = tampered[offset]! ^ 1;
      const file = path.join(a.root, "tampered-" + offset); await writeFile(file, tampered);
      await expect(extractArchive({ archivePath: file, credential: { passphrase }, stagingRoot: a.input.stagingRoot, schemaVersion: 1, validator })).rejects.toThrow();
    }
    const truncated = path.join(a.root, "truncated"); await writeFile(truncated, original.subarray(0, original.length - 20));
    await expect(extractArchive({ archivePath: truncated, credential: { passphrase }, stagingRoot: a.input.stagingRoot, schemaVersion: 1, validator })).rejects.toThrow("TRUNCATED_ARCHIVE");
  });
  it("rejects manifest digest mismatch, traversal, path collision and declared bombs", async () => {
    const a = await f(); const changed = structuredClone(a.manifest); changed.crmVersion = "modified";
    expect(() => validateManifest(changed)).toThrow("MANIFEST_CHECKSUM");
    for (const relative of ["../escape", "C:/escape", "documents/../x", "/absolute", "documents/x:ads", "documents/CON", "documents/a.", "documents/a\\b"]) expect(() => safeRelative(relative)).toThrow();
    const huge = structuredClone(a.manifest); huge.files[0]!.size = DEFAULT_LIMITS.fileBytes + 1;
    expect(() => validateManifest(resign(huge))).toThrow("FILE_SIZE_LIMIT");
    const total = structuredClone(a.manifest);
    expect(() => validateManifest(total, { ...DEFAULT_LIMITS, totalBytes: 1 })).toThrow("TOTAL_SIZE_LIMIT");
    const duplicate = structuredClone(a.manifest); duplicate.files.push({ ...duplicate.files[0]!, path: "DATABASE.SQLITE" });
    expect(() => validateManifest(resign(duplicate))).toThrow();
    const file = path.join(a.root, "bomb.zip"); await writeFile(file, Buffer.from("PK\x03\x04synthetic zip bomb"));
    await expect(extractArchive({ archivePath: file, credential: { passphrase }, stagingRoot: a.input.stagingRoot, schemaVersion: 1, validator })).rejects.toThrow("UNSUPPORTED_FORMAT");
  });
  it("rejects symlink storage, settings secrets, future schema and corrupt SQLite", async () => {
    const a = await f();
    const link = path.join(a.root, "link-docs"); await symlink(a.documents, link, process.platform === "win32" ? "junction" : "dir");
    await expect(createArchive({ ...a.input, storage: { documents: link } })).rejects.toThrow("SYMLINK_FORBIDDEN");
    await expect(createArchive({ ...a.input, settings: { apiKey: "synthetic" } as never })).rejects.toThrow();
    await expect(extractArchive({ archivePath: a.path, credential: { passphrase }, stagingRoot: a.input.stagingRoot, schemaVersion: 0, validator })).rejects.toThrow("SCHEMA_TOO_NEW");
    await writeFile(a.database, "invalid sqlite");
    await expect(validator.validate(a.database)).rejects.toThrow();
  });
  it("verifies before publication and leaves no completed archive on snapshot failure", async () => {
    const a = await f();
    await expect(createArchive({ ...a.input, validator: { async validate() { throw new Error("integrity failed"); } } })).rejects.toThrow("integrity failed");
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(a.input.outputDir)).filter(p => p.endsWith(".crmbackup"))).toHaveLength(1);
    expect(await readdir(a.input.stagingRoot)).toHaveLength(0);
  });
});
describe("restore, retention and handoff", () => {
  it("stages, validates protective snapshot and atomically switches a generation", async () => {
    const a = await f(); const store = new GenerationStore(path.join(a.root, "installation")); let stopped = false;
    const hooks = { async withStoppedRuntime<T>(fn: () => Promise<T>) { stopped = true; try { return await fn(); } finally { stopped = false; } }, async protectCurrent() { expect(stopped).toBe(true); return { path: a.path, archive: a.archive, credential: { passphrase } }; }, async prepareStage() {} };
    const restored = await restoreArchive({ archivePath: a.path, credential: { recoveryKey: a.recoveryKey }, schemaVersion: 1, validator, store, hooks, confirmed: true });
    expect(await store.currentPath()).toBe(restored.activePath);
    const before = await store.current();
    await expect(restoreArchive({ archivePath: a.path, credential: { passphrase }, schemaVersion: 1, validator, store, hooks: { ...hooks, async protectCurrent() { throw new Error("protective failure"); } }, confirmed: true })).rejects.toThrow("protective failure");
    expect(await store.current()).toEqual(before);
    expect(await readFile(path.join(restored.activePath, "documents/sample.txt"), "utf8")).toBe("synthetic document");
  });
  it("retains last usable generations even when space target is exceeded", async () => {
    const now = Date.now(); const refs = Array.from({ length: 5 }, (_, i) => ({ backupId: randomUUID(), size: 100, sha256: "a".repeat(64), createdAtUtc: new Date(now - i * 86400000).toISOString(), recoverable: i !== 0 }));
    const plan = planRetention(refs, { keep: 1, maxAgeDays: 0, maxBytes: 1 }, now);
    expect(plan.deleteIds).not.toContain(refs[1]!.backupId); expect(plan.deleteIds).not.toContain(refs[2]!.backupId);
    expect(plan.spaceLimitExceeded).toBe(true);
  });
  it("detects dirty copies, siblings, foreign deployment and checksum forks independently of clocks", async () => {
    const a = await f(); const state = { ...a.manifest, dirtySinceBackup: false, readOnly: false };
    expect(compareState(state, a.manifest)).toBe("same");
    const child = resign({ ...a.manifest, backupId: randomUUID(), snapshotRevision: 2, parentBackupId: a.archive.backupId, createdAtUtc: "2001-01-01T00:00:00.000Z" });
    expect(compareState(state, child)).toBe("incoming");
    expect(compareState({ ...state, dirtySinceBackup: true }, child)).toBe("conflict");
    expect(compareState(state, { ...child, parentBackupId: null })).toBe("conflict");
    expect(compareState(state, { ...child, deploymentId: randomUUID() })).toBe("conflict");
    expect(compareState(state, { ...a.manifest, manifestSha256: "0".repeat(64) })).toBe("conflict");
  });
  it("preserves both conflict copies and never applies implicitly; give makes source read-only", async () => {
    const a = await f(); const b = await createArchive({ ...a.input, metadata: { ...a.input.metadata, snapshotRevision: 2, parentBackupId: a.archive.backupId } });
    let state = { ...a.manifest, dirtySinceBackup: true, readOnly: false }; let applied = false;
    const transfer = new StateTransfer({ exclusive: fn => fn(), async loadState() { return state; }, async saveState(next) { state = { ...state, ...next }; }, async createVerified() { return a; }, async applyVerified() { applied = true; }, async verifyIncoming(item) { return item.manifest; } }, path.join(a.root, "conflicts"));
    expect((await transfer.receive(b)).status).toBe("conflict"); expect(applied).toBe(false);
    expect(await readFile(path.join(a.root, "conflicts", b.archive.backupId + "-" + b.archive.sha256 + ".crmbackup"))).toEqual(await readFile(b.path));
    await transfer.give(); expect(state.readOnly).toBe(true);
  });
  it("local/USB destinations are idempotent and removal leaves source intact", async () => {
    const a = await f(); const usbRoot = path.join(a.root, "usb"); await mkdir(usbRoot);
    for (const d of [new LocalDir("local", path.join(a.root, "local")), new RemovableDrive("usb", usbRoot)]) {
      await d.put(a.archive, a.path); await d.put(a.archive, a.path); expect(await d.list()).toHaveLength(1);
      const target = path.join(a.root, d.id + "-download"); await d.get(a.archive.backupId, target); expect(await readFile(target)).toEqual(await readFile(a.path)); await d.verify(a.archive);
    }
    const disconnected = path.join(a.root, "usb-away"); const { rename } = await import("node:fs/promises"); await rename(usbRoot, disconnected);
    await expect(new RemovableDrive("usb", usbRoot).put(a.archive, a.path)).rejects.toThrow();
    expect((await readFile(a.path)).length).toBe(a.archive.size);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(new RemovableDrive("usb", disconnected).put(a.archive, a.path, cancelled.signal)).rejects.toThrow();
    await copyFile(a.path, path.join(a.root, "unchanged"));
  });
});
