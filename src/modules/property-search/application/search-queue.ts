import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { db, transaction, disconnectDb } from "@/shared/db/client";
import { parseInput, zUuid } from "@/shared/validation";
import { ConflictError, NotFoundError } from "@/shared/errors";
import type { Actor } from "@/modules/auth/domain/actor";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { SearchFilters, SOURCES, type SourceRun, type NormalizedListing, type SearchResult } from "../domain/types";
import { evaluateListing, analyzeUnresolved } from "../domain/evaluation";
import { accessibleRun, aiContext, jsonValue, persistListing, searchAudit } from "./search-service";
import { getSearchAi, scraperFor, searchSettings } from "./dependencies";
import type { ScraperAdapter, AdapterSearchResult } from "../infrastructure/scraper-adapter";
import { stableListingId } from "./listing-identity";
import { SORTS } from "../queries/results-query";
import { resolveSourceDepth } from "../infrastructure/source-limits";
import { getConfig } from "@/shared/config/env";
import { regroupRunListings } from "./duplicate-ingestion";
const depthSchema = z.object({ maxPages: z.number().int().min(1).max(10).default(2), limit: z.number().int().min(1).max(500).default(100) }).strict();
export async function stopSearchWorker() { await disconnectDb(); }
export const queueInput = z.object({ filters: SearchFilters, sources: z.array(z.enum(SOURCES)).min(1).max(7), idempotencyKey: z.string().trim().min(8).max(120), needId: zUuid.optional(), savedSearchId: zUuid.optional(),
  depth: depthSchema.default({ maxPages: 2, limit: 100 }), sourceDepth: z.partialRecord(z.enum(SOURCES), depthSchema).optional(), deadlineMs: z.number().int().min(1000).max(600000).default(180000),
  sort: z.object({ sort: z.enum(SORTS).default("match"), direction: z.enum(["asc", "desc"]).default("desc") }).default({ sort: "match", direction: "desc" }),
  confirmedPaid: z.boolean().default(false), demoScenario: z.enum(["success", "partial", "failure", "empty"]).default("success") }).strict();
