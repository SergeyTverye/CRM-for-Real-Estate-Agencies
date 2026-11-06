import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm, copyFile, link, lstat, readdir, open } from "node:fs/promises";
import path from "node:path";
import { InfrastructureError, ValidationError } from "@/shared/errors";
import { backupRuntimeRoot } from "../infrastructure/destinations-runtime";
import { protectedDir, regularFile, hashFile } from "../infrastructure/fs";
import { z } from "zod";
import { extractArchive, type Credential } from "../infrastructure/archive";
import { SqliteSnapshotValidator } from "../infrastructure/sqlite-validator";
import { BackupError } from "../domain/contracts";
import { JsonSettingsRepository } from "../infrastructure/settings-repository";

/** Shared by native publication and protective snapshot creation. Never steal a
 * stale lock: an interrupted operation requires operator diagnosis, not a sweep. */
export async function withNativeArchiveBudget<T>(outputDir: string, work: () => Promise<T>): Promise<T> {
  await protectedDir(outputDir);
  const lock = path.join(outputDir, ".native-budget.lock");
  const handle = await open(lock, "wx", 0o600);
  try { return await work(); }
  finally { await handle.close(); await rm(lock); }
}

export async function nativeArchiveUsage(outputDir: string) {
  let bytes = 0, pendingBytes = 0, imports = 0;
  for (const name of await readdir(outputDir)) {
    if (!name.endsWith(".crmbackup") && !name.endsWith(".pending") && !name.endsWith(".import.json")) continue;
    const file = path.join(outputDir, name);
    const info = await regularFile(file);
    if (name.endsWith(".import.json")) { imports++; continue; }
    bytes += info.size;
    if (name.endsWith(".native.pending")) imports++;
    if (name.endsWith(".pending")) pendingBytes += info.size;
    if (!Number.isSafeInteger(bytes)) throw new BackupError("LOCAL_BACKUP_CAPACITY");
  }
  return { bytes, pendingBytes, imports };
}
export const nativeDialogRoot = () => path.join(backupRuntimeRoot(), "native-dialogs");
export const nativeIncomingRoot = () => path.join(nativeDialogRoot(), "incoming");
export async function requestNativeDialog(kind: "folder" | "export" | "import", backupId?: string, actorUserId?: string) {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop" || process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1") throw new InfrastructureError("Системный диалог доступен в установленной desktop-версии");
  const id = randomUUID(); await protectedDir(nativeDialogRoot());
  await writeFile(path.join(nativeDialogRoot(), id + ".request.json"), JSON.stringify({ kind, backupId, actorUserId, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  return { requestId: id };
}
export async function readNativeDialog(id: string, actorUserId?: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ValidationError();
  const root = nativeDialogRoot();
  try {
    await regularFile(path.join(root, id + ".result.json"));
     const result = JSON.parse(await readFile(path.join(root, id + ".result.json"), "utf8"));
     if (result.kind === "import" && (result.actorUserId !== actorUserId || !Number.isFinite(result.expiresAt) || result.expiresAt < Date.now())) throw new ValidationError();
     return { status: result.status as string, directory: result.kind === "import" ? undefined : result.directory as string | undefined };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "pending" }; throw new InfrastructureError("Системный диалог недоступен"); }
}

/** Consume a native-only capability; never accept a browser-supplied filesystem path.
 * The encrypted manifest, not the selected filename, determines archive identity.
 * Publication happens only after full authenticated extraction and SQLite validation.
 */
export async function importNativeArchive(id: string, actorUserId: string, credential: Credential, outputDir: string) {
  if (!z.uuid().safeParse(id).success) throw new ValidationError();
  const dir = path.join(nativeIncomingRoot(), id);
  const metadataPath = path.join(dir, "metadata.json");
  await regularFile(metadataPath);
  const metadata = z.object({ actorUserId: z.string(), expiresAt: z.number().finite(), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(await readFile(metadataPath, "utf8")));
  if (metadata.actorUserId !== actorUserId || metadata.expiresAt < Date.now()) throw new ValidationError("Выбор файла истёк. Выберите архив заново.");
  // Atomic claim makes concurrent requests and result replay fail closed.
  await rename(metadataPath, path.join(dir, "consumed.json"));
  try {
    const file = path.join(dir, "archive.crmbackup"); await regularFile(file);
    const hash = await hashFile(file);
    if (hash.size !== metadata.size || hash.sha256 !== metadata.sha256) throw new BackupError("IMPORT_CHECKSUM");
    return await withNativeArchiveBudget(outputDir, async () => {
    const settings = await new JsonSettingsRepository(backupRuntimeRoot()).read();
    const usage = await nativeArchiveUsage(outputDir);
    if (usage.imports >= 4 || usage.bytes + metadata.size > settings.retention.maxBytes) throw new BackupError("IMPORT_CAPACITY");
    const checked = await extractArchive({ archivePath: file, stagingRoot: path.join(dir, "validation"), credential, validator: new SqliteSnapshotValidator(), schemaVersion: 1 });
    try {
      if (checked.manifest.components.includes("postgres")) throw new BackupError("SQLITE_RESTORE_REQUIRED");
      await protectedDir(outputDir);
      const backupId = checked.manifest.backupId;
      const target = path.join(outputDir, backupId + ".crmbackup");
      // An existing catalog item may be subject to retention during protectCurrent.
      // Use the catalog workflow instead of turning that mutable entry into input.
      try { await lstat(target + ".json"); throw new ValidationError("Эта копия уже есть в локальном каталоге. Восстановите её через список копий."); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const pending = path.join(outputDir, id + ".native.pending");
      let ownsPending = false, ownsRef = false, ownsTarget = false;
      try {
        await copyFile(file, pending, 1);
        ownsPending = true;
        // Reserve an owned reference without replacing another import's metadata.
        await writeFile(target + ".import.json", JSON.stringify({ archive: { backupId, createdAtUtc: checked.manifest.createdAtUtc, ...hash } }), { flag: "wx", mode: 0o600 });
        ownsRef = true;
        await link(pending, target); // atomic no-clobber publication, even on ID collision
        ownsTarget = true;
      }
      catch (e) {
        if (ownsRef && !ownsTarget) await rm(target + ".import.json");
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new BackupError("ARCHIVE_ID_COLLISION");
        throw e;
      } finally { if (ownsPending) await rm(pending, { force: true }); }
      // Do not enroll the incoming snapshot in ordinary age-based retention:
      // protectCurrent may prune old catalog entries before the generation switch.
      return backupId;
    } finally { await checked.dispose(); }
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
