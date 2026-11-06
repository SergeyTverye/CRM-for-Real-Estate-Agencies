import { randomUUID } from "node:crypto";
import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BackupError, type ArchiveRef, type BackupManifest, type SnapshotValidator } from "../domain/contracts";
import { assertNoSymlinks, atomicJson, protectedDir, syncDir } from "../infrastructure/fs";
import { extractArchive, type Credential } from "../infrastructure/archive";
import { assertArchive } from "../infrastructure/transfer";
const pointerSchema = z.object({ generation: z.uuid(), backupId: z.uuid(), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), schemaVersion: z.number().int() }).strict();
export interface RestoreHooks {
  /** Holds exclusive maintenance lock, stops/closes DB + workers, restarts from pointer afterwards. */
  withStoppedRuntime<T>(work: () => Promise<T>): Promise<T>;
  /** Full encrypted backup of current DB and files, produced while writes are stopped. */
  protectCurrent(): Promise<{ path: string; archive: ArchiveRef; credential: Credential }>;
  /** May migrate staged SQLite, then check application counters; never accesses active data. */
  prepareStage(stage: string, manifest: BackupManifest): Promise<void | { schemaVersion: number }>;
}
export class GenerationStore {
  constructor(readonly root: string) {}
  async current() {
    try { await assertNoSymlinks(path.join(this.root, "current.json")); return pointerSchema.parse(JSON.parse(await readFile(path.join(this.root, "current.json"), "utf8"))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async currentPath() { const p = await this.current(); if (!p) return null; const dir = path.join(this.root, "generations", p.generation); await assertNoSymlinks(dir); return dir; }
  async activate(stage: string, manifest: BackupManifest, schemaVersion = manifest.schemaVersion) {
    const generation = randomUUID(); const generations = path.join(this.root, "generations"); await protectedDir(generations);
    const dest = path.join(generations, generation); await rename(stage, dest); await syncDir(generations);
    // Single publication point; old generations remain available for rollback.
    await atomicJson(path.join(this.root, "current.json"), { generation, backupId: manifest.backupId, manifestSha256: manifest.manifestSha256, schemaVersion });
    return dest;
  }
}
export async function restoreArchive(input: {
  archivePath: string; credential: Credential; schemaVersion: number; validator: SnapshotValidator;
  store: GenerationStore; hooks: RestoreHooks; confirmed: true;
}) {
  if (input.confirmed !== true) throw new BackupError("RESTORE_CONFIRMATION_REQUIRED");
  await protectedDir(input.store.root);
  const checked = await extractArchive({ ...input, stagingRoot: path.join(input.store.root, "staging") });
  try {
    const prepared = await input.hooks.prepareStage(checked.stage, checked.manifest);
    const schemaVersion = prepared?.schemaVersion ?? checked.manifest.schemaVersion;
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < checked.manifest.schemaVersion || schemaVersion > input.schemaVersion) throw new BackupError("STAGED_SCHEMA_INVALID");
    await input.validator.validate(path.join(checked.stage, "database.sqlite"));
    return await input.hooks.withStoppedRuntime(async () => {
      const protective = await input.hooks.protectCurrent(); await assertArchive(protective.path, protective.archive);
      const verified = await extractArchive({ archivePath: protective.path, credential: protective.credential, schemaVersion: input.schemaVersion, validator: input.validator, stagingRoot: path.join(input.store.root, "staging") });
      await verified.dispose();
      const activePath = await input.store.activate(checked.stage, checked.manifest, schemaVersion);
      return { manifest: checked.manifest, activePath, protectiveBackup: protective.archive };
    });
  } finally { await rm(checked.stage, { recursive: true, force: true }); }
}
