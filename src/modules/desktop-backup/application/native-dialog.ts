import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, rm, copyFile, link, lstat, readdir, open } from "node:fs/promises";
import path from "node:path";
import { InfrastructureError, ValidationError } from "@/shared/errors";
import { backupRuntimeRoot } from "../infrastructure/destinations-runtime";
import { protectedDir, regularFile, hashFile } from "../infrastructure/fs";
import { z } from "zod";
import { extractArchive, type Credential } from "../infrastructure/archive";
import { SqliteSnapshotValidator } from "../infrastructure/sqlite-validator";
import { BackupError, archiveRefSchema } from "../domain/contracts";
import { JsonSettingsRepository } from "../infrastructure/settings-repository";

const lockOwnerSchema = z.object({ pid: z.number().int().positive().max(2147483647), token: z.uuid(), createdAt: z.string().datetime() }).strict();
type LockOwner = z.infer<typeof lockOwnerSchema>;
async function inspectLock(file: string) {
  await regularFile(file);
  const handle = await open(file, "r");
  try {
    const identity = await handle.stat({ bigint: true });
    if (identity.size > 1024n) throw new BackupError("NATIVE_LOCK_INVALID");
    const owner = lockOwnerSchema.parse(JSON.parse(await handle.readFile("utf8")));
    return { identity, owner };
  } finally { await handle.close(); }
}
type LockSnapshot = Awaited<ReturnType<typeof inspectLock>>;
async function sameLock(file: string, expected: LockSnapshot) {
  try {
    const current = await inspectLock(file);
    return current.identity.ino === expected.identity.ino && current.identity.dev === expected.identity.dev
      && current.identity.birthtimeNs === expected.identity.birthtimeNs && current.owner.token === expected.owner.token;
  } catch { return false; }
}
function ownerDead(owner: LockOwner) {
  try { process.kill(owner.pid, 0); return false; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; }
}
async function acquireBudgetLock(file: string, depth = 0): Promise<() => Promise<void>> {
  if (depth > 8) throw new BackupError("NATIVE_LOCK_RECOVERY_LIMIT");
  const owner: LockOwner = { pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() };
  const candidate = file + ".owner-" + owner.token;
  const handle = await open(candidate, "wx", 0o600);
  let snapshot: LockSnapshot;
  try {
    await handle.writeFile(JSON.stringify(owner)); await handle.sync();
    snapshot = { owner, identity: await handle.stat({ bigint: true }) };
  } finally { await handle.close(); }
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await link(candidate, file);
        return async () => { if (await sameLock(file, snapshot)) await rm(file); };
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
      const previous = await inspectLock(file);
      if (!ownerDead(previous.owner)) throw Object.assign(new BackupError("NATIVE_LOCK_BUSY"), { code: "EEXIST" });
      const release = await acquireBudgetLock(file + ".retire-" + previous.owner.token, depth + 1);
      try {
        if (ownerDead(previous.owner) && await sameLock(file, previous)) {
          const retired = file + ".retired-" + owner.token;
          await rename(file, retired);
          await rm(retired);
        }
      } finally { await release(); }
    }
    throw new BackupError("NATIVE_LOCK_BUSY");
  } finally { await rm(candidate); }
}

