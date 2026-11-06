import { db } from "@/shared/db/client";
import type { Actor } from "@/modules/auth/domain/actor";
import { accessibleRun } from "./search-service";
export async function searchProgress(actor: Actor, id: string) {
  const run = await accessibleRun(actor, id);
  const sources = await db.searchRunSource.findMany({ where: { runId: id }, orderBy: { source: "asc" } });
  const sessions = await db.interactiveBrowserSession.findMany({ where: { searchRunId: id, ownerUserId: actor.userId }, orderBy: { createdAt: "desc" }, select: { id: true, source: true, status: true, closeReason: true, expiresAt: true } });
  const dateDetails = (run.progress as { dateDetails?: Record<string, unknown> } | null)?.dateDetails;
  return { id, status: run.status, progress: run.progress, deadlineAt: run.deadlineAt, cancelRequested: run.cancelRequested, heartbeatAt: run.heartbeatAt, incompleteReason: run.incompleteReason,
    sources: sources.map(s => ({ ...s, dateDetails: dateDetails?.[s.source] ?? null, browserSession: sessions.find(session => session.source === s.source) ?? null, browserSessionAction: s.needsUserAction ? { method: "POST", url: "/api/v1/browser-sessions", body: { searchRunId: id, source: s.source } } : null })) };
}
