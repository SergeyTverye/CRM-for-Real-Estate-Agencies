import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { accessibleRun } from "./search-service";
export async function searchProgress(actor: Actor, id: string) {
  const run = await accessibleRun(actor, id);
  const sources = await db.searchRunSource.findMany({ where: { runId: id }, orderBy: { source: "asc" } });
  return { id, status: run.status, progress: run.progress, deadlineAt: run.deadlineAt, cancelRequested: run.cancelRequested, heartbeatAt: run.heartbeatAt, incompleteReason: run.incompleteReason,
    sources: sources.map(s => ({ ...s, browserSessionAction: s.needsUserAction ? { method: "POST", url: "/api/v1/browser-sessions", body: { searchRunId: id, source: s.source } } : null })) };
}