export async function withNativeArchiveBudget<T>(outputDir: string, work: () => Promise<T>): Promise<T> {
  await protectedDir(outputDir);
  const lock = path.join(outputDir, ".native-budget.lock");
  const release = await acquireBudgetLock(lock);
  try { return await work(); }
  finally { await release(); }
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
export async function cleanupNativeImports(outputDir: string, commands: string, onlyId?: string) {
  if (onlyId !== undefined && !z.uuid().safeParse(onlyId).success) throw new BackupError("IMPORT_ID_INVALID");
  await protectedDir(outputDir); await protectedDir(commands);
  const referenced = new Set<string>();
  for (const name of await readdir(commands)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    try {
      const file = path.join(commands, name); const info = await regularFile(file);
      if (info.size > 128 * 1024) throw new Error();
      const request = JSON.parse(await readFile(file, "utf8"));
      if (!request.command || typeof request.command.action !== "string") throw new Error();
      if (request.command.backupId !== undefined) {
        if (!z.uuid().safeParse(request.command.backupId).success) throw new Error();
        referenced.add(request.command.backupId);
      } else if (!["create", "give"].includes(request.command.action)) throw new Error();
    } catch { throw new BackupError("IMPORT_COMMANDS_AMBIGUOUS"); }
  }
  const retained: string[] = [];
  for (const name of await readdir(outputDir)) {
    const match = /^([a-f0-9-]{36})\.crmbackup\.import\.json$/.exec(name);
    if (!match || (onlyId !== undefined && match[1] !== onlyId)) continue;
    const id = match[1]!;
    if (!z.uuid().safeParse(id).success || referenced.has(id)) continue;
    const archive = path.join(outputDir, id + ".crmbackup"), sidecar = path.join(outputDir, name);
    try {
      try { await lstat(archive + ".json"); continue; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const info = await regularFile(sidecar); if (info.size > 16384) throw new Error();
      const parsed = z.object({ archive: archiveRefSchema }).strict().parse(JSON.parse(await readFile(sidecar, "utf8")));
      if (parsed.archive.backupId !== id) throw new Error();
      await regularFile(archive); const actual = await hashFile(archive);
      if (actual.sha256 !== parsed.archive.sha256 || actual.size !== parsed.archive.size) throw new Error();
      await rm(archive); await rm(sidecar);
    } catch { retained.push(id); }
  }
  if (retained.length) throw new BackupError("IMPORT_CACHE_RETAINED_INVALID");
}
export const nativeDialogRoot = () => path.join(backupRuntimeRoot(), "native-dialogs");
export const nativeIncomingRoot = () => path.join(nativeDialogRoot(), "incoming");
const dialogOwnerSchema = z.object({ kind: z.enum(["folder", "export", "import"]), actorUserId: z.string().min(1) }).strict();
export async function requestNativeDialog(kind: "folder" | "export" | "import", backupId?: string, actorUserId?: string) {
  if (process.env.CRM_DEPLOYMENT_MODE !== "desktop" || process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1") throw new InfrastructureError("Системный диалог доступен в установленной desktop-версии");
  const owner = dialogOwnerSchema.parse({ kind, actorUserId });
  const id = randomUUID(); await protectedDir(nativeDialogRoot());
  const ownerPath = path.join(nativeDialogRoot(), id + ".owner.json");
  await writeFile(ownerPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
  try {
    await writeFile(path.join(nativeDialogRoot(), id + ".request.json"), JSON.stringify({ kind, backupId, actorUserId, createdAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
  } catch (e) { await rm(ownerPath, { force: true }); throw e; }
  return { requestId: id };
}
export async function readNativeDialog(id: string, actorUserId?: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ValidationError();
  const root = nativeDialogRoot();
  try {
    await regularFile(path.join(root, id + ".owner.json"));
    const owner = dialogOwnerSchema.parse(JSON.parse(await readFile(path.join(root, id + ".owner.json"), "utf8")));
    if (!actorUserId || owner.actorUserId !== actorUserId) throw new ValidationError();
    try { await regularFile(path.join(root, id + ".result.json")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "pending" }; throw e; }
     const result = JSON.parse(await readFile(path.join(root, id + ".result.json"), "utf8"));
     if ((result.kind !== undefined && result.kind !== owner.kind) || (result.actorUserId !== undefined && result.actorUserId !== actorUserId)) throw new ValidationError();
     if (owner.kind === "import" && (result.kind !== "import" || result.actorUserId !== actorUserId || !Number.isFinite(result.expiresAt) || result.expiresAt < Date.now())) throw new ValidationError();
     if (typeof result.status !== "string" || (result.directory !== undefined && typeof result.directory !== "string")) throw new ValidationError();
     return { status: result.status, directory: owner.kind === "folder" ? result.directory as string | undefined : undefined };
  } catch { throw new InfrastructureError("Системный диалог недоступен"); }
}

export async function importNativeArchive(id: string, actorUserId: string, credential: Credential, outputDir: string, publish?: (backupId: string) => Promise<void>) {
  if (!z.uuid().safeParse(id).success) throw new ValidationError();
  const dir = path.join(nativeIncomingRoot(), id);
  const metadataPath = path.join(dir, "metadata.json");
  await regularFile(metadataPath);
  const metadata = z.object({ actorUserId: z.string(), expiresAt: z.number().finite(), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(await readFile(metadataPath, "utf8")));
  if (metadata.actorUserId !== actorUserId || metadata.expiresAt < Date.now()) throw new ValidationError("Выбор файла истёк. Выберите архив заново.");
  await rename(metadataPath, path.join(dir, "consumed.json"));
  try {
    const file = path.join(dir, "archive.crmbackup"); await regularFile(file);
    const hash = await hashFile(file);
    if (hash.size !== metadata.size || hash.sha256 !== metadata.sha256) throw new BackupError("IMPORT_CHECKSUM");
    return await withNativeArchiveBudget(outputDir, async () => {
    if (publish) await cleanupNativeImports(outputDir, path.join(backupRuntimeRoot(), "commands"));
    const settings = await new JsonSettingsRepository(backupRuntimeRoot()).read();
    const usage = await nativeArchiveUsage(outputDir);
    if (usage.imports >= 4 || usage.bytes + metadata.size > settings.retention.maxBytes) throw new BackupError("IMPORT_CAPACITY");
    const checked = await extractArchive({ archivePath: file, stagingRoot: path.join(dir, "validation"), credential, validator: new SqliteSnapshotValidator(), schemaVersion: 1 });
    try {
      if (checked.manifest.components.includes("postgres")) throw new BackupError("SQLITE_RESTORE_REQUIRED");
      await protectedDir(outputDir);
      const backupId = checked.manifest.backupId;
      const target = path.join(outputDir, backupId + ".crmbackup");
      try { await lstat(target + ".json"); throw new ValidationError("Эта копия уже есть в локальном каталоге. Восстановите её через список копий."); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      const pending = path.join(outputDir, id + ".native.pending");
      let ownsPending = false, ownsRef = false, ownsTarget = false;
      try {
        await copyFile(file, pending, 1);
        ownsPending = true;
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
      if (publish) {
        try { await publish(backupId); }
        catch (e) {
          await cleanupNativeImports(outputDir, path.join(backupRuntimeRoot(), "commands"), backupId);
          throw e;
        }
      }
      return backupId;
    } finally { await checked.dispose(); }
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
