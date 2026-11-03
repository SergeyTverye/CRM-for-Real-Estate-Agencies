import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";
import { logger } from "@/shared/logging/logger";
import { ConflictError, ForbiddenError, InfrastructureError, ValidationError } from "@/shared/errors";
import { isManager, type Actor } from "@/modules/auth/domain/actor";
import { writeAudit } from "@/modules/audit/application/audit";
import { readiness } from "./health";

/**
 * Раздел «Эксплуатация» (FR-33, ТЗ 37.15, 37.22): версия, идентичность узла, состояние БД и файлов,
 * локальные BackupRun и состояние BackupRemote. Ручной запуск локального backup и проверки копии
 * выполняет тот же скрипт ops/backup, что и scripts/backup.sh. Секреты в UI не отображаются.
 * Destructive restore из UI не выполняется — только скриптом с подтверждением.
 */

function requireManager(actor: Actor) {
  if (!isManager(actor)) throw new ForbiddenError("Раздел доступен руководителю");
}

const SCRIPTS_DIR = path.resolve(process.cwd(), "ops/backup/scripts");
const BACKUP_ID_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

async function dirSize(dir: string, limit = 200_000): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  const walk = async (d: string) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (files > limit) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        files++;
        bytes += (await stat(p)).size;
      }
    }
  };
  await walk(dir);
  return { bytes, files };
}

export interface LocalBackupInfo {
  backupId: string;
  triggerType: string | null;
  createdAt: string | null;
  schemaVersion: string | null;
  sizeBytes: number;
}

async function listLocalBackups(): Promise<LocalBackupInfo[]> {
  const dir = path.resolve(getConfig().BACKUP_PATH);
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter((n) => BACKUP_ID_RE.test(n)).sort().reverse().slice(0, 30);
  } catch {
    return [];
  }
  const out: LocalBackupInfo[] = [];
  for (const n of names) {
    try {
      const m = JSON.parse(await readFile(path.join(dir, n, "manifest.json"), "utf8")) as {
        trigger_type?: string;
        created_at?: string;
        schema_version?: string;
        components?: { size?: number }[];
      };
      out.push({ backupId: n, triggerType: m.trigger_type ?? null, createdAt: m.created_at ?? null, schemaVersion: m.schema_version ?? null, sizeBytes: (m.components ?? []).reduce((s, c) => s + (c.size ?? 0), 0) });
    } catch {
      out.push({ backupId: n, triggerType: null, createdAt: null, schemaVersion: null, sizeBytes: 0 });
    }
  }
  return out;
}

async function listRestoreReports(): Promise<{ name: string; passed: boolean; at: string }[]> {
  const dir = path.join(path.resolve(getConfig().BACKUP_PATH), "restore-test-reports");
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".txt")).sort().reverse().slice(0, 10);
    return Promise.all(
      names.map(async (n) => {
        const text = await readFile(path.join(dir, n), "utf8");
        return { name: n, passed: !/FAIL/.test(text), at: /date: (\S+)/.exec(text)?.[1] ?? "" };
      }),
    );
  } catch {
    return [];
  }
}

export async function getOperationsStatus(actor: Actor) {
  requireManager(actor);
  const cfg = getConfig();
  const [health, files, runs, remotes, localBackups, restoreReports, migrations] = await Promise.all([
    readiness(),
    dirSize(path.resolve(cfg.FILE_STORAGE_PATH)),
    db.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 20, include: { initiator: { select: { displayName: true } }, targetRuns: { include: { backupRemote: { select: { remoteCode: true } } } } } }),
    db.backupRemote.findMany({
      orderBy: { remoteCode: "asc" },
      include: { targetRuns: { orderBy: { createdAt: "desc" }, take: 5, include: { backupRun: { select: { backupId: true, startedAt: true } } } } },
    }),
    listLocalBackups(),
    listRestoreReports(),
    db.$queryRaw<{ migration_name: string; finished_at: Date }[]>`SELECT migration_name, finished_at FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 5`,
  ]);
  const lastLocal = runs.find((r) => r.localStatus === "success") ?? null;
  return {
    instance: {
      version: cfg.APP_VERSION,
      commit: cfg.APP_COMMIT,
      deploymentMode: cfg.DEPLOYMENT_MODE,
      deploymentId: cfg.DEPLOYMENT_ID,
      instanceId: cfg.INSTANCE_ID,
      instanceRole: cfg.INSTANCE_ROLE,
      timeZone: cfg.APP_TIMEZONE,
    },
    health,
    schema: migrations,
    files,
    lastLocalBackup: lastLocal,
    runs,
    remotes: remotes.map((r) => {
      const lastVerified = r.targetRuns.find((t) => t.verifyStatus === "verified") ?? null;
      const last = r.targetRuns[0] ?? null;
      return {
        id: r.id,
        remoteCode: r.remoteCode,
        displayName: r.displayName,
        providerType: r.providerType,
        transportType: r.transportType,
        isEnabled: r.isEnabled,
        isMandatory: r.isMandatory,
        lastProbeAt: r.lastProbeAt,
        probeStatus: r.probeStatus,
        lastVerified,
        lastRun: last,
        lagFromLocal: lastLocal && lastVerified ? (lastLocal.startedAt.getTime() - lastVerified.backupRun.startedAt.getTime()) / 3_600_000 : null,
      };
    }),
    localBackups,
    restoreReports,
    configuredTargets: cfg.backupTargets,
  };
}

