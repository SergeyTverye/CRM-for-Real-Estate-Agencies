import { copyFile, mkdtemp, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { BackupError, archiveRefSchema, assertBackupId, type ArchiveRef, type BackupDestination } from "../domain/contracts";
import { assertNoSymlinks, atomicJson, ensureSpace, protectedDir, regularFile, syncDir } from "./fs";
import { assertArchive } from "./transfer";
export class LocalDir implements BackupDestination {
  constructor(readonly id: string, readonly root: string, private readonly removable = false) {}
  private async ready() {
    await assertNoSymlinks(this.root);
    if (this.removable) { if (!(await stat(this.root)).isDirectory()) throw new BackupError("MEDIA_UNAVAILABLE"); }
    else await protectedDir(this.root);
  }
  private folder(id: string) { return path.join(this.root, assertBackupId(id)); }
  async put(archive: ArchiveRef, sourcePath: string, signal?: AbortSignal) {
    archiveRefSchema.parse(archive); signal?.throwIfAborted(); await this.ready(); await assertArchive(sourcePath, archive);
    const existing = (await this.list()).find(a => a.backupId === archive.backupId);
    if (existing) { await this.verify(archive, signal); return; }
    await ensureSpace(this.root, archive.size + 8192);
    const stage = await mkdtemp(path.join(this.root, ".upload-"));
    try {
      const pending = path.join(stage, "archive.pending"); await copyFile(sourcePath, pending); signal?.throwIfAborted();
      const h = await open(pending, "r+"); try { await h.sync(); } finally { await h.close(); }
      await assertArchive(pending, archive); await rename(pending, path.join(stage, "archive.crmbackup"));
      await atomicJson(path.join(stage, "manifest.json"), archive); await syncDir(stage);
      // Non-empty generation directories cannot be replaced by rename.
      try { await rename(stage, this.folder(archive.backupId)); }
      catch (e) { if ((await this.list()).some(a => a.backupId === archive.backupId)) await this.verify(archive); else throw e; }
      await syncDir(this.root);
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  async list() {
    await this.ready(); const out: ArchiveRef[] = [];
    for (const e of await readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !archiveRefSchema.shape.backupId.safeParse(e.name).success) continue;
      await assertNoSymlinks(this.folder(e.name));
      try { const meta = archiveRefSchema.parse(JSON.parse(await readFile(path.join(this.folder(e.name), "manifest.json"), "utf8"))); if (meta.backupId === e.name) out.push(meta); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    }
    return out;
  }
  async get(id: string, destPath: string, signal?: AbortSignal) {
    signal?.throwIfAborted(); await this.ready(); await regularFile(path.join(this.folder(id), "archive.crmbackup"));
    const { constants } = await import("node:fs"); await copyFile(path.join(this.folder(id), "archive.crmbackup"), destPath, constants.COPYFILE_EXCL); signal?.throwIfAborted();
  }
  async delete(id: string) {
    await this.ready(); await assertNoSymlinks(this.folder(id));
    // Delete only the two known files, never follow arbitrary directory trees.
    await rm(path.join(this.folder(id), "manifest.json"), { force: true });
    await rm(path.join(this.folder(id), "archive.crmbackup"), { force: true });
    const { rmdir } = await import("node:fs/promises"); await rmdir(this.folder(id));
  }
  async verify(archive: ArchiveRef, signal?: AbortSignal) { signal?.throwIfAborted(); await this.ready(); await assertArchive(path.join(this.folder(archive.backupId), "archive.crmbackup"), archive); }
}
export class RemovableDrive extends LocalDir { constructor(id: string, root: string) { super(id, root, true); } }
