import { Prisma } from "@/generated/prisma/client";
import { lockSql } from "@/shared/db/dialect";
import type { SearchContinuationPort, PreparedSearch, SessionSource } from "@/modules/browser-sessions/domain/session";
import { configureBrowserSessionSearch } from "@/modules/browser-sessions/application/dependencies";
import type { BrowserContext, Page } from "playwright-core";
import { db, transaction } from "@/shared/db/client";
import { ConflictError } from "@/shared/errors";
import { parseInput } from "@/shared/validation";
import { SearchFilters, type NormalizedListing, type SearchResult } from "../domain/types";
import { evaluateListing } from "../domain/evaluation";
import { accessibleRun, persistListing, searchAudit } from "./search-service";
import { trustedListing } from "./search-queue";
import { loadAccessibleNeed } from "@/modules/needs/application/need-service";
import { regroupRunListings } from "./duplicate-ingestion";
import { parseExternalUrl } from "@/shared/net/ssrf";
import type { DepthOptions } from "../infrastructure/source-limits";

export interface InteractiveSearchAdapter {
  prepare(filters: SearchFilters, source: SessionSource, depth?: DepthOptions): Promise<PreparedSearch>;
  isReady(page: Page, source: SessionSource): Promise<boolean>;
  collect(input: { source: SessionSource; parameters: unknown; page: Page; context: BrowserContext; signal: AbortSignal }): Promise<{ listings: NormalizedListing[]; blocked: boolean; depthReached: number; incomplete: boolean }>;
}
export function attachInteractiveSearchAdapter(adapter: InteractiveSearchAdapter): SearchContinuationPort {
  const port: SearchContinuationPort = {
    async prepare(actor, runId, source) {
      const run = await accessibleRun(actor, runId);
      const row = await db.searchRunSource.findUnique({ where: { runId_source: { runId, source } } });
      if (run.cancelRequested) throw new ConflictError("SEARCH_NOT_WAITING", "Источник не ожидает проверки сотрудника");
      const params = run.depthParams as { depth?: DepthOptions; sourceDepth?: Partial<Record<SessionSource, DepthOptions>> };
      const filters = parseInput(SearchFilters, run.filters);
      
      
      
      if (row?.status === "blocked" && !row.needsUserAction) {
        let prepared: PreparedSearch;
        try { prepared = await adapter.prepare(filters, source, params.sourceDepth?.[source] ?? params.depth); }
        catch (error) {
          if (error instanceof ConflictError && error.code === "SOURCE_CONTINUATION_NOT_ALLOWED") await port.blocked(runId, source, "access_not_allowed");
          throw error;
        }
        
        
        await transaction(async tx => {
          await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM search_runs WHERE id=${runId}::uuid FOR UPDATE`));
          await tx.searchRunSource.updateMany({ where: { runId, source, status: "blocked" }, data: { status: "needs_user_action", needsUserAction: true, statusReasonRu: "Открыта ручная проверка сотрудником" } });
          await tx.searchRun.updateMany({ where: { id: runId, status: "partial" }, data: { status: "needs_user_action", progress: { phase: "needs_user_action" }, finishedAt: null, incompleteReason: null } });
        });
        return prepared;
      }
      if (!row?.needsUserAction || row.status !== "needs_user_action") throw new ConflictError("SEARCH_NOT_WAITING", "Источник не ожидает проверки сотрудника");
      try { return await adapter.prepare(filters, source, params.sourceDepth?.[source] ?? params.depth); }
      catch (error) {
        if (error instanceof ConflictError && error.code === "SOURCE_CONTINUATION_NOT_ALLOWED") await port.blocked(runId, source, "access_not_allowed");
        throw error;
      }
    },
    isReady: (page, source) => adapter.isReady(page, source),
    async resume(input) {
      const run = await accessibleRun(input.actor, input.runId);
      const waiting = await db.searchRunSource.findUnique({ where: { runId_source: { runId: run.id, source: input.source } } });
      if (run.cancelRequested || input.signal.aborted || !waiting?.needsUserAction || !["needs_user_action", "partial"].includes(run.status)) return "blocked";
      const result = await adapter.collect(input);
      if (input.signal.aborted) return "blocked";
      const filters = parseInput(SearchFilters, run.filters);
      const listings: SearchResult["listings"] = [];
      for (const raw of result.listings) {
        if (raw.source !== input.source || input.signal.aborted) continue;
        parseExternalUrl(raw.url);
        const listing = await trustedListing(raw);
        listings.push({ listing, evaluation: evaluateListing(listing, filters, run.startedAt) });
      }
      const outcome = await transaction(async tx => {
        const fence = await tx.searchRun.updateMany({ where: { id: run.id, cancelRequested: false, status: { in: ["needs_user_action", "partial"] } }, data: { heartbeatAt: new Date() } });
        const source = await tx.searchRunSource.findUniqueOrThrow({ where: { runId_source: { runId: run.id, source: input.source } } });
        if (!fence.count || !source.needsUserAction || input.signal.aborted) return "blocked";
        if (!await tx.user.findFirst({ where: { id: input.actor.userId, isActive: true } })) return "blocked";
        if (run.needId) await loadAccessibleNeed(tx, input.actor, run.needId);
        for (const item of listings) {
          input.signal.throwIfAborted();
          await persistListing(tx, run.id, item.listing, item.evaluation, (run.depthParams as { previousRunId?: string }).previousRunId ?? null);
        }
        const count = await tx.searchRunResult.count({ where: { runId: run.id, listing: { source: input.source } } });
        const acceptedCount = await tx.searchRunResult.count({ where: { runId: run.id, listing: { source: input.source }, verdict: { not: "rejected" } } });
        await tx.searchRunSource.update({ where: { id: source.id }, data: { status: result.blocked ? "blocked" : result.incomplete ? "partial" : "completed", needsUserAction: false, resultCount: count, receivedCount: count, acceptedCount, depthReached: result.depthReached, reason: null, statusReasonRu: result.blocked ? "Повторная блокировка. Полученное сохранено; используйте добавление по ссылке или официальный импорт." : "Продолжено после ручной проверки" } });
        const remaining = await tx.searchRunSource.findMany({ where: { runId: run.id } });
        const status = remaining.some(s => s.needsUserAction) ? "needs_user_action" : remaining.every(s => ["success", "completed", "disabled"].includes(s.status)) ? "completed" : "partial";
        input.signal.throwIfAborted();
        await tx.searchRun.update({ where: { id: run.id }, data: { status, progress: { phase: status }, finishedAt: new Date(), incompleteReason: status === "completed" ? null : "Выборка неполная: ограничения площадок" } });
        await searchAudit(tx, input.actor, "continued", "SearchRun", run.id, { source: input.source, count });
        return result.blocked ? "blocked" as const : "completed" as const;
      });
      await regroupRunListings(run.id);
      return outcome;
    },
    async isCancelled(runId) {
      const run = await db.searchRun.findUnique({ where: { id: runId }, select: { cancelRequested: true, user: { select: { isActive: true } } } });
      return !run || run.cancelRequested || !run.user.isActive;
    },
    async blocked(runId, source, _reason) {
      await transaction(async tx => {
        await tx.$executeRaw(lockSql(Prisma.sql`SELECT id FROM search_runs WHERE id=${runId}::uuid FOR UPDATE`));
        await tx.searchRunSource.updateMany({ where: { runId, source, needsUserAction: true }, data: { status: "blocked", needsUserAction: false, statusReasonRu: "Повторная блокировка или продолжение недоступно. Используйте ручное добавление или официальный импорт." } });
        if (!await tx.searchRunSource.count({ where: { runId, needsUserAction: true } })) await tx.searchRun.updateMany({ where: { id: runId, status: "needs_user_action" }, data: { status: "partial", progress: { phase: "partial" }, incompleteReason: "Выборка неполная: источник недоступен после ручной проверки", finishedAt: new Date() } });
      });
    },
  };
  configureBrowserSessionSearch(port);
  return port;
}