function scriptEnv(): NodeJS.ProcessEnv {
  const cfg = getConfig();
  const url = new URL(cfg.DATABASE_URL);
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH,
    HOME: process.env.HOME ?? "/tmp",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
    BACKUP_DIR: path.resolve(cfg.BACKUP_PATH),
    FILES_DIR: path.resolve(cfg.FILE_STORAGE_PATH),
    DEPLOYMENT_ID: cfg.DEPLOYMENT_ID,
    APP_VERSION: cfg.APP_VERSION,
    APP_COMMIT: cfg.APP_COMMIT,
    BACKUP_RETENTION_DAILY: process.env.BACKUP_RETENTION_DAILY ?? "14",
  };
}

/** Ручной локальный backup (асинхронно): статус виден в backup_runs, повторный запуск блокируется. */
export async function startManualBackup(actor: Actor): Promise<{ started: true }> {
  requireManager(actor);
  const running = await db.backupRun.count({ where: { localStatus: "running", startedAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
  if (running) throw new ConflictError("BACKUP_RUNNING", "Резервное копирование уже выполняется");
  const child = spawn("bash", [path.join(SCRIPTS_DIR, "backup.sh"), "--trigger", "manual", "--initiated-by", actor.userId], {
    env: scriptEnv(),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (err) => logger.error({ err }, "backup spawn failed"));
  let stderr = "";
  child.stderr?.on("data", (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-4000);
  });
  const startedAt = new Date();
  child.on("exit", (code) => {
    logger[code === 0 ? "info" : "error"]({ event: "backup.manual_finished", code, tail: code === 0 ? undefined : stderr.split("\n").slice(-5).join(" | ") }, "manual backup finished");
    if (code === 0) return;
    // Скрипт не смог даже зарегистрировать запуск (нет инструментов/БД) — фиксируем неудачу, чтобы её было видно в UI.
    void (async () => {
      const recorded = await db.backupRun.count({ where: { startedAt: { gte: new Date(startedAt.getTime() - 5_000) }, initiatedByUserId: actor.userId } });
      if (recorded) return;
      const id = startedAt.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
      await db.backupRun.create({
        data: {
          backupId: `${id}-failed`,
          deploymentId: getConfig().DEPLOYMENT_ID,
          startedAt,
          finishedAt: new Date(),
          initiatedByUserId: actor.userId,
          triggerType: "manual",
          localStatus: "failed",
          errorSummary: (stderr.split("\n").filter(Boolean).slice(-2).join(" | ") || `exit ${code}`).slice(0, 500),
        },
      });
    })().catch((err) => logger.error({ err }, "failed to record backup failure"));
  });
  child.unref();
  await writeAudit(db, { actorUserId: actor.userId, action: "backup.manual_started", entityType: "BackupRun", entityId: actor.userId });
  return { started: true };
}

/** Проверка локальной копии (checksums, manifest, читаемость dump/архива). */
export async function verifyLocalBackup(actor: Actor, backupId: string): Promise<{ backupId: string; verified: boolean; output: string }> {
  requireManager(actor);
  if (!BACKUP_ID_RE.test(backupId)) throw new ValidationError(undefined, { backupId: ["Некорректный идентификатор копии"] });
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(SCRIPTS_DIR, "verify.sh"), backupId], { env: scriptEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (out += b.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.on("error", () => reject(new InfrastructureError("Инструменты проверки резервной копии недоступны в этом окружении")));
    child.on("exit", (code) => {
      clearTimeout(timer);
      // Вывод содержит только служебные сообщения скрипта (без секретов).
      resolve({ backupId, verified: code === 0, output: out.split("\n").filter(Boolean).slice(-10).join("\n") });
    });
  });
}
