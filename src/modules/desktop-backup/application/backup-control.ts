import { requestNativeDialog, readNativeDialog, importNativeArchive } from "./native-dialog";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/shared/db/client";
import { ConflictError, ForbiddenError, InfrastructureError, NotFoundError, ValidationError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { startManualBackup } from "@/modules/operations/application/operations-service";
import { backupRuntimeRoot, runtimeCredentialStore, withBackupDestinations } from "../infrastructure/destinations-runtime";
import { DatabaseReplicationJournal } from "../infrastructure/database-journal";
import { protectedDir, regularFile } from "../infrastructure/fs";
import { decodeRecoveryKey } from "../infrastructure/encryption";
import { BackupError, archiveRefSchema } from "../domain/contracts";

export const backupCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pick-directory") }).strict(),
  z.object({ action: z.literal("pick-archive") }).strict(),
  z.object({ action: z.literal("restore-from-file"), requestId: z.uuid(), passphrase: z.string().min(12).max(1024).optional(), recoveryKey: z.string().max(100).optional(), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("native-export"), backupId: z.uuid() }).strict(),
  z.object({ action: z.literal("native-result"), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal("probe"), destinationId: z.uuid() }).strict(),
  z.object({ action: z.literal("list"), destinationId: z.uuid() }).strict(),
  z.object({ action: z.literal("retry"), destinationId: z.uuid(), backupId: z.uuid() }).strict(),
  z.object({ action: z.literal("create"), passphrase: z.string().min(12).max(1024), recoveryKey: z.string().max(100), recoveryKeySaved: z.literal(true), destinationId: z.uuid().optional() }).strict(),
  z.object({ action: z.enum(["verify", "restore", "compare", "receive"]), backupId: z.uuid(), destinationId: z.uuid().optional(), passphrase: z.string().min(12).max(1024).optional(), recoveryKey: z.string().max(100).optional(), confirmed: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("give"), passphrase: z.string().min(12).max(1024), recoveryKey: z.string().max(100), recoveryKeySaved: z.literal(true) }).strict(),
]);
export type BackupCommand = z.infer<typeof backupCommandSchema>;
export function requireBackupManager(actor: { role: string }) { if (actor.role !== "manager") throw new ForbiddenError(); }
export const commandRoot = () => path.join(backupRuntimeRoot(), "commands");
export const archiveRoot = () => path.join(path.resolve(process.env.BACKUP_PATH ?? "backups"), "portable");
export async function archivePath(id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError();
  const file = path.join(archiveRoot(), id + ".crmbackup");
  try { await regularFile(file); return file; } catch { throw new NotFoundError(); }
}
async function sizeOf(root: string, budget = { count: 0 }): Promise<number> {
  let size = 0;
  for (const e of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (++budget.count > 100000) break;
    const file = path.join(root, e.name);
    if (e.isDirectory()) size += await sizeOf(file, budget);
    else if (e.isFile()) size += (await stat(file)).size;
  }
  return size;
}
export async function backupControlStatus(actor: Actor) {
  requireBackupManager(actor);
  const { rows } = await new DatabaseReplicationJournal().read();
  const desktop = process.env.CRM_DEPLOYMENT_MODE === "desktop";
  const data = desktop ? process.env.DESKTOP_DATA_DIR ?? "Локальная SQLite" : "PostgreSQL (сервер)";
  const filesRoot = path.resolve(process.env.FILE_STORAGE_PATH ?? "data/files");
  const [storageBytes, disk, jobs, serverRuns] = await Promise.all([
    sizeOf(filesRoot), statfs(filesRoot).catch(() => null),
    db.backupQueueJournal.findMany({ where: { id: { startsWith: "command:" } }, take: 30, orderBy: { id: "desc" } }),
    desktop ? Promise.resolve([]) : db.backupRun.findMany({ take: 20, orderBy: { startedAt: "desc" }, select: { backupId: true, localStatus: true, startedAt: true, finishedAt: true } }),
  ]);
  const completed: { id: string; action: string; status: string; createdAt: string; finishedAt: string; errorCode?: string }[] = [];
  for (const name of (await readdir(commandRoot()).catch(() => [])).filter(n => /^[a-f0-9-]{36}\.result\.json$/.test(n)).slice(-30)) {
    try { const r = JSON.parse(await readFile(path.join(commandRoot(), name), "utf8")); completed.push({ id: r.id, action: r.action, status: r.status, createdAt: r.createdAt, finishedAt: r.finishedAt, errorCode: r.errorCode }); } catch {}
  }
  const archives = [];
  for (const e of await readdir(archiveRoot()).catch(() => [])) {
    if (!/^[a-f0-9-]{36}\.crmbackup\.json$/.test(e)) continue;
    try { const { archive } = JSON.parse(await readFile(path.join(archiveRoot(), e), "utf8")); archives.push(archiveRefSchema.parse(archive)); } catch {}
  }
  archives.sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
  return { mode: desktop ? "desktop" : "server", version: process.env.APP_VERSION ?? "development", dataLocation: data, storageBytes,
    freeBytes: disk ? disk.bavail * disk.bsize : null, selfCheck: "База доступна; пригодность архива проверяется отдельно", archives,
    rows: rows.map(({ sourcePath: _privatePath, ...r }) => { void _privatePath; return r; }),
    jobs: [...completed, ...serverRuns.map(r => ({ id: r.backupId, action: "create", status: r.localStatus, createdAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() })), ...jobs.filter(j => !completed.some(c => "command:" + c.id === j.id)).map(j => {
      const payload = j.payload as { action?: string; status?: string; createdAt?: string };
      return { id: j.id.slice(8), action: payload.action, status: payload.status, createdAt: payload.createdAt };
    })],
    nativeDialog: desktop && process.env.CRM_DESKTOP_SUPERVISED_UPGRADE === "1", restoreSupported: desktop && process.env.CRM_DESKTOP_SUPERVISED_UPGRADE === "1" };
}
/** HTTP boundary never exposes provider exceptions or entered values. */
export async function backupControlCommand(actor: Actor, raw: unknown) {
  requireBackupManager(actor);
  const parsed = backupCommandSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Проверьте поля операции резервирования");
   const input = parsed.data;
   let normalized: BackupCommand = input;
   try {
    if (input.action === "restore-from-file") {
      if (process.env.CRM_DEPLOYMENT_MODE !== "desktop" || process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1") throw new InfrastructureError("Восстановление из файла доступно только в desktop-версии");
      if (!input.passphrase && !input.recoveryKey) throw new ValidationError("Введите кодовую фразу или ключ восстановления");
      const backupId = await importNativeArchive(input.requestId, actor.userId, input.passphrase ? { passphrase: input.passphrase } : { recoveryKey: input.recoveryKey! }, archiveRoot());
      normalized = { action: "restore", backupId, confirmed: true, passphrase: input.passphrase, recoveryKey: input.recoveryKey };
    }
    const cmd = normalized;
    if (cmd.action === "pick-directory") return await requestNativeDialog("folder");
    if (cmd.action === "pick-archive") return await requestNativeDialog("import", undefined, actor.userId);
    if (cmd.action === "native-export") { await archivePath(cmd.backupId); return await requestNativeDialog("export", cmd.backupId); }
    if (cmd.action === "native-result") return await readNativeDialog(cmd.requestId, actor.userId);
    if (cmd.action === "restore-from-file") throw new ValidationError();
    if (cmd.action === "probe" || cmd.action === "list") return await withBackupDestinations(async destinations => {
      const items = await destinations[0]!.list();
      return cmd.action === "list" ? { archives: items } : { connected: true, checkedAt: new Date().toISOString(), message: "Чтение доступно. Запись и восстановление проверяются тестовой копией." };
    }, cmd.destinationId);
    if (cmd.action === "retry") {
      const store = new DatabaseReplicationJournal(); const current = await store.read();
      const row = current.rows.find(r => r.destinationId === cmd.destinationId && r.archive.backupId === cmd.backupId);
      if (!row || row.status !== "failed") throw new ConflictError("RETRY_NOT_FAILED", "Повтор доступен только для неудачного направления");
      row.status = "queued"; row.attempts = 0; row.nextAttemptAt = 0; delete row.errorCode;
      await store.save(current.revision, current.rows); return { queued: true };
    }
    if (process.env.CRM_DEPLOYMENT_MODE !== "desktop") {
      if (cmd.action === "create") {
        const decoded = decodeRecoveryKey(cmd.recoveryKey); decoded.fill(0);
        const secretRef = randomUUID(); await runtimeCredentialStore().put(secretRef, { passphrase: cmd.passphrase, recoveryKey: cmd.recoveryKey });
        await db.backupQueueJournal.upsert({ where: { id: "server-backup-credential-v1" }, create: { id: "server-backup-credential-v1", payload: { secretRef, actorUserId: actor.userId } }, update: { payload: { secretRef, actorUserId: actor.userId }, revision: { increment: 1 } } });
        return { ...await startManualBackup(actor), message: "Локальная копия запущена. Проверка и передача выполняются фоновым worker; результат появится в журнале." };
      }
      if (cmd.action === "verify") {
        if (!cmd.passphrase && !cmd.recoveryKey) throw new ValidationError("Введите кодовую фразу или ключ восстановления");
        const { verifyServerPortable } = await import("./server-archives");
        const credential = cmd.passphrase ? { passphrase: cmd.passphrase } : { recoveryKey: cmd.recoveryKey! };
        const verify = async (file: string) => {
          const result = await verifyServerPortable(file, credential);
          if (result.backupId !== cmd.backupId) throw new BackupError("ARCHIVE_ID_MISMATCH");
          return result;
        };
        if (!cmd.destinationId) return await verify(await archivePath(cmd.backupId));
        return await withBackupDestinations(async destinations => {
          const staging = path.join(backupRuntimeRoot(), "remote-verify"); await protectedDir(staging);
          const stage = await mkdtemp(path.join(staging, "download-"));
          try {
            const file = path.join(stage, "archive.crmbackup");
            await destinations[0]!.get(cmd.backupId, file);
            return await verify(file);
          } finally { await rm(stage, { recursive: true, force: true }); }
        }, cmd.destinationId);
      }
      throw new ConflictError("SERVER_RESTORE_RUNBOOK", "В серверном режиме восстановление выполняется оператором по ops/backup; перенос SQLite между ПК доступен в локальной установке");
    }
    if (process.env.CRM_DESKTOP_SUPERVISED_UPGRADE !== "1") throw new InfrastructureError("Для безопасного снимка запустите CRM через desktop supervisor");
    if ((cmd.action === "restore" || cmd.action === "receive") && !cmd.confirmed) throw new ValidationError("Подтвердите замену состояния после защитной копии");
    if (cmd.action === "create" || cmd.action === "give") { const key = decodeRecoveryKey(cmd.recoveryKey); key.fill(0); }
    else if (!cmd.passphrase && !cmd.recoveryKey) throw new ValidationError("Введите кодовую фразу или ключ восстановления");
    const id = randomUUID(); const ref = randomUUID();
    // Only encrypted immutable blobs contain credentials. No secret in DB/mailbox/response.
    const { passphrase, recoveryKey, ...safe } = cmd;
    await runtimeCredentialStore().put(ref, { ...(passphrase ? { passphrase } : {}), ...(recoveryKey ? { recoveryKey } : {}) });
    const request = { id, secretRef: ref, command: safe, actorUserId: actor.userId, createdAt: new Date().toISOString() };
    await protectedDir(commandRoot());
    await db.backupQueueJournal.create({ data: { id: "command:" + id, payload: { action: cmd.action, status: "queued", createdAt: request.createdAt } } });
    await writeFile(path.join(commandRoot(), id + ".json"), JSON.stringify(request), { flag: "wx", mode: 0o600 });
    return { queued: true, requestId: id, message: "Supervisor остановит запись. После операции обновите страницу." };
  } catch (e) {
    if (e instanceof ConflictError || e instanceof ValidationError || e instanceof InfrastructureError) throw e;
    if (e instanceof BackupError && e.code === "QUEUE_REVISION_CONFLICT") throw new ConflictError("STALE_UPDATE", "Очередь изменилась. Обновите данные.");
    throw new InfrastructureError("Операция не выполнена: проверьте сеть, учётные данные, доступность носителя и свободное место");
  }
}
