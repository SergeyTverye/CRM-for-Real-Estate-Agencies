import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { db } from "@/shared/db/client";
import { getConfig } from "@/shared/config/env";

/**
 * Readiness (ТЗ 40.12): доступность PostgreSQL и локального файлового хранилища.
 * Не зависит от облачных backup targets.
 */
export interface HealthReport {
  status: "ok" | "fail";
  checks: Record<string, { ok: boolean; detail?: string }>;
  version: string;
  instanceRole: string;
  deploymentMode: string;
}

async function checkWritableDir(dir: string): Promise<{ ok: boolean; detail?: string }> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK | constants.R_OK);
    const probe = path.join(dir, `.health-${process.pid}`);
    await writeFile(probe, "ok");
    await unlink(probe);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: (e as NodeJS.ErrnoException).code ?? "unavailable" };
  }
}

export async function readiness(): Promise<HealthReport> {
  const cfg = getConfig();
  const checks: HealthReport["checks"] = {};
  try {
    await db.$queryRaw`SELECT 1`;
    const migrations = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL`;
    checks.database = { ok: true, detail: `migrations=${migrations[0]?.count ?? 0}` };
  } catch {
    checks.database = { ok: false, detail: "unavailable" };
  }
  checks.fileStorage = await checkWritableDir(path.resolve(cfg.FILE_STORAGE_PATH));
  const ok = Object.values(checks).every((c) => c.ok);
  return {
    status: ok ? "ok" : "fail",
    checks,
    version: `${cfg.APP_VERSION}+${cfg.APP_COMMIT}`,
    instanceRole: cfg.INSTANCE_ROLE,
    deploymentMode: cfg.DEPLOYMENT_MODE,
  };
}
