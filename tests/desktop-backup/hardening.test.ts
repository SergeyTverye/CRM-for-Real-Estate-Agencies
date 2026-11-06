import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { fixture, passphrase, validator } from "./fixtures";
import { createArchive, extractArchive } from "../../src/modules/desktop-backup/infrastructure/archive";
import { createHeader, cryptChunk } from "../../src/modules/desktop-backup/infrastructure/encryption";
import { canonical, hashFile, sha256 } from "../../src/modules/desktop-backup/infrastructure/fs";
import { DEFAULT_LIMITS, type BackupManifest } from "../../src/modules/desktop-backup/domain/contracts";
import { StateTransfer } from "../../src/modules/desktop-backup/application/handoff";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function f() { const value = await fixture(); roots.push(value.root); return value; }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
async function forge(a: Awaited<ReturnType<typeof fixture>>, modify: (m: BackupManifest) => void, content: Buffer = Buffer.alloc(0)) {
  const { header, key } = await createHeader(passphrase, a.recoveryKey);
  try {
    const m = structuredClone(a.manifest); m.encryption = header.encryption; modify(m);
    const { manifestSha256: _, ...base } = m; m.manifestSha256 = sha256(canonical(base));
    const manifest = Buffer.from(canonical(m)); const plain = Buffer.concat([u32(manifest.length), manifest, content]);
    const cipher = cryptChunk(header, key, 0, plain, false); const end = cryptChunk(header, key, 1, Buffer.alloc(0), true);
    const hdr = Buffer.from(canonical(header)); const folder = await mkdtemp(path.join(a.root, "forged-")); const file = path.join(folder, "archive.crmbackup");
    await writeFile(file, Buffer.concat([Buffer.from("CRMBKP1\n"), u32(hdr.length), hdr, u32(cipher.data.length), cipher.data, cipher.tag, u32(0), end.tag]));
    return { path: file, manifest: m, archive: { backupId: m.backupId, createdAtUtc: m.createdAtUtc, ...await hashFile(file) } };
  } finally { key.fill(0); }
}
it("rejects authenticated traversal and declared bombs before creating payload files", async () => {
  const a = await f();
  for (const modify of [
    (m: BackupManifest) => { m.files[0]!.path = "../escaped.sqlite"; },
    (m: BackupManifest) => { m.files[0]!.size = DEFAULT_LIMITS.fileBytes + 1; },
  ]) {
    const archive = await forge(a, modify);
    await expect(extractArchive({ archivePath: archive.path, stagingRoot: a.input.stagingRoot, credential: { passphrase }, schemaVersion: 1, validator })).rejects.toThrow();
  }
  const { readdir } = await import("node:fs/promises"); expect(await readdir(a.input.stagingRoot)).toEqual([]);
});
it("rejects file digest mismatch even when encryption and manifest checksum are valid", async () => {
  const a = await f();
  const archive = await forge(a, m => {
    m.files = [{ path: "database.sqlite", size: 1, sha256: sha256("x") }, { path: "settings.json", size: 2, sha256: sha256("{}") }];
  }, Buffer.from("y{}"));
  await expect(extractArchive({ archivePath: archive.path, stagingRoot: a.input.stagingRoot, credential: { passphrase }, schemaVersion: 1, validator })).rejects.toThrow("FILE_CHECKSUM");
});
it("SQLite foreign_key_check rejects orphan references", async () => {
  const a = await f(); const db = new Database(a.database); db.pragma("foreign_keys=OFF");
  db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER, parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES(1,999)"); db.close();
  await expect(validator.validate(a.database)).rejects.toThrow("SQLITE_FOREIGN_KEYS");
  await expect(createArchive(a.input)).rejects.toThrow("SQLITE_FOREIGN_KEYS");
});
it("local archive budget stops accumulation and metadata callback runs inside write barrier", async () => {
  const a = await f();
  await expect(createArchive({ ...a.input, localBudget: { maxArchives: 1, maxBytes: 1024 ** 3 } })).rejects.toThrow("LOCAL_BACKUP_CAPACITY");
  let held = false; let captured = false;
  const result = await createArchive({ ...a.input, barrier: { async run(work) { held = true; try { return await work(); } finally { held = false; } } }, metadata: async () => { expect(held).toBe(true); captured = true; return { ...a.input.metadata, snapshotRevision: 2, parentBackupId: a.archive.backupId }; } });
  expect(captured).toBe(true); expect(result.manifest.snapshotRevision).toBe(2);
});
it("same backupId with different authenticated content preserves both conflict archives", async () => {
  const a = await f(); const stage = await extractArchive({ archivePath: a.path, stagingRoot: a.input.stagingRoot, credential: { passphrase }, schemaVersion: 1, validator });
  const contents: Buffer[] = [];
  for (const file of a.manifest.files) contents.push(await readFile(path.join(stage.stage, file.path)));
  await stage.dispose();
  const other = await forge(a, m => { m.crmVersion = "fork"; }, Buffer.concat(contents));
  let applied = false; const conflicts = path.join(a.root, "conflicts");
  const transfer = new StateTransfer({
    exclusive: fn => fn(), async loadState() { return { ...a.manifest, readOnly: false, dirtySinceBackup: false }; }, async saveState() {},
    async createVerified() { return a; }, async applyVerified() { applied = true; },
    async verifyIncoming(item) { const checked = await extractArchive({ archivePath: item.path, stagingRoot: a.input.stagingRoot, credential: { passphrase }, schemaVersion: 1, validator }); try { return checked.manifest; } finally { await checked.dispose(); } },
  }, conflicts);
  expect((await transfer.receive(other)).status).toBe("conflict"); expect(applied).toBe(false);
  const { readdir } = await import("node:fs/promises");
  expect((await readdir(conflicts)).filter(n => n.endsWith(".crmbackup"))).toHaveLength(2);
});