export async function enqueueSearch(actor: Actor, raw: unknown) {
  const input = parseInput(queueInput, raw);
  let needId = input.needId;
  let previousRunId: string | null = null;
  if (input.savedSearchId) {
    const saved = await db.savedSearch.findFirst({ where: { id: input.savedSearchId, ownerUserId: actor.userId } });
    if (!saved) throw new NotFoundError();
    if (needId && saved.needId && needId !== saved.needId) throw new ConflictError("SEARCH_NEED_MISMATCH", "Потребность отличается от сохранённого поиска");
    needId ??= saved.needId ?? undefined;
    previousRunId = saved.lastSuccessfulRunId;
  }
  if (needId) await loadAccessibleNeed(db, actor, needId);
  const key = `${actor.userId}:${input.idempotencyKey}`;
  const filters = { ...input.filters, sources: [...new Set(input.sources)] };
  const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
  const requestHash = createHash("sha256").update(canonical({ ...input, filters, needId })).digest("hex");
  const sourceDepth = Object.fromEntries(filters.sources.map(source => [source, resolveSourceDepth(source, input.sourceDepth?.[source] ?? input.depth, filters.purposes.length || (source === "onrealt" ? 5 : 1))]));
  return transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const existing = await tx.searchRun.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if ((existing.depthParams as { requestHash?: string }).requestHash !== requestHash) throw new ConflictError("IDEMPOTENCY_CONFLICT", "Ключ запуска уже использован для других условий");
      return existing;
    }
    if (!previousRunId) previousRunId = (await tx.searchRun.findFirst({ where: { userId: actor.userId, savedSearchId: input.savedSearchId ?? null, needId: needId ?? null, filters: { equals: jsonValue(filters) }, results: { some: {} }, status: { in: ["success", "completed", "partial", "needs_user_action"] } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }))?.id ?? null;
    const run = await tx.searchRun.create({ data: { userId: actor.userId, needId, savedSearchId: input.savedSearchId, idempotencyKey: key, city: filters.city, filters: jsonValue(filters), status: "queued", deadlineAt: new Date(Date.now() + input.deadlineMs), sortParams: jsonValue(input.sort), depthParams: jsonValue({ depth: input.depth, sourceDepth, scenario: input.demoScenario, previousRunId, requestHash, confirmedPaid: input.confirmedPaid }), progress: { phase: "queued" } } });
    for (const source of filters.sources) await tx.searchRunSource.create({ data: { runId: run.id, source, status: "queued", requestedCount: sourceDepth[source]!.limit } });
    await searchAudit(tx, actor, "queued", "SearchRun", run.id, { sources: filters.sources });
    return run;
  });
}
export async function cancelSearch(actor: Actor, runId: string) {
  await accessibleRun(actor, runId);
  await db.searchRun.updateMany({ where: { id: runId, userId: actor.userId, status: { in: ["queued", "running", "needs_user_action"] } }, data: { cancelRequested: true, cancelledAt: new Date() } });
  await transaction(async tx => {
    const changed = await tx.searchRun.updateMany({ where: { id: runId, status: { in: ["queued", "needs_user_action"] } }, data: { status: "partial", finishedAt: new Date(), incompleteReason: "Поиск отменён сотрудником; полученные данные сохранены" } });
    if (changed.count) await tx.searchRunSource.updateMany({ where: { runId, status: { in: ["queued", "needs_user_action"] } }, data: { status: "cancelled", needsUserAction: false } });
    await searchAudit(tx, actor, "cancel_requested", "SearchRun", runId);
  });
  return accessibleRun(actor, runId);
}
/** Resume only interrupted sources; completed observations are immutable and never fetched again. */
export async function recoverSearchQueue(now = new Date()) {
  return transaction(async tx => {
    const threshold = new Date(+now - 60000);
    const stale = await tx.$queryRaw<{ id: string; resumable: boolean }[]>`SELECT id,(NOT cancel_requested AND deadline_at>${now}) AS resumable FROM search_runs WHERE status='running' AND COALESCE(heartbeat_at,started_at)<${threshold} FOR UPDATE SKIP LOCKED`;
    for (const row of stale) {
      await tx.searchRun.update({ where: { id: row.id }, data: { status: row.resumable ? "queued" : "partial", finishedAt: row.resumable ? null : now, lockedBy: null, heartbeatAt: null, ...(!row.resumable ? { incompleteReason: "Выполнение прервано перезапуском; полученные результаты сохранены" } : {}) } });
      await tx.searchRunSource.updateMany({ where: { runId: row.id, status: { in: ["queued", "running"] } }, data: { status: row.resumable ? "queued" : "cancelled", statusReasonRu: "Выполнение прервано перезапуском" } });
    }
    return stale.length;
  });
}
type SourceDetails = Omit<SourceRun, "status"> & { status: string; adapterStatus?: string; failureCode?: string; pagesFetched?: number; listingsFetched?: number; incomplete?: boolean; retryAfterAt?: string; actionUrl?: string };
export async function trustedListing(listing: NormalizedListing) {
  const copy = { ...listing, seller: { ...listing.seller } };
  delete copy.seller.ownerVerification;
  const existing = await db.externalListing.findFirst({ where: { source: listing.source, sourceListingId: stableListingId(listing.sourceListingId, listing.url), sourceUnitId: listing.sourceUnitId }, include: { verifications: { orderBy: [{ verifiedAt: "desc" }, { id: "asc" }], take: 1 } } });
  copy.firstSeenAt = existing?.firstSeenAt.toISOString() ?? listing.fetchedAt;
  copy.lastCheckedAt = existing?.lastCheckedAt?.toISOString() ?? null;
  const verification = existing?.verifications[0];
  if (verification?.ownerConfirmed) copy.seller.ownerVerification = { source: "employee", method: "employee_check", checkedAt: verification.verifiedAt.toISOString(), verifiedBy: verification.verifiedBy };
  return copy;
}
export async function processSearchQueue(options: { scraper?: ScraperAdapter; signal?: AbortSignal; workerId?: string } = {}) {
  if (options.signal?.aborted || getConfig().isReadOnlyInstance) return false;
  await recoverSearchQueue();
  const workerId = `${options.workerId ?? "search"}:${randomUUID()}`;
  const run = await transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(310105)`;
    // One durable slot across all processes; bounded per-source adapter concurrency stays separate.
    if (await tx.searchRun.count({ where: { status: "running", lockedBy: { not: null } } })) return null;
    const candidate = await tx.searchRun.findFirst({ where: { status: "queued" }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
    if (!candidate) return null;
    const claimed = await tx.searchRun.updateMany({ where: { id: candidate.id, status: "queued", cancelRequested: false }, data: { status: "running", lockedBy: workerId, heartbeatAt: new Date() } });
    return claimed.count ? tx.searchRun.findUniqueOrThrow({ where: { id: candidate.id } }) : null;
  });
  if (!run) return false;
  const controller = new AbortController(), stop = () => controller.abort();
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const deadline = run.deadlineAt?.getTime() ?? Date.now() + 180000;
  if (deadline <= Date.now()) stop();
  const deadlineTimer = setTimeout(stop, Math.max(1, deadline - Date.now()));
  let checking = false;
  const poll = setInterval(() => {
    if (checking) return; checking = true;
    void db.searchRun.updateMany({ where: { id: run.id, status: "running", lockedBy: workerId, cancelRequested: false }, data: { heartbeatAt: new Date() } }).then(r => { if (!r.count) stop(); }).catch(stop).finally(() => { checking = false; });
  }, 500);
  try {
    const user = await db.user.findUniqueOrThrow({ where: { id: run.userId } });
    const actor: Actor = { userId: user.id, login: user.login, displayName: user.displayName, role: user.roleCode as Actor["role"], mustChangePassword: user.mustChangePassword, sessionId: "worker" };
    if (!user.isActive) throw new Error("INACTIVE_USER");
    if (run.needId) await loadAccessibleNeed(db, actor, run.needId);
    const filters = parseInput(SearchFilters, run.filters);
    const settings = await searchSettings();
    const params = run.depthParams as { confirmedPaid?: boolean; previousRunId?: string | null; depth?: { maxPages: number; limit: number }; sourceDepth?: Partial<Record<typeof SOURCES[number], { maxPages: number; limit: number }>>; scenario?: string };
    const adapter = options.scraper ?? scraperFor(settings, params.scenario, params);
    const ai = settings.aiEnabled && params.confirmedPaid ? await getSearchAi() : null;
    for (const source of filters.sources) {
      if (controller.signal.aborted) break;
      const claimed = await transaction(async tx => {
        const lease = await tx.searchRun.updateMany({ where: { id: run.id, status: "running", lockedBy: workerId, cancelRequested: false }, data: { heartbeatAt: new Date() } });
        return lease.count ? tx.searchRunSource.updateMany({ where: { runId: run.id, source, status: "queued" }, data: { status: "running" } }) : { count: 0 };
      });
      if (!claimed.count) continue;
      const started = Date.now();
      let result: { listings: SearchResult["listings"]; sources: SourceDetails[] };
      try {
        // Even a faulty adapter that ignores AbortSignal cannot hold the durable slot indefinitely.
        let abortTimer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        try {
          const detailed = adapter as ScraperAdapter & { searchDetailed?: (input: unknown, context: { signal: AbortSignal; deadline: number }) => Promise<AdapterSearchResult> };
          const search = detailed.searchDetailed ? detailed.searchDetailed({ ...filters, sources: [source] }, { signal: controller.signal, deadline }) : adapter.search({ ...filters, sources: [source] }, { signal: controller.signal, deadline });
          result = await Promise.race([search, new Promise<SearchResult>(resolve => {
            onAbort = () => { abortTimer = setTimeout(() => resolve({ listings: [], sources: [{ source, status: "timeout", resultCount: 0, reason: "Отмена или общий срок выполнения" }] }), 2000); };
            if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener("abort", onAbort, { once: true });
          })]);
        } finally { if (abortTimer) clearTimeout(abortTimer); if (onAbort) controller.signal.removeEventListener("abort", onAbort); }
      }
      catch { result = { listings: [], sources: [{ source, status: "error", resultCount: 0, reason: "Источник недоступен; прежние данные сохранены" }] }; }
      const items: SearchResult["listings"] = [];
      for (const item of result.listings) {
        if (item.listing.source !== source) continue;
        const listing = await trustedListing(item.listing);
        let evaluation = evaluateListing(listing, filters, run.startedAt);
        if (ai && evaluation.aiPending.length && !controller.signal.aborted) {
          let onAbort: (() => void) | undefined;
          try {
            evaluation = await Promise.race([
              analyzeUnresolved(listing, evaluation, { analyze: async ({ description, criteria }) => {
                const result = await ai.analyzeDescriptions(aiContext(actor, run.id), { listings: [{ id: "listing", publicDescription: description }], unresolvedCriteria: criteria });
                return result.evidence.map(e => ({ criterion: e.criterion, state: e.result, evidence: e.quote ?? "", source: "ai" as const }));
              } }, controller.signal),
              new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error("SEARCH_ABORTED")); if (controller.signal.aborted) onAbort(); else controller.signal.addEventListener("abort", onAbort, { once: true }); }),
            ]);
          } catch { /* Keep rule results on budget limit, cancellation or provider failure. */ }
          finally { if (onAbort) controller.signal.removeEventListener("abort", onAbort); }
        }
        items.push({ listing, evaluation });
      }
      const detail = result.sources.find(s => s.source === source) as SourceDetails | undefined;
      const adapterStatus = detail?.adapterStatus ?? detail?.status ?? "error";
      const status = detail?.actionUrl || detail?.failureCode === "NEEDS_USER_ACTION" ? "needs_user_action" : adapterStatus === "rate_limited" ? "blocked" : adapterStatus === "parse_failed" ? "error" : adapterStatus === "cancelled" ? "cancelled" : adapterStatus;
      await transaction(async tx => {
        const fence = await tx.searchRun.updateMany({ where: { id: run.id, status: "running", lockedBy: workerId }, data: { heartbeatAt: new Date(), progress: { phase: "fetching", source } } });
        if (!fence.count) return;
        for (const item of items) await persistListing(tx, run.id, item.listing, item.evaluation, params.previousRunId ?? null);
        await tx.searchRunSource.update({ where: { runId_source: { runId: run.id, source } }, data: { status, resultCount: items.length, receivedCount: detail?.listingsFetched ?? items.length, acceptedCount: items.filter(i => i.evaluation.verdict !== "rejected").length, depthReached: detail?.pagesFetched ?? 0,
          durationMs: Date.now() - started, reason: detail?.reason, statusReasonRu: detail?.reason, needsUserAction: status === "needs_user_action", retryAfterAt: detail?.retryAfterAt ? new Date(detail.retryAfterAt) : null } });
        if (detail?.incomplete || status !== "success") await tx.searchRun.update({ where: { id: run.id }, data: { incompleteReason: "Выборка неполная: ограничения глубины или доступности площадок" } });
      });
    }
    await transaction(async tx => {
      const fenced = await tx.searchRun.updateMany({ where: { id: run.id, status: "running", lockedBy: workerId }, data: { heartbeatAt: new Date() } });
      if (!fenced.count) return;
      const sources = await tx.searchRunSource.findMany({ where: { runId: run.id } });
      const fresh = await tx.searchRun.findUniqueOrThrow({ where: { id: run.id } });
      const stopped = controller.signal.aborted || fresh.cancelRequested;
      const needsAction = sources.some(s => s.needsUserAction);
      const partial = stopped || sources.some(s => !["success", "disabled", "completed"].includes(s.status));
      const status = needsAction && !stopped ? "needs_user_action" : partial ? "partial" : "completed";
      await tx.searchRunSource.updateMany({ where: { runId: run.id, status: { in: ["queued", "running"] } }, data: { status: "cancelled", statusReasonRu: "Отмена или общий срок выполнения" } });
      if (stopped) await tx.searchRunSource.updateMany({ where: { runId: run.id, needsUserAction: true }, data: { status: "cancelled", needsUserAction: false } });
      await tx.searchRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), lockedBy: null, progress: { phase: status }, ...(stopped ? { incompleteReason: "Поиск остановлен; частичные результаты сохранены" } : {}) } });
      if (run.savedSearchId && (status === "completed" || await tx.searchRunResult.count({ where: { runId: run.id } }) > 0)) await tx.savedSearch.update({ where: { id: run.savedSearchId }, data: { lastSuccessfulRunId: run.id, lastRunAt: run.startedAt } });
      await searchAudit(tx, actor, "finished", "SearchRun", run.id, { status });
    });
  } catch {
    await transaction(async tx => {
      const fence = await tx.searchRun.updateMany({ where: { id: run.id, status: "running", lockedBy: workerId }, data: { status: "partial", finishedAt: new Date(), lockedBy: null, progress: { phase: "partial" }, incompleteReason: "Ошибка выполнения; сохранённые результаты доступны" } });
      if (fence.count) await tx.searchRunSource.updateMany({ where: { runId: run.id, status: { in: ["running", "queued"] } }, data: { status: "error", statusReasonRu: "Выполнение прервано; сохранённые данные доступны" } });
    });
  } finally {
    clearInterval(poll); clearTimeout(deadlineTimer); options.signal?.removeEventListener("abort", stop);
  }
  await regroupRunListings(run.id);
  return true;
}
